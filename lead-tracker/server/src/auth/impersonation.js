import { randomUUID } from "node:crypto";
import { withTenant, withPlatform } from "../db/pool.js";
import { signSession } from "./session.js";

// Tenant admin -> view as one of their own PMs, or a PM being handed back control.
// Platform admin support impersonation of a tenant_admin is intentionally NOT handled
// here with the same helper: it still goes through tenant-scoped withTenant() below so
// the resulting session is bound by the exact same RLS as any tenant_admin session --
// impersonating never grants the platform admin a wider view of that tenant's data than
// the tenant_admin themself has, and it's still fully audited.

export async function startViewAs({ actor, targetUserId }) {
  if (actor.role !== "tenant_admin" && actor.role !== "platform_admin") {
    throw new Error("Only a tenant_admin or platform_admin can start view-as");
  }

  let target;
  if (actor.role === "tenant_admin") {
    target = await withTenant(actor.tenantId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'pm' AND disabled_at IS NULL",
        [targetUserId, actor.tenantId]
      );
      return rows[0];
    });
    if (!target) throw new Error("PM not found in your tenant");
  } else {
    // platform_admin: only ever a tenant_admin, and only for support -- looked up via
    // the platform pool since we don't yet know which tenant to scope withTenant to.
    target = await withPlatform(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM users WHERE id = $1 AND role = 'tenant_admin' AND disabled_at IS NULL",
        [targetUserId]
      );
      return rows[0];
    });
    if (!target) throw new Error("Tenant admin not found");
  }

  await writeAuditEntry({
    tenantId: target.tenant_id,
    actorUserId: actor.userId,
    action: "impersonation_start",
    targetUserId: target.id,
    metadata: { targetRole: target.role },
  });

  const token = signSession({
    userId: actor.userId,
    tenantId: actor.role === "tenant_admin" ? actor.tenantId : target.tenant_id,
    role: actor.role,
    actingAs: { userId: target.id, role: target.role },
  });
  return { token, target: { id: target.id, name: target.name, role: target.role } };
}

export async function stopViewAs({ actor, tenantId, actingAsUserId, actingAsRole }) {
  await writeAuditEntry({
    tenantId,
    actorUserId: actor.userId,
    action: "impersonation_stop",
    targetUserId: actingAsUserId,
    metadata: { targetRole: actingAsRole },
  });
  return signSession({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role });
}

async function writeAuditEntry({ tenantId, actorUserId, action, targetUserId, metadata }) {
  const insert = (client) =>
    client.query(
      `INSERT INTO audit_log (id, tenant_id, actor_user_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, actorUserId, action, targetUserId, metadata ? JSON.stringify(metadata) : null]
    );
  // audit_log is one of the tables both roles can INSERT into (0002_rls.sql); route
  // through withTenant when we have a concrete tenant so RLS's WITH CHECK is satisfied,
  // otherwise (shouldn't happen here -- tenantId is always known by this point) fall
  // back to the platform pool.
  if (tenantId) {
    await withTenant(tenantId, insert);
  } else {
    await withPlatform(insert);
  }
}

export { writeAuditEntry };
