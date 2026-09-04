import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

export const COOKIE_NAME = "rhx_session";
export const ROLES = new Set(["platform_admin", "tenant_admin", "pm"]);

// Session payload: {userId, tenantId, role, actingAs?: {userId, role}}.
// tenantId is null only for platform_admin. actingAs is set while a tenant_admin is
// "viewing as" one of their PMs, or (narrowly) while a platform_admin is viewing as a
// tenant_admin for support -- see auth/middleware.js for how it's applied, and
// auth/impersonation.js for how it's granted + audited.
export function signSession({ userId, tenantId, role, actingAs }) {
  if (!ROLES.has(role)) throw new Error(`invalid role: ${role}`);
  const payload = { userId, tenantId, role };
  if (actingAs) payload.actingAs = actingAs;
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (!payload.userId || !ROLES.has(payload.role)) return null;
    if (payload.tenantId !== null && typeof payload.tenantId !== "string") return null;
    if (payload.role === "platform_admin" && payload.tenantId !== null) return null;
    if (payload.role !== "platform_admin" && !payload.tenantId) return null;
    if (payload.actingAs) {
      const { userId, role } = payload.actingAs;
      if (!userId || !ROLES.has(role)) return null;
    }
    return payload;
  } catch {
    return null;
  }
}
