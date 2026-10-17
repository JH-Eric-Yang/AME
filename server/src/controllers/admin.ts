import { Response } from "express";
import bcrypt from "bcryptjs";
import { stringify as stringifyCsv } from "csv-stringify/sync";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import {
  indexGroupingsByParticipant,
  collectGroupedParticipantIds,
  groupingKey,
} from "../sessionGrouping.js";
import { loadSessionSummaries } from "../sessionSummary.js";
import { experimenterOwnsExperiment } from "../experimentAccess.js";
import { pushAdminSessionUpdate } from "../socket/adminHandler.js";
import { signToken, signDownloadToken, AuthRequest } from "../middleware/auth.js";
import { io } from "../app.js";
import { deliverContent } from "../socket/progressHandler.js";
import { archiveEntryName } from "../uploads/storage.js";
import { attachmentDisposition, csvText, csvValue } from "../exports/download.js";
import { randomUUID } from "crypto";
import { unlinkAssetFile } from "../assets/storage.js";
import { remapAssetRefs, type AssetManifestEntry } from "ame-shared/assetUsage";
import type { SocketState } from "../socket/index.js";
import type { RandomizationConfig, RoutineConfig, MatchingConfig, SessionMember } from "ame-shared";
import { validateRotation } from "ame-shared/interactionGroups";
import { validateRoleAssignment } from "ame-shared/roleAssignment";
import { dealRoles } from "../roleCycle.js";
import { progressBand, validateSessionDesign } from "ame-shared/sessionDesign";
import type {
  BandContentRow,
  SessionDesign,
  SessionDesignIssue,
} from "ame-shared/sessionDesign";
import { findOwningDesign, ownedRoutineNames } from "ame-shared/blockOwnership";
import {
  contentRowShapeIssue,
  validateContentRows,
  GeneratedDescriptionPrefix as BlockDescriptionPrefix,
} from "ame-shared/contentValidation";


const BcryptRounds = 12;

// Every content row a Session Designer block compiles carries
// `description: "block:<designId>:<rowIndex>"`, which is how a rebuild finds
// exactly the rows it wrote last time. The trailing colon in the built prefix
// is what stops block "design-1" matching rows written by "design-10". The
// prefix itself is `ame-shared/contentValidation`'s `GeneratedDescriptionPrefix`
// (aliased here so the `${blockId}:` suffixing below reads unchanged) — one
// hardcoded marker, not two, so a rename only ever touches one place.

// Prisma does not escape `%` or `_` in a `startsWith` filter, so a block id
// carrying either would over-match and delete a neighbouring block's rows —
// the exact failure the prefix's trailing colon exists to prevent. Compiled
// ids are `block-<8 chars>`, so this rejects nothing legitimate.
const BlockIdPattern = /^[A-Za-z0-9-]+$/;

// Returned for a `sessionDesigns` value that is not an array of design
// objects. Distinct from a design that is well-formed but unapplicable: that
// one carries the issue list validateSessionDesign produced.
const InvalidDesignMessage = "sessionDesigns must be an array of session design objects";

// ── Auth ───────────────────────────────────────────────

export async function signup(req: AuthRequest, res: Response): Promise<void> {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "Email, password, and name are required" });
    return;
  }

  const existing = await prisma.experimenter.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ code: "EMAIL_EXISTS", message: "Email already registered" });
    return;
  }

  const hashed = await bcrypt.hash(password, BcryptRounds);
  await prisma.experimenter.create({
    data: { email, password: hashed, name },
  });

  res.status(201).json({
    message: "Account submitted for review. You will be able to log in once an administrator approves your account.",
  });
}

export async function login(req: AuthRequest, res: Response): Promise<void> {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "Email and password are required" });
    return;
  }

  const experimenter = await prisma.experimenter.findUnique({ where: { email } });
  if (!experimenter) {
    res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, experimenter.password);
  if (!valid) {
    res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    return;
  }

  if (experimenter.status === "PENDING") {
    res.status(403).json({ code: "ACCOUNT_PENDING", message: "Account is pending approval" });
    return;
  }

  if (experimenter.status === "REJECTED") {
    res.status(403).json({ code: "ACCOUNT_REJECTED", message: "Account has been rejected" });
    return;
  }

  const token = signToken({ experimenterId: experimenter.id, email, role: experimenter.role });
  res.json({
    token,
    experimenter: { id: experimenter.id, email: experimenter.email, name: experimenter.name, role: experimenter.role },
  });
}

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const experimenter = await prisma.experimenter.findUnique({
    where: { id: req.auth!.experimenterId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!experimenter) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experimenter not found" });
    return;
  }

  res.json(experimenter);
}

// ── Account Management (Admin only) ──────────────────

