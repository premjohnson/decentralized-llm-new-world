import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import {
  checkDatabaseConnection,
  closeDatabase,
} from "./db/pool.js";
import {
  checkRedisConnection,
  closeRedis,
  connectRedis,
} from "./redis/client.js";

async function start(): Promise<void> {
  try {
    // --------------------------------------------------
    // PostgreSQL
    // --------------------------------------------------

    await checkDatabaseConnection();

    console.log("PostgreSQL connection established");

    // --------------------------------------------------
    // Redis
    // --------------------------------------------------

    await connectRedis();
    await checkRedisConnection();

    console.log("Redis connection established");

    // --------------------------------------------------
    // Fastify
    // --------------------------------------------------

    const app = await buildApp();

    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });

    // --------------------------------------------------
    // Graceful shutdown
    // --------------------------------------------------

    const shutdown = async (): Promise<void> => {
      try {
        await app.close();

        await closeRedis();
        await closeDatabase();

        console.log("Coordinator shutdown complete");
      } catch (error) {
        app.log.error(
          error,
          "Failed during shutdown",
        );

        process.exit(1);
      }
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error(
      "Failed to start coordinator:",
      error,
    );

    try {
      await closeRedis();
    } catch {
      // Redis may not have been connected.
    }

    await closeDatabase();

    process.exit(1);
  }
}

void start();