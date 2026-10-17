import type { Namespace } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoutineConfig,
  MatchingConfig,
  RandomizationConfig,
  SessionMember,
} from "ame-shared";
import { evaluateFilters } from "ame-shared/propertyFilters";
import { buildProgressSequence, detectMatchingPeriods } from "ame-shared/randomization";
import { findOwningDesign } from "ame-shared/blockOwnership";
import type { SessionDesign } from "ame-shared/sessionDesign";
import prisma from "../prisma.js";
import { dealRoles } from "../roleCycle.js";
import { closeSession } from "./progressHandler.js";
import { findActiveSession, sessionMembersOf } from "./sessionLookup.js";
import { activeMembers } from "./sessionMembership.js";
import type { TypedSocket, SocketState } from "./index.js";
import type { MatchLease } from "./waitingRoomStore.js";
import type { WaitingRoomStore, WaitingEntry } from "./waitingRoomStore.js";
import { notifyAdminQueueUpdate, pushAdminSessionUpdate } from "./adminHandler.js";
import { toQueueEntries } from "./queueSnapshot.js";
import { safeOn, safeOnDisconnect } from "./safeListener.js";
import { reportError } from "../errors/reportError.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

const MatchingTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * A matching routine needs at least two seats. One seat matches a participant
 * with nobody; zero seats makes `tryFifoMatch`'s `while (room.length >= slotCount)`
 * a loop whose `splice(0, 0)` never shrinks the room — it starves the event loop
 * and mass-creates empty sessions.
 */
const MinimumSlotCount = 2;

/** True when a matching config declares enough slots to form a session. */
export function slotsAreMatchable(
  matching: MatchingConfig | null | undefined,
): boolean {
  return (matching?.slots.length ?? 0) >= MinimumSlotCount;
}

