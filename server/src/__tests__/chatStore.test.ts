import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Redis } from "ioredis";
import { MemoryChatStore, RedisChatStore, MaxChatLines } from "../socket/chatStore.js";

const line = (text: string, at: number) => ({ from: "p1", seat: 0, text, at });

describe("MemoryChatStore", () => {
  it("returns lines in order and keeps only the newest MaxChatLines", async () => {
    const store = new MemoryChatStore();
    for (let i = 0; i < MaxChatLines + 2; i++) await store.append("k", line(`m${i}`, i), 60);
    const lines = await store.history("k");
    expect(lines).toHaveLength(MaxChatLines);
    expect(lines[0].text).toBe("m2");
    expect(await store.history("other")).toEqual([]);
  });
});

describe("RedisChatStore", () => {
  const pipeline = { rpush: vi.fn(), ltrim: vi.fn(), expire: vi.fn(), exec: vi.fn() };
  const lrange = vi.fn();
  const fakeRedis = { multi: vi.fn(), lrange } as unknown as Redis;

  // server/vitest.config.ts sets mockReset globally, so implementations are installed per test.
  beforeEach(() => {
    pipeline.rpush.mockReturnValue(pipeline);
    pipeline.ltrim.mockReturnValue(pipeline);
    pipeline.expire.mockReturnValue(pipeline);
    pipeline.exec.mockResolvedValue([]);
    (fakeRedis.multi as unknown as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
  });

  it("appends, trims and refreshes the TTL in one transaction", async () => {
    await new RedisChatStore(fakeRedis).append("ame:chat:s:1:0", line("hi", 5), 1800);
    expect(pipeline.rpush).toHaveBeenCalledWith("ame:chat:s:1:0", JSON.stringify(line("hi", 5)));
    expect(pipeline.ltrim).toHaveBeenCalledWith("ame:chat:s:1:0", -MaxChatLines, -1);
    expect(pipeline.expire).toHaveBeenCalledWith("ame:chat:s:1:0", 1800);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("throws when a command inside the transaction failed, or the transaction was aborted", async () => {
    const store = new RedisChatStore(fakeRedis);
    pipeline.exec.mockResolvedValue([[null, 1], [new Error("WRONGTYPE"), null], [null, 1]]);
    await expect(store.append("k", line("hi", 5), 60)).rejects.toThrow("Chat append to k failed: WRONGTYPE");
    pipeline.exec.mockResolvedValue(null);
    await expect(store.append("k", line("hi", 5), 60)).rejects.toThrow("Chat append to k was aborted");
  });

  it("parses the list and skips a malformed entry", async () => {
    lrange.mockResolvedValue([JSON.stringify(line("a", 1)), "{not json", JSON.stringify(line("b", 2))]);
    expect(await new RedisChatStore(fakeRedis).history("k")).toEqual([line("a", 1), line("b", 2)]);
  });
});
