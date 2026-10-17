import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { SessionDesign } from "ame-shared/sessionDesign";
import express from "express";
import request from "supertest";
import { parse as parseCsv } from "csv-parse/sync";
import bcrypt from "bcryptjs";
import adminRoutes from "../routes/admin.js";
import prisma from "../prisma.js";
import { signToken } from "../middleware/auth.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { useTestServer } from "./helpers/httpTestServer.js";

// Mock prisma
vi.mock("../prisma.js", () => ({
  default: {
    experimenter: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    experiment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    participant: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    experimentContent: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    experimentResult: {
      findMany: vi.fn(),
    },
    sessionGrouping: {
      findMany: vi.fn(),
    },
    upload: {
      findMany: vi.fn(),
    },
    asset: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock app.js (io) and progressHandler (deliverContent)
vi.mock("../app.js", () => ({
  io: { of: () => ({ sockets: new Map() }) },
}));
vi.mock("../socket/progressHandler.js", () => ({
  deliverContent: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);
app.use(errorHandler);

// One listening server for the whole file; see the helper for why supertest
// must never be handed the bare app.
const server = useTestServer(app);

const TestExperimenter = {
  id: "exp-1",
  email: "test@example.com",
  name: "Test User",
  password: "",
  role: "EXPERIMENTER",
  status: "APPROVED",
  createdAt: new Date(),
};

const TestExperiment = {
  id: "exp-id-1",
  name: "Test Experiment",
  description: "",
  visible: false,
  allowNew: true,
  img: null,
  avCollection: false,
  bodyDetection: false,
  videoChat: false,
  supplementaryDevice: "NONE" as const,
  activeTime: 30,
  rollBackTime: 60,
  participantsPerSession: 1,
  conditions: [],
  currentCondition: null,
  randomization: false,
  randomizationConfig: null,
  matchingStrategy: "FIFO" as const,
  routines: [{ name: "consent", type: "routine-consent", elements: [] }],
  createdAt: new Date(),
  updatedAt: new Date(),
};

let validToken: string;

// Reset at test START, not in an afterEach: mock state here is ambient, and a
// baseline installed only by teardown leaves every test responsible for
// reinstating what the previous one tore down.
beforeEach(async () => {
  vi.resetAllMocks();
  TestExperimenter.password = await bcrypt.hash("password123", 4);
  validToken = signToken({ experimenterId: "exp-1", email: "test@example.com", role: "EXPERIMENTER" });
  // The ownership lookup is a precondition of nearly every experiment route,
  // never the thing under test. The one test that needs a miss overrides it.
  vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);
  // Session-design validation reads the experiment's authored rows to catch a
  // rotating routine hand-placed inside a block's band. No test here authors
  // one, so the baseline is "no rows"; the band tests override it.
  vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([]);
  // deleteExperiment looks up asset files to unlink alongside the row cascade.
  vi.mocked(prisma.asset.findMany).mockResolvedValue([]);
});

describe("Auth", () => {
  describe("POST /api/admin/signup", () => {
    it("creates experimenter and returns pending message", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.experimenter.create).mockResolvedValue(TestExperimenter);

      const res = await request(server).post("/api/admin/signup").send({
        email: "new@example.com",
        password: "password123",
        name: "New User",
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("message");
    });

    it("rejects duplicate email", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue(TestExperimenter);

      const res = await request(server).post("/api/admin/signup").send({
        email: "test@example.com",
        password: "password123",
        name: "Test",
      });

      expect(res.status).toBe(409);
    });

    it("rejects missing fields", async () => {
      const res = await request(server).post("/api/admin/signup").send({
        email: "new@example.com",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/login", () => {
    it("returns token for valid credentials", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue(TestExperimenter);

      const res = await request(server).post("/api/admin/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(res.body.experimenter).toHaveProperty("role", "EXPERIMENTER");
    });

    it("rejects wrong password", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue(TestExperimenter);

      const res = await request(server).post("/api/admin/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
    });

    it("rejects non-existent email", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue(null);

      const res = await request(server).post("/api/admin/login").send({
        email: "nobody@example.com",
        password: "password123",
      });

      expect(res.status).toBe(401);
    });

    it("rejects pending account", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue({
        ...TestExperimenter,
        status: "PENDING",
      });

      const res = await request(server).post("/api/admin/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_PENDING");
    });

    it("rejects rejected account", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue({
        ...TestExperimenter,
        status: "REJECTED",
      });

      const res = await request(server).post("/api/admin/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_REJECTED");
    });
  });

  describe("GET /api/admin/me", () => {
    it("returns experimenter info with valid token", async () => {
      vi.mocked(prisma.experimenter.findUnique).mockResolvedValue(TestExperimenter);

      const res = await request(server)
        .get("/api/admin/me")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
    });

    it("rejects missing auth header", async () => {
      const res = await request(server).get("/api/admin/me");
      expect(res.status).toBe(401);
    });

    it("rejects invalid token", async () => {
      const res = await request(server)
        .get("/api/admin/me")
        .set("Authorization", "Bearer invalid-token");

      expect(res.status).toBe(401);
    });
  });
});

describe("Experiments", () => {
  describe("GET /api/admin/experiments", () => {
    it("lists experiments for authenticated user", async () => {
      vi.mocked(prisma.experiment.findMany).mockResolvedValue([TestExperiment]);

      const res = await request(server)
        .get("/api/admin/experiments")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("answers 500 instead of hanging when the database query fails", async () => {
      vi.mocked(prisma.experiment.findMany).mockRejectedValue(new Error("Can't reach database server"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(server)
        .get("/api/admin/experiments")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL");
      log.mockRestore();
    });
  });

  describe("POST /api/admin/experiments", () => {
    it("creates experiment", async () => {
      vi.mocked(prisma.experiment.create).mockResolvedValue(TestExperiment);

      const res = await request(server)
        .post("/api/admin/experiments")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          name: "Test Experiment",
          routines: [{ name: "consent", type: "routine-consent", elements: [] }],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
    });

    it("rejects missing name", async () => {
      const res = await request(server)
        .post("/api/admin/experiments")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ routines: [] });

      expect(res.status).toBe(400);
    });

    it("rejects a round-robin routine whose group size does not divide the cohort", async () => {
      const SevenSlots = Array.from({ length: 7 }, (_, i) => ({
        name: `slot-${i + 1}`,
      }));

      const res = await request(server)
        .post("/api/admin/experiments")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          name: "Test Experiment",
          routines: [
            {
              name: "match",
              type: "routine-video-chat",
              elements: [],
              matching: { strategy: "fifo", slots: SevenSlots },
            },
            {
              name: "chat",
              type: "routine-video-chat",
              elements: [],
              interactionPattern: { type: "round-robin", groupSize: 2 },
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CONFIG");
      expect(res.body.message).toBe(
        'Routine "chat" cannot rotate over the cohort matched by "match": Cohort of 7 cannot be split into groups of 2',
      );
      expect(prisma.experiment.create).not.toHaveBeenCalled();
    });

    it("refuses counterbalancing combined with property matching at creation", async () => {
      const res = await request(server)
        .post("/api/admin/experiments")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          name: "Test Experiment",
          routines: [
            {
              name: "task-match",
              type: "routine-matching",
              layout: { rows: [] },
              elements: [],
              matching: {
                strategy: "property",
                slots: [{ name: "a" }, { name: "b" }],
                assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
              },
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CONFIG");
      expect(res.body.message).toContain("property");
      expect(prisma.experiment.create).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/admin/experiments/:id", () => {
    it("updates experiment", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);
      vi.mocked(prisma.experiment.update).mockResolvedValue({
        ...TestExperiment,
        name: "Updated",
      });

      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
    });

    it("returns 404 for non-existent experiment", async () => {
      // The only test that wants the ownership lookup to miss; everything else
      // takes the baseline installed in beforeEach.
      vi.mocked(prisma.experiment.findFirst).mockResolvedValueOnce(null);

      const res = await request(server)
        .put("/api/admin/experiments/nope")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(404);
    });

    const SevenSlots = Array.from({ length: 7 }, (_, i) => ({
      name: `slot-${i + 1}`,
    }));
    const EightSlots = Array.from({ length: 8 }, (_, i) => ({
      name: `slot-${i + 1}`,
    }));

    function routinesWithCohort(slots: { name: string }[]) {
      return [
        {
          name: "match",
          type: "routine-video-chat",
          elements: [],
          matching: { strategy: "fifo", slots },
        },
        {
          name: "chat",
          type: "routine-video-chat",
          elements: [],
          interactionPattern: { type: "round-robin", groupSize: 2 },
        },
      ];
    }

    it("rejects a round-robin routine whose group size does not divide the cohort", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);

      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ routines: routinesWithCohort(SevenSlots) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CONFIG");
      expect(res.body.message).toBe(
        'Routine "chat" cannot rotate over the cohort matched by "match": Cohort of 7 cannot be split into groups of 2',
      );
      expect(prisma.experiment.update).not.toHaveBeenCalled();
    });

    it("accepts a round-robin routine that divides the cohort evenly", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);
      vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);

      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ routines: routinesWithCohort(EightSlots) });

      expect(res.status).toBe(200);
      expect(prisma.experiment.update).toHaveBeenCalled();
    });
  });

  describe("DELETE /api/admin/experiments/:id", () => {
    it("deletes experiment", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);
      vi.mocked(prisma.experiment.delete).mockResolvedValue(TestExperiment);

      const res = await request(server)
        .delete("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(204);
    });
  });

  describe("PUT /api/admin/experiments/:id/visibility", () => {
    it("toggles visibility", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);
      vi.mocked(prisma.experiment.update).mockResolvedValue({
        ...TestExperiment,
        visible: true,
      });

      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1/visibility")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.visible).toBe(true);
    });
  });
});

describe("Participants", () => {
  const TestParticipant = {
    id: "part-1",
    experimentId: "exp-id-1",
    experimenterId: null,
    email: null,
    password: null,
    responseId: "resp-1",
    roomId: null,
    condition: "A",
    progressSequence: null,
    progress: 2,
    currentStage: 0,
    isLoggedIn: true,
    consent: true,
    completion: false,
    withdraw: false,
    role: 0,
    lastLogTime: new Date(),
    createdAt: new Date(),
  };

  describe("GET /api/admin/experiments/:id/participants", () => {
    it("lists participants", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
        id: "exp-id-1",
      } as never);
      vi.mocked(prisma.participant.findMany).mockResolvedValue([TestParticipant]);

      const res = await request(server)
        .get("/api/admin/experiments/exp-id-1/participants")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("POST /api/admin/experiments/:id/match-participants", () => {
    it("matches participants manually", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
        id: "exp-id-1",
      } as never);
      vi.mocked(prisma.participant.findMany).mockResolvedValue([
        TestParticipant,
        { ...TestParticipant, id: "part-2" },
      ]);
      vi.mocked(prisma.session.create).mockResolvedValue({
        id: "sess-1",
        experimentId: "exp-id-1",
        routineName: "video-chat-1",
        status: "ACTIVE",
        matchedAt: new Date(),
        createdAt: new Date(),
        participants: [],
      } as never);

      const res = await request(server)
        .post("/api/admin/experiments/exp-id-1/match-participants")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          routineName: "video-chat-1",
          participantIds: ["part-1", "part-2"],
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sessionId");
    });

    it("rejects empty participants list", async () => {
      const res = await request(server)
        .post("/api/admin/experiments/exp-id-1/match-participants")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          routineName: "video-chat-1",
          participantIds: [],
        });

      expect(res.status).toBe(400);
    });
  });
});