export function registerMatchingHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
  store: WaitingRoomStore,
): void {
  safeOn(socket, "match:join", async ({ routineName }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) {
      socket.emit("error", {
        code: "NOT_JOINED",
        message: "Join experiment first",
      });
      return;
    }

    try {
      const experiment = await prisma.experiment.findUnique({
        where: { id: state.experimentId },
      });
      if (!experiment) return;

      const routines = experiment.routines as unknown as RoutineConfig[];
      const routine = routines.find((r) => r.name === routineName);
      if (!routine?.matching) {
        socket.emit("error", {
          code: "NO_MATCHING",
          message: "Routine has no matching config",
        });
        return;
      }

      if (!slotsAreMatchable(routine.matching)) {
        const configuredSlotCount = routine.matching.slots.length;
        socket.emit("error", {
          code: "INVALID_MATCHING",
          message: `Routine "${routineName}" has ${configuredSlotCount} matching ${configuredSlotCount === 1 ? "slot" : "slots"}; at least ${MinimumSlotCount} are required`,
        });
        return;
      }

      if (await resumeFormedSession(socket, state, routineName)) return;

      await closeActiveSessions(ns, state.participantId);

      const participant = await prisma.participant.findUnique({
        where: { id: state.participantId },
      });
      const properties =
        (participant?.properties as Record<string, unknown>) ?? {};

      const matching = routine.matching;
      const roomKey = `ame:match:${state.experimentId}:${routineName}`;

      await store.add(roomKey, {
        participantId: state.participantId,
        socketId: socket.id,
        condition: state.condition ?? null,
        // Captured here rather than looked up by the dashboard: the waiting
        // room is the only place that knows who is queued right now.
        externalId: participant?.externalId ?? null,
        properties,
        joinedAt: Date.now(),
      });

      const room = await store.getEntries(roomKey);
      const target = matching.slots.length;

      socket.emit("match:waiting", { current: room.length, target });

      for (const entry of room) {
        if (entry.socketId !== socket.id) {
          ns.to(entry.socketId).emit("match:waiting", {
            current: room.length,
            target,
          });
        }
      }

      notifyAdminQueueUpdate(
        state.experimentId,
        routineName,
        "joined",
        state.participantId,
        toQueueEntries(room),
      );

      await tryMatch(
        ns,
        store,
        roomKey,
        matching,
        state.experimentId,
        routineName,
        state.progress ?? 0,
      );

      if (matching.timeout && matching.timeout > 0) {
        const timeoutKey = `${roomKey}:${state.participantId}`;
        if (!MatchingTimeouts.has(timeoutKey)) {
          const timer = setTimeout(() => {
            // setTimeout never awaits this, so an unhandled rejection here would
            // end the process and every live participant's socket with it — the
            // same hazard `safeOn` guards against for a synchronous handler.
            handleTimeout(ns, store, socket, roomKey, matching, state).catch((err) => {
              console.error(`[matchingHandler] handleTimeout failed for ${state.participantId}:`, err);
              reportError(err, {
                source: "SERVER_TASK",
                experimentId: state.experimentId ?? null,
                participantId: state.participantId ?? null,
                routine: routineName,
                progress: state.progress ?? null,
                context: { task: "matchingHandler.handleTimeout" },
              });
            });
            MatchingTimeouts.delete(timeoutKey);
          }, matching.timeout * 1000);
          MatchingTimeouts.set(timeoutKey, timer);
        }
      }
    } catch (err) {
      socket.emit("error", {
        code: "INTERNAL",
        message: "Failed to join matching",
      });
    }
  });

  safeOnDisconnect(socket, async () => {
    const state = socket.data as SocketState;
    if (!state.participantId) return;

    // A device (phone) socket carries the participant's participantId too, but
    // it is not the participant's own connection. Without this guard, the
    // phone's screen locking would unqueue the participant from every waiting
    // room they are in — with no grace period and no recovery, since nothing
    // re-adds them and their (still-connected) desktop never re-emits
    // match:join. See the identical guard, and its rationale, in
    // experimentHandler's disconnect handler.
    if (state.deviceMode) return;

    // socket.io never awaits this listener, so anything that rejects here is an
    // unhandled rejection and Node ends the process — one participant closing a
    // tab would end every other session on the server. The timer sweep runs
    // whatever the store did, because a leaked timeout outlives the socket.
    try {
      const affectedRooms = await store.removeFromAll(state.participantId);

      for (const roomKey of affectedRooms) {
        const room = await store.getEntries(roomKey);
        for (const entry of room) {
          ns.to(entry.socketId).emit("match:waiting", {
            current: room.length,
            target: 0,
          });
        }
        if (state.experimentId) {
          const parts = roomKey.split(":");
          const routineName = parts[parts.length - 1];
          notifyAdminQueueUpdate(
            state.experimentId,
            routineName,
            "left",
            state.participantId,
            toQueueEntries(room),
          );
        }
      }
    } catch (err) {
      console.error(
        `[disconnect] Failed to clear ${state.participantId} from the waiting rooms:`,
        err,
      );
    }

    for (const [key, timer] of MatchingTimeouts.entries()) {
      if (key.includes(state.participantId)) {
        clearTimeout(timer);
        MatchingTimeouts.delete(key);
      }
    }
  });
}

/**
 * A participant who reloads on the step that formed their session mounts the
 * matching routine again and re-sends `match:join` — the client cannot tell it
 * is seated, because a reload does not restore its session id. Closing active
 * sessions here would end the session for the whole cohort, so when the
 * session was formed by this routine at this step, re-send the seat instead.
 *
 * @returns true when the participant was resumed and nothing else should run.
 */
async function resumeFormedSession(
  socket: TypedSocket,
  state: SocketState,
  routineName: string,
): Promise<boolean> {
  const info = await findActiveSession(state.participantId!, state.experimentId!);
  if (!info) return false;
  const { session } = info;
  if (session.routineName !== routineName || session.matchProgress !== (state.progress ?? 0)) {
    return false;
  }

  // The reloaded socket is new, so it has to rejoin the room exp:sync is sent to.
  await socket.join(`session:${session.id}`);
  socket.emit("match:matched", {
    sessionId: session.id,
    peers: activeMembers(session.participants)
      .map((member) => member.participantId)
      .filter((participantId) => participantId !== state.participantId),
    seat: info.seat,
    slotName: info.slotName ?? `seat-${info.seat}`,
    members: sessionMembersOf(info),
  });
  return true;
}

