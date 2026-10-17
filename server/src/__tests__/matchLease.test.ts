import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryWaitingRoomStore, MatchLeaseTtlMs } from "../socket/waitingRoomStore.js";
import { RedisWaitingRoomStore } from "../socket/redisWaitingRoomStore.js";

describe("MemoryWaitingRoomStore — match lease", () => {
  let store: MemoryWaitingRoomStore;

  beforeEach(() => {
    store = new MemoryWaitingRoomStore();
  });

  it("hands the room to one attempt at a time", async () => {
    const first = await store.acquireMatchLease("room-1");
    const second = await store.acquireMatchLease("room-1");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("lets a different room proceed in parallel", async () => {
    await store.acquireMatchLease("room-1");

    expect(await store.acquireMatchLease("room-2")).not.toBeNull();
  });

  it("raises the token on every acquisition", async () => {
    const first = await store.acquireMatchLease("room-1");
    await first!.release();
    const second = await store.acquireMatchLease("room-1");

    expect(second!.token).toBeGreaterThan(first!.token);
  });

  it("reopens the room once the holder releases", async () => {
    const first = await store.acquireMatchLease("room-1");
    await first!.release();

    expect(await store.acquireMatchLease("room-1")).not.toBeNull();
  });

  it("reopens the room once the lease lapses", async () => {
    vi.useFakeTimers();
    await store.acquireMatchLease("room-1", 1000);
    vi.advanceTimersByTime(1001);

    expect(await store.acquireMatchLease("room-1")).not.toBeNull();
    vi.useRealTimers();
  });

  it("refuses a stalled holder's commit after a newer attempt committed", async () => {
    // The fencing case: the first holder stalls past its lease, a second takes
    // the room and commits, then the first wakes up and tries to write.
    vi.useFakeTimers();
    const stalled = await store.acquireMatchLease("room-1", 1000);
    vi.advanceTimersByTime(1001);
    const fresh = await store.acquireMatchLease("room-1");

    expect(await fresh!.commit()).toBe(true);
    expect(await stalled!.commit()).toBe(false);
    vi.useRealTimers();
  });

  it("lets one attempt commit repeatedly, so it can form several cohorts", async () => {
    // A FIFO room holding four people forms two sessions in one pass. Each
    // write re-commits, so the rule must admit an equal token.
    const lease = await store.acquireMatchLease("room-1");

    expect(await lease!.commit()).toBe(true);
    expect(await lease!.commit()).toBe(true);
  });

  it("does not let a lapsed holder release the room out from under its successor", async () => {
    vi.useFakeTimers();
    const stalled = await store.acquireMatchLease("room-1", 1000);
    vi.advanceTimersByTime(1001);
    const fresh = await store.acquireMatchLease("room-1");

    await stalled!.release();

    // The successor still holds it, so a third attempt must still be refused.
    expect(await store.acquireMatchLease("room-1")).toBeNull();
    expect(fresh).not.toBeNull();
    vi.useRealTimers();
  });

  it("defaults to the shared lease lifetime", async () => {
    vi.useFakeTimers();
    await store.acquireMatchLease("room-1");
    vi.advanceTimersByTime(MatchLeaseTtlMs - 1);

    expect(await store.acquireMatchLease("room-1")).toBeNull();
    vi.useRealTimers();
  });
});

describe("RedisWaitingRoomStore — match lease", () => {
  const redis = {
    incr: vi.fn(),
    set: vi.fn(),
    eval: vi.fn(),
  };
  const store = new RedisWaitingRoomStore(redis as never);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.incr).mockResolvedValue(7);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes the lock with NX and an expiry, so a crashed holder cannot keep it", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");

    const lease = await store.acquireMatchLease("room-1", 4000);

    expect(lease?.token).toBe(7);
    // Outside the `ame:match:*` namespace: the room sweeps SCAN that pattern
    // and run hash commands on what they find, and a lock is a string.
    expect(redis.set).toHaveBeenCalledWith(
      "ame:lease:lock:room-1",
      "7",
      "PX",
      4000,
      "NX",
    );
  });

  it("returns no lease when another attempt holds the lock", async () => {
    vi.mocked(redis.set).mockResolvedValue(null);

    expect(await store.acquireMatchLease("room-1")).toBeNull();
  });

  it("commits through a script, so the compare and the write are one step", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(redis.eval).mockResolvedValue(1);
    const lease = await store.acquireMatchLease("room-1");

    expect(await lease!.commit()).toBe(true);
    const [script, keyCount, key, token] = vi.mocked(redis.eval).mock.calls[0];
    expect(String(script)).toContain("tonumber");
    expect(keyCount).toBe(1);
    expect(key).toBe("ame:lease:committed:room-1");
    expect(token).toBe("7");
  });

  it("reports a refused commit when a newer token already committed", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(redis.eval).mockResolvedValue(0);
    const lease = await store.acquireMatchLease("room-1");

    expect(await lease!.commit()).toBe(false);
  });

  it("releases only its own token", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(redis.eval).mockResolvedValue(1);
    const lease = await store.acquireMatchLease("room-1");

    await lease!.release();

    const [script, keyCount, key, token] = vi.mocked(redis.eval).mock.calls[0];
    // A plain DEL would delete a successor's lock after this lease lapsed.
    expect(String(script)).toContain("DEL");
    expect(String(script)).toContain("GET");
    expect(keyCount).toBe(1);
    expect(key).toBe("ame:lease:lock:room-1");
    expect(token).toBe("7");
  });
});