describe("Content", () => {
  describe("POST /api/admin/experiments/:id/content", () => {
    it("uploads content rows", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
        id: "exp-id-1",
      } as never);
      vi.mocked(prisma.experimentContent.createMany).mockResolvedValue({ count: 2 });

      const res = await request(server)
        .post("/api/admin/experiments/exp-id-1/content")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          rows: [
            { progress: 0, routine: "survey-1", content: { q1: "What?" } },
            { progress: 1, routine: "survey-2", content: { q2: "How?" } },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(2);
    });
  });

  describe("DELETE /api/admin/experiments/:id/content", () => {
    it("clears all content", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
        id: "exp-id-1",
      } as never);
      vi.mocked(prisma.experimentContent.deleteMany).mockResolvedValue({ count: 5 });

      const res = await request(server)
        .delete("/api/admin/experiments/exp-id-1/content")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(204);
    });
  });
});

describe("Results", () => {
  describe("GET /api/admin/experiments/:id/results", () => {
    it("lists results", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
        id: "exp-id-1",
      } as never);
      vi.mocked(prisma.experimentResult.findMany).mockResolvedValue([]);

      const res = await request(server)
        .get("/api/admin/experiments/exp-id-1/results")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/admin/experiments/:id/export/csv", () => {
    it("exports CSV", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
        id: "exp-id-1",
        name: "Test",
      } as never);
      vi.mocked(prisma.sessionGrouping.findMany).mockResolvedValue([]);
      vi.mocked(prisma.experimentResult.findMany).mockResolvedValue([
        {
          id: "r1",
          experimentId: "exp-id-1",
          participantId: "p1",
          responseId: "resp-1",
          progress: 0,
          trial: 1,
          routine: "survey",
          response: { q1: "answer" },
          trialInfo: null,
          createdAt: new Date("2026-01-01"),
        },
      ]);

      const res = await request(server)
        .get("/api/admin/experiments/exp-id-1/export/csv")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
    });

    it("keeps each answer in its own column when it holds commas, quotes or a line break", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({ id: "exp-id-1", name: "Test" } as never);
      vi.mocked(prisma.sessionGrouping.findMany).mockResolvedValue([]);
      vi.mocked(prisma.experimentResult.findMany).mockResolvedValue([
        {
          id: "r1",
          experimentId: "exp-id-1",
          participantId: "p1",
          responseId: "resp-1",
          progress: 0,
          trial: 1,
          routine: "survey",
          response: { note: 'She said "yes", then\nleft', reading: { uploadId: "u-1", size: 2 } },
          trialInfo: null,
          createdAt: new Date("2026-01-01"),
        },
      ] as never);

      const res = await request(server)
        .get("/api/admin/experiments/exp-id-1/export/csv")
        .set("Authorization", `Bearer ${validToken}`);

      const [row] = parseCsv(res.text, { columns: true }) as Record<string, string>[];
      expect(row.note).toBe('She said "yes", then\nleft');
      expect(JSON.parse(row.reading)).toEqual({ uploadId: "u-1", size: 2 });
      expect(row.createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("writes participant text that starts like a formula as text, and keeps numbers", async () => {
      vi.mocked(prisma.experiment.findFirst).mockResolvedValue({ id: "exp-id-1", name: "Test" } as never);
      vi.mocked(prisma.sessionGrouping.findMany).mockResolvedValue([]);
      vi.mocked(prisma.experimentResult.findMany).mockResolvedValue([
        {
          id: "r1",
          experimentId: "exp-id-1",
          participantId: "p1",
          responseId: "resp-1",
          progress: 0,
          trial: 1,
          routine: "survey",
          response: {
            sum: "=1+2",
            plus: "+cmd",
            at: "@SUM(A1)",
            dash: "-2+3",
            tab: "\t=1",
            typedNumber: "-5",
            slider: -5,
          },
          trialInfo: null,
          createdAt: new Date("2026-01-01"),
          participant: { externalId: "=HYPERLINK(\"x\")" },
        },
      ] as never);

      const res = await request(server)
        .get("/api/admin/experiments/exp-id-1/export/csv")
        .set("Authorization", `Bearer ${validToken}`);

      const [row] = parseCsv(res.text, { columns: true }) as Record<string, string>[];
      expect(row.sum).toBe("'=1+2");
      expect(row.plus).toBe("'+cmd");
      expect(row.at).toBe("'@SUM(A1)");
      expect(row.dash).toBe("'-2+3");
      expect(row.tab).toBe("'\t=1");
      expect(row.typedNumber).toBe("-5");
      expect(row.slider).toBe("-5");
      expect(row.externalId).toBe("'=HYPERLINK(\"x\")");
    });
  });
});

