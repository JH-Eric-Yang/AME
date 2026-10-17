import type { Namespace } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoutineConfig,
  ContentPayload,
  ElementConfig,
} from "ame-shared";
import { getDefaultLayout } from "ame-shared/defaultLayouts";
import { evaluateFilters } from "ame-shared/propertyFilters";
import type { AddressingContext } from "ame-shared/participantRef";
import { detectMatchingPeriods } from "ame-shared/randomization";
import { isOnSurface } from "ame-shared/surfaces";
import { chatKey, chatScope } from "ame-shared/videoChat";
import {
  resolveReferences,
  type ResolveOutcome,
  type Unresolved,
} from "../references/resolve.js";
import { prismaLookups } from "../references/lookups.js";
import { visibilityProperties } from "../references/visibility.js";
import { mediaUrlFor } from "../references/mediaToken.js";
import prisma from "../prisma.js";
import { activeParticipantIds } from "./sessionMembership.js";
import { findActiveSession, sessionMembersOf } from "./sessionLookup.js";
import { assignInteractionGroup } from "./groupAssignment.js";
import { deviceRoom } from "./rooms.js";
import type { TypedSocket, SocketState } from "./index.js";
import { recordSessionGrouping, warnOnSoloRoundRobin } from "../sessionGrouping.js";
import { pushAdminSessionUpdate } from "./adminHandler.js";
import { chatTtlSeconds } from "./chatHandler.js";
import { safeOn } from "./safeListener.js";
import { loadMemberRoles, needsMemberRoles } from "./memberRoles.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

const SessionProceedState = new Map<string, Set<string>>();

export function registerProgressHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
): void {
  safeOn(socket, "exp:ready", async () => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) {
      socket.emit("error", {
        code: "NOT_JOINED",
        message: "Join experiment first",
      });
      return;
    }
    try {
      await deliverContent(ns, socket, state);
    } catch (err) {
      console.error("[exp:ready] deliverContent error:", err);
      socket.emit("error", { code: "INTERNAL", message: "Failed to deliver content" });
    }
  });

  safeOn(socket, "exp:proceed", async () => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) {
      socket.emit("error", {
        code: "NOT_JOINED",
        message: "Join experiment first",
      });
      return;
    }

    try {
      // Check for session sync (any active session)
      const activeSession = await findActiveSession(
        state.participantId,
        state.experimentId,
      );
      if (activeSession) {
        // ACTIVE-only, and the SAME list feeds both calls: the barrier must not
        // wait on a seat that has gone, and advanceSession must not increment a
        // departed participant's stored progress for the rest of the run.
        const activeIds = activeParticipantIds(activeSession.session.participants);
        const { released, submitted } = await checkSessionSync(
          state,
          activeSession.session.id,
          activeIds,
        );
        // Early arrivals wait at the barrier; the last one releases everyone.
        if (!released) {
          // findActiveSession awaits, so this session can be closed between
          // that lookup and the line above. The close clears a barrier we were
          // not in yet, and we then join one nobody will ever clear — sitting
          // on "Proceeding..." while our partner finishes. Re-read the row:
          // either the close saw us at the barrier and advanced us, or we see
          // the close here and leave under our own steam. Leaving takes us OUT
          // of the barrier first, and that removal is the claim — whichever
          // side gets it advances the member, and the other finds nothing and
          // does not advance them twice.
          if (await sessionHasClosed(activeSession.session.id)) {
            if (forgetBarrierMember(activeSession.session.id, state.participantId)) {
              await advanceParticipant(ns, socket, state);
            }
            return;
          }

          // Tell the whole cohort where the barrier stands, so the member who
          // has submitted knows they are waiting rather than stuck, and the
          // others know somebody is waiting on them. The release path sends
          // nothing: `exp:content` is the signal that the wait is over.
          ns.to(`session:${activeSession.session.id}`).emit("exp:sync", {
            submitted,
            total: activeIds.length,
            progress: state.progress ?? 0,
          });
          return;
        }
        await advanceSession(ns, activeIds);
        return;
      }

      await advanceParticipant(ns, socket, state);
    } catch (err) {
      console.error("[exp:proceed] error:", err);
      socket.emit("error", { code: "INTERNAL", message: "Failed to proceed" });
    }
  });
}

