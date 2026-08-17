import { COOKIE_NAME, verifySession } from "../auth.js";
import { db } from "../db.js";

const PERMISSION_COLUMNS = {
  editLeads: "canEditLeads",
  editWarranty: "canEditWarranty",
  viewFinancials: "canViewFinancials",
  manageSettings: "canManageSettings",
};

export function userFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    isAdmin: !!row.isAdmin,
    permissions: {
      editLeads: !!row.canEditLeads,
      editWarranty: !!row.canEditWarranty,
      viewFinancials: !!row.canViewFinancials,
      manageSettings: !!row.canManageSettings,
    },
  };
}

// "viewer" (default) just means "signed in" — matches the old shared-viewer-
// passcode tier. "admin" requires the one true administrator. Anything else
// must name a PERMISSION_COLUMNS key; admins always pass regardless, since
// full access is what "administrator" means.
export function requireAuth(permission = "viewer") {
  return (req, res, next) => {
    const token = req.cookies[COOKIE_NAME];
    const session = token && verifySession(token);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(session.userId);
    if (!row) return res.status(401).json({ error: "Not authenticated" });

    const user = userFromRow(row);

    if (permission === "admin" && !user.isAdmin) {
      return res.status(403).json({ error: "Administrator access required" });
    }
    if (permission !== "viewer" && permission !== "admin" && !user.isAdmin) {
      const column = PERMISSION_COLUMNS[permission];
      if (!column || !user.permissions[permission]) {
        return res.status(403).json({ error: "You don't have permission to do that" });
      }
    }

    req.user = user;
    next();
  };
}
