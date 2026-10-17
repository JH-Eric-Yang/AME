import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import adminRoutes from "../routes/admin.js";
import prisma from "../prisma.js";
import { signToken } from "../middleware/auth.js";
import { useTestServer } from "./helpers/httpTestServer.js";

vi.mock("../prisma.js", () => ({
  default: {
    experimenter: { findUnique: vi.fn() },
    experiment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    experimentContent: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    asset: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("../app.js", () => ({
  io: { of: () => ({ sockets: new Map() }) },
}));
vi.mock("../socket/progressHandler.js", () => ({
  deliverContent: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

// One listening server for the whole file; see the helper for why supertest
// must never be handed the bare app.
const server = useTestServer(app);

const ExperimenterId = "exp-1";
const Token = signToken({ experimenterId: ExperimenterId, email: "test@test.com", role: "ADMIN" });
const AuthHeader = `Bearer ${Token}`;

const MockExperiment = {
  id: "test-exp-1",
  name: "Test Study",
  description: "A test experiment",
  visible: true,
  allowNew: true,
  img: null,
  avCollection: true,
  bodyDetection: false,
  videoChat: true,
  supplementaryDevice: "NONE",
  activeTime: 30,
  rollBackTime: 60,
  participantsPerSession: 2,
  conditions: ["A", "B"],
  randomization: false,
  randomizationConfig: null,
  matchingStrategy: "FIFO",
  initialProperties: {},
  conditionProperties: {},
  routines: [{ name: "consent", type: "routine-consent", elements: [] }],
  currentCondition: "A",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MockContents = [
  { progress: 0, trialNumber: 1, routine: "consent", content: { text: "Welcome" }, condition: null, description: "Intro" },
  { progress: 1, trialNumber: 1, routine: "task", content: { stimulus: "img1.png" }, condition: "A", description: "Trial 1" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.experimenter.findUnique).mockResolvedValue({
    id: ExperimenterId,
    email: "test@test.com",
    password: "hash",
    name: "Test",
    role: "ADMIN",
    status: "APPROVED",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // exportJson now always queries the asset manifest; default to none so the
  // existing export tests, which don't set this themselves, keep passing.
  vi.mocked(prisma.asset.findMany).mockResolvedValue([]);
});

describe("JSON Export", () => {
  it("exports experiment config and content as JSON", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(MockExperiment as any);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue(MockContents as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/export/json")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.headers["content-disposition"]).toMatch(/attachment.*\.json/);

    const body = res.body;
    expect(body.version).toBe(2);
    expect(body.exportedAt).toBeDefined();
    expect(body.experiment.name).toBe("Test Study");
    expect(body.experiment.conditions).toEqual(["A", "B"]);
    expect(body.experiment.routines).toHaveLength(1);
    expect(body.contents).toHaveLength(2);
    expect(body.contents[0].routine).toBe("consent");
    // Should not include transient fields
    expect(body.experiment.currentCondition).toBeUndefined();
    expect(body.experiment.id).toBeUndefined();
  });

  it("returns 404 for non-existent experiment", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server)
      .get("/api/admin/experiments/missing/export/json")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(404);
  });

  it("exports with empty contents when none exist", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(MockExperiment as any);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([]);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/export/json")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(200);
    expect(res.body.contents).toEqual([]);
  });
});

describe("JSON Import", () => {
  it("creates a new experiment from valid export JSON", async () => {
    const importPayload = {
      version: 1,
      exportedAt: "2026-03-13T00:00:00Z",
      experiment: {
        name: "Imported Study",
        routines: [{ name: "consent", type: "routine-consent", elements: [] }],
        conditions: ["X"],
        participantsPerSession: 1,
      },
      contents: [
        { progress: 0, trialNumber: 1, routine: "consent", content: {}, condition: null, description: "" },
      ],
    };

    vi.mocked(prisma.experiment.create).mockResolvedValue({
      id: "new-exp-1",
      name: "Imported Study (imported)",
    } as any);
    vi.mocked(prisma.experimentContent.createMany).mockResolvedValue({ count: 1 });

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send(importPayload);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("new-exp-1");
    expect(res.body.name).toBe("Imported Study (imported)");
    expect(res.body.contentRows).toBe(1);

    // Verify create was called with correct data
    const createCall = vi.mocked(prisma.experiment.create).mock.calls[0][0];
    expect(createCall.data.name).toBe("Imported Study (imported)");
    expect(createCall.data.visible).toBe(false); // Always starts hidden
    expect(createCall.data.conditions).toEqual(["X"]);
  });

  it("rejects invalid version", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({ version: 99, experiment: { name: "X", routines: [] } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FORMAT");
  });

  it("rejects missing experiment field", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({ version: 1 });

    expect(res.status).toBe(400);
  });

  it("rejects missing name/routines", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({ version: 1, experiment: { description: "no name" } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
  });

  it("rejects a round-robin routine whose group size does not divide the cohort", async () => {
    const importPayload = {
      version: 1,
      exportedAt: "2026-03-13T00:00:00Z",
      experiment: {
        name: "Bad Rotation Study",
        routines: [
          {
            name: "match",
            type: "routine-video-chat",
            elements: [],
            matching: {
              strategy: "fifo",
              slots: Array.from({ length: 7 }, (_, i) => ({ name: `slot-${i + 1}` })),
            },
          },
          {
            name: "chat",
            type: "routine-video-chat",
            elements: [],
            interactionPattern: { type: "round-robin", groupSize: 2 },
          },
        ],
      },
    };

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send(importPayload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(res.body.message).toBe(
      'Routine "chat" cannot rotate over the cohort matched by "match": Cohort of 7 cannot be split into groups of 2',
    );
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });

  // A hand-edited export file is the one path with no Session Designer in
  // front of it. Without a shape guard, validateSessionDesign dereferences
  // design.seats.length on a malformed member and throws inside an async
  // Express handler — which Express 4 does not catch, and which no error
  // middleware in this server catches either, so the request never gets a
  // response and the process dies on the unhandled rejection.
  it("rejects a session design member that is not a design object", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 1,
        experiment: { name: "Malformed Study", routines: [], sessionDesigns: [{}] },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });

  it("rejects a sessionDesigns value that is not an array rather than persisting it", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 1,
        experiment: {
          name: "Malformed Study",
          routines: [],
          sessionDesigns: { id: "design-1" },
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });

  it("imports with no content rows", async () => {
    vi.mocked(prisma.experiment.create).mockResolvedValue({
      id: "new-exp-2",
      name: "Empty Study (imported)",
    } as any);

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 1,
        experiment: { name: "Empty Study", routines: [] },
      });

    expect(res.status).toBe(201);
    expect(res.body.contentRows).toBe(0);
    expect(prisma.experimentContent.createMany).not.toHaveBeenCalled();
  });
});

describe("Asset manifest", () => {
  it("exports assets as metadata, without bytes, at version 2", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(MockExperiment as any);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([]);
    vi.mocked(prisma.asset.findMany).mockResolvedValue([
      {
        id: "a1",
        fileName: "stim.png",
        mimeType: "image/png",
        size: BigInt(421888),
        filePath: "/srv/assets/a1",
      },
    ] as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/export/json")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.assets).toEqual([
      { id: "a1", fileName: "stim.png", mimeType: "image/png", size: 421888 },
    ]);
  });

  it("still imports a version 1 file, which has no assets", async () => {
    vi.mocked(prisma.experiment.create).mockResolvedValue({ id: "new-exp" } as any);

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 1,
        experiment: { name: "Old Study", routines: [] },
      });

    expect(res.status).toBe(201);
    expect(prisma.asset.createMany).not.toHaveBeenCalled();
  });

  it("mints fresh asset ids and rewrites every reference to them", async () => {
    vi.mocked(prisma.experiment.create).mockResolvedValue({ id: "new-exp" } as any);

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 2,
        experiment: {
          name: "Study",
          routines: [
            {
              name: "trial",
              type: "routine-card",
              layout: { rows: [{ columns: [{ span: 12 }] }] },
              elements: [{ name: "stim", type: "image", params: { src: "asset:a1" } }],
            },
          ],
        },
        contents: [
          { progress: 0, trialNumber: 1, routine: "trial", content: { clip: "asset:a1" } },
        ],
        assets: [{ id: "a1", fileName: "stim.png", mimeType: "image/png", size: 421888 }],
      });

    expect(res.status).toBe(201);

    const created = vi.mocked(prisma.asset.createMany).mock.calls[0][0].data as any[];
    expect(created).toHaveLength(1);
    const newId = created[0].id;
    // A fresh id, so re-importing into the source server cannot collide.
    expect(newId).not.toBe("a1");
    // Rows arrive without their bytes, to be restored in the Media tab.
    expect(created[0].filePath).toBeNull();
    expect(created[0].fileName).toBe("stim.png");

    const experimentArg = vi.mocked(prisma.experiment.create).mock.calls[0][0] as any;
    expect(experimentArg.data.routines[0].elements[0].params.src).toBe(`asset:${newId}`);

    const contentArg = vi.mocked(prisma.experimentContent.createMany).mock.calls[0][0] as any;
    expect(contentArg.data[0].content.clip).toBe(`asset:${newId}`);
  });

  it("reports the asset count it created", async () => {
    vi.mocked(prisma.experiment.create).mockResolvedValue({ id: "new-exp" } as any);

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 2,
        experiment: { name: "Study", routines: [] },
        assets: [{ id: "a1", fileName: "stim.png", mimeType: "image/png", size: 1 }],
      });

    expect(res.body.assets).toBe(1);
  });

  it("rejects a manifest entry with a non-numeric size, before any write", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 2,
        experiment: { name: "Study", routines: [] },
        assets: [{ id: "a1", fileName: "stim.png", mimeType: "image/png", size: "abc" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FORMAT");
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });

  it("rejects a manifest entry with a missing id, before any write", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 2,
        experiment: { name: "Study", routines: [] },
        assets: [{ fileName: "stim.png", mimeType: "image/png", size: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FORMAT");
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });

  it("rejects an assets value that is not an array, before any write", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 2,
        experiment: { name: "Study", routines: [] },
        assets: { id: "a1" },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FORMAT");
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });

  // A canonical 8-seat round-robin design, well-formed enough that
  // validateSessionDesign raises no blocking error — mirrors the fixture in
  // admin.test.ts's "Session designs" suite.
  const CanonicalCohortSize = 8;
  function sessionDesignWithAssetRef() {
    return {
      version: 1,
      id: "design-1",
      label: "Chat",
      cohortSize: CanonicalCohortSize,
      strategy: "fifo",
      timeoutSeconds: 300,
      timeoutAction: "wait",
      seats: Array.from({ length: CanonicalCohortSize }, (_, i) => ({ name: `seat-${i + 1}` })),
      pattern: { type: "round-robin", groupSize: 2 },
      trials: CanonicalCohortSize - 1,
      trialRoutine: "Chat",
      interTrialRoutine: null,
      conditions: ["Basic"],
      startProgress: 1,
      matchRoutineName: "Chat-match",
      endMatchRoutineName: "Chat-end-match",
      partnerUnavailableText: "Your partner has left the study.",
      // The reference this test is about: a per-trial stimulus pointing at the
      // asset being imported, exactly where the Session Designer would put one.
      trialContent: { 1: { clip: "asset:a1" } },
    };
  }

  it("remaps an asset reference inside a session design's trialContent", async () => {
    vi.mocked(prisma.experiment.create).mockResolvedValue({ id: "new-exp" } as any);

    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", AuthHeader)
      .send({
        version: 2,
        experiment: {
          name: "Study",
          routines: [],
          sessionDesigns: [sessionDesignWithAssetRef()],
        },
        assets: [{ id: "a1", fileName: "stim.png", mimeType: "image/png", size: 421888 }],
      });

    expect(res.status).toBe(201);

    const newId = vi.mocked(prisma.asset.createMany).mock.calls[0][0].data[0].id as string;
    const experimentArg = vi.mocked(prisma.experiment.create).mock.calls[0][0] as any;
    expect(experimentArg.data.sessionDesigns[0].trialContent["1"].clip).toBe(`asset:${newId}`);
  });
});
