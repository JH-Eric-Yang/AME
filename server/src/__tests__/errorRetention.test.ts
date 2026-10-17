import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sweepErrorEvents, RetentionDays, MaxEventsPerGroup } from "../errors/retention.js";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    errorEvent: { deleteMany: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.errorEvent.deleteMany).mockResolvedValue({ count: 0 });
  vi.mocked(prisma.errorEvent.groupBy).mockResolvedValue([]);
  vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("sweepErrorEvents", () => {
  // Bundled requirement: a test that only imports and re-asserts the constants
  // (e.g. `expect(RetentionDays).toBe(RetentionDays)`) can never fail, so it
  // cannot catch drift. Pin the literal spec values here.
  it("pins the retention constants to the spec values", () => {
    expect([RetentionDays, MaxEventsPerGroup]).toEqual([30, 100]);
  });

  it("deletes occurrences older than the retention window", async () => {
    vi.mocked(prisma.errorEvent.deleteMany).mockResolvedValueOnce({ count: 12 });
    const now = new Date("2026-09-17T00:00:00Z");

    const result = await sweepErrorEvents(now);

    expect(prisma.errorEvent.deleteMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: new Date("2026-08-18T00:00:00Z") } },
    });
    expect(result.deletedByAge).toBe(12);
  });

  it("trims a group past the per-group cap, keeping the newest", async () => {
    vi.mocked(prisma.errorEvent.groupBy).mockResolvedValue([
      { groupId: "g-1", _count: { _all: MaxEventsPerGroup + 3 } },
    ] as never);
    vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([{ id: "e-1" }, { id: "e-2" }, { id: "e-3" }] as never);
    vi.mocked(prisma.errorEvent.deleteMany).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 3 });

    const result = await sweepErrorEvents(new Date());

    expect(prisma.errorEvent.findMany).toHaveBeenCalledWith({
      where: { groupId: "g-1" },
      orderBy: { occurredAt: "desc" },
      skip: MaxEventsPerGroup,
      select: { id: true },
    });
    expect(prisma.errorEvent.deleteMany).toHaveBeenLastCalledWith({ where: { id: { in: ["e-1", "e-2", "e-3"] } } });
    expect(result.deletedByCap).toBe(3);
  });

  it("leaves a group inside the cap alone", async () => {
    vi.mocked(prisma.errorEvent.groupBy).mockResolvedValue([{ groupId: "g-1", _count: { _all: 5 } }] as never);

    await sweepErrorEvents(new Date());

    expect(prisma.errorEvent.findMany).not.toHaveBeenCalled();
  });

  it("never throws when the database fails", async () => {
    vi.mocked(prisma.errorEvent.deleteMany).mockRejectedValueOnce(new Error("db down"));
    await expect(sweepErrorEvents(new Date())).resolves.toMatchObject({ deletedByAge: 0 });
  });
});
