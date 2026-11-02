import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

export const COOKIE_NAME = "rhx_session";

// owner / viewer are the two shared passcodes; employee is a per-person
// login (see employees.js) and carries which employee it is as `eid`
export function signSession(role, extra = {}) {
  return jwt.sign({ role, ...extra }, SECRET, { expiresIn: "30d" });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.role === "owner" || payload.role === "viewer") return payload;
    if (payload.role === "employee" && typeof payload.eid === "string" && payload.eid) return payload;
    return null;
  } catch {
    return null;
  }
}