// ── Session designs & block-scoped content ─────────────

const CanonicalCohortSize = 8;
const CanonicalTrials = CanonicalCohortSize - 1;
const TestExperimentId = "exp-id-1";

/** A design that satisfies every rule in validateSessionDesign(). */
function sessionDesignFixture(overrides: Partial<SessionDesign> = {}): SessionDesign {
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
    trials: CanonicalTrials,
    trialRoutine: "Chat",
    interTrialRoutine: null,
    conditions: ["Basic"],
    startProgress: 1,
    matchRoutineName: "Chat-match",
    endMatchRoutineName: "Chat-end-match",
    partnerUnavailableText: "Your partner has left the study.",
    trialContent: {},
    ...overrides,
  };
}

/** The three routines the fixture above compiles to. */
function blockRoutines() {
  return [
    {
      name: "Chat-match",
      type: "routine-matching",
      layout: { rows: [] },
      elements: [],
      matching: {
        strategy: "fifo",
        slots: Array.from({ length: CanonicalCohortSize }, (_, i) => ({ name: `seat-${i + 1}` })),
        timeout: 300,
        timeoutAction: "wait",
      },
    },
    {
      // The trial routine must NOT carry its own matching: a second matching
      // config re-matches every trial and pins the rotation index to 0.
      name: "Chat",
      type: "routine-video-chat",
      layout: { rows: [] },
      elements: [],
      matching: null,
      interactionPattern: { type: "round-robin", groupSize: 2 },
    },
    {
      name: "Chat-end-match",
      type: "routine-end-matching",
      layout: { rows: [] },
      elements: [],
    },
  ];
}

