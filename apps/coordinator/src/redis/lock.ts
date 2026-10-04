import { randomUUID } from "node:crypto";
import { redis } from "./client.js";

export interface RedisLock {
  key: string;
  token: string;
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function acquireLock(
  key: string,
  ttlSeconds: number,
): Promise<RedisLock | null> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(
      "Lock TTL must be a positive integer",
    );
  }

  const token = randomUUID();

  const result = await redis.set(
    key,
    token,
    "EX",
    ttlSeconds,
    "NX",
  );

  if (result !== "OK") {
    return null;
  }

  return {
    key,
    token,
  };
}

export async function releaseLock(
  lock: RedisLock,
): Promise<boolean> {
  const result = await redis.eval(
    RELEASE_LOCK_SCRIPT,
    1,
    lock.key,
    lock.token,
  );

  return result === 1;
}