/**
 * Advance one participant by a single progress step and deliver their next
 * content, or finish them if no content remains.
 *
 * `state` must be that socket's OWN state object: deliverContent reads
 * participantId, condition and progress from it.
 */
async function advanceParticipant(
  ns: TypedNamespace,
  socket: TypedSocket,
  state: SocketState,
  options: DeliverContentOptions = {},
): Promise<void> {
  const newProgress = (state.progress ?? 0) + 1;
  await prisma.participant.update({
    where: { id: state.participantId! },
    data: {
      progress: newProgress,
      currentStage: 0,
      lastLogTime: new Date(),
    },
  });
  state.progress = newProgress;

  // Check if content exists for the new progress
  const condition = state.condition ?? "Basic";
  const experiment = await prisma.experiment.findUnique({
    where: { id: state.experimentId! },
  });
  if (!experiment) return;

  const nextContentProgress = await resolveContentProgress(
    state.experimentId!, state.participantId!, newProgress, condition, experiment,
  );

  const nextContent = await prisma.experimentContent.findFirst({
    where: {
      experimentId: state.experimentId!,
      progress: nextContentProgress,
      condition,
    },
  });

  if (!nextContent) {
    // No more content = experiment complete
    await prisma.participant.update({
      where: { id: state.participantId! },
      data: { completion: true, isLoggedIn: false, lastLogTime: new Date() },
    });

    // Close any active sessions where all members are done
    const sessionParticipants = await prisma.sessionParticipant.findMany({
      where: { participantId: state.participantId! },
      include: { session: true },
    });
    for (const sp of sessionParticipants) {
      if (sp.session.status === "ACTIVE") {
        const allParticipants = await prisma.sessionParticipant.findMany({
          where: { sessionId: sp.session.id },
          include: { participant: true },
        });
        const allDone = allParticipants.every(
          (p) => p.participant.completion || p.participant.withdraw,
        );
        if (allDone) {
          await closeSession(ns, sp.session.id, sp.session.experimentId);
        }
      }
    }

    socket.emit("exp:alert", {
      message: "Experiment complete",
      type: "complete",
    });
    return;
  }

  await deliverContent(ns, socket, state, options);
}

/**
 * Release a synchronised session: EVERY member advances, not only the socket
 * whose proceed completed the barrier. Each member is advanced with their own
 * SocketState, because condition, seat and peers differ per participant.
 *
 * `memberIds` is ACTIVE-only by contract (see the exp:proceed call site).
 *
 * ns.fetchSockets() returns the live local Socket instances under the default
 * adapter — the same assumption matchingHandler makes when it joins matched
 * sockets to the `session:${id}` room.
 *
 * The session close for a routine-end-matching is deferred out of
 * deliverContent and applied ONCE here, after every member has been served, so
 * that no member loses their seat by being later in the loop.
 */
async function advanceSession(
  ns: TypedNamespace,
  memberIds: string[],
): Promise<void> {
  const connectedSockets = await ns.fetchSockets();
  const memberIdSet = new Set(memberIds);
  const socketByParticipant = new Map<string, TypedSocket>();
  for (const connected of connectedSockets) {
    const memberState = connected.data as SocketState;
    if (
      memberState.participantId &&
      memberIdSet.has(memberState.participantId)
    ) {
      socketByParticipant.set(
        memberState.participantId,
        connected as unknown as TypedSocket,
      );
    }
  }

  // sessionId -> experimentId: the close needs the experiment to notify the
  // dashboard, and only the member that deferred the close knows it.
  const deferredSessionCloses = new Map<string, string>();

  for (const participantId of memberIds) {
    const memberSocket = socketByParticipant.get(participantId);

    // The whole iteration is guarded, disconnected members included: a member
    // whose participant row has been deleted must not strand the rest of the
    // cohort at the old progress, nor skip the deferred session close below.
    try {
      if (!memberSocket) {
        // Member disconnected after reaching the barrier. Keep their stored
        // progress in step with the cohort so a reconnect resumes on the same
        // routine. lastLogTime is left alone — they were not active.
        await prisma.participant.update({
          where: { id: participantId },
          data: { progress: { increment: 1 }, currentStage: 0 },
        });
        console.warn(
          `[exp:proceed] Session member ${participantId} has no connected socket; advanced stored progress only`,
        );
        continue;
      }

      await advanceParticipant(
        ns,
        memberSocket,
        memberSocket.data as SocketState,
        { deferredSessionCloses },
      );
    } catch (err) {
      console.error(
        `[exp:proceed] Failed to advance session member ${participantId}:`,
        err,
      );
      memberSocket?.emit("error", {
        code: "INTERNAL",
        message: `Failed to advance session member ${participantId}`,
      });
    }
  }

  // Every member has now been served against the open session; close it once.
  // No member can throw past the guard above, so this always runs — an
  // end-matching session must never be left ACTIVE by one member's failure.
  for (const [sessionId, experimentId] of deferredSessionCloses) {
    await closeSession(ns, sessionId, experimentId);
  }
}

