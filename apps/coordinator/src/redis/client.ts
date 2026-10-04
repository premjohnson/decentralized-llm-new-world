import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  db: env.REDIS_DATABASE,

  lazyConnect: true,

  maxRetriesPerRequest: 3,

  enableReadyCheck: true,
});

redis.on("connect", () => {
  console.log("Redis connection established");
});

redis.on("ready", () => {
  console.log("Redis connection ready");
});

redis.on("error", (error: Error) => {
  console.error("Redis connection error:", error);
});

redis.on("close", () => {
  console.log("Redis connection closed");
});

export async function connectRedis(): Promise<void> {
  if (redis.status === "ready") {
    return;
  }

  if (redis.status === "wait") {
    await redis.connect();
    return;
  }

  if (redis.status === "end") {
    throw new Error(
      "Redis client has already been closed",
    );
  }

  await redis.connect();
}

export async function checkRedisConnection(): Promise<void> {
  const result = await redis.ping();

  if (result !== "PONG") {
    throw new Error(
      `Unexpected Redis ping response: ${result}`,
    );
  }
}

export async function closeRedis(): Promise<void> {
  if (
    redis.status === "end" ||
    redis.status === "wait"
  ) {
    return;
  }

  await redis.quit();
}