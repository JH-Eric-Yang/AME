import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, RoutineConfig } from "ame-shared";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import { closeSession } from "./progressHandler.js";
import { dropSeatsForParticipant } from "./sessionDropout.js";
import type { TypedSocket, SocketState } from "./index.js";
import { safeOn } from "./safeListener.js";
import { deviceRoom } from "./rooms.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

export function registerDataHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
): void {
  safeOn(socket, "exp:data", async ({ progress, trial, routine, response, trialInfo }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId || !state.responseId) {
      socket.emit("error", { code: "NOT_JOINED", message: "Join experiment first" });
      return;
    }

    try {
      await prisma.experimentResult.create({
        data: {
          experimentId: state.experimentId,
          participantId: state.participantId,
          responseId: state.responseId,
          progress,
          trial,
          routine,
          response: response as unknown as Prisma.InputJsonValue,
          trialInfo: trialInfo ? (trialInfo as unknown as Prisma.InputJsonValue) : undefined,
        },
      });

      // Check if any elements in current routine set properties
      const experiment = await prisma.experiment.findUnique({
        where: { id: state.experimentId },
      });
      if (experiment) {
        const routines = experiment.routines as unknown as RoutineConfig[];
        const currentRoutine = routines.find((r) => r.name === routine);
        if (currentRoutine) {
          const propertyUpdates: Record<string, unknown> = {};
          for (const element of currentRoutine.elements ?? []) {
            if (element.setsProperty && response[element.name] !== undefined) {
              propertyUpdates[element.setsProperty] = response[element.name];
            }
          }

          if (Object.keys(propertyUpdates).length > 0) {
            const participant = await prisma.participant.findUnique({
              where: { id: state.participantId },
            });
            const existingProps = (participant?.properties as Record<string, unknown>) ?? {};
            await prisma.participant.update({
              where: { id: state.participantId },
              data: {
                properties: { ...existingProps, ...propertyUpdates } as Prisma.InputJsonValue,
                lastLogTime: new Date(),
              },
            });
            socket.emit("exp:data:ack");
            return; // Already updated lastLogTime
          }
        }
      }

      // Update last activity time
      await prisma.participant.update({
        where: { id: state.participantId },
        data: { lastLogTime: new Date() },
      });

      socket.emit("exp:data:ack");
    } catch (err) {
      socket.emit("error", { code: "INTERNAL", message: "Failed to save data" });
    }
  });

  safeOn(socket, "exp:consent", async () => {
    const state = socket.data as SocketState;
    if (!state.participantId) {
      socket.emit("error", { code: "NOT_JOINED", message: "Join experiment first" });
      return;
    }

    try {
      await prisma.participant.update({
        where: { id: state.participantId },
        data: { consent: true, lastLogTime: new Date() },
      });
    } catch (err) {
      socket.emit("error", { code: "INTERNAL", message: "Failed to record consent" });
    }
  });

  safeOn(socket, "exp:withdraw", async () => {
    const state = socket.data as SocketState;
    if (!state.participantId) {
      socket.emit("error", { code: "NOT_JOINED", message: "Join experiment first" });
      return;
    }

    try {
      await prisma.participant.update({
        where: { id: state.participantId },
        data: { withdraw: true, isLoggedIn: false, lastLogTime: new Date() },
      });

      // A withdrawal frees this seat but leaves the cohort running; the session
      // closes only when its last active member is gone.
      if (state.experimentId) {
        await dropSeatsForParticipant(ns, state.experimentId, state.participantId);
        ns.to(deviceRoom(state.experimentId, state.participantId)).emit("device:finished");
      }

      socket.disconnect(true);
    } catch (err) {
      socket.emit("error", { code: "INTERNAL", message: "Failed to withdraw" });
    }
  });

  safeOn(socket, "exp:complete", async () => {
    const state = socket.data as SocketState;
    if (!state.participantId) {
      socket.emit("error", { code: "NOT_JOINED", message: "Join experiment first" });
      return;
    }

    try {
      await prisma.participant.update({
        where: { id: state.participantId },
        data: { completion: true, isLoggedIn: false, lastLogTime: new Date() },
      });

      // Close any active sessions
      const sessionParticipants = await prisma.sessionParticipant.findMany({
        where: { participantId: state.participantId },
        include: { session: true },
      });

      for (const sp of sessionParticipants) {
        if (sp.session.status === "ACTIVE") {
          // Check if all participants in session have completed
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

      // Without this the participant sees no change and the Finish button
      // looks inert, even though completion was recorded.
      socket.emit("exp:completed");
    } catch (err) {
      socket.emit("error", { code: "INTERNAL", message: "Failed to complete" });
    }
  });

  safeOn(socket, "exp:upload:done", async ({ uploadId }) => {
    try {
      await prisma.upload.update({
        where: { id: uploadId },
        data: { status: "COMPLETE" },
      });
    } catch {
      // Upload record may not exist
    }
  });
}