export async function listAccounts(req: AuthRequest, res: Response): Promise<void> {
  const statusFilter = req.query.status as string | undefined;
  const where = statusFilter ? { status: statusFilter as "PENDING" | "APPROVED" | "REJECTED" } : {};

  const accounts = await prisma.experimenter.findMany({
    where,
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  res.json(accounts);
}

export async function approveAccount(req: AuthRequest, res: Response): Promise<void> {
  const account = await prisma.experimenter.findUnique({ where: { id: req.params.id } });

  if (!account) {
    res.status(404).json({ code: "NOT_FOUND", message: "Account not found" });
    return;
  }

  if (account.status !== "PENDING") {
    res.status(400).json({ code: "INVALID_STATUS", message: "Account is not pending" });
    return;
  }

  const updated = await prisma.experimenter.update({
    where: { id: req.params.id },
    data: { status: "APPROVED" },
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
  });

  res.json(updated);
}

export async function rejectAccount(req: AuthRequest, res: Response): Promise<void> {
  const account = await prisma.experimenter.findUnique({ where: { id: req.params.id } });

  if (!account) {
    res.status(404).json({ code: "NOT_FOUND", message: "Account not found" });
    return;
  }

  if (account.status !== "PENDING") {
    res.status(400).json({ code: "INVALID_STATUS", message: "Account is not pending" });
    return;
  }

  await prisma.experimenter.delete({ where: { id: req.params.id } });
  res.status(204).send();
}

// ── Experiments ────────────────────────────────────────

export async function listExperiments(req: AuthRequest, res: Response): Promise<void> {
  const experiments = await prisma.experiment.findMany({
    where: {
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
    include: {
      _count: { select: { participants: true, results: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json(experiments);
}

export async function getExperiment(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
    include: {
      _count: { select: { participants: true, results: true, contents: true } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  res.json(experiment);
}

export async function createExperiment(req: AuthRequest, res: Response): Promise<void> {
  const {
    name, description, visible, allowNew, img,
    avCollection, bodyDetection, videoChat, supplementaryDevice,
    activeTime, rollBackTime, participantsPerSession, participantIdParam,
    conditions, randomization, randomizationConfig, matchingStrategy,
    initialProperties, conditionProperties, routines, sessionDesigns,
  } = req.body;

  if (!name || !routines) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "Name and routines are required" });
    return;
  }

  // Validate that element names and multi-capture source labels don't contain '__'
  // '__' is a reserved separator used in upload filenames (e.g., elementName__slotLabel_timestamp.webm)
  if (Array.isArray(routines)) {
    for (const routine of routines) {
      if (!Array.isArray(routine.elements)) continue;
      for (const element of routine.elements) {
        if (typeof element.name === "string" && element.name.includes("__")) {
          res.status(400).json({
            code: "INVALID_ELEMENT_NAME",
            message: `Element names cannot contain '__' (reserved separator): "${element.name}"`,
          });
          return;
        }
        if (element.type === "multi-capture" && element.params?.sources) {
          for (const source of element.params.sources) {
            if (typeof source.label === "string" && source.label.includes("__")) {
              res.status(400).json({
                code: "INVALID_SOURCE_LABEL",
                message: `Device source labels cannot contain '__' (reserved separator): "${source.label}"`,
              });
              return;
            }
          }
        }
      }
    }
  }

  if (Array.isArray(routines)) {
    const rotationError = validateRoutineRotations(
      routines as RoutineConfig[],
      sessionDesigns,
    );
    if (rotationError) {
      res.status(400).json({ code: "INVALID_CONFIG", message: rotationError });
      return;
    }

    const roleIssue = roleAssignmentIssue(routines as RoutineConfig[]);
    if (roleIssue) {
      res.status(400).json({ code: "INVALID_CONFIG", message: roleIssue });
      return;
    }
  }

  // A brand-new experiment has no content rows yet, so the band checks have
  // nothing to read but the designs themselves.
  const designError = validateSessionDesigns(
    sessionDesigns,
    (routines ?? []) as RoutineConfig[],
    (conditions ?? []) as string[],
  );
  if (designError) {
    res.status(400).json({
      code: "INVALID_CONFIG",
      message: designError.message,
      issues: designError.issues,
    });
    return;
  }

  const experiment = await prisma.experiment.create({
    data: {
      name,
      description: description ?? "",
      visible: visible ?? false,
      allowNew: allowNew ?? true,
      img: img ?? null,
      avCollection: avCollection ?? false,
      bodyDetection: bodyDetection ?? false,
      videoChat: videoChat ?? false,
      supplementaryDevice: supplementaryDevice ?? "NONE",
      activeTime: activeTime ?? 30,
      rollBackTime: rollBackTime ?? 60,
      participantsPerSession: participantsPerSession ?? 1,
      participantIdParam: participantIdParam || null,
      conditions: conditions ?? [],
      randomization: randomization ?? false,
      randomizationConfig: randomizationConfig ?? null,
      matchingStrategy: matchingStrategy ?? "FIFO",
      initialProperties: initialProperties ?? {},
      conditionProperties: conditionProperties ?? {},
      routines,
      // Conditional spread rather than `?? null`: a nullable Json column takes
      // an omitted key, not a literal null.
      ...(sessionDesigns !== undefined && { sessionDesigns }),
      experimenters: {
        create: { experimenterId: req.auth!.experimenterId },
      },
    },
  });

  res.status(201).json({
    id: experiment.id,
    name: experiment.name,
    visible: experiment.visible,
    createdAt: experiment.createdAt,
  });
}

/** One matching routine's declared cohort: the routine's name and its seat count. */
interface RoutineCohort {
  name: string;
  seatCount: number;
}

/**
 * The cohorts a round-robin routine could actually rotate over.
 *
 * A routine claimed by a session block runs inside the session that block's own
 * matching routine creates, so it is checked against that cohort alone. Two
 * blocks in one experiment — 8 seats in dyads and 9 seats in triads — are each
 * valid, and neither may be failed by the other's cohort.
 *
 * A routine no block claims has no knowable session, so it keeps the original
 * conservative rule and is checked against every cohort the experiment declares.
 *
 * @param routineName the round-robin routine being checked.
 * @param cohorts every (matching routine name, seat count) pair in the experiment.
 * @param designs the experiment's persisted session designs; empty for every
 *   experiment authored before the Session Designer existed.
 * @returns the cohorts to check this routine against; never empty.
 */
function cohortsForRotatingRoutine(
  routineName: string,
  cohorts: RoutineCohort[],
  designs: SessionDesign[],
): RoutineCohort[] {
  const owner = findOwningDesign(routineName, designs);
  if (!owner) return cohorts;

  const owned = ownedRoutineNames(owner);
  const scoped = cohorts.filter((cohort) => owned.includes(cohort.name));
  if (scoped.length > 0) return scoped;

  // The block claims this routine but its own match routine is not in the list
  // being written — a block saved before its routines were applied. Its declared
  // cohort is added rather than substituted: `validateSessionDesign` has already
  // checked that cohort against the DESIGN's group size, and the Builder is free
  // to drift the ROUTINE's group size away from it, so the declared cohort alone
  // would let a drifted routine through to rotate over a real cohort it does not
  // divide. Keeping the cross-product preserves the pre-block guarantee exactly.
  return [
    { name: owner.matchRoutineName, seatCount: owner.cohortSize },
    ...cohorts,
  ];
}

/**
 * A round-robin routine runs inside whatever session its own block's matching
 * routine creates, so its group size must divide that block's cohort size.
 * `computeRoundRobinRotations` degrades to one all-seats group instead of
 * throwing (B8), and the JSON-import route bypasses every client-side check, so
 * this is the only blocking check on the design.
 *
 * @param routines the routine list being written.
 * @param sessionDesigns the raw `sessionDesigns` value the same write carries
 *   (or the stored one). Anything that is not an array is treated as "no blocks
 *   declared", which restores the pre-Session-Designer cross-product rule.
 * @returns null when every rotation is valid, otherwise the first problem found.
 */
function validateRoutineRotations(
  routines: RoutineConfig[],
  sessionDesigns: unknown,
): string | null {
  const cohorts: RoutineCohort[] = routines
    .filter(
      (r): r is RoutineConfig & { matching: MatchingConfig } =>
        r.matching != null,
    )
    .map((r) => ({ name: r.name, seatCount: r.matching.slots.length }));

  // Anything malformed simply owns no routine — `ownedRoutineNames` tolerates a
  // missing name — and `validateSessionDesigns` refuses the write regardless.
  const designs = Array.isArray(sessionDesigns)
    ? (sessionDesigns as SessionDesign[])
    : [];

  for (const routine of routines) {
    const pattern = routine.interactionPattern;
    if (pattern?.type !== "round-robin") continue;

    for (const cohort of cohortsForRotatingRoutine(routine.name, cohorts, designs)) {
      const problem = validateRotation(cohort.seatCount, pattern.groupSize);
      if (problem) {
        return `Routine "${routine.name}" cannot rotate over the cohort matched by "${cohort.name}": ${problem}`;
      }
    }
  }

  return null;
}

/** The first role-assignment problem across these routines, or null. */
function roleAssignmentIssue(routines: RoutineConfig[]): string | null {
  for (const routine of routines) {
    if (!routine.matching) continue;
    const issue = validateRoleAssignment(routine.matching);
    if (issue) return `Routine "${routine.name}": ${issue}`;
  }
  return null;
}

/**
 * Refuse two blocks that claim the same routine.
 *
 * Ownership is resolved by `findOwningDesign`, which returns the FIRST design
 * claiming a name. Two blocks both naming `trialRoutine: "chat"` would therefore
 * have the second block's cohort silently skipped by
 * `cohortsForRotatingRoutine`, letting through a rotation the pre-block
 * cross-product refused — and at run time a single `Session.blockId` cannot name
 * two owners anyway. Cross-design, so it cannot live in `validateSessionDesign`,
 * which sees one design at a time.
 *
 * @param designs the well-formed designs being written, in array order.
 * @returns null when every routine is claimed at most once, otherwise the first
 *   collision as a blocking issue.
 */
function duplicateClaimIssue(
  designs: SessionDesign[],
): { message: string; issues: SessionDesignIssue[] } | null {
  const claimedBy = new Map<string, SessionDesign>();

  for (const design of designs) {
    for (const name of ownedRoutineNames(design)) {
      const first = claimedBy.get(name);
      if (!first) {
        claimedBy.set(name, design);
        continue;
      }

      const message = `Routine "${name}" is claimed by both "${first.label}" and "${design.label}". Give each block its own routines; a routine can belong to only one session block, and the second block's cohort would be ignored.`;
      return {
        message: `Session design "${design.label}" cannot be saved: ${message}`,
        issues: [{ level: "error", message, field: "trialRoutine" }],
      };
    }
  }

  return null;
}

/**
 * Refuse two blocks whose progress bands overlap on a shared condition.
 *
 * `replaceContent` scopes its delete by `blockId`, so two blocks laid over the
 * same progresses BOTH keep their rows, and `deliverContent`'s
 * `findFirst … orderBy trialNumber asc` then serves one of them arbitrarily
 * while the other block's cohort never forms. Nothing else catches this:
 * `duplicateClaimIssue` compares routine NAMES, and `validateSessionDesign`
 * only ever sees one design. The Designer produces it by hand — a second block
 * added before the first has written any content row derives the same
 * `startProgress`, because that is read back from the content rows.
 *
 * Conditions are part of the test because `deliverContent` selects by
 * condition: two arms of a between-subjects design legitimately occupy the
 * same progresses under different condition names.
 *
 * @param designs the well-formed designs being written, in array order.
 * @returns null when no two bands collide, otherwise the first collision.
 */
function bandOverlapIssue(
  designs: SessionDesign[],
): { message: string; issues: SessionDesignIssue[] } | null {
  const bands = designs.map((design) => ({
    design,
    ...progressBand(design),
    conditions: new Set(design.conditions),
  }));

  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const first = bands[i];
      const second = bands[j];
      if (first.fromProgress > second.toProgress || second.fromProgress > first.toProgress) {
        continue;
      }

      const shared = [...second.conditions].filter((condition) =>
        first.conditions.has(condition),
      );
      if (shared.length === 0) continue;

      const from = Math.max(first.fromProgress, second.fromProgress);
      const to = Math.min(first.toProgress, second.toProgress);
      const message = `Blocks "${first.design.label}" and "${second.design.label}" both occupy progress ${from}-${to} under condition ${shared.join(", ")}. Move one block's starting progress past the other's last one; two blocks stacked on the same progresses both keep their rows, and only one of them is ever delivered, so the other block's cohort silently never forms.`;
      return {
        message: `Session design "${second.design.label}" cannot be saved: ${message}`,
        issues: [{ level: "error", message, field: "pattern" }],
      };
    }
  }

  return null;
}

/** Design fields the validator reads as text, so each must BE text. */
const RequiredDesignStrings = [
  "id",
  "label",
  "trialRoutine",
  "matchRoutineName",
  "endMatchRoutineName",
  "partnerUnavailableText",
] as const;

/** Design fields the validator does arithmetic on, so each must be a real number. */
const RequiredDesignNumbers = [
  "cohortSize",
  "trials",
  "startProgress",
  "timeoutSeconds",
] as const;

/**
 * Whether a pattern carries the members `stepsForDesign` and the validator
 * iterate for its own type. An unrecognised type is refused rather than
 * ignored: it would reach the runtime's rotation switch and fall through to
 * "everybody alone".
 */
function isWellFormedPattern(pattern: unknown): boolean {
  if (!pattern || typeof pattern !== "object") return false;
  const { type, steps, groups, groupSize } = pattern as Record<string, unknown>;

  switch (type) {
    case "round-robin":
      return Number.isFinite(groupSize);
    case "sequence":
      return (
        Array.isArray(steps) &&
        steps.every(
          (trial) => Array.isArray(trial) && trial.every((group) => Array.isArray(group)),
        )
      );
    case "fixed":
      return Array.isArray(groups);
    case "all":
      return true;
    default:
      return false;
  }
}

/**
 * Whether a design carries every field `validateSessionDesign` dereferences.
 *
 * This has to be at least as strict as the validator is trusting, field for
 * field. The validator calls `design.partnerUnavailableText.trim()`, iterates
 * `design.conditions` and `design.pattern.steps`, and compares `design.trials`
 * — none of them guarded, because the authoring client cannot produce a design
 * without them. A hand-edited import can, and an exception thrown here lands in
 * an async Express handler: Express 4 does not catch async rejections and this
 * server registers no error middleware, so the request is never answered and
 * the unhandled rejection takes the process down, dropping every live
 * participant's websocket mid-experiment.
 */
function isWellFormedDesign(design: unknown): design is SessionDesign {
  if (!design || typeof design !== "object") return false;
  const record = design as Record<string, unknown>;

  if (RequiredDesignStrings.some((field) => typeof record[field] !== "string")) return false;
  if (RequiredDesignNumbers.some((field) => !Number.isFinite(record[field]))) return false;

  // The id is the `block:<id>:` prefix `replaceContent` deletes by, so a blank
  // one is not merely untidy: two id-less designs would share a single prefix
  // and re-applying either would wipe the other's rows.
  if ((record.id as string).trim().length === 0) return false;

  // `compileSessionDesign` indexes this per trial. Absent, it throws there
  // rather than here, and blanks the Session tab instead of answering 400.
  if (!record.trialContent || typeof record.trialContent !== "object") return false;

  // Null is the "no between-trials routine" value; anything else is a name.
  if (record.interTrialRoutine != null && typeof record.interTrialRoutine !== "string") {
    return false;
  }
  if (!Array.isArray(record.conditions)) return false;
  if (!Array.isArray(record.seats)) return false;
  if (record.seats.some((seat) => !seat || typeof seat !== "object")) return false;

  return isWellFormedPattern(record.pattern);
}

/**
 * Session designs reach the database from three routes, and the JSON-import
 * route bypasses every client-side check, so the same validation the Session
 * Designer runs while authoring has to run again on save. Mirrors
 * `validateRoutineRotations`: null means "write it", anything else is a 400.
 *
 * A non-array value must be refused for the same reason it cannot be
 * validated: it would otherwise be spread straight into the create.
 *
 * @param sessionDesigns the raw `sessionDesigns` value off the request body.
 * @param routines the routines the designs are checked against — the ones in
 *   this request when it carries any, otherwise the ones already stored.
 * @param conditions likewise for the experiment's condition list.
 * @param bandContent the experiment's authored content rows, so a rotating
 *   routine hand-placed inside a block's progress band is caught here too and
 *   not only in the client.
 * @returns null when every design is clean, otherwise the first offending
 *   design's message and its blocking issues.
 */
function validateSessionDesigns(
  sessionDesigns: unknown,
  routines: RoutineConfig[],
  conditions: string[],
  bandContent: BandContentRow[] = [],
): { message: string; issues: SessionDesignIssue[] } | null {
  // An absent field means "leave it alone"; anything else present must be a
  // well-formed array of designs before it reaches the validator.
  if (sessionDesigns === undefined || sessionDesigns === null) return null;

  if (!Array.isArray(sessionDesigns)) {
    return { message: InvalidDesignMessage, issues: [] };
  }

  for (const design of sessionDesigns) {
    if (!isWellFormedDesign(design)) {
      return { message: InvalidDesignMessage, issues: [] };
    }

    const blocking = validateSessionDesign(design, routines, conditions, bandContent).filter(
      (issue) => issue.level === "error",
    );

    if (blocking.length > 0) {
      const summary = blocking.map((issue) => issue.message).join("; ");
      return {
        message: `Session design "${design.label}" cannot be saved: ${summary}`,
        issues: blocking,
      };
    }
  }

  const designs = sessionDesigns as SessionDesign[];
  return duplicateClaimIssue(designs) ?? bandOverlapIssue(designs);
}

/**
 * The `{ progress, routine }` pairs the band checks read.
 *
 * Loaded only when designs are actually being written, so the ordinary
 * experiment update pays nothing for it.
 */
async function loadBandContent(
  experimentId: string,
  sessionDesigns: unknown,
): Promise<BandContentRow[]> {
  if (!Array.isArray(sessionDesigns) || sessionDesigns.length === 0) return [];
  return prisma.experimentContent.findMany({
    where: { experimentId },
    select: { progress: true, routine: true },
  });
}

export async function updateExperiment(req: AuthRequest, res: Response): Promise<void> {
  const existing = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const {
    name, description, visible, allowNew, img,
    avCollection, bodyDetection, videoChat, supplementaryDevice,
    activeTime, rollBackTime, participantsPerSession, participantIdParam,
    conditions, randomization, randomizationConfig, matchingStrategy,
    initialProperties, conditionProperties, routines, sessionDesigns,
  } = req.body;

  // Validate randomizationConfig if provided
  if (randomizationConfig !== undefined && randomizationConfig !== null) {
    for (const [condition, ranges] of Object.entries(randomizationConfig)) {
      if (!Array.isArray(ranges)) {
        res.status(400).json({
          code: "INVALID_CONFIG",
          message: `Randomization ranges for condition "${condition}" must be an array`,
        });
        return;
      }
      for (const range of ranges as { fromTrial: number; toTrial: number; method: string; blockSize?: number }[]) {
        if (range.fromTrial > range.toTrial) {
          res.status(400).json({
            code: "INVALID_CONFIG",
            message: `Range fromTrial (${range.fromTrial}) must be ≤ toTrial (${range.toTrial})`,
          });
          return;
        }
        if (range.method === "block" && (!range.blockSize || range.blockSize <= 0)) {
          res.status(400).json({
            code: "INVALID_CONFIG",
            message: "Block randomization requires a positive blockSize",
          });
          return;
        }
      }
      // Check for overlapping ranges
      const sorted = [...(ranges as { fromTrial: number; toTrial: number }[])].sort(
        (a, b) => a.fromTrial - b.fromTrial,
      );
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].fromTrial <= sorted[i - 1].toTrial) {
          res.status(400).json({
            code: "INVALID_CONFIG",
            message: `Overlapping ranges detected in condition "${condition}": [${sorted[i - 1].fromTrial}-${sorted[i - 1].toTrial}] and [${sorted[i].fromTrial}-${sorted[i].toTrial}]`,
          });
          return;
        }
      }
    }
  }

  // Validate rotation designs if routines are provided. A partial update may
  // send routines without designs, so ownership falls back to what is stored —
  // but ONLY when the field is absent. An explicit `sessionDesigns: null` is a
  // request to clear the column (see the spread below), and scoping validation
  // by blocks this same write deletes would validate against designs that will
  // not exist a moment later.
  if (Array.isArray(routines)) {
    const rotationError = validateRoutineRotations(
      routines as RoutineConfig[],
      sessionDesigns === undefined ? existing.sessionDesigns : sessionDesigns,
    );
    if (rotationError) {
      res.status(400).json({ code: "INVALID_CONFIG", message: rotationError });
      return;
    }

    const roleIssue = roleAssignmentIssue(routines as RoutineConfig[]);
    if (roleIssue) {
      res.status(400).json({ code: "INVALID_CONFIG", message: roleIssue });
      return;
    }
  }

  // A partial update may send designs without routines (or the reverse), so
  // each side falls back to what is already stored.
  const designError = validateSessionDesigns(
    sessionDesigns,
    (Array.isArray(routines) ? routines : existing.routines) as RoutineConfig[],
    (Array.isArray(conditions) ? conditions : existing.conditions) as string[],
    await loadBandContent(req.params.id, sessionDesigns),
  );
  if (designError) {
    res.status(400).json({
      code: "INVALID_CONFIG",
      message: designError.message,
      issues: designError.issues,
    });
    return;
  }

  const experiment = await prisma.experiment.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(visible !== undefined && { visible }),
      ...(allowNew !== undefined && { allowNew }),
      ...(img !== undefined && { img }),
      ...(avCollection !== undefined && { avCollection }),
      ...(bodyDetection !== undefined && { bodyDetection }),
      ...(videoChat !== undefined && { videoChat }),
      ...(supplementaryDevice !== undefined && { supplementaryDevice }),
      ...(activeTime !== undefined && { activeTime }),
      ...(rollBackTime !== undefined && { rollBackTime }),
      ...(participantsPerSession !== undefined && { participantsPerSession }),
      ...(participantIdParam !== undefined && { participantIdParam: participantIdParam || null }),
      ...(conditions !== undefined && { conditions }),
      ...(randomization !== undefined && { randomization }),
      ...(randomizationConfig !== undefined && { randomizationConfig }),
      ...(matchingStrategy !== undefined && { matchingStrategy }),
      ...(initialProperties !== undefined && { initialProperties }),
      ...(conditionProperties !== undefined && { conditionProperties }),
      ...(routines !== undefined && { routines }),
      ...(sessionDesigns !== undefined && { sessionDesigns }),
    },
  });

  res.json(experiment);
}

