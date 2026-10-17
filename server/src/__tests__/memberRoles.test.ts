import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";
import { memberRoleNames, loadMemberRoles } from "../socket/memberRoles.js";

vi.mock("../prisma.js", () => ({
  default: { participant: { findMany: vi.fn() } },
}));

const Roles = ["Director", "Matcher"];
const members = [
  { participantId: "p0", seat: 0, slotName: null },
  { participantId: "p1", seat: 1, slotName: null },
];

beforeEach(() => {
  vi.mocked(prisma.participant.findMany).mockResolvedValue([
    { id: "p0", role: 1 },
    { id: "p1", role: 0 },
  ] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("memberRoleNames", () => {
  it("names each member by their role index", () => {
    expect(memberRoleNames(Roles, [{ id: "a", role: 1 }, { id: "b", role: null }])).toEqual({ a: "Matcher", b: "Director" });
  });

  it("leaves out an index past the roles, and gives nothing without roles", () => {
    expect(memberRoleNames(Roles, [{ id: "a", role: 5 }])).toBeUndefined();
    expect(memberRoleNames([], [{ id: "a", role: 0 }])).toBeUndefined();
    expect(memberRoleNames(undefined, [{ id: "a", role: 0 }])).toBeUndefined();
  });
});

describe("loadMemberRoles", () => {
  it("looks up the roles for a video-chat routine with roles in a session", async () => {
    expect(await loadMemberRoles({ type: "routine-video-chat", roles: Roles }, members, "exp-1")).toEqual({ p0: "Matcher", p1: "Director" });
  });

  it("skips the lookup when no label is needed", async () => {
    vi.mocked(prisma.participant.findMany).mockClear();
    expect(await loadMemberRoles({ type: "routine-card", roles: Roles }, members, "exp-1")).toBeUndefined();
    expect(await loadMemberRoles({ type: "routine-video-chat", roles: [] }, members, "exp-1")).toBeUndefined();
    expect(await loadMemberRoles({ type: "routine-video-chat", roles: Roles }, undefined, "exp-1")).toBeUndefined();
    expect(prisma.participant.findMany).not.toHaveBeenCalled();
  });

  it("gives no labels, and does not throw, when the lookup fails", async () => {
    vi.mocked(prisma.participant.findMany).mockRejectedValue(new Error("db down"));
    await expect(loadMemberRoles({ type: "routine-video-chat", roles: Roles }, members, "exp-1")).resolves.toBeUndefined();
  });
});
