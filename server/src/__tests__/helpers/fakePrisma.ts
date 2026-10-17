/**
 * Minimal in-memory stand-in for the Prisma client, covering exactly the
 * queries issued by experimentHandler, matchingHandler, progressHandler and
 * sessionDropout during a matched, rotating session. It is deliberately not a
 * general Prisma emulator: `select` never narrows the returned fields, and only
 * the `where` shapes the handlers actually use are understood.
 */

/**
 * Bumped for every generated row id. It is NOT reset by resetFakeDb: the
 * proceed barrier in progressHandler is a module-level Map keyed by session id
 * that outlives a database reset, so two scenarios in one file must never be
 * handed the same session id.
 */
let idCounter = 0;

const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

export interface FakeExperimentRow {
  id: string;
  routines: unknown;
  randomization: boolean;
  randomizationConfig: unknown;
  conditions: string[];
  participantsPerSession: number;
}

export interface FakeParticipantRow {
  id: string;
  experimentId: string;
  condition: string | null;
  progress: number;
  currentStage: number;
  role: number;
  properties: Record<string, unknown>;
  completion: boolean;
  withdraw: boolean;
  isLoggedIn: boolean;
  lastLogTime: Date | null;
  progressSequence: number[] | null;
}

export interface FakeContentRow {
  id: string;
  experimentId: string;
  progress: number;
  trialNumber: number;
  routine: string;
  content: Record<string, unknown>;
  condition: string;
  description: string | null;
}

export interface FakeSessionRow {
  id: string;
  experimentId: string;
  routineName: string;
  status: string;
  matchProgress: number;
  matchedAt: Date | null;
  sharedProgressSequence: number[] | null;
  blockId: string | null;
}

export interface FakeSessionParticipantRow {
  id: string;
  sessionId: string;
  participantId: string;
  seat: number;
  slotName: string | null;
  status: string;
  droppedAt: Date | null;
}

export interface FakeSessionGroupingRow {
  id: string;
  sessionId: string;
  progress: number;
  trialNumber: number;
  routineName: string;
  groupIndex: number;
  /**
   * Written VERBATIM by the upsert below, never normalised. Prisma accepts both
   * `[1, 2]` and `{ set: [1, 2] }` for a scalar list; a fake that normalised
   * them would make `Array.isArray(seats)` a property of the fake instead of a
   * property of recordSessionGrouping, and a regression to the `{ set: … }`
   * form would go unnoticed. The declared type is the shape the production
   * code is required to write.
   */
  seats: number[];
  participantIds: string[];
  createdAt: Date;
}

export interface FakeDb {
  experiments: FakeExperimentRow[];
  participants: FakeParticipantRow[];
  content: FakeContentRow[];
  sessions: FakeSessionRow[];
  sessionParticipants: FakeSessionParticipantRow[];
  sessionGroupings: FakeSessionGroupingRow[];
}

export const fakeDb: FakeDb = {
  experiments: [],
  participants: [],
  content: [],
  sessions: [],
  sessionParticipants: [],
  sessionGroupings: [],
};

export function resetFakeDb(): void {
  fakeDb.experiments.length = 0;
  fakeDb.participants.length = 0;
  fakeDb.content.length = 0;
  fakeDb.sessions.length = 0;
  fakeDb.sessionParticipants.length = 0;
  fakeDb.sessionGroupings.length = 0;
}

type NumericClause =
  | number
  | { gt?: number; gte?: number; lt?: number; lte?: number }
  | undefined;

const matchesNumber = (value: number, clause: NumericClause): boolean => {
  if (clause === undefined) return true;
  if (typeof clause === "number") return value === clause;
  if (clause.gt !== undefined && value <= clause.gt) return false;
  if (clause.gte !== undefined && value < clause.gte) return false;
  if (clause.lt !== undefined && value >= clause.lt) return false;
  if (clause.lte !== undefined && value > clause.lte) return false;
  return true;
};

interface ContentWhere {
  experimentId?: string;
  condition?: string;
  routine?: string;
  progress?: NumericClause;
  trialNumber?: NumericClause;
}

const contentMatches = (row: FakeContentRow, where: ContentWhere = {}): boolean =>
  (where.experimentId === undefined || row.experimentId === where.experimentId) &&
  (where.condition === undefined || row.condition === where.condition) &&
  (where.routine === undefined || row.routine === where.routine) &&
  matchesNumber(row.progress, where.progress) &&
  matchesNumber(row.trialNumber, where.trialNumber);

interface OrderBy {
  progress?: "asc" | "desc";
  trialNumber?: "asc" | "desc";
}

const sortContent = (rows: FakeContentRow[], orderBy?: OrderBy): FakeContentRow[] => {
  if (!orderBy) return rows;
  const sorted = [...rows];
  if (orderBy.progress) {
    sorted.sort((a, b) =>
      orderBy.progress === "asc" ? a.progress - b.progress : b.progress - a.progress,
    );
  }
  if (orderBy.trialNumber) {
    sorted.sort((a, b) =>
      orderBy.trialNumber === "asc"
        ? a.trialNumber - b.trialNumber
        : b.trialNumber - a.trialNumber,
    );
  }
  return sorted;
};

