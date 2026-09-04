import { COOKIE_NAME, verifySession } from "./session.js";

// requireAuth(...allowedRoles) verifies the session cookie and, if allowedRoles is
// non-empty, requires the *effective* role (see below) to be one of them.
//
// Every handler downstream should read req.actor (who is really signed in -- used for
// audit logging) and req.effective (whose data/permissions apply -- used for every
// tenant_id/assigned_pm_id scoping decision). They're equal unless a tenant_admin or
// platform_admin is currently "viewing as" someone else, in which case req.effective
// reflects the impersonated identity so the rest of the app doesn't need two code paths.
export function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const token = req.cookies[COOKIE_NAME];
    const session = token && verifySession(token);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    req.session = session;
    req.actor = { userId: session.userId, tenantId: session.tenantId, role: session.role };
    req.effective = session.actingAs
      ? { userId: session.actingAs.userId, tenantId: session.tenantId, role: session.actingAs.role }
      : req.actor;

    if (allowedRoles.length && !allowedRoles.includes(req.effective.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export const requirePlatformAdmin = () => requireAuth("platform_admin");
export const requireTenantAdmin = () => requireAuth("tenant_admin");
export const requireAnyTenantUser = () => requireAuth("tenant_admin", "pm");