export async function deleteExperiment(req: AuthRequest, res: Response): Promise<void> {
  const existing = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  // Prisma's cascade drops the Asset rows, but rows are not files — and each
  // finished upload is two files, the payload plus tus's `.json` sidecar.
  const assetFiles = await prisma.asset.findMany({
    where: { experimentId: req.params.id },
    select: { filePath: true },
  });
  await Promise.all(
    assetFiles
      .filter((asset) => asset.filePath)
      .map((asset) => unlinkAssetFile(asset.filePath!)),
  );

  await prisma.experiment.delete({ where: { id: req.params.id } });
  res.status(204).send();
}

export async function toggleVisibility(req: AuthRequest, res: Response): Promise<void> {
  const existing = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const experiment = await prisma.experiment.update({
    where: { id: req.params.id },
    data: { visible: !existing.visible },
  });

  res.json({ id: experiment.id, visible: experiment.visible });
}

// ── Participants ───────────────────────────────────────

export async function listParticipants(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const participants = await prisma.participant.findMany({
    where: { experimentId: req.params.id },
    orderBy: { createdAt: "desc" },
  });

  res.json(participants);
}

export async function getParticipant(req: AuthRequest, res: Response): Promise<void> {
  const participant = await prisma.participant.findUnique({
    where: { id: req.params.id },
    include: {
      experiment: {
        include: {
          experimenters: { where: { experimenterId: req.auth!.experimenterId } },
        },
      },
    },
  });

  if (!participant || participant.experiment.experimenters.length === 0) {
    res.status(404).json({ code: "NOT_FOUND", message: "Participant not found" });
    return;
  }

  const { experiment: _, ...participantData } = participant;
  res.json(participantData);
}