/**
 * Map virtual progress to content progress via randomization sequences.
 * Uses session.sharedProgressSequence during matching periods,
 * participant.progressSequence otherwise.
 */
async function resolveContentProgress(
  experimentId: string,
  participantId: string,
  virtualProgress: number,
  condition: string,
  experiment: { randomization: boolean; routines: unknown },
): Promise<number> {
  if (!experiment.randomization) return virtualProgress;

  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
  });
  const individualSeq = participant?.progressSequence as number[] | null;

  const activeSession = await findActiveSession(participantId, experimentId);
  const sessionSeq = activeSession?.session.sharedProgressSequence ?? null;

  if (!sessionSeq && !individualSeq) return virtualProgress;

  const contentRows = await prisma.experimentContent.findMany({
    where: { experimentId, condition },
    orderBy: { progress: "asc" },
    select: { progress: true, routine: true },
  });
  const routines = experiment.routines as unknown as RoutineConfig[];
  const matchingPeriods = detectMatchingPeriods(contentRows, routines);
  const inMatchingPeriod = matchingPeriods.some(
    (mp) => virtualProgress >= mp.fromProgress && virtualProgress <= mp.toProgress,
  );

  const sequence = inMatchingPeriod && sessionSeq ? sessionSeq : individualSeq;
  if (sequence && virtualProgress < sequence.length) {
    return sequence[virtualProgress];
  }
  return virtualProgress;
}

export interface DeliverContentOptions {
  /**
   * Session ids whose CLOSE is deferred to the caller. When this set is
   * present, a `routine-end-matching` routine records its session id here
   * instead of closing the session inline. `advanceSession` passes one set for
   * the whole cohort, so every member is served against the SAME still-open
   * session and the session is closed exactly once, afterwards.
   */
  deferredSessionCloses?: Map<string, string>;
}

