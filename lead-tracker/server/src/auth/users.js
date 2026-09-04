import { randomUUID } from "node:crypto";
import { withPlatform, withTenant } from "../db/pool.js";
import { hashPassword } from "./passwords.js";

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
  };
}

// Login needs to find a user by email before we know their tenant, so it goes through
// the platform pool (the only role with unconditional SELECT on `users`). This returns
// the password hash too -- callers must not leak it past the login check.
export async function findUserForLogin(email) {
  return withPlatform(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM users WHERE lower(email) = lower($1) AND disabled_at IS NULL",
      [email]
    );
    return rows[0] || null;
  });
}

// Stamped on every successful login -- the one activity signal a platform_admin can see
// per tenant (via the platform pool's unconditional access to `users`) without any
// grant on business tables. Best-effort: never let a timestamp update block a login.
export async function markLoggedIn(userId) {
  await withPlatform((client) => client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId])).catch(
    () => {}
  );
}

export async function getUserById(effectiveTenantId, userId) {
  return withTenant(effectiveTenantId, async (client) => {
    const { rows } = await client.query("SELECT * FROM users WHERE id = $1", [userId]);
    return rowToUser(rows[0]);
  });
}

export async function listTenantUsers(tenantId) {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM users WHERE tenant_id = $1 ORDER BY role, lower(name)",
      [tenantId]
    );
    return rows.map(rowToUser);
  });
}

// Tenant admin adding a PM (or a second tenant admin) to their own tenant. Scoped by
// RLS to tenantId regardless of what's passed, since it goes through withTenant.
export async function createTenantUser(tenantId, { email, name, password, role }) {
  if (role !== "tenant_admin" && role !== "pm") {
    throw new Error(`createTenantUser cannot create role "${role}"`);
  }
  const passwordHash = await hashPassword(password);
  return withTenant(tenantId, async (client) => {
    const existing = await client.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
    if (existing.rows.length) throw new Error("A user with that email already exists");
    const { rows } = await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), tenantId, email, passwordHash, name, role]
    );
    return rowToUser(rows[0]);
  });
}

export async function setUserDisabled(tenantId, userId, disabled) {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      "UPDATE users SET disabled_at = $2 WHERE id = $1 RETURNING *",
      [userId, disabled ? new Date().toISOString() : null]
    );
    return rowToUser(rows[0]);
  });
}

export async function setUserPassword(tenantId, userId, newPassword) {
  const passwordHash = await hashPassword(newPassword);
  return withTenant(tenantId, async (client) => {
    await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
  });
}

// Platform-admin-only: create a new tenant plus its first tenant_admin, in one
// transaction. This is the entire "onboard a new client" flow.
export async function createTenantWithAdmin({ tenantName, slug, timezone, adminEmail, adminName, password }) {
  const passwordHash = await hashPassword(password);
  // The platform pool's role has no grant at all on tenant_settings (or any other
  // business table) by design -- only tenants/users/audit_log. So this transaction
  // creates just the tenant + its first admin user; the default settings row is seeded
  // right after, through the tenant-scoped app pool (which does own tenant_settings).
  const { tenantId, admin } = await withPlatform(async (client) => {
    await client.query("BEGIN");
    try {
      const tenantId = randomUUID();
      await client.query(
        `INSERT INTO tenants (id, name, slug, timezone) VALUES ($1, $2, $3, $4)`,
        [tenantId, tenantName, slug, timezone || "America/Denver"]
      );
      const userId = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, $5, 'tenant_admin') RETURNING *`,
        [userId, tenantId, adminEmail, passwordHash, adminName]
      );
      await client.query("COMMIT");
      return { tenantId, admin: rowToUser(rows[0]) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
  await withTenant(tenantId, (client) =>
    client.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantId])
  );
  return { tenantId, admin };
}

export async function listTenants() {
  return withPlatform(async (client) => {
    const { rows } = await client.query("SELECT * FROM tenants ORDER BY created_at DESC");
    return rows;
  });
}

export async function createPlatformAdmin({ email, name, password }) {
  const passwordHash = await hashPassword(password);
  return withPlatform(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role)
       VALUES ($1, NULL, $2, $3, $4, 'platform_admin') RETURNING *`,
      [randomUUID(), email, passwordHash, name]
    );
    return rowToUser(rows[0]);
  });
}