export async function deleteParticipant(req: AuthRequest, res: Response): Promise<void> {
  const participant = await prisma.participant.findUnique({
    where: { id: req.params.id },
    include: {
      experiment: {
        include: {
          experimenters: { where: { experimenterId: req.auth!.experimenterId } },
        },
      },
    },
  });

  if (!participant || participant.experiment.experimenters.length === 0) {
    res.status(404).json({ code: "NOT_FOUND", message: "Participant not found" });
    return;
  }

  await prisma.participant.delete({ where: { id: req.params.id } });
  res.status(204).send();
}

export async function updateParticipantProgress(req: AuthRequest, res: Response): Promise<void> {
  const { progress } = req.body;

  if (typeof progress !== "number" || progress < 0) {
    res.status(400).json({ code: "INVALID_PROGRESS", message: "Progress must be a non-negative integer" });
    return;
  }

  const participant = await prisma.participant.findUnique({
    where: { id: req.params.id },
    include: {
      experiment: {
        include: {
          experimenters: { where: { experimenterId: req.auth!.experimenterId } },
        },
      },
    },
  });

  if (!participant || participant.experiment.experimenters.length === 0) {
    res.status(404).json({ code: "NOT_FOUND", message: "Participant not found" });
    return;
  }

  // Validate that content exists for the target progress
  const condition = participant.condition ?? "Basic";
  const contentExists = await prisma.experimentContent.findFirst({
    where: {
      experimentId: participant.experimentId,
      progress,
      condition,
    },
  });

  if (!contentExists) {
    res.status(400).json({
      code: "INVALID_PROGRESS",
      message: `No content found for progress ${progress} and condition "${condition}"`,
    });
    return;
  }

  const updated = await prisma.participant.update({
    where: { id: req.params.id },
    data: { progress, currentStage: 0, lastLogTime: new Date() },
  });

  // Push live update if participant is connected
  const ns = io.of("/experimentSocket");
  for (const [, socket] of ns.sockets) {
    const state = socket.data as SocketState;
    if (state.participantId === req.params.id) {
      state.progress = progress;
      await deliverContent(ns, socket, state);
      break;
    }
  }

  res.json({ id: updated.id, progress: updated.progress });
}

