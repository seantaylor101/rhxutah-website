import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, userFromRow } from "../middleware/requireAuth.js";
import { hashPassword } from "../passwords.js";

const router = Router();

const PERMISSION_FIELDS = {
  editLeads: "canEditLeads",
  editWarranty: "canEditWarranty",
  viewFinancials: "canViewFinancials",
  manageSettings: "canManageSettings",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/", requireAuth("admin"), (req, res) => {
  const rows = db.prepare(`SELECT * FROM users ORDER BY createdAt ASC`).all();
  res.json(rows.map(userFromRow));
});

router.post("/", requireAuth("admin"), (req, res) => {
  const { email, password, permissions } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: "Enter a valid email address" });
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
  if (existing) return res.status(400).json({ error: "That email already has an account" });

  const row = {
    id: randomUUID(),
    email: cleanEmail,
    passwordHash: hashPassword(password),
    isAdmin: 0,
    canEditLeads: permissions?.editLeads ? 1 : 0,
    canEditWarranty: permissions?.editWarranty ? 1 : 0,
    canViewFinancials: permissions?.viewFinancials ? 1 : 0,
    canManageSettings: permissions?.manageSettings ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO users (id, email, passwordHash, isAdmin, canEditLeads, canEditWarranty, canViewFinancials, canManageSettings, createdAt)
     VALUES (@id, @email, @passwordHash, @isAdmin, @canEditLeads, @canEditWarranty, @canViewFinancials, @canManageSettings, @createdAt)`
  ).run(row);

  res.status(201).json(userFromRow(row));
});

router.patch("/:id", requireAuth("admin"), (req, res) => {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Team member not found" });
  if (row.isAdmin) return res.status(400).json({ error: "Can't change the administrator's permissions" });

  const { permissions, password } = req.body || {};
  const updates = {};
  if (permissions && typeof permissions === "object") {
    for (const [key, column] of Object.entries(PERMISSION_FIELDS)) {
      if (key in permissions) updates[column] = permissions[key] ? 1 : 0;
    }
  }
  if (password !== undefined) {
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    updates.passwordHash = hashPassword(password);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No editable fields given" });
  }

  const fields = Object.keys(updates);
  db.prepare(`UPDATE users SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });

  res.json(userFromRow(db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.id)));
});

router.delete("/:id", requireAuth("admin"), (req, res) => {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Team member not found" });
  if (row.isAdmin) return res.status(400).json({ error: "Can't remove the administrator" });

  db.prepare(`DELETE FROM users WHERE id = ?`).run(row.id);
  res.status(204).end();
});

export default router;
