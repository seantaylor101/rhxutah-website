import { COOKIE_NAME, verifySession } from "../auth.js";
import { getActiveEmployee } from "../employees.js";

// minRole:
//   "viewer"   — owner or viewer (the lead board). Employee logins are
//                refused: they only ever see their own time clock.
//   "owner"    — owner only
//   "employee" — an employee login whose employee is still active; sets
//                req.employee
//   "any"      — any valid session (used by /auth/me)
export function requireAuth(minRole = "viewer") {
  return (req, res, next) => {
    const token = req.cookies[COOKIE_NAME];
    const session = token && verifySession(token);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    if (session.role === "employee") {
      // checked on every request so turning an employee off (or deleting
      // them) cuts their phone off right away, not when the cookie expires
      const employee = getActiveEmployee(session.eid);
      if (!employee) return res.status(401).json({ error: "Not authenticated" });
      if (minRole !== "employee" && minRole !== "any") {
        return res.status(403).json({ error: "Not available on an employee login" });
      }
      req.role = "employee";
      req.employee = employee;
      return next();
    }

    if (minRole === "employee") return res.status(403).json({ error: "Employee login required" });
    if (minRole === "owner" && session.role !== "owner") {
      return res.status(403).json({ error: "Editor access required" });
    }
    req.role = session.role;
    next();
  };
}