export async function manualMatch(req: AuthRequest, res: Response): Promise<void> {
  const { routineName, assignments } = req.body;

  // Support both new format (assignments) and legacy format (participantIds)
  let resolvedAssignments: Array<{ participantId: string; slotName?: string; seat?: number }>;

  if (Array.isArray(assignments)) {
    resolvedAssignments = assignments;
  } else if (Array.isArray(req.body.participantIds)) {
    // Legacy: convert participantIds to assignments
    resolvedAssignments = req.body.participantIds.map((pid: string, i: number) => ({
      participantId: pid,
      seat: i,
    }));
  } else {
    res.status(400).json({ code: "MISSING_FIELDS", message: "routineName and assignments (or participantIds) are required" });
    return;
  }

  if (!routineName || resolvedAssignments.length < 1) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "routineName and at least one assignment are required" });
    return;
  }

  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const participantIds = resolvedAssignments.map((a) => a.participantId);
  const participants = await prisma.participant.findMany({
    where: { id: { in: participantIds }, experimentId: req.params.id },
  });

  if (participants.length !== participantIds.length) {
    res.status(400).json({ code: "INVALID_PARTICIPANTS", message: "Some participants not found in this experiment" });
    return;
  }

  const manualDesigns = Array.isArray(experiment.sessionDesigns)
    ? (experiment.sessionDesigns as unknown as SessionDesign[])
    : [];

  // A manually formed cohort needs its roles dealt exactly as an automatically
  // matched one does — `matchingHandler.createAndNotifySession` is the only
  // other place `participant.role` is written, and without the same write here
  // every manually matched participant stays on the schema default of 0 and
  // resolves to the first name in `routine.roles`.
  //
  // The routine's own matching config governs, so a routine authored as
  // counterbalanced counterbalances however its cohorts happen to be formed.
  // A routine that declares no matching at all falls back to a random deal.
  const manualRoutines = Array.isArray(experiment.routines)
    ? (experiment.routines as unknown as RoutineConfig[])
    : [];
  const manualMatching = manualRoutines.find((r) => r.name === routineName)?.matching ?? null;

  // Under property matching the slot filters decide who belongs where, so the
  // role IS the slot index — the same rule createAndNotifySession applies.
  // Otherwise the list order is the arrival order the permutation is dealt over.
  const roles =
    manualMatching?.strategy === "property"
      ? resolvedAssignments.map((_, i) => i)
      : await dealRoles(
          req.params.id,
          resolvedAssignments.length,
          manualMatching?.assignment ?? { mode: "random" },
        );

  const session = await prisma.session.create({
    data: {
      experimentId: req.params.id,
      routineName,
      // Same provenance as an automatically matched session, so the run-time
      // panel names the block whichever way the cohort was formed.
      blockId: findOwningDesign(routineName, manualDesigns)?.id ?? null,
      status: "ACTIVE",
      matchedAt: new Date(),
      participants: {
        create: resolvedAssignments.map((a, i) => ({
          participantId: a.participantId,
          seat: a.seat ?? i,
          slotName: a.slotName ?? `seat-${a.seat ?? i}`,
        })),
      },
    },
    include: { participants: true },
  });

  await Promise.all(
    resolvedAssignments.map((a, i) =>
      prisma.participant.update({
        where: { id: a.participantId },
        data: { role: roles[i] },
      }),
    ),
  );

  // The cohort as every member sees it, seated exactly as the emit below seats
  // each one. participantIds is resolvedAssignments mapped, so the indexes align.
  const members: SessionMember[] = participantIds
    .map((participantId, idx) => ({
      participantId,
      seat: resolvedAssignments[idx]?.seat ?? idx,
      slotName: resolvedAssignments[idx]?.slotName ?? `seat-${idx}`,
    }))
    .sort((a, b) => a.seat - b.seat);

  // Notify connected participants
  const ns = io.of("/experimentSocket");
  for (const [, sock] of ns.sockets) {
    const sockState = sock.data as SocketState;
    if (participantIds.includes(sockState.participantId ?? "")) {
      const assignmentIdx = resolvedAssignments.findIndex(
        (a) => a.participantId === sockState.participantId,
      );
      const peerIds = participantIds.filter((pid) => pid !== sockState.participantId);
      sock.emit("match:matched", {
        sessionId: session.id,
        peers: peerIds,
        seat: resolvedAssignments[assignmentIdx]?.seat ?? assignmentIdx,
        slotName: resolvedAssignments[assignmentIdx]?.slotName ?? `seat-${assignmentIdx}`,
        members,
      });
      await sock.join(`session:${session.id}`);
    }
  }

  // A manually assigned cohort is a live session like any other, so the
  // dashboard that just assigned it must see the card appear.
  await pushAdminSessionUpdate(session.experimentId, session.id);

  res.json({
    sessionId: session.id,
    participants: participantIds,
    routineName,
  });
}

