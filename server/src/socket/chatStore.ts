/**
 * chatStore — the buffer behind the text channel, so a participant who reloads
 * mid-routine gets the conversation back (spec §6.1).
 *
 * Keys come from `chatKey` (`ame:chat:…`), deliberately outside `ame:match:*`:
 * the waiting-room sweeps SCAN that pattern and run hash commands on whatever
 * they find, and a list there would raise WRONGTYPE inside a disconnect handler.
 */

import type { Redis } from "ioredis";
import type { ChatLine } from "ame-shared";

/** Lines kept per thread; older ones are trimmed. */
export const MaxChatLines = 500;

export interface ChatStore {
  append(key: string, line: ChatLine, ttlSeconds: number): Promise<void>;
  history(key: string): Promise<ChatLine[]>;
}

/** For tests and a server started without Redis. */
export class MemoryChatStore implements ChatStore {
  private readonly threads = new Map<string, ChatLine[]>();

  async append(key: string, line: ChatLine, _ttlSeconds: number): Promise<void> {
    this.threads.set(key, [...(this.threads.get(key) ?? []), line].slice(-MaxChatLines));
  }

  async history(key: string): Promise<ChatLine[]> {
    return [...(this.threads.get(key) ?? [])];
  }
}

export class RedisChatStore implements ChatStore {
  constructor(private readonly redis: Redis) {}

  async append(key: string, line: ChatLine, ttlSeconds: number): Promise<void> {
    const results = await this.redis
      .multi()
      .rpush(key, JSON.stringify(line))
      .ltrim(key, -MaxChatLines, -1)
      .expire(key, ttlSeconds)
      .exec();
    // exec() resolves even when a command inside the transaction failed; the
    // failure is in its [err, result] pair. Null means the transaction was aborted.
    if (!results) throw new Error(`Chat append to ${key} was aborted`);
    const failed = results.find(([err]) => err);
    if (failed) throw new Error(`Chat append to ${key} failed: ${failed[0]!.message}`);
  }

  async history(key: string): Promise<ChatLine[]> {
    const raw = await this.redis.lrange(key, 0, -1);
    return raw.flatMap((entry) => {
      try {
        return [JSON.parse(entry) as ChatLine];
      } catch {
        return [];
      }
    });
  }
}