async function closeActiveSessions(
  ns: TypedNamespace,
  participantId: string,
): Promise<void> {
  const activeSessionParticipants =
    await prisma.sessionParticipant.findMany({
      where: {
        participantId,
        session: { status: "ACTIVE" },
      },
      include: { session: true },
    });

  for (const sp of activeSessionParticipants) {
    await closeSession(ns, sp.session.id, sp.session.experimentId);
  }
}

async function tryMatch(
  ns: TypedNamespace,
  store: WaitingRoomStore,
  roomKey: string,
  matching: MatchingConfig,
  experimentId: string,
  routineName: string,
  matchProgress: number,
): Promise<void> {
  const slotCount = matching.slots.length;

  for (;;) {
    // One attempt per room at a time. A refused lease means another attempt
    // holds the room; it re-checks after releasing (below), so it will see the
    // participant we just added and returning here strands nobody.
    const lease = await store.acquireMatchLease(roomKey);
    if (!lease) return;

    let sizeBefore: number;
    try {
      // Read the room INSIDE the lease. A snapshot taken before acquiring
      // could already be stale by the time the attempt runs.
      const room = await store.getEntries(roomKey);
      sizeBefore = room.length;
      // Too few people to seat is not a reason to leave: the re-check below
      // still has to run, because someone may have arrived and been refused
      // the lease between this read and the release.
      if (sizeBefore >= slotCount) {
        await runStrategy(
          ns,
          store,
          room,
          roomKey,
          matching,
          experimentId,
          routineName,
          matchProgress,
          lease,
        );
      }
    } finally {
      await lease.release();
    }

    // Re-check AFTER releasing, which is what makes this safe: anyone refused
    // the lease was refused before that release, so their entry is on the
    // store by now. Without this, two people can sit in a full room that
    // nobody ever looks at again — the first holds the lease and sees only
    // itself, the second is refused and gives up.
    const room = await store.getEntries(roomKey);
    // An unchanged size means the strategy could form no cohort from these
    // people and none arrived, so another round would repeat itself exactly.
    if (room.length < slotCount || room.length === sizeBefore) return;
  }
}

/** Dispatch to the strategy that forms this routine's cohorts. */
async function runStrategy(
  ns: TypedNamespace,
  store: WaitingRoomStore,
  room: WaitingEntry[],
  roomKey: string,
  matching: MatchingConfig,
  experimentId: string,
  routineName: string,
  matchProgress: number,
  lease: MatchLease,
): Promise<void> {
  switch (matching.strategy) {
    case "fifo":
      await tryFifoMatch(
        ns,
        store,
        room,
        roomKey,
        matching,
        experimentId,
        routineName,
        matchProgress,
        lease,
      );
      break;
    case "property":
      await tryPropertyMatch(
        ns,
        store,
        room,
        roomKey,
        matching,
        experimentId,
        routineName,
        matchProgress,
        lease,
      );
      break;
    case "manual":
      // Nothing forms a manual cohort here: the experimenter does it from the
      // Participants tab, and `admin.manualMatch` deals and persists the roles
      // exactly as `createAndNotifySession` does below.
      break;
  }
}

/**
 * Take every candidate out of the room, or none of them.
 *
 * `remove` returns the entry it deleted, so a null means another attempt
 * claimed that participant first. Ignoring that return is what allowed two
 * attempts to build a session from the same people: both read a full room, both
 * spliced the same entries, and the second `remove` quietly did nothing.
 *
 * A partial claim is given back, so whoever is racing us — or the next join —
 * can still use them.
 */
async function claimAll(
  store: WaitingRoomStore,
  roomKey: string,
  candidates: WaitingEntry[],
): Promise<WaitingEntry[] | null> {
  const claimed: WaitingEntry[] = [];
  for (const candidate of candidates) {
    const entry = await store.remove(roomKey, candidate.participantId);
    if (entry) claimed.push(entry);
  }

  if (claimed.length === candidates.length) return claimed;

  for (const entry of claimed) {
    await store.add(roomKey, entry);
  }
  return null;
}