/**
 * Every session of one experiment, newest first, with its seats and the
 * grouping rows for the progress it is currently on.
 *
 * This is the dashboard's first paint: the socket snapshot arrives only after
 * the handshake, and a researcher opening the Matching tab on a cohort that is
 * already running should not stare at an empty panel while that completes.
 */
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const owned = await experimenterOwnsExperiment(
    req.auth!.experimenterId,
    req.params.id,
  );

  if (!owned) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  // Closed sessions are included here: this is the researcher's history view,
  // where a finished cohort is exactly what they came to look at.
  res.json(await loadSessionSummaries(req.params.id));
}

// ── Content ────────────────────────────────────────────

export async function listContent(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const contents = await prisma.experimentContent.findMany({
    where: { experimentId: req.params.id },
    orderBy: [{ progress: "asc" }, { trialNumber: "asc" }],
  });

  res.json(contents);
}

/** One content row as it arrives on an upload or replace request body. */
interface ContentRowInput {
  progress: number;
  trialNumber?: number;
  routine: string;
  content: Record<string, unknown>;
  condition?: string;
  description?: string;
}

/**
 * Request rows → `experimentContent.createMany` data.
 *
 * Shared by `uploadContent` (append) and `replaceContent` (rewrite a band) so
 * the two paths cannot drift on the defaults a row falls back to; a row that
 * appends differently from the way it is rebuilt would make a block's rebuild
 * silently change its own content.
 */
function toContentCreateData(experimentId: string, rows: ContentRowInput[]) {
  return rows.map((row) => ({
    experimentId,
    progress: row.progress,
    trialNumber: row.trialNumber ?? 1,
    routine: row.routine,
    content: (row.content ?? {}) as unknown as Prisma.InputJsonValue,
    condition: row.condition ?? "Basic",
    description: row.description ?? null,
  }));
}

export async function uploadContent(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "rows array is required" });
    return;
  }

  const shapeIssue = contentRowShapeIssue(rows);
  if (shapeIssue) {
    res.status(400).json({ code: "INVALID_CONTENT", message: shapeIssue });
    return;
  }

  const created = await prisma.experimentContent.createMany({
    data: toContentCreateData(req.params.id, rows as ContentRowInput[]),
  });

  res.status(201).json({ count: created.count });
}

/**
 * Rewrites one band of content in place. Unlike `clearContent`, which deletes
 * every row on the experiment and returns 204, this deletes only what the
 * caller declares it owns — either the rows a compiled block stamped with its
 * own id, or the rows inside a progress band for the named conditions — and
 * writes the replacement in the same transaction, so a failure leaves the
 * previous rows intact.
 */
export async function replaceContent(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const { rows, replaceRange } = req.body;

  // An empty rows array would delete the band and write nothing back, which is
  // a wipe wearing a rewrite's clothes. Deleting a block is a separate action.
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "rows array is required" });
    return;
  }

  // Before the transaction, not inside it: a row Prisma refuses would reject
  // the `$transaction` promise in an async handler this server has no error
  // middleware behind, killing the process rather than answering the request.
  const shapeIssue = contentRowShapeIssue(rows);
  if (shapeIssue) {
    res.status(400).json({ code: "INVALID_CONTENT", message: shapeIssue });
    return;
  }

  if (
    !replaceRange ||
    typeof replaceRange.fromProgress !== "number" ||
    typeof replaceRange.toProgress !== "number"
  ) {
    res.status(400).json({
      code: "MISSING_FIELDS",
      message: "replaceRange with numeric fromProgress and toProgress is required",
    });
    return;
  }

  if (replaceRange.fromProgress > replaceRange.toProgress) {
    res.status(400).json({
      code: "INVALID_CONFIG",
      message: `replaceRange fromProgress (${replaceRange.fromProgress}) must be ≤ toProgress (${replaceRange.toProgress})`,
    });
    return;
  }

  const conditions: string[] = Array.isArray(replaceRange.conditions)
    ? replaceRange.conditions
    : [];

  // Without a blockId the delete is scoped by progress and condition alone, so
  // an omitted condition list would drop the condition filter and wipe every
  // condition across the band while writing back only one. Refuse instead.
  if (!replaceRange.blockId && conditions.length === 0) {
    res.status(400).json({
      code: "MISSING_FIELDS",
      message:
        "replaceRange.conditions must name at least one condition when blockId is absent, otherwise the replace would delete every condition in the progress band",
    });
    return;
  }

  // The block id becomes a `startsWith` pattern below, and Prisma passes `%`
  // and `_` through unescaped, so an id carrying either would widen the delete
  // past its own rows.
  const hasBlockId = replaceRange.blockId !== undefined && replaceRange.blockId !== null;
  if (hasBlockId && !BlockIdPattern.test(String(replaceRange.blockId))) {
    res.status(400).json({
      code: "INVALID_CONFIG",
      message: `replaceRange.blockId "${replaceRange.blockId}" must contain only letters, digits and hyphens`,
    });
    return;
  }

  // A compiled block stamps every row it owns with `block:<designId>:<k>`, so a
  // rebuild can replace exactly its own rows and leave hand-authored rows that
  // share the same progress range untouched.
  const where: Prisma.ExperimentContentWhereInput = replaceRange.blockId
    ? {
        experimentId: req.params.id,
        description: { startsWith: `${BlockDescriptionPrefix}${replaceRange.blockId}:` },
      }
    : {
        experimentId: req.params.id,
        progress: { gte: replaceRange.fromProgress, lte: replaceRange.toProgress },
        condition: { in: conditions },
      };

  const [deleted, created] = await prisma.$transaction([
    prisma.experimentContent.deleteMany({ where }),
    prisma.experimentContent.createMany({
      data: toContentCreateData(req.params.id, rows as ContentRowInput[]),
    }),
  ]);

  res.json({ deleted: deleted.count, created: created.count });
}

export async function clearContent(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  await prisma.experimentContent.deleteMany({
    where: { experimentId: req.params.id },
  });

  res.status(204).send();
}

/** Errors listed in the 400 message before the rest are left to the `errors` array. */
const MaxErrorsInMessage = 5;

/**
 * Replace the whole content table in one transaction. This is the Progress
 * tab's save: it owns every row, so unlike `replaceContent` there is no band
 * to declare, and an empty `rows` is a legitimate "no steps yet" (the tab
 * confirms before sending it). Reference rules (spec §4) are enforced here
 * and only here — compiled Session Design rows carry no refs, and the CSV
 * importer feeds this same path through the tab.
 */