describe("Session designs on PUT /api/admin/experiments/:id", () => {
  it("persists a valid design alongside the routines it compiled to", async () => {
    vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);

    const design = sessionDesignFixture();
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines: blockRoutines(),
        sessionDesigns: [design],
        conditions: ["Basic"],
        participantsPerSession: CanonicalCohortSize,
      });

    expect(res.status).toBe(200);
    const updateData = vi.mocked(prisma.experiment.update).mock.calls[0][0].data as {
      sessionDesigns?: unknown;
    };
    expect(updateData.sessionDesigns).toEqual([design]);
  });

  it("rejects a design whose cohort cannot be split by its group size", async () => {
    // No `routines` in the body, so validateRoutineRotations is skipped and the
    // 400 can only have come from the design check. The controller falls back to
    // the stored routines, which is the path the JSON-import route also takes.
    const OddCohortSize = 7;
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        sessionDesigns: [
          sessionDesignFixture({
            cohortSize: OddCohortSize,
            trials: OddCohortSize - 1,
            seats: Array.from({ length: OddCohortSize }, (_, i) => ({ name: `seat-${i + 1}` })),
          }),
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(res.body.message).toContain('Session design "Chat"');
    // Pin the specific rule rather than "some error happened": Task 1 tags the
    // cohort-divisibility failure with field "cohortSize" so the designer can
    // render it beside the control that caused it.
    expect(
      res.body.issues.some((issue: { field?: string }) => issue.field === "cohortSize"),
    ).toBe(true);
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/experiments/:id/content", () => {
  const DeletedCount = 9;
  const Rows = [
    {
      progress: 2,
      trialNumber: 1,
      routine: "Chat",
      content: { text: "trial one" },
      condition: "Basic",
      description: "block:design-1:1",
    },
    {
      progress: 3,
      trialNumber: 2,
      routine: "Chat",
      content: { text: "trial two" },
      condition: "Basic",
      description: "block:design-1:2",
    },
  ];

  // vitest.config.ts sets mockReset globally AND this file resets in its own
  // top-level beforeEach, so every implementation is installed per test here.
  beforeEach(() => {
    vi.mocked(prisma.experimentContent.deleteMany).mockResolvedValue({ count: DeletedCount });
    vi.mocked(prisma.experimentContent.createMany).mockResolvedValue({ count: Rows.length });
    // The array form of $transaction resolves the operations it is handed, so
    // the controller reads the real deleteMany/createMany counts back.
    (prisma.$transaction as unknown as Mock).mockImplementation(
      (operations: Promise<unknown>[]) => Promise.all(operations),
    );
  });

  it("deletes only the declared progress band and conditions, then writes the rows", async () => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        rows: Rows,
        replaceRange: { fromProgress: 1, toProgress: 9, conditions: ["Basic"] },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: DeletedCount, created: Rows.length });
    expect(prisma.experimentContent.deleteMany).toHaveBeenCalledWith({
      where: {
        experimentId: TestExperimentId,
        progress: { gte: 1, lte: 9 },
        condition: { in: ["Basic"] },
      },
    });
    expect(prisma.experimentContent.createMany).toHaveBeenCalledWith({
      data: Rows.map((row) => ({ experimentId: TestExperimentId, ...row })),
    });
  });

  it("scopes the delete to the block's own description stamps when blockId is given", async () => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        rows: Rows,
        replaceRange: {
          fromProgress: 1,
          toProgress: 9,
          conditions: ["Basic"],
          blockId: "design-1",
        },
      });

    expect(res.status).toBe(200);
    // The trailing colon matters: without it "design-1" would also match rows
    // stamped by a block called "design-10".
    expect(prisma.experimentContent.deleteMany).toHaveBeenCalledWith({
      where: {
        experimentId: TestExperimentId,
        description: { startsWith: "block:design-1:" },
      },
    });
  });

  it("rejects a blockId carrying a SQL LIKE wildcard, which would over-match the delete", async () => {
    // Prisma passes `%` and `_` through to LIKE unescaped, so "design-%" would
    // match every block's stamps — the exact over-match the trailing colon in
    // the prefix exists to prevent.
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        rows: Rows,
        replaceRange: {
          fromProgress: 1,
          toProgress: 9,
          conditions: ["Basic"],
          blockId: "design-%",
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(prisma.experimentContent.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a request with no replaceRange rather than deleting nothing or everything", async () => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: Rows });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
    expect(prisma.experimentContent.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects an empty rows array, which would wipe the band and write nothing back", async () => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        rows: [],
        replaceRange: { fromProgress: 1, toProgress: 9, conditions: ["Basic"] },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
    expect(prisma.experimentContent.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * A row Prisma cannot hold rejects the `$transaction` promise inside an
   * async Express handler, which — with no error middleware behind it — is an
   * unhandled rejection that kills the process rather than answering the
   * request. The check has to run BEFORE the transaction opens.
   */
  it.each([
    ["a row with no progress", { trialNumber: 1, routine: "Chat", content: {} }],
    ["a row with no routine", { progress: 2, trialNumber: 1, content: {} }],
    ["a row whose progress is text", { progress: "2", routine: "Chat", content: {} }],
    ["a row whose content is not an object", { progress: 2, routine: "Chat", content: "hi" }],
    ["a row that is not an object at all", null],
  ])("400s on %s instead of failing inside the transaction", async (_name, row) => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        rows: [Rows[0], row],
        replaceRange: { fromProgress: 1, toProgress: 9, conditions: ["Basic"] },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONTENT");
    // Named by its 1-based position, so the researcher can find it in the table.
    expect(res.body.message).toContain("Row 2");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.experimentContent.deleteMany).not.toHaveBeenCalled();
  });

  it("400s on an unwritable row on the append route too, which shares the same mapper", async () => {
    const res = await request(server)
      .post(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: [{ progress: 0, content: {} }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONTENT");
    expect(prisma.experimentContent.createMany).not.toHaveBeenCalled();
  });

  it("rejects a band replace that names no conditions, which would wipe every condition in the range", async () => {
    // Without this guard an omitted `conditions` field drops the condition
    // filter entirely, so a single-condition rebuild deletes the other
    // conditions' rows across the whole progress band and never writes them
    // back. blockId scoping is the only case where conditions are dispensable.
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        rows: Rows,
        replaceRange: { fromProgress: 1, toProgress: 9 },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
    expect(res.body.message).toContain("conditions");
    expect(prisma.experimentContent.deleteMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/experiments/:id/content/all", () => {
  const Routines = [
    { name: "Intro", type: "routine-card", layout: { rows: [] }, elements: [{ name: "name", type: "input-textfield", params: {} }, { name: "clip", type: "recorder", params: {} }] },
    { name: "Recap", type: "routine-card", layout: { rows: [] }, elements: [{ name: "replay", type: "video", params: {} }] },
  ];
  const GoodRows = [
    { progress: 0, trialNumber: 1, routine: "Intro", content: {}, condition: "Basic" },
    { progress: 1, trialNumber: 1, routine: "Recap", content: { replay: { src: "ref:self/p0/clip" } }, condition: "Basic" },
  ];

  beforeEach(() => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      id: TestExperimentId, routines: Routines, conditions: ["Basic"], randomizationConfig: null,
    } as never);
    vi.mocked(prisma.experimentContent.deleteMany).mockResolvedValue({ count: 3 });
    vi.mocked(prisma.experimentContent.createMany).mockResolvedValue({ count: GoodRows.length });
    (prisma.$transaction as unknown as Mock).mockImplementation(
      (operations: Promise<unknown>[]) => Promise.all(operations),
    );
  });

  it("replaces every row in one transaction and reports the count written", async () => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: GoodRows });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: GoodRows.length });
    expect(prisma.experimentContent.deleteMany).toHaveBeenCalledWith({ where: { experimentId: TestExperimentId } });
    expect(prisma.experimentContent.createMany).toHaveBeenCalledWith({
      data: GoodRows.map((row) => ({ experimentId: TestExperimentId, ...row, description: null })),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("accepts an empty sequence (the tab confirms first)", async () => {
    vi.mocked(prisma.experimentContent.createMany).mockResolvedValue({ count: 0 });
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0 });
  });

  it("refuses a sequence with a hard reference error and writes nothing", async () => {
    const bad = [GoodRows[0], { ...GoodRows[1], content: { replay: { src: "ref:self/p0/name" } } }];
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: bad });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONTENT");
    expect(res.body.errors).toEqual([
      'p1 (Basic): `ref:self/p0/name`: a media source needs a recording or file, but "name" is a input-textfield',
    ]);
    expect(res.body.message).toContain("a media source needs a recording or file");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("ignores the randomization ranges unless the experiment shuffles", async () => {
    // `randomization` (Boolean) and `randomizationConfig` (Json) are stored
    // independently and the runtime reads the config only when the switch is
    // on, so a stale range must not make an otherwise safe p<N> ref unsafe.
    const stale = { Basic: [{ fromTrial: 1, toTrial: 1, method: "shuffle" }] };
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      id: TestExperimentId, routines: Routines, conditions: ["Basic"],
      randomization: false, randomizationConfig: stale,
    } as never);
    const ignored = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: GoodRows });
    expect(ignored.status).toBe(200);

    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      id: TestExperimentId, routines: Routines, conditions: ["Basic"],
      randomization: true, randomizationConfig: stale,
    } as never);
    const applied = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: GoodRows });
    expect(applied.status).toBe(400);
    expect(applied.body.errors).toEqual([
      "p1 (Basic): p0 and p1 are both in a shuffled range (p0–p1) and may swap; use t<K>",
    ]);
  });

  it("refuses a malformed row before validating references", async () => {
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: [{ trialNumber: 1, routine: "Intro", content: {} }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("needs a whole-number progress");
  });

  it("404s an experiment the caller does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null as never);
    const res = await request(server)
      .put(`/api/admin/experiments/${TestExperimentId}/content/all`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ rows: GoodRows });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/experiments/:id/sessions", () => {
  const SessionRowFixture = {
    id: "sess-1",
    experimentId: TestExperimentId,
    routineName: "Chat-match",
    // Null because nothing writes Session.blockId until multi-block support
    // lands; the summary must pass it through either way.
    blockId: null,
    status: "ACTIVE",
    matchProgress: 1,
    matchedAt: new Date("2026-09-06T10:00:00.000Z"),
    createdAt: new Date("2026-09-06T10:00:00.000Z"),
    sharedProgressSequence: null,
    participants: [
      {
        participantId: "p-1",
        seat: 1,
        slotName: "seat-1",
        status: "ACTIVE",
        participant: { externalId: "PROLIFIC_6KD2", progress: 5 },
      },
      {
        participantId: "p-0",
        seat: 0,
        slotName: "seat-0",
        status: "DROPPED",
        participant: { externalId: null, progress: 3 },
      },
    ],
    groupings: [
      { progress: 5, trialNumber: 4, groupIndex: 0, seats: [1], participantIds: ["p-1"] },
      { progress: 4, trialNumber: 3, groupIndex: 0, seats: [0, 1], participantIds: ["p-0", "p-1"] },
    ],
  };

  it("returns the experiment's sessions with seats and the current grouping", async () => {
    vi.mocked(prisma.session.findMany).mockResolvedValue([SessionRowFixture] as never);

    const res = await request(server)
      .get(`/api/admin/experiments/${TestExperimentId}/sessions`)
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      sessionId: "sess-1",
      routineName: "Chat-match",
      blockId: null,
      seatCount: 2,
      activeSeatCount: 1,
      currentProgress: 5,
      currentTrialNumber: 4,
    });
    // Seats come back ascending, with the dropped one still present.
    expect(res.body[0].seats.map((s: { seat: number }) => s.seat)).toEqual([0, 1]);
    expect(res.body[0].seats[1].externalId).toBe("PROLIFIC_6KD2");
    // Only the newest progress's groups survive.
    expect(res.body[0].groupings).toHaveLength(1);
    expect(res.body[0].groupings[0].seats).toEqual([1]);
  });

  it("404s when the experimenter does not own the experiment", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server)
      .get(`/api/admin/experiments/${TestExperimentId}/sessions`)
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });

  it("401s without a token", async () => {
    const res = await request(server).get(
      `/api/admin/experiments/${TestExperimentId}/sessions`,
    );
    expect(res.status).toBe(401);
  });
});

