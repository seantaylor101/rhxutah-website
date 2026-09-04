import pg from "pg";

const { Pool } = pg;

// Tenant-scoped pool: every session for a tenant_admin or pm connects through this role.
// RLS policies (db/migrations/0002_rls.sql) key off app.tenant_id, set per-transaction by
// withTenant() below -- never trust a tenant id from anywhere except the verified session.
export const appPool = new Pool({ connectionString: requireEnv("APP_DATABASE_URL") });

// Platform pool: used only for platform_admin sessions (tenant onboarding, tenant
// health/listing) and for the cross-tenant user lookup during login. Its role has no
// grants at all on any business table -- see 0002_rls.sql -- so this pool structurally
// cannot read a tenant's leads/contacts/warranty/goals/settings even if a bug tried.
export const platformPool = new Pool({ connectionString: requireEnv("PLATFORM_DATABASE_URL") });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

export async function withTenant(tenantId, fn) {
  if (!tenantId) throw new Error("withTenant requires a tenantId");
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function withPlatform(fn) {
  const client = await platformPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePools() {
  await Promise.all([appPool.end(), platformPool.end()]);
}