export async function deliverContent(
  ns: TypedNamespace,
  socket: TypedSocket,
  state: SocketState,
  options: DeliverContentOptions = {},
): Promise<void> {
  try {
    const experiment = await prisma.experiment.findUnique({
      where: { id: state.experimentId! },
    });
    if (!experiment) return;

    const routines = experiment.routines as unknown as RoutineConfig[];
    const virtualProgress = state.progress ?? 0;
    const condition = state.condition ?? "Basic";

    // Map virtual progress through randomization sequence
    const contentProgress = await resolveContentProgress(
      state.experimentId!, state.participantId!, virtualProgress, condition, experiment,
    );

    // Content row drives the experiment sequence
    const content = await prisma.experimentContent.findFirst({
      where: {
        experimentId: state.experimentId!,
        progress: contentProgress,
        condition,
      },
      orderBy: { trialNumber: "asc" },
    });

    if (!content) {
      // No content for this progress = experiment complete
      socket.emit("exp:alert", {
        message: "Experiment complete",
        type: "complete",
      });
      return;
    }

    // Look up routine template by name from content row
    const routine = routines.find((r) => r.name === content.routine);
    if (!routine) {
      socket.emit("error", {
        code: "INVALID_CONTENT",
        message: `Routine "${content.routine}" referenced by content not found in experiment templates`,
      });
      return;
    }

    // Load participant info (role + properties)
    const participant = await prisma.participant.findUnique({
      where: { id: state.participantId! },
    });
    const roleIndex = participant?.role ?? 0;
    const roleName = routine.roles?.[roleIndex];
    const properties =
      (participant?.properties as Record<string, unknown>) ?? {};

    // Close session if this is an end-matching routine. A cohort released by
    // advanceSession defers the close: closing here would make the very next
    // member's findActiveSession return null, costing them their seat, their
    // interactionGroup and the session's sharedProgressSequence purely because
    // they came later in the loop.
    const endsMatching = routine.type === "routine-end-matching";
    if (endsMatching && !options.deferredSessionCloses) {
      await closeSessionForParticipant(ns, state.participantId!, state.experimentId!);
    }

    // Load active session info
    const sessionInfo = await findActiveSession(
      state.participantId!,
      state.experimentId!,
    );

    if (endsMatching && options.deferredSessionCloses && sessionInfo) {
      // findActiveSession filtered on this same experimentId, so the session is
      // this experiment's by construction; its select does not carry the column.
      options.deferredSessionCloses.set(
        sessionInfo.session.id,
        state.experimentId!,
      );
    }

    const seat = sessionInfo?.seat ?? null;
    const slotName = sessionInfo?.slotName ?? null;

    // The group comes first: resolving `partner`/`seat` refs needs the members
    // this participant is grouped with, and the group does not depend on the
    // elements, so computing it before merge/resolve/filter changes nothing
    // about those steps.
    const assignment = await assignInteractionGroup({
      sessionInfo,
      routine,
      routines,
      experimentId: state.experimentId!,
      participantId: state.participantId!,
      virtualProgress,
      trialNumber: content.trialNumber ?? 1,
    });
    const interactionGroup = assignment?.interactionGroup;

    if (sessionInfo && assignment?.provenance) {
      const provenance = assignment.provenance;
      warnOnSoloRoundRobin({
        patternType: provenance.patternType,
        groupPeers: provenance.groupPeers,
        seatCount: provenance.seatCount,
        sessionId: sessionInfo.session.id,
        progress: virtualProgress,
        seat: sessionInfo.seat,
      });

      // Persist provenance. The upsert key (session, progress, groupIndex) is
      // member-invariant, so all N members converge on one row. The payload is
      // derived from the ACTIVE seat map, not the full cohort (see
      // groupAssignment): a later member's array may be a smaller, still valid,
      // subset of the group, and the last writer wins.
      await recordSessionGrouping({
        sessionId: sessionInfo.session.id,
        progress: virtualProgress,
        trialNumber: content.trialNumber ?? 1,
        routineName: routine.name,
        groupIndex: provenance.groupIndex,
        seats: provenance.seats,
        participantIds: provenance.participantIds,
      });

      // The pairing this participant just received is now the newest grouping
      // row, so this is where "current pairing" on the dashboard changes.
      //
      // Deliberately NOT awaited: this sits before the exp:content emit, and
      // every member of the cohort reaches it on the same trial transition. An
      // awaited two-table read here would put N sequential round trips into N
      // participants' wait for their next routine, all to produce the same
      // payload — the upsert key is member-invariant. Monitoring must never be
      // on the participant's critical path. pushAdminSessionUpdate catches and
      // logs its own failures, so nothing escapes as an unhandled rejection.
      void pushAdminSessionUpdate(state.experimentId!, sessionInfo.session.id);
    }

    const sessionMembers = sessionInfo ? sessionMembersOf(sessionInfo) : undefined;

    // The text channel follows the group: a rotation moves the participant to a
    // new thread on its own, and a step without a group has no chat.
    state.chat =
      sessionInfo && interactionGroup && interactionGroup.members.length > 0
        ? {
            key: chatKey(sessionInfo.session.id, virtualProgress, interactionGroup.groupIndex),
            scope: chatScope(virtualProgress, interactionGroup.groupIndex),
            memberIds: interactionGroup.members.map((member) => member.participantId),
            seat: interactionGroup.seat,
            ttlSeconds: chatTtlSeconds(experiment.activeTime),
          }
        : undefined;

    // Three steps, in this order: merge the content row's overrides over each
    // element's authored params, resolve every `ref:` in the MERGED params (an
    // override may itself be a ref), then filter by
    // showForRoles/showForSeats/showWhen and split by surface. sendDeviceContent
    // (below) replays the same three steps for a phone that pairs mid-routine,
    // so the device half it computes is identical to the one computed here
    // rather than a second, drifting copy of these rules.
    const contentData = (content.content as Record<string, unknown>) ?? {};
    const merged = mergeContentOverrides(routine.elements ?? [], contentData);
    const outcome = await resolveForParticipant(
      merged,
      state.experimentId!,
      state.participantId!,
      routines,
      {
        session: sessionMembers ? { members: sessionMembers } : null,
        group: interactionGroup ? { members: interactionGroup.members } : null,
      },
    );
    const { screenElements, deviceElements } = filterElementsForParticipant(
      outcome.elements,
      roleName,
      slotName,
      seat,
      visibilityProperties(properties, outcome.values),
      routine.roles,
    );
    const unresolved = unresolvedRefsFor(outcome.unresolvedByElement, [
      ...screenElements,
      ...deviceElements,
    ]);
    warnUnresolved(unresolved, state.participantId!);

    // Skip the await entirely when no label is needed, so other routines keep their timing.
    const memberRoles = needsMemberRoles(routine, sessionMembers)
      ? await loadMemberRoles(routine, sessionMembers, state.experimentId!)
      : undefined;

    const payload: ContentPayload = {
      progress: virtualProgress,
      routine: {
        name: routine.name,
        type: routine.type,
        layout: routine.layout ?? getDefaultLayout(routine.type),
        matching: routine.matching ?? null,
        device: routine.device ?? null,
        config: routine.config,
        interactionPattern: routine.interactionPattern,
      },
      elements: screenElements,
      deviceElements,
      trial: content.trialNumber ?? 1,
      trialInfo: contentData,
      interactionGroup,
      ...(sessionMembers ? { sessionMembers } : {}),
      ...(roleName ? { roleName } : {}),
      ...(memberRoles ? { memberRoles } : {}),
      ...(unresolved.length > 0 ? { unresolvedRefs: unresolved.map((u) => u.ref) } : {}),
    };

    socket.emit("exp:content", payload);

    // Always sent, even empty: an empty list is what clears the handset
    // between routines. Without it the previous routine's controls stay live.
    ns.to(deviceRoom(state.experimentId!, state.participantId!)).emit("device:content", {
      progress: virtualProgress,
      routine: { name: routine.name, type: routine.type },
      elements: deviceElements,
      trial: content.trialNumber ?? 1,
    });
    // The end screen is the end for the phone too, whether or not Finish is clicked.
    if (routine.type === "routine-end") {
      ns.to(deviceRoom(state.experimentId!, state.participantId!)).emit("device:finished");
    }
  } catch (err) {
    console.error("[deliverContent] error:", err);
    socket.emit("error", {
      code: "INTERNAL",
      message: "Failed to deliver content",
    });
  }
}

