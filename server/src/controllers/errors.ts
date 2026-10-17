/**
 * Reading the error log (spec §6). An experiment's groups belong to its
 * owners; a group with no experiment is platform-wide and ADMIN-only, enforced
 * here rather than hidden in the UI.
 */

import type { Response } from "express";
import type { ErrorStatus, StoredErrorGroup, StoredErrorEvent } from "ame-shared/errors";
import prisma from "../prisma.js";
import { experimenterOwnsExperiment } from "../experimentAccess.js";
import type { AuthRequest } from "../middleware/auth.js";

/** Groups (or events) returned in one page — a dashboard list, not an export. */
const GroupPageSize = 200;
const EventPageSize = 50;

type GroupRow = Awaited<ReturnType<typeof prisma.errorGroup.findMany>>[number];

function statusFilter(raw: unknown): { status?: ErrorStatus } {
  if (raw === "all") return {};
  if (raw === "resolved") return { status: "RESOLVED" };
  return { status: "OPEN" };
}

/** Distinct participants per group, for the list's "affected" column. */
async function participantCounts(groupIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.errorEvent.findMany({
    where: { groupId: { in: groupIds }, participantId: { not: null } },
    select: { groupId: true, participantId: true },
    distinct: ["groupId", "participantId"],
  });

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
  return counts;
}

async function present(groups: GroupRow[]): Promise<StoredErrorGroup[]> {
  const counts = await participantCounts(groups.map((g) => g.id));
  return groups.map((g) => ({
    id: g.id,
    source: g.source,
    name: g.name,
    message: g.message,
    experimentId: g.experimentId,
    count: g.count,
    participantCount: counts.get(g.id) ?? 0,
    firstSeenAt: g.firstSeenAt.toISOString(),
    lastSeenAt: g.lastSeenAt.toISOString(),
    status: g.status,
  }));
}

/** Single-group counterpart of `present`, for the resolve/reopen responses. */
async function presentOne(group: GroupRow): Promise<StoredErrorGroup> {
  const [presented] = await present([group]);
  return presented;
}

export async function listExperimentErrors(req: AuthRequest, res: Response): Promise<void> {
  if (!(await experimenterOwnsExperiment(req.auth!.experimenterId, req.params.id))) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const groups = await prisma.errorGroup.findMany({
    where: { experimentId: req.params.id, ...statusFilter(req.query.status) },
    orderBy: { lastSeenAt: "desc" },
    take: GroupPageSize,
  });

  res.json(await present(groups));
}

export async function listPlatformErrors(req: AuthRequest, res: Response): Promise<void> {
  const platformOnly = req.query.scope === "platform";
  const groups = await prisma.errorGroup.findMany({
    where: { ...(platformOnly ? { experimentId: null } : {}), ...statusFilter(req.query.status) },
    orderBy: { lastSeenAt: "desc" },
    take: GroupPageSize,
  });

  res.json(await present(groups));
}

/** Why a caller was refused a group — the two cases have different remedies. */
type ForbiddenReason = "platform" | "not-owner";

/** Null when the caller may not see this group; the caller answers 403/404. */
async function accessibleGroup(
  req: AuthRequest,
): Promise<{ group: GroupRow | null; forbidden: ForbiddenReason | null }> {
  const group = await prisma.errorGroup.findUnique({ where: { id: req.params.groupId } });
  if (!group) return { group: null, forbidden: null };

  if (group.experimentId === null) {
    return req.auth?.role === "ADMIN" ? { group, forbidden: null } : { group: null, forbidden: "platform" };
  }

  const owns = await experimenterOwnsExperiment(req.auth!.experimenterId, group.experimentId);
  return owns || req.auth?.role === "ADMIN"
    ? { group, forbidden: null }
    : { group: null, forbidden: "not-owner" };
}

/**
 * A platform group really is admin-only, so "Administrator access required" is
 * the accurate remedy there. A plain experimenter denied someone else's
 * experiment-scoped group is a different failure — admin rights are not the
 * issue and granting them is not the remedy — so it gets its own message.
 */
function refuse(res: Response, forbidden: ForbiddenReason | null): void {
  if (forbidden === "platform") {
    res.status(403).json({ code: "FORBIDDEN", message: "Administrator access required" });
  } else if (forbidden === "not-owner") {
    res.status(403).json({ code: "FORBIDDEN", message: "You do not have access to this error group" });
  } else {
    res.status(404).json({ code: "NOT_FOUND", message: "Error group not found" });
  }
}

export async function listGroupEvents(req: AuthRequest, res: Response): Promise<void> {
  const { group, forbidden } = await accessibleGroup(req);
  if (!group) {
    refuse(res, forbidden);
    return;
  }

  const events = await prisma.errorEvent.findMany({
    where: { groupId: group.id },
    orderBy: { occurredAt: "desc" },
    take: EventPageSize,
  });

  const payload: StoredErrorEvent[] = events.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    participantId: e.participantId,
    responseId: e.responseId,
    routine: e.routine,
    progress: e.progress,
    context: e.context as Record<string, unknown> | null,
    stack: e.stack,
    message: e.message,
  }));

  res.json(payload);
}

export async function resolveGroup(req: AuthRequest, res: Response): Promise<void> {
  const { group, forbidden } = await accessibleGroup(req);
  if (!group) {
    refuse(res, forbidden);
    return;
  }

  const updated = await prisma.errorGroup.update({
    where: { id: group.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: req.auth!.experimenterId },
  });
  res.json(await presentOne(updated));
}

export async function reopenGroup(req: AuthRequest, res: Response): Promise<void> {
  const { group, forbidden } = await accessibleGroup(req);
  if (!group) {
    refuse(res, forbidden);
    return;
  }

  const updated = await prisma.errorGroup.update({
    where: { id: group.id },
    data: { status: "OPEN", resolvedAt: null, resolvedById: null },
  });
  res.json(await presentOne(updated));
}