describe("Multi-block rotation validation", () => {
  /** The canonical dyad block: 8 seats rotating in pairs. */
  const DyadCohortSize = 8;
  const DyadGroupSize = 2;
  /** A second, deliberately incompatible block: 9 seats rotating in threes. */
  const TriadCohortSize = 9;
  const TriadGroupSize = 3;
  /** A full round-robin over N seats has N-1 unique rotations. */
  const DyadTrials = DyadCohortSize - 1;
  /**
   * A resolvable schedule for nine seats in threes: four trials, each seat once
   * per trial, every one of the 36 pairs met exactly once.
   *
   * There is no round-robin that does this — `computeRoundRobinRotations`
   * chunks the rotated circle above dyads and misses a third of the pairs — so
   * an explicit table is how a triad study is authored, and what the validator
   * points a researcher at.
   */
  const TriadSchedule = [
    [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
    [[0, 3, 6], [1, 4, 7], [2, 5, 8]],
    [[0, 4, 8], [1, 5, 6], [2, 3, 7]],
    [[0, 5, 7], [1, 3, 8], [2, 4, 6]],
  ];
  const TriadTrials = TriadSchedule.length;
  /** A third cohort, so a routine can be claimed twice by blocks that differ. */
  const RivalCohortSize = 6;
  const RivalTrials = RivalCohortSize - 1;

  const slots = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ name: `seat-${i + 1}` }));

  const blockRoutines = (
    prefix: string,
    cohortSize: number,
    groupSize: number,
  ) => [
    {
      name: `${prefix}-match`,
      type: "routine-matching",
      elements: [],
      matching: { strategy: "fifo", slots: slots(cohortSize) },
    },
    {
      name: prefix,
      type: "routine-video-chat",
      elements: [],
      interactionPattern: { type: "round-robin", groupSize },
    },
    {
      name: `${prefix}-end-match`,
      type: "routine-end-matching",
      elements: [],
    },
  ];

  const blockDesign = (
    prefix: string,
    id: string,
    label: string,
    cohortSize: number,
    groupSize: number,
    trials: number,
  ) => ({
    version: 1,
    id,
    label,
    cohortSize,
    strategy: "fifo",
    timeoutSeconds: 300,
    timeoutAction: "wait",
    seats: slots(cohortSize),
    pattern: { type: "round-robin", groupSize },
    trials,
    trialRoutine: prefix,
    interTrialRoutine: null,
    // "Basic" is the default condition, so this never trips the unknown-condition
    // warning even though TestExperiment declares no conditions.
    conditions: ["Basic"],
    startProgress: 1,
    matchRoutineName: `${prefix}-match`,
    endMatchRoutineName: `${prefix}-end-match`,
    partnerUnavailableText: "Your partner is no longer available.",
    trialContent: {},
  });

  const twoBlockRoutines = (triadGroupSize: number) => [
    ...blockRoutines("chat-a", DyadCohortSize, DyadGroupSize),
    ...blockRoutines("triad", TriadCohortSize, triadGroupSize),
  ];

  it("saves two blocks whose cohorts and group sizes differ", async () => {
    vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);

    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines: twoBlockRoutines(TriadGroupSize),
        sessionDesigns: [
          blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials),
          {
            ...blockDesign("triad", "blk-b", "Triad block", TriadCohortSize, TriadGroupSize, TriadTrials),
            // Groups of three are authored as an explicit table, because no
            // round-robin covers nine seats in threes. The ROUTINE still
            // rotates in threes over nine seats, which is what
            // validateRoutineRotations checks and what this test is about.
            pattern: { type: "sequence", steps: TriadSchedule },
            // Past the dyad block's own band (progress 1-9), so the two blocks
            // do not stack on the same progresses.
            startProgress: 10,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(prisma.experiment.update).toHaveBeenCalled();
  });

  it("rejects a block whose group size does not divide its OWN cohort, and names that block's cohort", async () => {
    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        // The triad block now asks for dyads over 9 seats — invalid on its own terms.
        routines: twoBlockRoutines(DyadGroupSize),
        sessionDesigns: [
          blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials),
          blockDesign("triad", "blk-b", "Triad block", TriadCohortSize, DyadGroupSize, TriadTrials),
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    // "triad-match", not "chat-a-match": the routine is checked against the
    // cohort of the block that owns it.
    expect(res.body.message).toBe(
      'Routine "triad" cannot rotate over the cohort matched by "triad-match": Cohort of 9 cannot be split into groups of 2',
    );
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  it("still fails a drifted routine against a real cohort when the owning block's match routine is absent", async () => {
    // The block claims "chat-a" but names a match routine that is absent from the
    // list being written, so its declared cohort is all `cohortsForRotatingRoutine`
    // can derive by ownership. That declared cohort is 9 seats in groups of 3 and
    // validates on its own; the cohort "chat-a" will actually rotate over at run
    // time is "other-match"'s 8 seats, which cannot split into 3. Concatenating the
    // declared cohort with the cross-product is what still catches it -- replacing
    // them (the pre-fix behaviour) let this save through.
    const routines = [
      {
        name: "other-match",
        type: "routine-matching",
        elements: [],
        matching: { strategy: "fifo", slots: slots(DyadCohortSize) },
      },
      {
        name: "chat-a",
        type: "routine-video-chat",
        elements: [],
        interactionPattern: { type: "round-robin", groupSize: TriadGroupSize },
      },
    ];

    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines,
        sessionDesigns: [
          {
            ...blockDesign("chat-a", "blk-a", "Dyad block", TriadCohortSize, TriadGroupSize, TriadTrials),
            matchRoutineName: "absent-match",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Routine "chat-a" cannot rotate over the cohort matched by "other-match": Cohort of 8 cannot be split into groups of 3',
    );
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  it("refuses two blocks that claim the same routine, which ownership would resolve first-wins", async () => {
    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines: blockRoutines("chat-a", DyadCohortSize, DyadGroupSize),
        sessionDesigns: [
          blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials),
          // Same trial routine, a different cohort: findOwningDesign would take
          // the first and silently skip this block's 6 seats.
          {
            ...blockDesign("chat-a", "blk-b", "Rival block", RivalCohortSize, DyadGroupSize, RivalTrials),
            matchRoutineName: "rival-match",
            endMatchRoutineName: "rival-end-match",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(res.body.message).toBe(
      'Session design "Rival block" cannot be saved: Routine "chat-a" is claimed by both "Dyad block" and "Rival block". Give each block its own routines; a routine can belong to only one session block, and the second block\'s cohort would be ignored.',
    );
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  it("scopes a routines-only update by the designs already stored", async () => {
    // The request carries no sessionDesigns at all, so ownership can only come
    // from the experiment row. Without that fallback the triad cohort fails the
    // dyad rotation and this 400s.
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      ...TestExperiment,
      sessionDesigns: [
        blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials),
        blockDesign("triad", "blk-b", "Triad block", TriadCohortSize, TriadGroupSize, TriadTrials),
      ],
    } as never);
    vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);

    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ routines: twoBlockRoutines(TriadGroupSize) });

    expect(res.status).toBe(200);
    expect(prisma.experiment.update).toHaveBeenCalled();
  });

  it("validates against no blocks when the same write clears sessionDesigns", async () => {
    // `sessionDesigns: null` deletes the column, so scoping by the stored blocks
    // would validate against designs this write is about to remove.
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      ...TestExperiment,
      sessionDesigns: [
        blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials),
        blockDesign("triad", "blk-b", "Triad block", TriadCohortSize, TriadGroupSize, TriadTrials),
      ],
    } as never);

    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ routines: twoBlockRoutines(TriadGroupSize), sessionDesigns: null });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Routine "chat-a" cannot rotate over the cohort matched by "triad-match": Cohort of 9 cannot be split into groups of 2',
    );
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  it("does not crash on a malformed design entry, which reaches rotation validation first", async () => {
    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines: blockRoutines("chat-a", DyadCohortSize, DyadGroupSize),
        sessionDesigns: [null],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "sessionDesigns must be an array of session design objects",
    );
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  it("keeps cross-product validation for an experiment that declares no session designs", async () => {
    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ routines: twoBlockRoutines(TriadGroupSize) });

    // No sessionDesigns means no ownership is knowable, so the conservative
    // pre-existing rule stands: the dyad rotation is failed by the triad cohort.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Routine "chat-a" cannot rotate over the cohort matched by "triad-match": Cohort of 9 cannot be split into groups of 2',
    );
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  /**
   * Every fixture here reached `validateSessionDesign`, which dereferences the
   * fields the Session Designer always sets, and threw a TypeError inside an
   * async Express handler. Express 4 does not catch async rejections and this
   * server registers no error middleware, so the request was never answered
   * and the unhandled rejection took the process down — dropping every live
   * participant's websocket mid-experiment. Each must be a plain 400.
   *
   * Routines are deliberately omitted from every request: `validateRoutineRotations`
   * runs first and tolerates anything, so this is the guard under test.
   */
  describe("malformed session designs are refused, not crashed on", () => {
    const wellFormed = () =>
      blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials) as
        unknown as Record<string, unknown>;

    const without = (field: string): Record<string, unknown> => {
      const copy = wellFormed();
      delete copy[field];
      return copy;
    };

    it.each([
      // `partnerUnavailableText.trim()` — "Cannot read properties of undefined".
      ["a bare object carrying only seats and a pattern", { seats: [], pattern: {} }],
      // `design.pattern.steps.forEach` — "steps is undefined".
      ["a sequence pattern with no steps table", { ...wellFormed(), pattern: { type: "sequence" } }],
      // A step that is not a list of groups: `for (const seat of group)`.
      [
        "a sequence step that is not a list of groups",
        { ...wellFormed(), pattern: { type: "sequence", steps: [7] } },
      ],
      // `for (const c of design.conditions)` — "is not iterable".
      ["a design with no conditions", without("conditions")],
      ["a design with no dropout notice", without("partnerUnavailableText")],
      ["a design with no label to name it by", without("label")],
      ["a design with no trial routine", without("trialRoutine")],
      ["a design with no seat list", without("seats")],
      ["a design whose seats are not objects", { ...wellFormed(), seats: [null, null] }],
      ["a design with no cohort size", without("cohortSize")],
      ["a design whose cohort size is text", { ...wellFormed(), cohortSize: "8" }],
      ["a design whose trial count is not a number", { ...wellFormed(), trials: null }],
      ["a design with no starting progress", without("startProgress")],
      ["a design with a pattern type nothing implements", { ...wellFormed(), pattern: { type: "spiral" } }],
      // The id is the `block:<id>:` prefix replaceContent deletes by. Two designs
      // sharing a blank one would share a single prefix, so re-applying either
      // would silently wipe the other's content rows.
      ["a design with no id to key its rows by", without("id")],
      ["a design whose id is blank", { ...wellFormed(), id: "   " }],
      // compileSessionDesign indexes this per trial; absent, it throws there
      // instead of answering here, and the Session tab renders nothing.
      ["a design with no trial content map", without("trialContent")],
      ["a design whose trial content is not an object", { ...wellFormed(), trialContent: "none" }],
    ])("400s on %s", async (_name, design) => {
      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ sessionDesigns: [design] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CONFIG");
      expect(res.body.message).toBe(
        "sessionDesigns must be an array of session design objects",
      );
      expect(prisma.experiment.update).not.toHaveBeenCalled();
    });

    it("400s on the same payload arriving through the JSON import route", async () => {
      const res = await request(server)
        .post("/api/admin/experiments/import/json")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          version: 1,
          experiment: {
            name: "Imported",
            routines: [],
            sessionDesigns: [{ seats: [], pattern: {} }],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "sessionDesigns must be an array of session design objects",
      );
      expect(prisma.experiment.create).not.toHaveBeenCalled();
    });
  });

  /**
   * Two blocks stacked on the same progresses both keep their rows —
   * `replaceContent` scopes its delete by block id — and `deliverContent`
   * serves whichever its `orderBy trialNumber asc` reaches first, so the other
   * block's cohort silently never forms and the experiment still runs to
   * completion. `duplicateClaimIssue` only compares routine NAMES, and
   * `validateSessionDesign` only ever sees one design.
   */
  describe("two blocks whose progress bands overlap", () => {
    /** The Designer produces this: a second block added before the first has
     *  written any content row reads the same `lastProgressOf` and starts at 1. */
    const stackedDesigns = () => [
      blockDesign("chat-a", "blk-a", "First block", DyadCohortSize, DyadGroupSize, DyadTrials),
      blockDesign("chat-b", "blk-b", "Second block", DyadCohortSize, DyadGroupSize, DyadTrials),
    ];

    it("refuses them, naming both blocks and the overlapping range", async () => {
      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ sessionDesigns: stackedDesigns() });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CONFIG");
      expect(res.body.message).toBe(
        'Session design "Second block" cannot be saved: Blocks "First block" and "Second block" both occupy progress 1-9 under condition Basic. Move one block\'s starting progress past the other\'s last one; two blocks stacked on the same progresses both keep their rows, and only one of them is ever delivered, so the other block\'s cohort silently never forms.',
      );
      expect(prisma.experiment.update).not.toHaveBeenCalled();
    });

    it("saves two blocks laid end to end", async () => {
      vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);
      const [first, second] = stackedDesigns();

      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        // The first block ends at progress 9, so the second starts at 10.
        .send({ sessionDesigns: [first, { ...second, startProgress: 10 }] });

      expect(res.status).toBe(200);
    });

    it("saves two blocks that share progresses under different conditions", async () => {
      // `deliverContent` selects by condition, so two arms of a between-subjects
      // design legitimately occupy the same progress map.
      vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);
      const [first, second] = stackedDesigns();

      const res = await request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          conditions: ["ArmA", "ArmB"],
          sessionDesigns: [
            { ...first, conditions: ["ArmA"] },
            { ...second, conditions: ["ArmB"] },
          ],
        });

      expect(res.status).toBe(200);
    });
  });

  /**
   * `computeRotationIndex` counts EVERY round-robin routine between the match
   * progress and the current one, so a second rotating routine authored into
   * the band double-advances the schedule. The rule existed in
   * `validateSessionDesign` but the server called it with three arguments, so
   * `bandContent` defaulted to `[]` and it could never fire — including on the
   * import route, the one path server validation exists to cover.
   */
  describe("a rotating routine authored inside a block's band", () => {
    const warmup = {
      name: "Warmup",
      type: "routine-card",
      elements: [],
      interactionPattern: { type: "round-robin", groupSize: DyadGroupSize },
    };

    const save = (design: unknown) =>
      request(server)
        .put("/api/admin/experiments/exp-id-1")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          routines: [...blockRoutines("chat-a", DyadCohortSize, DyadGroupSize), warmup],
          sessionDesigns: [design],
        });

    const design = () =>
      blockDesign("chat-a", "blk-a", "Dyad block", DyadCohortSize, DyadGroupSize, DyadTrials);

    it("is caught by reading the experiment's own content rows", async () => {
      // Progress 5 sits inside the block's band of 1-9.
      vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([
        { progress: 5, routine: "Warmup" },
      ] as never);

      const res = await save(design());

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Routine "Warmup" also rotates inside this block');
      expect(prisma.experiment.update).not.toHaveBeenCalled();
    });

    it("leaves the same routine alone outside the band", async () => {
      vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);
      vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([
        { progress: 99, routine: "Warmup" },
      ] as never);

      expect((await save(design())).status).toBe(200);
    });

    it("reads the rows out of the file on the import route", async () => {
      const res = await request(server)
        .post("/api/admin/experiments/import/json")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          version: 1,
          experiment: {
            name: "Imported",
            routines: [...blockRoutines("chat-a", DyadCohortSize, DyadGroupSize), warmup],
            sessionDesigns: [design()],
          },
          contents: [{ progress: 5, routine: "Warmup", content: {} }],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Routine "Warmup" also rotates inside this block');
      expect(prisma.experiment.create).not.toHaveBeenCalled();
    });
  });
});

