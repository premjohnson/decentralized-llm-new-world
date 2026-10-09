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
import {
  BlockchainOutboxProcessor,
} from "./modules/blockchain/blockchain.outbox.processor.js";
import {
  BlockchainOutboxWorker,
} from "./modules/blockchain/blockchain.outbox.worker.js";
import {
  BlockchainService,
} from "./modules/blockchain/blockchain.service.js";
import {
  BlockchainClient,
} from "./modules/blockchain/blockchain.client.js";

async function start(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  let blockchainOutboxWorker: BlockchainOutboxWorker | null = null;

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

    app = await buildApp();

    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });

    // --------------------------------------------------
    // Blockchain Outbox
    // --------------------------------------------------

const blockchainClient = new BlockchainClient(
  env.BLOCKCHAIN_RPC_URL,
  env.BLOCKCHAIN_WALLET_PATH,
);
    const blockchainService = new BlockchainService(
      blockchainClient,
    );

    const blockchainOutboxProcessor =
      new BlockchainOutboxProcessor(
        blockchainService,
      );

    blockchainOutboxWorker =
      new BlockchainOutboxWorker(
        blockchainOutboxProcessor,
      );

    await blockchainOutboxWorker.start();

    console.log(
      "Blockchain outbox worker started",
    );

    // --------------------------------------------------
    // Graceful shutdown
    // --------------------------------------------------

    const shutdown = async (): Promise<void> => {
      try {
        if (blockchainOutboxWorker) {
          await blockchainOutboxWorker.stop();

          console.log(
            "Blockchain outbox worker stopped",
          );
        }

        if (app) {
          await app.close();
        }

        await closeRedis();
        await closeDatabase();

        console.log(
          "Coordinator shutdown complete",
        );
      } catch (error) {
        if (app) {
          app.log.error(
            error,
            "Failed during shutdown",
          );
        } else {
          console.error(
            "Failed during shutdown:",
            error,
          );
        }

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
      if (blockchainOutboxWorker) {
        await blockchainOutboxWorker.stop();
      }
    } catch {
      // Worker may not have started.
    }

    try {
      if (app) {
        await app.close();
      }
    } catch {
      // Fastify may not have started.
    }

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