/**
 * Content overrides shallow-merged over each element's authored params.
 * Split out of `filterElementsForParticipant` so reference resolution can
 * run in between: refs are substituted into the MERGED params (a per-progress
 * override may itself be a ref), and before filtering so `showWhen` can
 * evaluate a resolved value, through `visibilityProperties`.
 */
function mergeContentOverrides(
  routineElements: ElementConfig[],
  contentData: Record<string, unknown>,
): ElementConfig[] {
  return routineElements.map((el) => {
    const override = contentData[el.name];
    if (override && typeof override === "object" && !Array.isArray(override)) {
      return { ...el, params: { ...el.params, ...override } };
    }
    return el;
  });
}

/**
 * Resolve every `ref:` in the merged elements for this participant, with the
 * session and group they are in, so `partner`/`seat` refs read the right
 * member's data. Outside a session both are null and those refs report
 * `no-session`.
 */
async function resolveForParticipant(
  elements: ElementConfig[],
  experimentId: string,
  participantId: string,
  routines: RoutineConfig[],
  addressing: Pick<AddressingContext, "session" | "group">,
): Promise<ResolveOutcome> {
  return resolveReferences(elements, {
    selfId: participantId,
    session: addressing.session,
    group: addressing.group,
    routines,
    lookups: prismaLookups(experimentId),
    mintMediaUrl: (upload) => mediaUrlFor(upload.id),
  });
}