async function tryFifoMatch(
  ns: TypedNamespace,
  store: WaitingRoomStore,
  room: WaitingEntry[],
  roomKey: string,
  matching: MatchingConfig,
  experimentId: string,
  routineName: string,
  matchProgress: number,
  lease: MatchLease,
): Promise<void> {
  if (!slotsAreMatchable(matching)) return;

  const slotCount = matching.slots.length;
  while (room.length >= slotCount) {
    const matched = await claimAll(store, roomKey, room.splice(0, slotCount));
    if (!matched) return;

    // Fence immediately before the write, not once per lease: a holder that
    // stalls between two cohorts must be stopped at the second.
    if (!(await lease.commit())) {
      for (const entry of matched) await store.add(roomKey, entry);
      return;
    }

    await createAndNotifySession(
      ns,
      matched,
      matching,
      experimentId,
      routineName,
      matchProgress,
    );
  }
}

async function tryPropertyMatch(
  ns: TypedNamespace,
  store: WaitingRoomStore,
  room: WaitingEntry[],
  roomKey: string,
  matching: MatchingConfig,
  experimentId: string,
  routineName: string,
  matchProgress: number,
  lease: MatchLease,
): Promise<void> {
  if (!slotsAreMatchable(matching)) return;

  const assigned: WaitingEntry[] = [];
  const usedIndices = new Set<number>();

  for (const slot of matching.slots) {
    const idx = room.findIndex((entry, i) => {
      if (usedIndices.has(i)) return false;
      if (!slot.filters || slot.filters.length === 0) return true;
      return evaluateFilters(entry.properties, slot.filters);
    });

    if (idx === -1) return;
    assigned.push(room[idx]);
    usedIndices.add(idx);
  }

  const claimed = await claimAll(store, roomKey, assigned);
  if (!claimed) return;

  if (!(await lease.commit())) {
    for (const entry of claimed) await store.add(roomKey, entry);
    return;
  }

  await createAndNotifySession(
    ns,
    claimed,
    matching,
    experimentId,
    routineName,
    matchProgress,
  );
}

