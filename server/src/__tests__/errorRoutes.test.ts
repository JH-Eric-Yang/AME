import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { adminErrorRoutes } from "../routes/errors.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { signToken } from "../middleware/auth.js";
import prisma from "../prisma.js";
import { useTestServer } from "./helpers/httpTestServer.js";

vi.mock("../prisma.js", () => ({
  default: {
    errorGroup: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    errorEvent: { findMany: vi.fn() },
    experiment: { findFirst: vi.fn() },
  },
}));

const app = express();
app.use(express.json());
app.use("/api/admin", adminErrorRoutes);
app.use(errorHandler);
const server = useTestServer(app);

const OwnerToken = signToken({ experimenterId: "owner-1", email: "o@x.ac.uk", role: "EXPERIMENTER" });
const AdminToken = signToken({ experimenterId: "admin-1", email: "a@x.ac.uk", role: "ADMIN" });

const group = {
  id: "g-1", fingerprint: "f", source: "SERVER_SOCKET", name: "Error", message: "boom",
  experimentId: "exp-1", count: 3, firstSeenAt: new Date(), lastSeenAt: new Date(),
  status: "OPEN", resolvedAt: null, resolvedById: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.experiment.findFirst).mockResolvedValue({ id: "exp-1" } as never);
  vi.mocked(prisma.errorGroup.findMany).mockResolvedValue([group] as never);
  vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue(group as never);
});

describe("GET /api/admin/experiments/:id/errors", () => {
  it("lists an owner's groups with a participant count", async () => {
    vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([
      { groupId: "g-1", participantId: "p-1" }, { groupId: "g-1", participantId: "p-2" },
    ] as never);

    const res = await request(server).get("/api/admin/experiments/exp-1/errors").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "g-1", count: 3, participantCount: 2 });
  });

  it("defaults to open groups only", async () => {
    await request(server).get("/api/admin/experiments/exp-1/errors").set("Authorization", `Bearer ${OwnerToken}`);

    expect(prisma.errorGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { experimentId: "exp-1", status: "OPEN" } }),
    );
  });

  it("refuses an experiment the caller does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server).get("/api/admin/experiments/exp-9/errors").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await request(server).get("/api/admin/experiments/exp-1/errors")).status).toBe(401);
  });
});

describe("GET /api/admin/errors", () => {
  it("is refused for a non-admin", async () => {
    const res = await request(server).get("/api/admin/errors").set("Authorization", `Bearer ${OwnerToken}`);
    expect(res.status).toBe(403);
  });

  it("is refused for an unauthenticated caller", async () => {
    expect((await request(server).get("/api/admin/errors")).status).toBe(401);
  });

  it("lists platform-only groups when asked", async () => {
    const res = await request(server).get("/api/admin/errors?scope=platform").set("Authorization", `Bearer ${AdminToken}`);

    expect(res.status).toBe(200);
    expect(prisma.errorGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { experimentId: null, status: "OPEN" } }),
    );
  });
});