/**
 * The unresolved refs found inside the elements this participant is actually
 * being sent, deduplicated in first-seen order.
 *
 * Resolution runs before filtering, so an element hidden by role, seat or
 * showWhen still contributes its gaps to the outcome. Reporting those would
 * tell a participant that data is missing from a step they never see — and name
 * the other role's references while doing it.
 */
function unresolvedRefsFor(
  unresolvedByElement: Map<string, Unresolved[]>,
  delivered: ElementConfig[],
): Unresolved[] {
  const seen = new Set<string>();
  const gaps: Unresolved[] = [];
  for (const element of delivered) {
    for (const gap of unresolvedByElement.get(element.name) ?? []) {
      if (seen.has(gap.ref)) continue;
      seen.add(gap.ref);
      gaps.push(gap);
    }
  }
  return gaps;
}

function warnUnresolved(gaps: Unresolved[], participantId: string): void {
  for (const { ref, reason } of gaps) {
    console.warn(`[references] reference unresolved: ${ref} (${reason}) for participant ${participantId}`);
  }
}

/**
 * Apply showForRoles/showForSeats/showWhen to already-merged elements and
 * split the result by surface.
 *
 * The ONE definition of "what does this participant see right now" — both
 * `deliverContent` (the screen half, on every routine transition) and
 * `sendDeviceContent` (the device half, replayed for a phone that pairs
 * mid-routine) call this rather than keeping their own copies of the rule.
 */
function filterElementsForParticipant(
  mergedElements: ElementConfig[],
  roleName: string | undefined,
  slotName: string | null,
  seat: number | null,
  properties: Record<string, unknown>,
  routineRoles: string[] | undefined,
): { screenElements: ElementConfig[]; deviceElements: ElementConfig[] } {
  // A routine that declares roles has role assignment permute independently
  // of arrival slot, so the slot name can no longer stand in for it — a
  // participant sitting in slot "Director" may hold the role "Matcher", and
  // matching `showForRoles: ["Director"]` against their slot would leak the
  // other participant's stimuli to them. The slot fallback exists only for
  // routines authored before roles existed, which declare none.
  const routineHasRoles = !!routineRoles && routineRoles.length > 0;

  const elements = mergedElements.filter((el) => {
    if (el.showForRoles && el.showForRoles.length > 0) {
      const matchesRole = roleName && el.showForRoles.includes(roleName);
      const matchesSlot =
        !routineHasRoles && slotName && el.showForRoles.includes(slotName);
      if (!matchesRole && !matchesSlot) {
        return false;
      }
    }

    if (el.showForSeats && el.showForSeats.length > 0) {
      if (seat === null || !el.showForSeats.includes(seat)) {
        return false;
      }
    }

    if (el.showWhen && el.showWhen.length > 0) {
      if (!evaluateFilters(properties, el.showWhen)) {
        return false;
      }
    }

    return true;
  });

  // One filter decides who may see an element; the surface decides which of
  // their screens it lands on. Splitting AFTER the role filter is what makes
  // `showForRoles: ["Director"], surface: "device"` mean the Director's
  // phone without a second matching rule.
  return {
    screenElements: elements.filter((el) => isOnSurface(el, "screen")),
    deviceElements: elements.filter((el) => isOnSurface(el, "device")),
  };
}

/**
 * Send a participant's phone the device half of the routine they are on.
 *
 * Called both when content is delivered and when a phone connects, because
 * participants pair the handset AFTER starting — a phone that joined
 * mid-routine would otherwise sit blank until the next one. Reads the
 * participant's stored progress/condition rather than any live socket state,
 * since the device socket that triggers this has none of its own — the
 * desktop socket that does own that state is a separate connection.
 */