describe("Role assignment validation", () => {
  it("refuses counterbalancing combined with property matching", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);

    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines: [
          {
            name: "task-match",
            type: "routine-matching",
            layout: { rows: [] },
            elements: [],
            matching: {
              strategy: "property",
              slots: [{ name: "a" }, { name: "b" }],
              assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
            },
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(res.body.message).toContain("property");
    expect(prisma.experiment.update).not.toHaveBeenCalled();
  });

  it("accepts a routine with no assignment at all", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(TestExperiment);
    vi.mocked(prisma.experiment.update).mockResolvedValue(TestExperiment);

    const res = await request(server)
      .put("/api/admin/experiments/exp-id-1")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routines: [
          {
            name: "task-match",
            type: "routine-matching",
            layout: { rows: [] },
            elements: [],
            matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] },
          },
        ],
      });

    expect(res.status).toBe(200);
  });

  it("refuses the same combination arriving through the JSON import route", async () => {
    const res = await request(server)
      .post("/api/admin/experiments/import/json")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        version: 2,
        experiment: {
          name: "Imported",
          routines: [
            {
              name: "task-match",
              type: "routine-matching",
              layout: { rows: [] },
              elements: [],
              matching: {
                strategy: "property",
                slots: [{ name: "a" }, { name: "b" }],
                assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
              },
            },
          ],
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CONFIG");
    expect(res.body.message).toContain("property");
    expect(prisma.experiment.create).not.toHaveBeenCalled();
  });
});