export async function saveContent(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });
  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const { rows } = req.body;
  if (!Array.isArray(rows)) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "rows array is required" });
    return;
  }

  const shapeIssue = contentRowShapeIssue(rows);
  if (shapeIssue) {
    res.status(400).json({ code: "INVALID_CONTENT", message: shapeIssue });
    return;
  }

  const inputRows = rows as ContentRowInput[];
  const validation = validateContentRows(
    inputRows.map((row) => ({
      progress: row.progress,
      trialNumber: row.trialNumber ?? 1,
      routine: row.routine,
      condition: row.condition ?? "Basic",
      content: row.content ?? {},
      description: row.description ?? null,
    })),
    (experiment.routines as unknown as RoutineConfig[]) ?? [],
    experiment.conditions ?? [],
    // The switch and the config are stored independently and the runtime reads
    // the config only when the switch is on, so a stale range left behind by a
    // disabled randomization must not make a safe p<N> ref unsafe.
    experiment.randomization ? (experiment.randomizationConfig as RandomizationConfig | null) : null,
  );
  const errors = validation.rowErrors.flatMap((messages, index) =>
    messages.map((message) => `p${inputRows[index].progress} (${inputRows[index].condition ?? "Basic"}): ${message}`),
  );
  if (errors.length > 0) {
    res.status(400).json({
      code: "INVALID_CONTENT",
      message: errors.slice(0, MaxErrorsInMessage).join("; "),
      errors,
    });
    return;
  }

  const [, created] = await prisma.$transaction([
    prisma.experimentContent.deleteMany({ where: { experimentId: req.params.id } }),
    prisma.experimentContent.createMany({ data: toContentCreateData(req.params.id, inputRows) }),
  ]);

  res.json({ count: created.count });
}

// ── Results ────────────────────────────────────────────

export async function listResults(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const results = await prisma.experimentResult.findMany({
    where: { experimentId: req.params.id },
    orderBy: [{ createdAt: "asc" }],
  });

  res.json(results);
}

/** A short-lived token that lets the browser download this experiment's exports. */
export async function createDownloadToken(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
    select: { id: true },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  res.json({ token: signDownloadToken(req.auth!.experimenterId, experiment.id) });
}

export async function exportCsv(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const results = await prisma.experimentResult.findMany({
    where: { experimentId: req.params.id },
    orderBy: [{ responseId: "asc" }, { progress: "asc" }, { trial: "asc" }],
    include: { participant: { select: { externalId: true } } },
  });

  const groupings = await prisma.sessionGrouping.findMany({
    where: { session: { experimentId: req.params.id } },
    select: {
      sessionId: true,
      progress: true,
      groupIndex: true,
      seats: true,
      participantIds: true,
    },
  });
  // The CSV identifies rows by responseId, so the partners column must speak
  // that language too — Participant.id and Participant.responseId are
  // independent uuids, and an internal id in the export joins to nothing.
  const groupedParticipantIds = collectGroupedParticipantIds(groupings);
  const groupedParticipants = groupedParticipantIds.length
    ? await prisma.participant.findMany({
        where: { id: { in: groupedParticipantIds } },
        select: { id: true, responseId: true },
      })
    : [];
  const responseIdByParticipantId = new Map(
    groupedParticipants.map((p) => [p.id, p.responseId]),
  );
  const groupingIndex = indexGroupingsByParticipant(groupings, responseIdByParticipantId);

  // Build CSV header from response keys
  const responseKeys = new Set<string>();
  for (const result of results) {
    const response = result.response as Record<string, unknown>;
    for (const key of Object.keys(response)) {
      responseKeys.add(key);
    }
  }

  // externalId carries the recruitment-platform id (e.g. PROLIFIC_PID) when
  // the experiment captures one, so analyses can join against that platform.
  // sessionId/seat/groupIndex/partners answer "who was P4 with at progress 5?"
  const headers = [
    "responseId",
    "externalId",
    "progress",
    "trial",
    "routine",
    "sessionId",
    "seat",
    "groupIndex",
    "partners",
    ...responseKeys,
    "createdAt",
  ];
  const rows = results.map((r) => {
    const response = r.response as Record<string, unknown>;
    const grouping = groupingIndex.get(groupingKey(r.participantId, r.progress));
    return [
      r.responseId,
      csvText(r.participant?.externalId ?? ""),
      r.progress,
      r.trial,
      r.routine,
      grouping?.sessionId ?? "",
      grouping?.seat ?? "",
      grouping?.groupIndex ?? "",
      grouping?.partners ?? "",
      ...[...responseKeys].map((k) => csvValue(response[k])),
      r.createdAt.toISOString(),
    ];
  });

  // A value can hold commas, quotes or line breaks; csv-stringify quotes it.
  const csv = stringifyCsv([headers, ...rows]);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", attachmentDisposition(`${experiment.name}-results.csv`));
  res.send(csv);
}

export async function exportFiles(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const completed = await prisma.upload.findMany({
    where: { experimentId: req.params.id, status: "COMPLETE" },
    include: { participant: { select: { responseId: true } } },
  });

  // A row with no recorded path has nothing to add to the archive, so it must
  // not count towards "there are files" either — otherwise the researcher gets
  // an empty ZIP and a 200 instead of being told the export found nothing.
  const uploads = completed.filter((upload) => upload.filePath);

  if (uploads.length === 0) {
    res.status(404).json({ code: "NO_FILES", message: "No completed uploads found" });
    return;
  }

  // Dynamic import for archiver (ESM)
  const archiver = (await import("archiver")).default;
  const archive = archiver("zip", { zlib: { level: 5 } });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachmentDisposition(`${experiment.name}-files.zip`));

  archive.pipe(res);

  for (const upload of uploads) {
    archive.file(upload.filePath!, {
      name: archiveEntryName({ responseId: upload.participant.responseId, fileName: upload.fileName }),
    });
  }

  await archive.finalize();
}

// ── JSON Export / Import ──────────────────────────────────

export async function exportJson(req: AuthRequest, res: Response): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: req.params.id,
      experimenters: { some: { experimenterId: req.auth!.experimenterId } },
    },
  });

  if (!experiment) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const contents = await prisma.experimentContent.findMany({
    where: { experimentId: experiment.id },
    orderBy: [{ progress: "asc" }, { trialNumber: "asc" }],
    select: {
      progress: true,
      trialNumber: true,
      routine: true,
      content: true,
      condition: true,
      description: true,
    },
  });

  const assetRows = await prisma.asset.findMany({
    where: { experimentId: experiment.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, mimeType: true, size: true },
  });

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    experiment: {
      name: experiment.name,
      description: experiment.description,
      visible: experiment.visible,
      allowNew: experiment.allowNew,
      img: experiment.img,
      avCollection: experiment.avCollection,
      bodyDetection: experiment.bodyDetection,
      videoChat: experiment.videoChat,
      supplementaryDevice: experiment.supplementaryDevice,
      activeTime: experiment.activeTime,
      rollBackTime: experiment.rollBackTime,
      participantsPerSession: experiment.participantsPerSession,
      participantIdParam: experiment.participantIdParam,
      conditions: experiment.conditions,
      randomization: experiment.randomization,
      randomizationConfig: experiment.randomizationConfig,
      matchingStrategy: experiment.matchingStrategy,
      initialProperties: experiment.initialProperties,
      conditionProperties: experiment.conditionProperties,
      routines: experiment.routines,
      sessionDesigns: experiment.sessionDesigns,
    },
    contents,
    assets: assetRows.map(
      (row): AssetManifestEntry => ({
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        // Number, not BigInt: JSON.stringify throws on a BigInt.
        size: Number(row.size),
      }),
    ),
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", attachmentDisposition(`${experiment.name}.json`));
  res.json(payload);
}

