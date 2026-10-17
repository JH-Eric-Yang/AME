import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import type { RandomizationConfig, RoutineConfig } from "ame-shared";
import { buildProgressSequence, detectMatchingPeriods } from "ame-shared/randomization";
import prisma from "../prisma.js";
import {
  cancelSeatDrop,
  dropSeatsForParticipant,
  scheduleSeatDrop,
} from "./sessionDropout.js";
import type { TypedSocket, SocketState } from "./index.js";
import type { WaitingRoomStore } from "./waitingRoomStore.js";
import { safeOn, safeOnDisconnect } from "./safeListener.js";
import { grantIceServers } from "./iceServerGrant.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

const ActiveTimeTimers = new Map<string, NodeJS.Timeout>();

export function registerExperimentHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
  store: WaitingRoomStore,
): void {
  const state: SocketState = (socket.data as SocketState) ?? {};
  socket.data = state;

  safeOn(socket, "exp:init", async ({ experimentId, platform }) => {
    try {
      const experiment = await prisma.experiment.findUnique({
        where: { id: experimentId },
      });

      if (!experiment) {
        socket.emit("error", { code: "NOT_FOUND", message: "Experiment not found" });
        return;
      }

      if (!experiment.visible) {
        socket.emit("error", { code: "NOT_AVAILABLE", message: "Experiment not available" });
        return;
      }

      state.experimentId = experimentId;

      socket.emit("exp:config", {
        id: experiment.id,
        name: experiment.name,
        description: experiment.description,
        avCollection: experiment.avCollection,
        bodyDetection: experiment.bodyDetection,
        videoChat: experiment.videoChat,
        supplementaryDevice: experiment.supplementaryDevice,
        participantsPerSession: experiment.participantsPerSession,
        conditions: experiment.conditions,
        participantIdParam: experiment.participantIdParam,
      });
    } catch (err) {
      socket.emit("error", { code: "INTERNAL", message: "Failed to initialize experiment" });
    }
  });

  safeOn(socket, "exp:join", async ({ responseId, externalId }) => {
    if (!state.experimentId) {
      socket.emit("error", { code: "NOT_INITIALIZED", message: "Call exp:init first" });
      return;
    }

    try {
      const experiment = await prisma.experiment.findUnique({
        where: { id: state.experimentId },
      });

      if (!experiment) {
        socket.emit("error", { code: "NOT_FOUND", message: "Experiment not found" });
        return;
      }

      let participant;

      // An external id (e.g. PROLIFIC_PID) identifies the person across
      // browsers and refreshes, so it takes precedence over the local
      // responseId held in localStorage.
      const trimmedExternalId = externalId?.trim();
      // When the experiment names an id parameter and the URL carried one, that
      // id IS the person. The browser sends the localStorage responseId too, and
      // it belongs to whoever last used this profile — so it must not be
      // consulted here, or a second tab opened as ?PID=bob silently resumes
      // alice and the two never appear as separate participants.
      const identifiedExternally = Boolean(
        trimmedExternalId && experiment.participantIdParam,
      );
      if (identifiedExternally) {
        participant = await prisma.participant.findFirst({
          where: { experimentId: state.experimentId, externalId: trimmedExternalId },
        });

        // A returning external id that already finished must not take part twice.
        if (participant?.completion) {
          socket.emit("error", {
            code: "ALREADY_COMPLETED",
            message: "You have already taken part in this experiment.",
          });
          return;
        }
      }

      if (!participant && !identifiedExternally && responseId) {
        // Try to resume existing participant
        participant = await prisma.participant.findFirst({
          where: { experimentId: state.experimentId, responseId },
        });
      }

      if (participant) {
        // Already completed — show completion screen, don't allow re-entry
        if (participant.completion) {
          state.participantId = participant.id;
          state.responseId = participant.responseId;
          state.condition = participant.condition;
          state.progress = participant.progress;
          socket.emit("exp:joined", {
            participantId: participant.id,
            responseId: participant.responseId,
            progress: participant.progress,
            condition: participant.condition,
            properties: (participant.properties as Record<string, unknown>) ?? {},
          });
          socket.emit("exp:alert", {
            message: "Experiment complete",
            type: "complete",
          });
          return;
        }

        // Resume — check roll-back
        if (participant.lastLogTime) {
          const elapsed = Date.now() - participant.lastLogTime.getTime();
          const rollBackMs = experiment.rollBackTime * 60 * 1000;
          if (elapsed > rollBackMs) {
            // Reset progress
            participant = await prisma.participant.update({
              where: { id: participant.id },
              data: { progress: 0, currentStage: 0, isLoggedIn: true, lastLogTime: new Date() },
            });
          } else {
            participant = await prisma.participant.update({
              where: { id: participant.id },
              data: { isLoggedIn: true, lastLogTime: new Date() },
            });
          }
        }
      } else {
        // New participant
        if (!experiment.allowNew) {
          socket.emit("error", { code: "NOT_ALLOWED", message: "New participants not allowed" });
          return;
        }

        // Condition assignment via round-robin
        let condition: string | null = null;
        if (experiment.conditions.length > 0) {
          const currentIdx = experiment.currentCondition
            ? experiment.conditions.indexOf(experiment.currentCondition)
            : -1;
          const nextIdx = (currentIdx + 1) % experiment.conditions.length;
          condition = experiment.conditions[nextIdx];

          // Advance round-robin pointer
          const nextPointer = experiment.conditions[(nextIdx + 1) % experiment.conditions.length];
          await prisma.experiment.update({
            where: { id: experiment.id },
            data: { currentCondition: nextPointer },
          });
        }

        // Build initial properties
        const initialProps = (experiment.initialProperties as Record<string, unknown>) ?? {};
        const conditionProps = (experiment.conditionProperties as Record<string, Record<string, unknown>>) ?? {};
        const properties: Record<string, unknown> = {
          ...initialProps,
          ...(condition && conditionProps[condition] ? conditionProps[condition] : {}),
          ...(condition ? { condition } : {}),
        };

        // Resolve array-valued properties: pick least represented value
        const arrayKeys = Object.entries(properties).filter(
          ([, v]) => Array.isArray(v),
        );
        if (arrayKeys.length > 0) {
          const waitingEntries = await store.getEntriesForExperiment(state.experimentId);
          for (const [key, options] of arrayKeys) {
            const arr = options as unknown[];
            if (arr.length === 0) continue;
            if (arr.length === 1) {
              properties[key] = arr[0];
              continue;
            }
            // Count frequency of each option among waiting participants
            const counts = new Map<unknown, number>();
            for (const opt of arr) counts.set(opt, 0);
            for (const entry of waitingEntries) {
              const val = entry.properties[key];
              if (val !== undefined && counts.has(val)) {
                counts.set(val, counts.get(val)! + 1);
              }
            }
            // Pick least represented, random tiebreak
            let minCount = Infinity;
            const candidates: unknown[] = [];
            for (const [opt, count] of counts) {
              if (count < minCount) {
                minCount = count;
                candidates.length = 0;
                candidates.push(opt);
              } else if (count === minCount) {
                candidates.push(opt);
              }
            }
            properties[key] = candidates[Math.floor(Math.random() * candidates.length)];
          }
        }

        participant = await prisma.participant.create({
          data: {
            experimentId: state.experimentId,
            condition,
            isLoggedIn: true,
            lastLogTime: new Date(),
            externalId: experiment.participantIdParam ? (trimmedExternalId ?? null) : null,
            properties: properties as Record<string, string | number | boolean>,
          },
        });

        // Generate randomized progress sequence if enabled
        let progressSequence: number[] | null = null;
        if (experiment.randomization) {
          const config = experiment.randomizationConfig as RandomizationConfig | null;
          const conditionKey = condition ?? "Basic";
          const conditionRanges = config?.[conditionKey];

          if (conditionRanges && conditionRanges.length > 0) {
            const contentRows = await prisma.experimentContent.findMany({
              where: { experimentId: state.experimentId, condition: conditionKey },
              orderBy: { progress: "asc" },
              select: { progress: true, trialNumber: true, routine: true },
            });

            if (contentRows.length > 0) {
              const routines = experiment.routines as unknown as RoutineConfig[];

              // Detect matching periods to partition ranges
              const matchingPeriods = detectMatchingPeriods(contentRows, routines);

              // Filter to individual-scope ranges (outside matching periods)
              const individualRanges = conditionRanges.filter((range) => {
                const rangeRows = contentRows.filter(
                  (r) => r.trialNumber >= range.fromTrial && r.trialNumber <= range.toTrial,
                );
                return !rangeRows.some((r) =>
                  matchingPeriods.some(
                    (mp) => r.progress >= mp.fromProgress && r.progress <= mp.toProgress,
                  ),
                );
              });

              // Count participants in this condition for Latin square index
              const participantCount = await prisma.participant.count({
                where: { experimentId: state.experimentId, condition: conditionKey },
              });

              progressSequence = buildProgressSequence(
                contentRows.map((r) => ({ progress: r.progress, trialNumber: r.trialNumber })),
                individualRanges,
                participantCount - 1, // Current participant is already counted
              );

              await prisma.participant.update({
                where: { id: participant.id },
                data: { progressSequence },
              });
            }
          }
        }
      }

      state.participantId = participant.id;
      // A refresh or a brief network blip reconnects inside the grace window.
      cancelSeatDrop(participant.id);
      state.responseId = participant.responseId;
      state.condition = participant.condition;
      state.progress = participant.progress;

      // Join participant room
      const room = `experiment:${state.experimentId}:${participant.id}`;
      await socket.join(room);

      socket.emit("exp:joined", {
        participantId: participant.id,
        responseId: participant.responseId,
        progress: participant.progress,
        condition: participant.condition,
        properties: (participant.properties as Record<string, unknown>) ?? {},
      });
      // Only now: a participant who joined may use the TURN relay.
      grantIceServers(socket);

      // Start auto-withdraw timer
      startActiveTimer(ns, socket, experiment.activeTime);
    } catch (err) {
      socket.emit("error", { code: "INTERNAL", message: "Failed to join experiment" });
    }
  });

  safeOnDisconnect(socket, async () => {
    clearActiveTimer(socket.id);

    const { participantId, experimentId } = state;
    if (!participantId) return;

    // A device (phone) socket also carries the participant's participantId so
    // signaling can find their room, but it is not the participant's own
    // connection. Treating its disconnect as the participant leaving would
    // mark them logged out and, after the reconnect grace, drop their seat and
    // alert their cohort that a live partner has gone — while they're still
    // sitting at their desktop. `device:left` (signalingHandler) tells the
    // client the device is gone; this handler must not.
    if (state.deviceMode) return;

    try {
      await prisma.participant.update({
        where: { id: participantId },
        data: { isLoggedIn: false, lastLogTime: new Date() },
      });
    } catch {
      // Participant may have been deleted
    }

    if (experimentId) {
      // Their seat is only released once the reconnect grace expires, so a page
      // refresh does not orphan the cohort.
      scheduleSeatDrop(participantId, async () => {
        await dropSeatsForParticipant(ns, experimentId, participantId);
      });
    }
  });
}

function startActiveTimer(
  ns: TypedNamespace,
  socket: TypedSocket,
  activeTimeMinutes: number,
): void {
  clearActiveTimer(socket.id);

  const ms = activeTimeMinutes * 60 * 1000;
  const timer = setTimeout(async () => {
    const state = socket.data as SocketState;
    if (state.participantId) {
      try {
        await prisma.participant.update({
          where: { id: state.participantId },
          data: { withdraw: true },
        });
      } catch {
        // ignore
      }
    }
    socket.emit("exp:alert", {
      message: "You have been withdrawn due to inactivity.",
      type: "auto-withdraw",
    });
    socket.disconnect(true);
  }, ms);

  ActiveTimeTimers.set(socket.id, timer);
}

function clearActiveTimer(socketId: string): void {
  const timer = ActiveTimeTimers.get(socketId);
  if (timer) {
    clearTimeout(timer);
    ActiveTimeTimers.delete(socketId);
  }
}

/** Reset the auto-withdraw timer (called on activity). */
export function resetActiveTimer(
  ns: TypedNamespace,
  socket: TypedSocket,
  activeTimeMinutes: number,
): void {
  startActiveTimer(ns, socket, activeTimeMinutes);
}
