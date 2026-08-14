import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendPushToRole } from "../pushService.js";
import { warrantyPhotoUpload, WARRANTY_PHOTOS_DIR, SAFE_FILENAME } from "../uploads.js";

const router = Router();

const STAGES = new Set(["reported", "scheduled", "resolved"]);
const EDITABLE_FIELDS = new Set(["name", "phone", "email", "issue", "createdAt"]);

function photosFor(requestId) {
  return db
    .prepare(`SELECT id, createdAt, filename FROM warranty_photos WHERE requestId = ? ORDER BY createdAt ASC`)
    .all(requestId)
    .map((p) => ({ id: p.id, createdAt: p.createdAt, url: `/api/warranty/photos/${p.filename}` }));
}

function withPhotos(row) {
  return { ...row, photos: photosFor(row.id) };
}

router.get("/", requireAuth("viewer"), (req, res) => {
  const rows = db.prepare(`SELECT * FROM warranty_requests ORDER BY createdAt DESC`).all();
  res.json(rows.map(withPhotos));
});

router.post("/", requireAuth("owner"), (req, res) => {
  const { name, phone, email, issue } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });

  const row = {
    id: randomUUID(),
    name: String(name).trim(),
    phone: String(phone || "").trim(),
    email: String(email || "").trim(),
    issue: String(issue || "").trim(),
    stage: "reported",
    createdAt: new Date().toISOString(),
    scheduledAt: null,
    resolvedAt: null,
  };

  db.prepare(
    `INSERT INTO warranty_requests (id, name, phone, email, issue, stage, createdAt, scheduledAt, resolvedAt)
     VALUES (@id, @name, @phone, @email, @issue, @stage, @createdAt, @scheduledAt, @resolvedAt)`
  ).run(row);

  res.status(201).json(withPhotos(row));

  // best-effort — the request is already saved, don't let a push hiccup
  // affect the response
  sendPushToRole("viewer", {
    title: "New warranty request",
    body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
  }).catch((err) => console.error("warranty push notify failed:", err.message));
});

function getOr404(id, res) {
  const row = db.prepare(`SELECT * FROM warranty_requests WHERE id = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: "Warranty request not found" });
    return null;
  }
  return row;
}

// viewer-level so both roles can move a request through the pipeline —
// adding, editing, and deleting requests stay owner-only below
router.post("/:id/move", requireAuth("viewer"), (req, res) => {
  const { stage, revert } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });
  const row = getOr404(req.params.id, res);
  if (!row) return;

  const ts = new Date().toISOString();
  const patch = { stage };
  if (revert) {
    if (stage !== "scheduled") patch.scheduledAt = null;
    patch.resolvedAt = null;
  } else if (stage === "scheduled") {
    patch.scheduledAt = ts;
  } else if (stage === "resolved") {
    patch.resolvedAt = ts;
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE warranty_requests SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(withPhotos(db.prepare(`SELECT * FROM warranty_requests WHERE id = ?`).get(row.id)));

  // best-effort — the move is already saved, don't let a push hiccup affect
  // the response
  if (!revert && stage === "resolved") {
    sendPushToRole("owner", {
      title: "Warranty request resolved",
      body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
    }).catch((err) => console.error("warranty resolved push notify failed:", err.message));
  }
});

router.patch("/:id", requireAuth("owner"), (req, res) => {
  const row = getOr404(req.params.id, res);
  if (!row) return;

  const updates = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (EDITABLE_FIELDS.has(key)) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No editable fields given" });
  }
  if ("name" in updates) {
    updates.name = String(updates.name).trim();
    if (!updates.name) return res.status(400).json({ error: "Name can't be empty" });
  }
  if ("phone" in updates) updates.phone = String(updates.phone || "").trim();
  if ("email" in updates) updates.email = String(updates.email || "").trim();
  if ("issue" in updates) updates.issue = String(updates.issue || "").trim();

  const fields = Object.keys(updates);
  db.prepare(`UPDATE warranty_requests SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });

  res.json(withPhotos(db.prepare(`SELECT * FROM warranty_requests WHERE id = ?`).get(row.id)));
});

// any authenticated role can attach photos — field crew documenting a
// repair are just as likely to be on the viewer account as the owner is
router.post("/:id/photos", requireAuth("viewer"), (req, res) => {
  warrantyPhotoUpload.array("photos", 6)(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Photo is too large (10MB max)" : "Couldn't upload those photos";
      return res.status(400).json({ error: message });
    }

    const row = getOr404(req.params.id, res);
    if (!row) return;

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No image files given" });

    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO warranty_photos (id, requestId, filename, createdAt) VALUES (?, ?, ?, ?)`);
    const tx = db.transaction((uploaded) => {
      for (const f of uploaded) insert.run(randomUUID(), row.id, f.filename, now);
    });
    tx(files);

    res.status(201).json(withPhotos(row));
  });
});

// deleting a photo (not the whole request) stays owner-only, same tier as
// editing/deleting the request itself
router.delete("/:id/photos/:photoId", requireAuth("owner"), (req, res) => {
  const row = getOr404(req.params.id, res);
  if (!row) return;
  const photo = db
    .prepare(`SELECT * FROM warranty_photos WHERE id = ? AND requestId = ?`)
    .get(req.params.photoId, row.id);
  if (!photo) return res.status(404).json({ error: "Photo not found" });

  db.prepare(`DELETE FROM warranty_photos WHERE id = ?`).run(photo.id);
  res.json(withPhotos(row));

  fs.unlink(path.join(WARRANTY_PHOTOS_DIR, photo.filename), () => {});
});

router.get("/photos/:filename", requireAuth("viewer"), (req, res) => {
  const { filename } = req.params;
  if (!SAFE_FILENAME.test(filename)) return res.status(400).end();
  res.sendFile(path.join(WARRANTY_PHOTOS_DIR, filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

router.delete("/:id", requireAuth("owner"), (req, res) => {
  const row = getOr404(req.params.id, res);
  if (!row) return;
  const photos = db.prepare(`SELECT filename FROM warranty_photos WHERE requestId = ?`).all(row.id);
  db.prepare(`DELETE FROM warranty_photos WHERE requestId = ?`).run(row.id);
  db.prepare(`DELETE FROM warranty_requests WHERE id = ?`).run(row.id);
  res.status(204).end();

  for (const p of photos) fs.unlink(path.join(WARRANTY_PHOTOS_DIR, p.filename), () => {});
});

export default router;
