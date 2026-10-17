import type { Server, Namespace, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import type {
  AdminToServerEvents,
  AdminFromServerEvents,
  QueueEntry,
  QueueUpdatePayload,
  SessionSummary,
} from "ame-shared";
import type { WaitingRoomStore } from "./waitingRoomStore.js";
import { toQueueRooms } from "./queueSnapshot.js";
import { loadSessionSummaries, loadSessionSummary } from "../sessionSummary.js";
import { experimenterOwnsExperiment } from "../experimentAccess.js";
import { safeOnAdmin } from "./safeListener.js";
import { JwtSecret } from "../middleware/auth.js";

/** What the admin JWT carries; `signToken` mints exactly this. */
interface AdminTokenPayload {
  experimenterId?: string;
  role?: string;
}

/**
 * Roles that may open a dashboard socket at all.
 *
 * Role is deliberately NOT the boundary here: `Experimenter.role` defaults to
 * EXPERIMENTER and nothing in the codebase ever promotes an account, so an
 * ADMIN-only handshake rejected every real researcher — the live queue and the
 * session panel reached nobody, and the dashboard's "Live" indicator never lit.
 *
 * What actually protects the data is the per-subscription ownership check
 * below: an experimenter can only ever watch experiments they are attached to,
 * exactly as the REST routes guarantee. Widening the handshake widens who may
 * connect, never what anyone may read.
 */
const DashboardRoles = new Set(["ADMIN", "EXPERIMENTER"]);

type AdminNamespace = Namespace<AdminToServerEvents, AdminFromServerEvents>;

let adminNs: AdminNamespace | null = null;

/** Watchers of one experiment's matching queues. */
const adminQueueRoom = (experimentId: string): string => `admin:${experimentId}`;

/**
 * Watchers of one experiment's sessions. A separate room from the queue one so
 * that `session:unsubscribe` cannot silently stop queue updates as well.
 */
const adminSessionRoom = (experimentId: string): string =>
  `admin:${experimentId}:sessions`;

export function setupAdminSocket(io: Server, store: WaitingRoomStore): void {
  adminNs = io.of("/adminSocket") as unknown as AdminNamespace;

  adminNs.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = jwt.verify(token, JwtSecret) as AdminTokenPayload;
      if (!payload.role || !DashboardRoles.has(payload.role)) {
        return next(new Error("Experimenter access required"));
      }
      // Carried onto the socket so every subscription can be ownership-checked.
      // The handshake proves who the caller is, never which experiments are
      // theirs, and both snapshots now carry participants' recruitment ids.
      socket.data.experimenterId = payload.experimenterId ?? null;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  adminNs.on("connection", (socket: Socket<AdminToServerEvents, AdminFromServerEvents>) => {
    /**
     * Refuse a subscription to an experiment this account is not attached to.
     * Silent to the caller — the dashboard can only ever name experiments it
     * just listed — but logged, because it should not happen.
     */
    const mayWatch = async (experimentId: string): Promise<boolean> => {
      const experimenterId = socket.data.experimenterId as string | null;
      if (experimenterId && (await experimenterOwnsExperiment(experimenterId, experimentId))) {
        return true;
      }
      console.warn(
        `[adminHandler] Experimenter ${experimenterId ?? "unknown"} is not attached to experiment ${experimentId}; subscription refused`,
      );
      return false;
    };

    /**
     * The experiment id a subscribe payload names, or null when it names none.
     *
     * The typed client always sends one, but the wire is not the client: an
     * emit with no payload destructures `undefined` INSIDE an async listener,
     * and socket.io does not catch a rejected listener, so the unhandled
     * rejection takes the process down. Any authenticated experimenter can
     * reach it, so both subscriptions read their payload through this.
     */
    const watchedExperimentId = (payload?: { experimentId?: string }): string | null => {
      const experimentId = payload?.experimentId;
      return typeof experimentId === "string" && experimentId.length > 0 ? experimentId : null;
    };

    safeOnAdmin(socket, "queue:subscribe", async (payload?: { experimentId?: string }) => {
      const experimentId = watchedExperimentId(payload);
      if (!experimentId) return;
      if (!(await mayWatch(experimentId))) return;
      await socket.join(adminQueueRoom(experimentId));

      // The store already knows which room each entry sits in. Asking it per
      // entry (findParticipant) costs a full `ame:match:*` keyspace SCAN each
      // in the Redis store, across every experiment on the box.
      const rooms = await store.getRoomsForExperiment(experimentId);
      socket.emit("queue:state", { experimentId, rooms: toQueueRooms(rooms) });
    });

    safeOnAdmin(socket, "queue:unsubscribe", (payload?: { experimentId?: string }) => {
      const experimentId = watchedExperimentId(payload);
      if (experimentId) socket.leave(adminQueueRoom(experimentId));
    });

    safeOnAdmin(socket, "session:subscribe", async (payload?: { experimentId?: string }) => {
      const experimentId = watchedExperimentId(payload);
      if (!experimentId) return;
      if (!(await mayWatch(experimentId))) return;
      await socket.join(adminSessionRoom(experimentId));
      socket.emit("session:state", {
        experimentId,
        // Only what is still running: a CLOSED cohort can never change again,
        // so streaming it to a socket that exists to watch for changes is weight.
        sessions: await loadSessionSummaries(experimentId, { activeOnly: true }),
      });
    });

    safeOnAdmin(socket, "session:unsubscribe", (payload?: { experimentId?: string }) => {
      const experimentId = watchedExperimentId(payload);
      if (experimentId) socket.leave(adminSessionRoom(experimentId));
    });
  });
}

/**
 * Notify admins watching an experiment that a queue changed.
 * Called by matchingHandler when entries are added/removed.
 */
export function notifyAdminQueueUpdate(
  experimentId: string,
  routineName: string,
  action: QueueUpdatePayload["action"],
  participantId: string,
  currentEntries: QueueEntry[],
): void {
  if (!adminNs) return;
  adminNs.to(adminQueueRoom(experimentId)).emit("queue:update", {
    experimentId,
    routineName,
    action,
    participantId,
    entries: currentEntries,
  });
}

/**
 * True while at least one admin socket is watching this experiment's sessions.
 *
 * Node-local: `adapter.rooms` only knows the sockets on THIS process, while the
 * emit that follows goes cluster-wide through the adapter. Under the single
 * process PM2 runs today those are the same set. Should the cluster mode the
 * design doc defers ever land, this guard would suppress a push to a dashboard
 * connected to a sibling worker, and it must become an adapter room query.
 */
export function hasSessionSubscribers(experimentId: string): boolean {
  const room = adminNs?.adapter.rooms.get(adminSessionRoom(experimentId));
  return (room?.size ?? 0) > 0;
}

/** Push an already-built summary. Sibling of notifyAdminQueueUpdate. */
export function notifyAdminSessionUpdate(
  experimentId: string,
  session: SessionSummary,
): void {
  if (!adminNs) return;
  adminNs
    .to(adminSessionRoom(experimentId))
    .emit("session:update", { experimentId, session });
}

/**
 * Load one session and push it, but only while somebody is watching.
 *
 * The load is a two-table read and the call sites are on the participant's hot
 * path — every content delivery of every cohort member. The common case is that
 * no dashboard is open, so the subscriber check comes first and costs nothing.
 *
 * Monitoring must never break a live session, so failures are logged and
 * swallowed rather than propagated into a participant's error path.
 */
export async function pushAdminSessionUpdate(
  experimentId: string,
  sessionId: string,
): Promise<void> {
  if (!adminNs || !hasSessionSubscribers(experimentId)) return;
  try {
    const session = await loadSessionSummary(sessionId);
    if (session) notifyAdminSessionUpdate(experimentId, session);
  } catch (err) {
    console.error(
      `[adminHandler] Failed to push a session update for session ${sessionId}:`,
      err,
    );
  }
}
