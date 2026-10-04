import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, closeDatabase } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDirectory = path.join(__dirname, "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await db.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );

  return new Set(result.rows.map((row) => row.version));
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await fs.readdir(migrationsDirectory);

  return files
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function runMigration(
  version: string,
  sql: string,
): Promise<void> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(sql);

    await client.query(
      `
        INSERT INTO schema_migrations (version)
        VALUES ($1)
      `,
      [version],
    );

    await client.query("COMMIT");

    console.log(`Applied migration: ${version}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  try {
    await ensureMigrationsTable();

    const appliedMigrations = await getAppliedMigrations();
    const migrationFiles = await getMigrationFiles();

    for (const file of migrationFiles) {
      if (appliedMigrations.has(file)) {
        continue;
      }

      const filePath = path.join(migrationsDirectory, file);
      const sql = await fs.readFile(filePath, "utf8");

      await runMigration(file, sql);
    }

    console.log("Database migrations completed");
  } finally {
    await closeDatabase();
  }
}

void migrate().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exit(1);
});