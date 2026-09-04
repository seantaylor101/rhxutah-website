#!/usr/bin/env node
// Minimal migration runner: applies every .sql file in db/migrations, in filename order,
// that isn't already recorded in schema_migrations. Runs with the DB owner connection
// (DATABASE_URL), since migrations create RLS policies and GRANTs targeting the
// leadhammer_app / leadhammer_platform roles -- run scripts/setup-db-roles.js first.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await client.query("SELECT id FROM schema_migrations");
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const file of files) {
    if (appliedIds.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`Applying ${file}...`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`Migration ${file} failed:`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  console.log(files.length ? "Migrations up to date." : "No migration files found.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