export async function sendDeviceContent(
  ns: TypedNamespace,
  experimentId: string,
  participantId: string,
): Promise<void> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
  });
  if (!participant) return;

  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
  });
  if (!experiment) return;

  const routines = experiment.routines as unknown as RoutineConfig[];
  const virtualProgress = participant.progress ?? 0;
  const condition = participant.condition ?? "Basic";

  const contentProgress = await resolveContentProgress(
    experimentId,
    participantId,
    virtualProgress,
    condition,
    experiment,
  );

  const content = await prisma.experimentContent.findFirst({
    where: { experimentId, progress: contentProgress, condition },
    orderBy: { trialNumber: "asc" },
  });
  if (!content) return;

  const routine = routines.find((r) => r.name === content.routine);
  if (!routine) return;

  const roleIndex = participant.role ?? 0;
  const roleName = routine.roles?.[roleIndex];
  const properties = (participant.properties as Record<string, unknown>) ?? {};

  const sessionInfo = await findActiveSession(participantId, experimentId);
  const seat = sessionInfo?.seat ?? null;
  const slotName = sessionInfo?.slotName ?? null;

  // Same addressing as deliverContent, without re-recording provenance — this only catches a phone up.
  const assignment = await assignInteractionGroup({
    sessionInfo,
    routine,
    routines,
    experimentId,
    participantId,
    virtualProgress,
    trialNumber: content.trialNumber ?? 1,
  });
  const sessionMembers = sessionInfo ? sessionMembersOf(sessionInfo) : undefined;

  const contentData = (content.content as Record<string, unknown>) ?? {};
  const merged = mergeContentOverrides(routine.elements ?? [], contentData);
  const outcome = await resolveForParticipant(
    merged,
    experimentId,
    participantId,
    routines,
    {
      session: sessionMembers ? { members: sessionMembers } : null,
      group: assignment ? { members: assignment.interactionGroup.members } : null,
    },
  );
  const { deviceElements } = filterElementsForParticipant(
    outcome.elements,
    roleName,
    slotName,
    seat,
    visibilityProperties(properties, outcome.values),
    routine.roles,
  );
  warnUnresolved(unresolvedRefsFor(outcome.unresolvedByElement, deviceElements), participantId);

  ns.to(deviceRoom(experimentId, participantId)).emit("device:content", {
    progress: virtualProgress,
    routine: { name: routine.name, type: routine.type },
    elements: deviceElements,
    trial: content.trialNumber ?? 1,
  });
}

async function closeSessionForParticipant(
  ns: TypedNamespace,
  participantId: string,
  experimentId: string,
): Promise<void> {
  const activeSessions = await prisma.sessionParticipant.findMany({
    where: {
      participantId,
      session: { experimentId, status: "ACTIVE" },
    },
    include: { session: true },
  });

  for (const sp of activeSessions) {
    await closeSession(ns, sp.session.id, sp.session.experimentId);
  }
}

/**
 * True when every id given has already reached the barrier. An empty roster
 * never releases: a session with no ACTIVE seat has nobody to advance.
 */
export function allActiveProceeded(
  memberIds: readonly string[],
  proceeded: ReadonlySet<string>,
): boolean {
  return memberIds.length > 0 && memberIds.every((pid) => proceeded.has(pid));
}

/**
 * Barrier: record that this participant has proceeded, and report whether the
 * whole cohort has now arrived, along with how many have. `activeMemberIds` is
 * ACTIVE-only by contract — a DROPPED seat must never hold the barrier open.
 *
 * The count is taken from the same set that decides the release, so the notice
 * a waiting member sees can never disagree with the barrier itself. It is a
 * set, so a member who proceeds twice is still counted once.
 *
 * Deliberately contains no `await`: the read-modify-write of the proceed set
 * must complete inside one microtask, or two members can both observe "all
 * proceeded" and the cohort is released twice.
 */
