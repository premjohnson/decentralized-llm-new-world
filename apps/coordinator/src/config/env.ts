import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum([
      "development",
      "test",
      "production",
    ])
    .default("development"),

  HOST: z
    .string()
    .default("0.0.0.0"),

  PORT: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(4000),

  WORKER_HEARTBEAT_TIMEOUT_SECONDS: z
    .coerce
    .number()
    .int()
    .positive()
    .default(45),

  WORKER_HEALTH_CHECK_INTERVAL_SECONDS: z
    .coerce
    .number()
    .int()
    .positive()
    .default(15),

  /*
   * Task Recovery
   *
   * A task that remains assigned/running longer than this
   * duration is considered stale and eligible for recovery.
   */
  TASK_RECOVERY_TIMEOUT_SECONDS: z
    .coerce
    .number()
    .int()
    .positive()
    .default(300),

  /*
   * How frequently the Coordinator checks for stale tasks.
   */
  TASK_RECOVERY_INTERVAL_SECONDS: z
    .coerce
    .number()
    .int()
    .positive()
    .default(15),

  /*
   * PostgreSQL
   */
  DATABASE_HOST: z
    .string()
    .default("localhost"),

  DATABASE_PORT: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(5433),

  DATABASE_NAME: z
    .string()
    .min(1),

  DATABASE_USER: z
    .string()
    .min(1),

  DATABASE_PASSWORD: z
    .string()
    .min(1),

  DATABASE_POOL_MAX: z
    .coerce
    .number()
    .int()
    .positive()
    .default(10),

  /*
   * Redis
   */
  REDIS_HOST: z
    .string()
    .default("localhost"),

  REDIS_PORT: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(6379),

  REDIS_DATABASE: z
    .coerce
    .number()
    .int()
    .min(0)
    .default(0),

  /*
   * Solana / Blockchain
   *
   * RPC endpoint used by the coordinator to communicate
   * with the Solana blockchain.
   */
  BLOCKCHAIN_RPC_URL: z
    .string()
    .url()
    .default("https://api.devnet.solana.com"),

  /*
   * Filesystem path to the Solana authority wallet.
   *
   * The private key itself must never be stored in .env.
   * Only the path to the keypair file is configured here.
   */
  BLOCKCHAIN_WALLET_PATH: z
    .string()
    .min(1),
});

export const env = envSchema.parse(
  process.env,
);