interface SessionWhere {
  experimentId?: string;
  routineName?: string;
  status?: string;
}

const sessionMatches = (row: FakeSessionRow, where: SessionWhere = {}): boolean =>
  (where.experimentId === undefined || row.experimentId === where.experimentId) &&
  (where.routineName === undefined || row.routineName === where.routineName) &&
  (where.status === undefined || row.status === where.status);

interface SessionParticipantWhere {
  id?: string;
  sessionId?: string;
  participantId?: string;
  status?: string;
  session?: SessionWhere;
}

const sessionParticipantMatches = (
  row: FakeSessionParticipantRow,
  where: SessionParticipantWhere = {},
): boolean => {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.sessionId !== undefined && row.sessionId !== where.sessionId) return false;
  if (where.participantId !== undefined && row.participantId !== where.participantId) {
    return false;
  }
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.session) {
    const session = fakeDb.sessions.find((s) => s.id === row.sessionId);
    if (!session || !sessionMatches(session, where.session)) return false;
  }
  return true;
};

interface NestedInclude {
  where?: SessionParticipantWhere;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
}

interface SessionParticipantInclude {
  session?: boolean | NestedInclude;
  participant?: boolean;
}

/**
 * One seat as findActiveSession sees it. `condition` is carried through from the
 * Participant row in BOTH the nested shape the pinned select produces
 * (`participant: { select: { condition: true } }`) and flat, so the session
 * condition anchor resolves to a real value instead of falling through to the
 * default. Without this the rotation-band query silently reads the wrong
 * condition for any cohort that is not "Basic".
 */
const hydrateSeat = (row: FakeSessionParticipantRow) => {
  const person = fakeDb.participants.find((p) => p.id === row.participantId);
  const condition = person?.condition ?? null;
  return {
    ...row,
    condition,
    participant: { condition },
  };
};

const hydrateSessionParticipant = (
  row: FakeSessionParticipantRow,
  include: SessionParticipantInclude = {},
): Record<string, unknown> => {
  const hydrated: Record<string, unknown> = { ...row };

  if (include.session) {
    const session = fakeDb.sessions.find((s) => s.id === row.sessionId);
    if (!session) {
      throw new Error(`Session not found for session participant ${row.id}`);
    }
    const sessionShape: Record<string, unknown> = { ...session };
    const sessionInclude =
      include.session === true
        ? {}
        : ((include.session.include ?? {}) as Record<string, boolean | NestedInclude>);
    const participantsInclude = sessionInclude.participants;
    if (participantsInclude) {
      // The real findActiveSession never filters this nested list — the whole
      // cohort must come back so seatCount stays at its match-time size.
      const nested = participantsInclude === true ? {} : participantsInclude;
      sessionShape.participants = fakeDb.sessionParticipants
        .filter(
          (sp) => sp.sessionId === session.id && sessionParticipantMatches(sp, nested.where),
        )
        .map(hydrateSeat);
    }
    hydrated.session = sessionShape;
  }

  if (include.participant) {
    const participant = fakeDb.participants.find((p) => p.id === row.participantId);
    if (!participant) {
      throw new Error(`Participant not found for session participant ${row.id}`);
    }
    hydrated.participant = { ...participant };
  }

  return hydrated;
};

