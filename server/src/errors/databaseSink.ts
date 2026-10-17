/**
 * Buffers records in memory and writes them in batches (spec §4.3, amended:
 * each group writes independently rather than the whole flush sharing one
 * transaction — see fix report, task 5 finding 2, 2026-09-17-error-log).
 *
 * Nothing on a participant's path waits for this. A storm degrades to counting
 * rather than to unbounded memory or a row per occurrence, and a failed flush
 * drops its batch rather than retrying for ever. Error groups are independent
 * of each other, so one group's write failing must cost only that group, not
 * every other group in the same flush.
 */

import type { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import { fingerprintFor } from "./fingerprint.js";
import { setErrorSink, type ErrorRecord, type ErrorSink } from "./reportError.js";

export const FlushIntervalMs = 5_000;
/** Stored occurrences per group per flush window; beyond this only the count rises. */
export const MaxEventsPerGroupPerMinute = 20;
/** Distinct groups held between flushes. */
export const MaxGroupsPerFlush = 500;

interface PendingGroup {
  fingerprint: string;
  first: ErrorRecord;
  count: number;
  lastSeenAt: Date;
  events: ErrorRecord[];
}

export function createDatabaseSink(): {
  sink: ErrorSink;
  flush: () => Promise<void>;
  start: () => void;
  stop: () => void;
  pending: () => PendingGroup[];
} {
  let buffer = new Map<string, PendingGroup>();
  let warned = false;
  let timer: NodeJS.Timeout | null = null;
  // A flush slower than FlushIntervalMs (most likely during the same error
  // storm that fills the buffer) would otherwise overlap with the next tick's
  // flush, stacking a second interactive transaction against the pool live
  // participants are using. The buffer swap at entry keeps each flush's
  // batch disjoint, so this guard is only about not running two at once.
  let flushing = false;

  const sink: ErrorSink = (record) => {
    const fingerprint = fingerprintFor(record);
    const existing = buffer.get(fingerprint);

    if (!existing) {
      if (buffer.size >= MaxGroupsPerFlush) {
        if (!warned) {
          console.warn(`[errorSink] Buffer full (${MaxGroupsPerFlush} groups); dropping new groups until the next flush`);
          warned = true;
        }
        return;
      }
      buffer.set(fingerprint, { fingerprint, first: record, count: 1, lastSeenAt: record.occurredAt, events: [record] });
      return;
    }

    existing.count += 1;
    existing.lastSeenAt = record.occurredAt;
    if (existing.events.length < MaxEventsPerGroupPerMinute) existing.events.push(record);
  };

  /**
   * One group's upsert-then-createMany, in its own transaction. Deliberately
   * NOT one transaction wrapping the whole batch: Prisma's default
   * interactive-transaction timeout (5s) is easy for a full 500-group buffer
   * (1000 sequential round-trips) to trip, and error groups don't need
   * cross-group atomicity — a group that fails should cost that group alone.
   */
  const writeGroup = async (group: PendingGroup): Promise<void> => {
    await prisma.$transaction(async (tx) => {
      const row = await tx.errorGroup.upsert({
        where: { fingerprint: group.fingerprint },
        create: {
          fingerprint: group.fingerprint,
          source: group.first.source,
          name: group.first.name,
          message: group.first.message,
          experimentId: group.first.experimentId,
          count: group.count,
          firstSeenAt: group.first.occurredAt,
          lastSeenAt: group.lastSeenAt,
        },
        // A returning bug reopens itself, so a resolved group can never hide one.
        update: {
          count: { increment: group.count },
          lastSeenAt: group.lastSeenAt,
          status: "OPEN",
          resolvedAt: null,
          resolvedById: null,
        },
      });

      await tx.errorEvent.createMany({
        data: group.events.map((event) => ({
          groupId: row.id,
          occurredAt: event.occurredAt,
          participantId: event.participantId,
          responseId: event.responseId,
          routine: event.routine,
          progress: event.progress,
          context: event.context as Prisma.InputJsonValue,
          stack: event.stack,
          message: event.message,
        })),
      });
    });
  };

  const flush = async (): Promise<void> => {
    if (flushing) return;
    if (buffer.size === 0) return;
    flushing = true;
    try {
      const batch = [...buffer.values()];
      buffer = new Map();
      warned = false;

      for (const group of batch) {
        try {
          await writeGroup(group);
        } catch (err) {
          // This group's occurrences are gone either way: retrying a failing
          // database behind a participant's request is exactly what this
          // design refuses to do. The other groups in this flush are
          // unaffected — each ran in its own transaction.
          console.error(`[errorSink] Failed to persist error group ${group.fingerprint}:`, err);
        }
      }
    } finally {
      flushing = false;
    }
  };

  return {
    sink,
    flush,
    pending: () => [...buffer.values()],
    start: () => {
      timer = setInterval(() => void flush(), FlushIntervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Called once from `app.ts`. Returns a handle so a shutdown hook (see
 * `processErrorHandlers.ts`) can flush and stop the timer before the process
 * exits — otherwise up to `FlushIntervalMs` of buffered errors, including the
 * one describing why the process is exiting, dies with it.
 */
export function installDatabaseSink(): { flush: () => Promise<void>; stop: () => void } {
  const { sink, flush, start, stop } = createDatabaseSink();
  setErrorSink(sink);
  start();
  return { flush, stop };
}
