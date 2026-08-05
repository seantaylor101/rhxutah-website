import { COOKIE_NAME, verifySession } from "../auth.js";

export function requireAuth(minRole = "viewer") {
  return (req, res, next) => {
    const token = req.cookies[COOKIE_NAME];
    const session = token && verifySession(token);
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    if (minRole === "owner" && session.role !== "owner") {
      return res.status(403).json({ error: "Editor access required" });
    }
    req.role = session.role;
    next();
  };
}
