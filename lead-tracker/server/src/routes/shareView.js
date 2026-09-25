import { Router } from "express";
import path from "node:path";
import { db } from "../db.js";
import { parseJobDetails } from "../jobDetails.js";
import { JOB_MEDIA_DIR, SAFE_JOB_MEDIA_FILENAME } from "../uploads.js";

const router = Router();

// Deliberately unauthenticated — this is the subcontractor-facing side of a
// share link the owner issues per lead (see POST /api/leads/:id/share). The
// token is an unguessable 128-bit random string, not a session; anyone with
// the link can view this one job's instructions and photo/video references,
// nothing else (no customer contact info, no revenue, no other leads).
function leadForToken(token) {
  const share = db.prepare(`SELECT leadId FROM lead_shares WHERE token = ?`).get(token);
  if (!share) return null;
  return db.prepare(`SELECT * FROM leads WHERE id = ?`).get(share.leadId);
}

router.get("/:token", (req, res) => {
  const lead = leadForToken(req.params.token);
  if (!lead) return res.status(404).json({ error: "This link isn't valid" });

  const details = parseJobDetails(lead.jobDetails);
  const media = db
    .prepare(`SELECT id, filename, kind, createdAt FROM lead_media WHERE leadId = ? ORDER BY createdAt ASC`)
    .all(lead.id)
    .map((m) => ({ id: m.id, kind: m.kind, createdAt: m.createdAt, url: `/api/share/${req.params.token}/media/${m.filename}` }));

  res.json({
    job: lead.job || "",
    address: lead.address || "",
    instructions: details.instructions,
    equipment: details.equipment,
    media,
  });
});

router.get("/:token/media/:filename", (req, res) => {
  const lead = leadForToken(req.params.token);
  if (!lead) return res.status(404).end();

  const { filename } = req.params;
  if (!SAFE_JOB_MEDIA_FILENAME.test(filename)) return res.status(400).end();

  // token grants access to this lead's media only — a filename that's valid
  // but belongs to a different lead (e.g. guessed/reused from another link)
  // still 404s
  const owned = db.prepare(`SELECT 1 FROM lead_media WHERE leadId = ? AND filename = ?`).get(lead.id, filename);
  if (!owned) return res.status(404).end();

  res.sendFile(path.join(JOB_MEDIA_DIR, filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

export default router;