export const fakePrisma = {
  experiment: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      fakeDb.experiments.find((e) => e.id === where.id) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = fakeDb.experiments.find((e) => e.id === where.id);
      if (!row) throw new Error(`Experiment not found for update: ${where.id}`);
      Object.assign(row, data);
      return { ...row };
    },
  },

  participant: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      fakeDb.participants.find((p) => p.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { id?: string; experimentId?: string } }) =>
      fakeDb.participants.find(
        (p) =>
          (where.id === undefined || p.id === where.id) &&
          (where.experimentId === undefined || p.experimentId === where.experimentId),
      ) ?? null,
    count: async ({ where }: { where: { experimentId?: string; condition?: string } }) =>
      fakeDb.participants.filter(
        (p) =>
          (where.experimentId === undefined || p.experimentId === where.experimentId) &&
          (where.condition === undefined || p.condition === where.condition),
      ).length,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = fakeDb.participants.find((p) => p.id === where.id);
      if (!row) throw new Error(`Participant not found for update: ${where.id}`);
      // advanceSession writes { progress: { increment: 1 } } for a member whose
      // socket has gone, so the increment form has to be understood.
      const { progress, ...rest } = data as { progress?: unknown };
      const increment = (progress as { increment?: number } | undefined)?.increment;
      if (typeof increment === "number") {
        row.progress += increment;
      } else if (typeof progress === "number") {
        row.progress = progress;
      }
      Object.assign(row, rest);
      return { ...row };
    },
  },

  experimentContent: {
    findFirst: async ({ where, orderBy }: { where: ContentWhere; orderBy?: OrderBy }) => {
      const rows = sortContent(
        fakeDb.content.filter((r) => contentMatches(r, where)),
        orderBy,
      );
      return rows[0] ? { ...rows[0] } : null;
    },
    findMany: async ({ where, orderBy }: { where: ContentWhere; orderBy?: OrderBy }) =>
      sortContent(
        fakeDb.content.filter((r) => contentMatches(r, where)),
        orderBy,
      ).map((r) => ({ ...r })),
  },

  session: {
    create: async ({
      data,
    }: {
      data: {
        experimentId: string;
        routineName: string;
        matchProgress?: number;
        status?: string;
        matchedAt?: Date;
        blockId?: string | null;
        participants?: {
          create: Array<{ participantId: string; seat: number; slotName?: string }>;
        };
      };
    }) => {
      const session: FakeSessionRow = {
        id: nextId("session"),
        experimentId: data.experimentId,
        routineName: data.routineName,
        status: data.status ?? "WAITING",
        matchProgress: data.matchProgress ?? 0,
        matchedAt: data.matchedAt ?? null,
        sharedProgressSequence: null,
        blockId: data.blockId ?? null,
      };
      fakeDb.sessions.push(session);
      for (const member of data.participants?.create ?? []) {
        fakeDb.sessionParticipants.push({
          id: nextId("session-participant"),
          sessionId: session.id,
          participantId: member.participantId,
          seat: member.seat,
          slotName: member.slotName ?? null,
          status: "ACTIVE",
          droppedAt: null,
        });
      }
      return { ...session };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeSessionRow>;
    }) => {
      const row = fakeDb.sessions.find((s) => s.id === where.id);
      if (!row) throw new Error(`Session not found for update: ${where.id}`);
      Object.assign(row, data);
      return { ...row };
    },
    count: async ({ where }: { where: SessionWhere }) =>
      fakeDb.sessions.filter((s) => sessionMatches(s, where)).length,
  },

  sessionParticipant: {
    findFirst: async ({
      where,
      include,
    }: {
      where: SessionParticipantWhere;
      include?: SessionParticipantInclude;
      // findDroppedSeat passes orderBy/select; the fake IGNORES both and returns
      // the whole first matching row in insertion order. That is sound only
      // while no participant can hold two DROPPED seats — a scenario that added
      // one would need real `droppedAt desc` ordering here.
      orderBy?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => {
      const row = fakeDb.sessionParticipants.find((sp) =>
        sessionParticipantMatches(sp, where),
      );
      return row ? hydrateSessionParticipant(row, include) : null;
    },
    findMany: async ({
      where,
      include,
    }: {
      where: SessionParticipantWhere;
      include?: SessionParticipantInclude;
    }) =>
      fakeDb.sessionParticipants
        .filter((sp) => sessionParticipantMatches(sp, where))
        .map((sp) => hydrateSessionParticipant(sp, include)),
    update: async ({
      where,
      data,
    }: {
      where: {
        id?: string;
        sessionId_participantId?: { sessionId: string; participantId: string };
      };
      data: Partial<FakeSessionParticipantRow>;
    }) => {
      const key = where.sessionId_participantId;
      const row = fakeDb.sessionParticipants.find(
        (sp) =>
          (where.id !== undefined && sp.id === where.id) ||
          (key !== undefined &&
            sp.sessionId === key.sessionId &&
            sp.participantId === key.participantId),
      );
      if (!row) {
        throw new Error(`Session participant not found for update: ${JSON.stringify(where)}`);
      }
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: SessionParticipantWhere;
      data: Partial<FakeSessionParticipantRow>;
    }) => {
      const rows = fakeDb.sessionParticipants.filter((sp) =>
        sessionParticipantMatches(sp, where),
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  },

  sessionGrouping: {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        sessionId_progress_groupIndex: {
          sessionId: string;
          progress: number;
          groupIndex: number;
        };
      };
      // `seats` / `participantIds` are typed `unknown` so the fake can store
      // whatever the caller actually wrote — including Prisma's `{ set: [...] }`
      // scalar-list form — rather than silently coercing it to an array.
      create: Omit<FakeSessionGroupingRow, "id" | "createdAt" | "seats" | "participantIds"> & {
        seats: unknown;
        participantIds: unknown;
      };
      update: Record<string, unknown>;
    }) => {
      const key = where.sessionId_progress_groupIndex;
      const existing = fakeDb.sessionGroupings.find(
        (g) =>
          g.sessionId === key.sessionId &&
          g.progress === key.progress &&
          g.groupIndex === key.groupIndex,
      );
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      const row: FakeSessionGroupingRow = {
        ...create,
        seats: create.seats as number[],
        participantIds: create.participantIds as string[],
        id: nextId("session-grouping"),
        createdAt: new Date(),
      };
      fakeDb.sessionGroupings.push(row);
      return { ...row };
    },
    findMany: async ({
      where,
    }: {
      where: { sessionId?: string; progress?: NumericClause };
    }) =>
      fakeDb.sessionGroupings
        .filter(
          (g) =>
            (where.sessionId === undefined || g.sessionId === where.sessionId) &&
            matchesNumber(g.progress, where.progress),
        )
        .map((g) => ({ ...g })),
  },
};