describe("GET /api/admin/errors/:groupId/events", () => {
  it("lists an owner's events for their own group", async () => {
    vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([
      {
        id: "e-1", groupId: "g-1", occurredAt: new Date("2026-09-17T00:00:00Z"), participantId: "p-1",
        responseId: "r-1", routine: "intro", progress: 0, context: null, stack: null, message: "boom",
      },
    ] as never);

    const res = await request(server).get("/api/admin/errors/g-1/events").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "e-1", occurredAt: "2026-09-17T00:00:00.000Z", message: "boom" });
  });

  it("refuses a group belonging to an experiment the caller does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server).get("/api/admin/errors/g-1/events").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(403);
  });

  it("refuses a platform group's events for a non-admin", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue({ ...group, experimentId: null } as never);

    const res = await request(server).get("/api/admin/errors/g-1/events").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(403);
  });

  it("allows an admin to read a platform group's events", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue({ ...group, experimentId: null } as never);

    const res = await request(server).get("/api/admin/errors/g-1/events").set("Authorization", `Bearer ${AdminToken}`);

    expect(res.status).toBe(200);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await request(server).get("/api/admin/errors/g-1/events")).status).toBe(401);
  });

  it("404s an unknown group", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue(null);

    const res = await request(server).get("/api/admin/errors/nope/events").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/errors/:groupId/resolve", () => {
  it("resolves a group the caller owns and records who did it", async () => {
    vi.mocked(prisma.errorGroup.update).mockResolvedValue({ ...group, status: "RESOLVED" } as never);

    const res = await request(server).post("/api/admin/errors/g-1/resolve").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(200);
    expect(prisma.errorGroup.update).toHaveBeenCalledWith({
      where: { id: "g-1" },
      data: { status: "RESOLVED", resolvedAt: expect.any(Date), resolvedById: "owner-1" },
    });
    // Response matches StoredErrorGroup, participantCount included, so the
    // dashboard can update its list from this response alone.
    expect(res.body).toMatchObject({ id: "g-1", status: "RESOLVED", participantCount: 0 });
  });

  it("refuses a platform group for a non-admin", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue({ ...group, experimentId: null } as never);

    const res = await request(server).post("/api/admin/errors/g-1/resolve").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(403);
  });

  it("allows an admin to resolve a platform group", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue({ ...group, experimentId: null } as never);
    vi.mocked(prisma.errorGroup.update).mockResolvedValue({ ...group, experimentId: null, status: "RESOLVED" } as never);

    const res = await request(server).post("/api/admin/errors/g-1/resolve").set("Authorization", `Bearer ${AdminToken}`);

    expect(res.status).toBe(200);
    expect(prisma.errorGroup.update).toHaveBeenCalledWith({
      where: { id: "g-1" },
      data: { status: "RESOLVED", resolvedAt: expect.any(Date), resolvedById: "admin-1" },
    });
  });

  it("refuses a group belonging to an experiment the caller does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server).post("/api/admin/errors/g-1/resolve").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await request(server).post("/api/admin/errors/g-1/resolve")).status).toBe(401);
  });

  it("404s an unknown group", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue(null);

    const res = await request(server).post("/api/admin/errors/nope/resolve").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/errors/:groupId/reopen", () => {
  it("clears the resolution", async () => {
    vi.mocked(prisma.errorGroup.update).mockResolvedValue(group as never);

    const res = await request(server).post("/api/admin/errors/g-1/reopen").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(200);
    expect(prisma.errorGroup.update).toHaveBeenCalledWith({
      where: { id: "g-1" },
      data: { status: "OPEN", resolvedAt: null, resolvedById: null },
    });
  });

  it("refuses a platform group for a non-admin", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue({ ...group, experimentId: null } as never);

    const res = await request(server).post("/api/admin/errors/g-1/reopen").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(403);
    // Admin rights really are the remedy here, so this message stays generic.
    expect(res.body.message).toBe("Administrator access required");
  });

  it("refuses a group belonging to an experiment the caller does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server).post("/api/admin/errors/g-1/reopen").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(403);
    // Distinct from the platform-group message: granting admin rights is not
    // the fix for a non-owner, so a silent revert to the generic message
    // would undo the point of this carry-forward item invisibly.
    expect(res.body.message).toBe("You do not have access to this error group");
  });

  it("404s an unknown group", async () => {
    vi.mocked(prisma.errorGroup.findUnique).mockResolvedValue(null);

    const res = await request(server).post("/api/admin/errors/nope/reopen").set("Authorization", `Bearer ${OwnerToken}`);

    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await request(server).post("/api/admin/errors/g-1/reopen")).status).toBe(401);
  });
});

describe("mounting", () => {
  it("does not authenticate unrelated /api/admin routes", async () => {
    // adminErrorRoutes mounts at /api/admin ahead of adminRoutes. If it used
    // router-level requireAuth, this anonymous request would 401 here instead
    // of falling through — which is exactly what would break login and signup.
    const res = await request(server).post("/api/admin/login").send({});

    expect(res.status).toBe(404);
  });
});