describe("Participants carry their role", () => {
  it("returns the role index with each participant", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      id: "exp-id-1",
    } as never);
    vi.mocked(prisma.participant.findMany).mockResolvedValue([
      { id: "p-1", responseId: "r-1", role: 0, progress: 6, condition: "Basic", createdAt: new Date() },
      { id: "p-2", responseId: "r-2", role: 1, progress: 6, condition: "Basic", createdAt: new Date() },
    ] as never);

    const res = await request(server)
      .get("/api/admin/experiments/exp-id-1/participants")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.map((p: { role: number }) => p.role)).toEqual([0, 1]);
    // A mocked return value is independent of the query that requested it, so
    // the assertions above alone would still pass a future `select` that
    // drops `role`. Pin the call shape too: no `select` at all today means no
    // field can be silently narrowed away.
    expect(prisma.participant.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ select: expect.anything() }),
    );
  });
});

describe("Manual matching deals roles", () => {
  /** The routine the cohort is matched into, with the matching config given. */
  function experimentWithMatching(matching: unknown) {
    return {
      ...TestExperiment,
      id: "exp-id-1",
      sessionDesigns: [],
      routines: [
        { name: "task-match", type: "routine-matching", elements: [], matching },
      ],
    } as never;
  }

  /** The role written for each participant, keyed by participant id. */
  function rolesWritten() {
    return new Map(
      vi
        .mocked(prisma.participant.update)
        .mock.calls.filter((c) => (c[0] as { data?: { role?: number } }).data?.role !== undefined)
        .map((c) => {
          const arg = c[0] as { where: { id: string }; data: { role: number } };
          return [arg.where.id, arg.data.role];
        }),
    );
  }

  beforeEach(() => {
    vi.mocked(prisma.participant.findMany).mockResolvedValue([
      { id: "p-1", experimentId: "exp-id-1" },
      { id: "p-2", experimentId: "exp-id-1" },
    ] as never);
    vi.mocked(prisma.session.create).mockResolvedValue({
      id: "sess-1",
      participants: [],
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
  });

  async function matchTwo(matching: unknown) {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(experimentWithMatching(matching));

    return request(server)
      .post("/api/admin/experiments/exp-id-1/match-participants")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        routineName: "task-match",
        assignments: [
          { participantId: "p-1", slotName: "director", seat: 0 },
          { participantId: "p-2", slotName: "matcher", seat: 1 },
        ],
      });
  }

  it("persists a distinct role index for every member", async () => {
    const res = await matchTwo({
      strategy: "manual",
      slots: [{ name: "director" }, { name: "matcher" }],
      assignment: { mode: "random" },
    });

    expect(res.status).toBe(200);
    const roles = rolesWritten();
    expect([...roles.values()].sort()).toEqual([0, 1]);
    expect(roles.get("p-1")).not.toBe(roles.get("p-2"));
  });

  it("uses the slot index under property matching", async () => {
    await matchTwo({
      strategy: "property",
      slots: [
        { name: "director", filters: [{ property: "score", operator: "gt", value: 5 }] },
        { name: "matcher", filters: [{ property: "score", operator: "lte", value: 5 }] },
      ],
    });

    const roles = rolesWritten();
    expect(roles.get("p-1")).toBe(0);
    expect(roles.get("p-2")).toBe(1);
  });

  it("still deals roles for a routine that declares no matching config", async () => {
    // The Participants tab matches by typed routine name, so the named routine
    // may carry no matching at all. Leaving every member on the schema default
    // is the defect this whole feature exists to remove, so a random deal
    // governs rather than nothing being written.
    const res = await matchTwo(null);

    expect(res.status).toBe(200);
    expect([...rolesWritten().values()].sort()).toEqual([0, 1]);
  });
});
