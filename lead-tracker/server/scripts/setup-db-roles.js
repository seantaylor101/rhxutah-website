#!/usr/bin/env node
// Idempotently creates the two Postgres roles the app connects as (see
// db/migrations/0002_rls.sql for what each is allowed to touch). Run once per
// environment, with a superuser/owner connection (DATABASE_URL), before running
// migrations for the first time or whenever passwords need to rotate.
//
// Required env vars: DATABASE_URL, APP_DB_PASSWORD, PLATFORM_DB_PASSWORD.

import pg from "pg";

const { DATABASE_URL, APP_DB_PASSWORD, PLATFORM_DB_PASSWORD } = process.env;

for (const [name, value] of Object.entries({ DATABASE_URL, APP_DB_PASSWORD, PLATFORM_DB_PASSWORD })) {
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function ensureRole(name, password) {
  const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  if (rows.length) {
    await client.query(`ALTER ROLE ${client.escapeIdentifier(name)} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    console.log(`Updated password for existing role "${name}"`);
  } else {
    await client.query(`CREATE ROLE ${client.escapeIdentifier(name)} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    console.log(`Created role "${name}"`);
  }
  const dbName = new URL(DATABASE_URL).pathname.slice(1);
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(dbName)} TO ${client.escapeIdentifier(name)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${client.escapeIdentifier(name)}`);
}

async function main() {
  await client.connect();
  await ensureRole("leadhammer_app", APP_DB_PASSWORD);
  await ensureRole("leadhammer_platform", PLATFORM_DB_PASSWORD);
  await client.end();
  console.log("Done. Run `npm run migrate` next (as the DB owner) to apply schema + grants.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