async function checkSessionSync(
  state: SocketState,
  sessionId: string,
  activeMemberIds: string[],
): Promise<{ released: boolean; submitted: number }> {
  if (!SessionProceedState.has(sessionId)) {
    SessionProceedState.set(sessionId, new Set());
  }
  const proceeded = SessionProceedState.get(sessionId)!;
  proceeded.add(state.participantId!);

  if (allActiveProceeded(activeMemberIds, proceeded)) {
    SessionProceedState.delete(sessionId);
    return { released: true, submitted: proceeded.size };
  }

  return { released: false, submitted: proceeded.size };
}

/**
 * Release a barrier that a departed member is holding up.
 *
 * The proceed set for a session is captured as members arrive, so when somebody
 * drops out the survivors can already all have proceeded with nobody left to
 * complete the count. Called from the dropout path with the ids of the seats
 * that are still ACTIVE; returns true when the cohort was actually released.
 */
export async function releaseStaleBarrier(
  ns: TypedNamespace,
  sessionId: string,
  activeMemberIds: string[],
): Promise<boolean> {
  const proceeded = SessionProceedState.get(sessionId);
  if (!proceeded || !allActiveProceeded(activeMemberIds, proceeded)) return false;

  SessionProceedState.delete(sessionId);
  console.warn(
    `[releaseStaleBarrier] Session ${sessionId} released after a seat dropped; advancing ${activeMemberIds.length} remaining member(s)`,
  );
  await advanceSession(ns, activeMemberIds);
  return true;
}

/**
 * Release a session's pending barrier and report who was in it.
 *
 * Once a session is CLOSED no member will ever reach that barrier again, so
 * the entry has to go or it lives for the lifetime of the process. But the
 * members already IN it have said they are done with their routine and are
 * waiting to be advanced — dropping the entry silently abandons them. They
 * come back here so the caller can advance each one on their own.
 *
 * The entry is deleted BEFORE the caller advances anybody, so a close that
 * re-enters this function while advancing finds nothing and cannot advance a
 * member twice.
 *
 * `closeSession` below is the only caller — every path that ends a session goes
 * through it, so the barrier can never be left behind by one that forgot.
 */
/** True when this session is no longer running, so its barrier can never release. */
async function sessionHasClosed(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  });
  return session?.status !== "ACTIVE";
}

/**
 * Take one member back out of a session's barrier, reporting whether they were
 * still in it. Contains no `await`: the read-and-remove is the claim on that
 * member, and it must not be split, or a closing session and an in-flight
 * proceed both advance them and one routine is skipped.
 */
function forgetBarrierMember(sessionId: string, participantId: string): boolean {
  const proceeded = SessionProceedState.get(sessionId);
  if (!proceeded?.delete(participantId)) return false;
  if (proceeded.size === 0) SessionProceedState.delete(sessionId);
  return true;
}

export function clearSessionBarrier(sessionId: string): string[] {
  const stranded = SessionProceedState.get(sessionId);
  SessionProceedState.delete(sessionId);
  return [...(stranded ?? [])];
}

/**
 * End one session: mark it CLOSED, forget its barrier, and tell any admin
 * dashboard watching this experiment.
 *
 * Every path that ends a session goes through here. Six places used to write
 * `status: "CLOSED"` and only the dropout path notified, so a cohort that
 * finished NORMALLY — the common case — stayed "Active" on the dashboard until
 * the researcher reloaded the page.
 */
export async function closeSession(
  ns: TypedNamespace,
  sessionId: string,
  experimentId: string,
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "CLOSED" },
  });

  // Anyone still at the barrier has already asked to move on and is sitting on
  // "Proceeding..." waiting for a cohort that no longer exists. The session is
  // CLOSED by now, so each of them advances on their own — the same thing the
  // next member's proceed does once findActiveSession stops finding this one.
  const stranded = clearSessionBarrier(sessionId);
  if (stranded.length > 0) {
    console.warn(
      `[closeSession] Session ${sessionId} closed with ${stranded.length} member(s) at the barrier; advancing them alone`,
    );
    await advanceSession(ns, stranded);
  }

  await pushAdminSessionUpdate(experimentId, sessionId);
}
