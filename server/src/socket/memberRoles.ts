/**
 * memberRoles — the role name of each person in a video-chat session, so the
 * call can label each video ("Director", "Matcher") without the browser
 * knowing how roles are assigned.
 */

import type { RoutineConfig, SessionMember } from "ame-shared";
import prisma from "../prisma.js";
import { reportError } from "../errors/reportError.js";

/** participantId → role name, for the rows whose role index names a role. */
export function memberRoleNames(
  roles: readonly string[] | undefined,
  rows: ReadonlyArray<{ id: string; role: number | null }>,
): Record<string, string> | undefined {
  if (!roles || roles.length === 0) return undefined;
  const named = rows.flatMap((row) => {
    const name = roles[row.role ?? 0];
    return name ? [[row.id, name] as const] : [];
  });
  return named.length > 0 ? Object.fromEntries(named) : undefined;
}

/** Only a video-chat routine with roles, inside a session, labels its videos by role. */
export function needsMemberRoles(
  routine: Pick<RoutineConfig, "type" | "roles">,
  members: readonly SessionMember[] | undefined,
): members is readonly SessionMember[] {
  return routine.type === "routine-video-chat" && (routine.roles?.length ?? 0) > 0 && (members?.length ?? 0) > 0;
}

/** A failed lookup costs the labels only, never the delivery. */
export async function loadMemberRoles(
  routine: Pick<RoutineConfig, "type" | "roles">,
  members: readonly SessionMember[] | undefined,
  experimentId: string,
): Promise<Record<string, string> | undefined> {
  if (!needsMemberRoles(routine, members)) return undefined;
  try {
    const rows = await prisma.participant.findMany({
      where: { id: { in: members.map((member) => member.participantId) } },
      select: { id: true, role: true },
    });
    return memberRoleNames(routine.roles, rows);
  } catch (err) {
    reportError(err, { source: "SERVER_SOCKET", experimentId, context: { task: "loadMemberRoles" } });
    return undefined;
  }
}