async function createAndNotifySession(
  ns: TypedNamespace,
  matched: WaitingEntry[],
  matching: MatchingConfig,
  experimentId: string,
  routineName: string,
  matchProgress: number,
): Promise<void> {
  const participantIds = matched.map((e) => e.participantId);

  // Read before the session is created so the block that owns `routineName` can
  // be stamped on it. The randomization branch below reuses this same row
  // instead of reading the experiment a second time.
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
  });
  const designs = Array.isArray(experiment?.sessionDesigns)
    ? (experiment.sessionDesigns as unknown as SessionDesign[])
    : [];

  // Under property matching the slot filters already decided who belongs where,
  // so the role IS the slot index; shuffling would violate the filters the
  // researcher authored. Otherwise the assignment mode deals them.
  const roles =
    matching.strategy === "property"
      ? matched.map((_, i) => i)
      : await dealRoles(experimentId, matched.length, matching.assignment ?? { mode: "random" });

  const session = await prisma.session.create({
    data: {
      experimentId,
      routineName,
      // The design's id, so a renamed block keeps its existing sessions. Null
      // for a matching routine no Session Designer block claims.
      blockId: findOwningDesign(routineName, designs)?.id ?? null,
      matchProgress,
      status: "ACTIVE",
      matchedAt: new Date(),
      participants: {
        create: matched.map((entry, i) => ({
          participantId: entry.participantId,
          seat: i,
          slotName: matching.slots[i]?.name ?? `seat-${i}`,
        })),
      },
    },
  });

  // The write this whole feature turns on: without it every participant holds
  // index 0 and progressHandler resolves them all to the first role name.
  await Promise.all(
    matched.map((entry, i) =>
      prisma.participant.update({
        where: { id: entry.participantId },
        data: { role: roles[i] },
      }),
    ),
  );

  // Generate shared progress sequence for session-scoped randomization
  if (experiment?.randomization) {
    const config = experiment.randomizationConfig as RandomizationConfig | null;
    // Use the first matched participant's condition (all should share condition in a session)
    const firstParticipant = await prisma.participant.findUnique({
      where: { id: matched[0].participantId },
    });
    const conditionKey = firstParticipant?.condition ?? "Basic";
    const conditionRanges = config?.[conditionKey];

    if (conditionRanges && conditionRanges.length > 0) {
      const contentRows = await prisma.experimentContent.findMany({
        where: { experimentId, condition: conditionKey },
        orderBy: { progress: "asc" },
        select: { progress: true, trialNumber: true, routine: true },
      });

      if (contentRows.length > 0) {
        const routines = experiment.routines as unknown as RoutineConfig[];
        const matchingPeriods = detectMatchingPeriods(contentRows, routines);

        // Filter to session-scope ranges (inside the current matching period)
        const currentPeriod = matchingPeriods.find((mp) => mp.fromProgress <= matchProgress);
        if (currentPeriod) {
          const sessionRanges = conditionRanges.filter((range) => {
            const rangeRows = contentRows.filter(
              (r) => r.trialNumber >= range.fromTrial && r.trialNumber <= range.toTrial,
            );
            return rangeRows.every(
              (r) => r.progress >= currentPeriod.fromProgress && r.progress <= currentPeriod.toProgress,
            );
          });

          if (sessionRanges.length > 0) {
            // Count sessions for this experiment+routine for Latin square
            const sessionCount = await prisma.session.count({
              where: { experimentId, routineName },
            });

            const sharedSequence = buildProgressSequence(
              contentRows.map((r) => ({ progress: r.progress, trialNumber: r.trialNumber })),
              sessionRanges,
              sessionCount - 1,
            );

            await prisma.session.update({
              where: { id: session.id },
              data: { sharedProgressSequence: sharedSequence },
            });
          }
        }
      }
    }
  }

  const members: SessionMember[] = matched.map((entry, i) => ({
    participantId: entry.participantId,
    seat: i,
    slotName: matching.slots[i]?.name ?? `seat-${i}`,
  }));

  for (const [i, entry] of matched.entries()) {
    const peerIds = participantIds.filter(
      (pid) => pid !== entry.participantId,
    );
    ns.to(entry.socketId).emit("match:matched", {
      sessionId: session.id,
      peers: peerIds,
      seat: i,
      slotName: matching.slots[i]?.name ?? `seat-${i}`,
      members,
    });

    const sockets = await ns.fetchSockets();
    const targetSocket = sockets.find((s) => s.id === entry.socketId);
    if (targetSocket) {
      targetSocket.join(`session:${session.id}`);
    }

    const timeoutKey = `ame:match:${experimentId}:${routineName}:${entry.participantId}`;
    const timer = MatchingTimeouts.get(timeoutKey);
    if (timer) {
      clearTimeout(timer);
      MatchingTimeouts.delete(timeoutKey);
    }
  }

  // Notify admin of matched participants (queue now empty or reduced)
  for (const entry of matched) {
    notifyAdminQueueUpdate(experimentId, routineName, "matched", entry.participantId, []);
  }

  // The queue tables have just gone empty. Without this the dashboard would go
  // dark at exactly the moment the cohort starts.
  await pushAdminSessionUpdate(experimentId, session.id);
}

async function handleTimeout(
  ns: TypedNamespace,
  store: WaitingRoomStore,
  socket: TypedSocket,
  roomKey: string,
  matching: MatchingConfig,
  state: SocketState,
): Promise<void> {
  if (matching.timeoutAction === "proceed") {
    await store.remove(roomKey, state.participantId!);
    // Not a match:matched with an empty sessionId: the client cannot tell that
    // apart from "still waiting", and the participant would be shown the
    // waiting overlay forever instead of being told their partner never came.
    socket.emit("match:timeout");
  }
}

export { MatchingTimeouts };