/**
 * A manifest entry only if `id`/`fileName` are non-empty strings, `mimeType`
 * is a string, and `size` is a non-negative integer.
 *
 * Import is the one path with no client-side designer in front of it, so a
 * hand-edited file with a malformed entry is the expected failure mode, not
 * an exotic one. `size` reaches here straight off `req.body`, so it must be
 * checked before it is ever handed to `BigInt(...)` — `BigInt("abc")` and
 * `BigInt(1.5)` both throw synchronously, and with no error-handling
 * middleware in front of this async handler that throw would hang the
 * request instead of answering it.
 */
function isValidAssetManifestEntry(entry: unknown): entry is AssetManifestEntry {
  const candidate = entry as Partial<AssetManifestEntry> | null;
  return (
    !!candidate &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.fileName === "string" &&
    candidate.fileName.length > 0 &&
    typeof candidate.mimeType === "string" &&
    Number.isInteger(candidate.size) &&
    (candidate.size as number) >= 0
  );
}

/**
 * The first problem with the whole `assets` manifest, or null when it is
 * well-formed (including simply absent, for a version 1 export). Reject
 * rather than coerce: a manifest entry missing `id` would otherwise collapse
 * multiple entries onto the same `undefined` map key and silently mis-wire
 * every asset reference that follows.
 */
function assetManifestError(assets: unknown): string | null {
  if (assets === undefined) return null;
  if (!Array.isArray(assets)) return "assets must be an array of manifest entries";
  const badIndex = assets.findIndex((entry) => !isValidAssetManifestEntry(entry));
  return badIndex === -1 ? null : `assets[${badIndex}] is not a valid asset manifest entry`;
}

export async function importJson(req: AuthRequest, res: Response): Promise<void> {
  const data = req.body;

  // Version 1 files predate the asset manifest and import unchanged.
  const SupportedExportVersions = [1, 2];
  if (!SupportedExportVersions.includes(data?.version) || !data?.experiment) {
    res.status(400).json({ code: "INVALID_FORMAT", message: "Invalid export format" });
    return;
  }

  const exp = data.experiment;

  if (!exp.name || !exp.routines) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "Experiment name and routines are required" });
    return;
  }

  if (Array.isArray(exp.routines)) {
    const rotationError = validateRoutineRotations(
      exp.routines as RoutineConfig[],
      exp.sessionDesigns,
    );
    if (rotationError) {
      res.status(400).json({ code: "INVALID_CONFIG", message: rotationError });
      return;
    }

    const roleIssue = roleAssignmentIssue(exp.routines as RoutineConfig[]);
    if (roleIssue) {
      res.status(400).json({ code: "INVALID_CONFIG", message: roleIssue });
      return;
    }
  }

  // The import route is the one path with no client-side designer in front of
  // it, so this check is the only thing standing between a hand-edited JSON
  // file and a design that compiles a mismatched cohort.
  // The rows arrive in the same file, so the band checks read them from the
  // payload rather than from a database row that does not exist yet.
  const importedRows: BandContentRow[] = (Array.isArray(data.contents) ? data.contents : [])
    .filter((row: unknown): row is BandContentRow => {
      const candidate = row as BandContentRow | null;
      return (
        !!candidate &&
        Number.isFinite(candidate.progress) &&
        typeof candidate.routine === "string"
      );
    })
    .map((row: BandContentRow) => ({ progress: row.progress, routine: row.routine }));

  const designError = validateSessionDesigns(
    exp.sessionDesigns,
    (exp.routines ?? []) as RoutineConfig[],
    (exp.conditions ?? []) as string[],
    importedRows,
  );
  if (designError) {
    res.status(400).json({
      code: "INVALID_CONFIG",
      message: designError.message,
      issues: designError.issues,
    });
    return;
  }

  // Validated before any database write: a malformed manifest entry must
  // reject the whole import with a clear 400, not throw deep inside a write.
  const manifestError = assetManifestError(data.assets);
  if (manifestError) {
    res.status(400).json({ code: "INVALID_FORMAT", message: manifestError });
    return;
  }

  // Asset ids are the primary key, so an import into the server the study came
  // from would collide. Mint fresh ids and rewrite every reference to them —
  // in the routines, in each content row's content, AND in any session
  // design's trialContent, so a later re-apply of that design in the Session
  // Designer can't overwrite good references with dangling old ones.
  const manifest: AssetManifestEntry[] = Array.isArray(data.assets) ? data.assets : [];
  const assetIdMap = new Map(manifest.map((asset) => [asset.id, randomUUID()]));
  const remappedRoutines = remapAssetRefs(exp.routines, assetIdMap);
  const remappedSessionDesigns =
    exp.sessionDesigns !== undefined ? remapAssetRefs(exp.sessionDesigns, assetIdMap) : undefined;

  const created = await prisma.experiment.create({
    data: {
      name: `${exp.name} (imported)`,
      description: exp.description ?? "",
      visible: false,
      allowNew: exp.allowNew ?? true,
      img: exp.img ?? null,
      avCollection: exp.avCollection ?? false,
      bodyDetection: exp.bodyDetection ?? false,
      videoChat: exp.videoChat ?? false,
      supplementaryDevice: exp.supplementaryDevice ?? "NONE",
      activeTime: exp.activeTime ?? 30,
      rollBackTime: exp.rollBackTime ?? 60,
      participantsPerSession: exp.participantsPerSession ?? 1,
      participantIdParam: exp.participantIdParam ?? null,
      conditions: exp.conditions ?? [],
      randomization: exp.randomization ?? false,
      randomizationConfig: exp.randomizationConfig ?? null,
      matchingStrategy: exp.matchingStrategy ?? "FIFO",
      initialProperties: exp.initialProperties ?? {},
      conditionProperties: exp.conditionProperties ?? {},
      routines: remappedRoutines,
      ...(remappedSessionDesigns !== undefined && { sessionDesigns: remappedSessionDesigns }),
      experimenters: {
        create: { experimenterId: req.auth!.experimenterId },
      },
    },
  });

  if (manifest.length > 0) {
    await prisma.asset.createMany({
      data: manifest.map((asset) => ({
        id: assetIdMap.get(asset.id)!,
        experimentId: created.id,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        // Safe: assetManifestError already confirmed size is a non-negative integer.
        size: BigInt(asset.size),
        // The bytes did not travel with the JSON; the Media tab restores them.
        filePath: null,
      })),
    });
  }

  const contents = Array.isArray(data.contents) ? data.contents : [];
  if (contents.length > 0) {
    await prisma.experimentContent.createMany({
      data: contents.map((c: Record<string, unknown>) => ({
        experimentId: created.id,
        progress: c.progress as number,
        trialNumber: (c.trialNumber as number) ?? 1,
        routine: c.routine as string,
        content: remapAssetRefs((c.content ?? {}) as Prisma.InputJsonValue, assetIdMap),
        condition: (c.condition as string) ?? null,
        description: (c.description as string) ?? "",
      })),
    });
  }

  res.status(201).json({
    id: created.id,
    name: created.name,
    contentRows: contents.length,
    assets: manifest.length,
  });
}
