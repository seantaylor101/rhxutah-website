import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { sendPushToUser, sendPushToTenantAdmins } from "../pushService.js";
import { warrantyPhotoUpload, WARRANTY_PHOTOS_DIR, SAFE_FILENAME } from "../uploads.js";
import { logMove } from "../activityLog.js";

const router = Router();

const STAGES = new Set(["reported", "scheduled", "resolved"]);
const EDITABLE_FIELDS = new Set(["name", "phone", "email", "issue", "createdAt"]);

function rowToWarranty(row, photos) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    leadId: row.lead_id,
    assignedPmId: row.assigned_pm_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    issue: row.issue,
    stage: row.stage,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    resolvedAt: row.resolved_at,
    photos: photos || [],
  };
}

async function photosFor(client, requestId) {
  const { rows } = await client.query(
    `SELECT id, created_at, filename, type FROM warranty_photos WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId]
  );
  return rows.map((p) => ({ id: p.id, createdAt: p.created_at, type: p.type, url: `/api/warranty/photos/${p.filename}` }));
}

async function hasAfterPhoto(client, requestId) {
  const { rows } = await client.query(
    `SELECT 1 FROM warranty_photos WHERE request_id = $1 AND type = 'after' LIMIT 1`,
    [requestId]
  );
  return rows.length > 0;
}

function canAccess(effective, row) {
  return effective.role === "tenant_admin" || row.assigned_pm_id === effective.userId;
}

async function getWarranty(client, id) {
  const { rows } = await client.query(`SELECT * FROM warranty_requests WHERE id = $1`, [id]);
  return rows[0] || null;
}

router.get("/", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const { rows } =
        effective.role === "tenant_admin"
          ? await client.query(`SELECT * FROM warranty_requests ORDER BY created_at DESC`)
          : await client.query(
              `SELECT * FROM warranty_requests WHERE assigned_pm_id = $1 ORDER BY created_at DESC`,
              [effective.userId]
            );
      const out = [];
      for (const row of rows) out.push(rowToWarranty(row, await photosFor(client, row.id)));
      res.json(out);
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    const { name, phone, email, issue, leadId, pmId } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });

    const assignedPmId = effective.role === "pm" ? effective.userId : pmId || null;
    const id = randomUUID();

    await withTenant(effective.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO warranty_requests (id, tenant_id, lead_id, assigned_pm_id, name, phone, email, issue, stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reported') RETURNING *`,
        [id, effective.tenantId, leadId || null, assignedPmId, String(name).trim(), String(phone || "").trim(), String(email || "").trim(), String(issue || "").trim()]
      );
      const row = rows[0];
      res.status(201).json(rowToWarranty(row, []));

      if (assignedPmId) {
        sendPushToUser(effective.tenantId, assignedPmId, {
          title: "New warranty request",
          body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
        }).catch((err) => console.error("warranty push notify failed:", err.message));
      } else {
        sendPushToTenantAdmins(effective.tenantId, {
          title: "New warranty request",
          body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
        }).catch((err) => console.error("warranty push notify failed:", err.message));
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/move", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    const { stage, revert, date } = req.body || {};
    if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });

    await withTenant(effective.tenantId, async (client) => {
      const row = await getWarranty(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Warranty request not found" });
      if (!canAccess(effective, row)) return res.status(403).json({ error: "Not your warranty ticket" });

      if (!revert && stage === "resolved" && !(await hasAfterPhoto(client, row.id))) {
        return res.status(400).json({ error: "Add at least one after-repair photo before marking this resolved" });
      }

      const ts = new Date().toISOString();
      const patch = { stage };
      if (revert) {
        if (stage !== "scheduled") patch.scheduledAt = null;
        patch.resolvedAt = null;
      } else if (stage === "scheduled") {
        if (date) {
          const parsed = new Date(`${date}T00:00:00.000Z`);
          if (isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid date" });
          patch.scheduledAt = parsed.toISOString();
        } else {
          patch.scheduledAt = ts;
        }
      } else if (stage === "resolved") {
        patch.resolvedAt = ts;
      }

      const column = { stage: "stage", scheduledAt: "scheduled_at", resolvedAt: "resolved_at" };
      const keys = Object.keys(patch);
      const setClauses = keys.map((k, i) => `${column[k]} = $${i + 2}`);
      await client.query(`UPDATE warranty_requests SET ${setClauses.join(", ")} WHERE id = $1`, [
        row.id,
        ...keys.map((k) => patch[k]),
      ]);

      const updated = await getWarranty(client, row.id);
      res.json(rowToWarranty(updated, await photosFor(client, row.id)));

      await logMove({
        tenantId: effective.tenantId,
        type: "warranty",
        entityId: row.id,
        entityName: row.name,
        fromStage: row.stage,
        toStage: stage,
        actorUserId: effective.userId,
      });

      if (!revert && stage === "resolved") {
        sendPushToTenantAdmins(effective.tenantId, {
          title: "Warranty request resolved",
          body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
        }).catch((err) => console.error("warranty resolved push notify failed:", err.message));
      }
    });
  } catch (err) {
    next(err);
  }
});

// Tenant-admin-only: edit ticket details, or (re)assign it to a PM -- mirrors the lead
// push/retrieve/reassign flow so admins keep the same override authority here.
router.patch("/:id", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getWarranty(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Warranty request not found" });

      const updates = {};
      for (const [key, value] of Object.entries(req.body || {})) {
        if (EDITABLE_FIELDS.has(key)) updates[key] = value;
      }
      if ("name" in updates) {
        updates.name = String(updates.name).trim();
        if (!updates.name) return res.status(400).json({ error: "Name can't be empty" });
      }
      if ("phone" in updates) updates.phone = String(updates.phone || "").trim();
      if ("email" in updates) updates.email = String(updates.email || "").trim();
      if ("issue" in updates) updates.issue = String(updates.issue || "").trim();
      if ("createdAt" in updates) {
        updates.created_at = updates.createdAt;
        delete updates.createdAt;
      }

      if (req.body && "pmId" in req.body) {
        if (req.body.pmId) {
          const check = await client.query(
            `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'pm' AND disabled_at IS NULL`,
            [req.body.pmId, effective.tenantId]
          );
          if (!check.rows.length) return res.status(400).json({ error: "PM not found in this tenant" });
        }
        updates.assigned_pm_id = req.body.pmId || null;
      }

      const keys = Object.keys(updates);
      if (!keys.length) return res.status(400).json({ error: "No editable fields given" });
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
      await client.query(`UPDATE warranty_requests SET ${setClauses.join(", ")} WHERE id = $1`, [
        row.id,
        ...keys.map((k) => updates[k]),
      ]);

      const updated = await getWarranty(client, row.id);
      res.json(rowToWarranty(updated, await photosFor(client, row.id)));

      if (updates.assigned_pm_id) {
        sendPushToUser(effective.tenantId, updates.assigned_pm_id, {
          title: "Warranty ticket assigned to you",
          body: `${updated.name}${updated.issue ? " — " + updated.issue : ""}`,
        }).catch((err) => console.error("warranty assign push failed:", err.message));
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/photos", requireAuth("tenant_admin", "pm"), (req, res, next) => {
  warrantyPhotoUpload.array("photos", 6)(req, res, async (err) => {
    try {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? "Photo is too large (10MB max)" : "Couldn't upload those photos";
        return res.status(400).json({ error: message });
      }

      const { effective } = req;
      await withTenant(effective.tenantId, async (client) => {
        const row = await getWarranty(client, req.params.id);
        if (!row) return res.status(404).json({ error: "Warranty request not found" });
        if (!canAccess(effective, row)) return res.status(403).json({ error: "Not your warranty ticket" });

        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: "No image files given" });
        const type = req.body?.type === "after" ? "after" : "before";

        for (const f of files) {
          await client.query(
            `INSERT INTO warranty_photos (id, tenant_id, request_id, filename, type) VALUES ($1, $2, $3, $4, $5)`,
            [randomUUID(), effective.tenantId, row.id, f.filename, type]
          );
        }
        res.status(201).json(rowToWarranty(row, await photosFor(client, row.id)));
      });
    } catch (e) {
      next(e);
    }
  });
});

router.delete("/:id/photos/:photoId", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getWarranty(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Warranty request not found" });
      const { rows } = await client.query(
        `SELECT * FROM warranty_photos WHERE id = $1 AND request_id = $2`,
        [req.params.photoId, row.id]
      );
      const photo = rows[0];
      if (!photo) return res.status(404).json({ error: "Photo not found" });

      await client.query(`DELETE FROM warranty_photos WHERE id = $1`, [photo.id]);
      res.json(rowToWarranty(row, await photosFor(client, row.id)));
      fs.unlink(path.join(WARRANTY_PHOTOS_DIR, photo.filename), () => {});
    });
  } catch (err) {
    next(err);
  }
});

router.get("/photos/:filename", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { filename } = req.params;
    if (!SAFE_FILENAME.test(filename)) return res.status(400).end();
    const { effective } = req;

    await withTenant(effective.tenantId, async (client) => {
      // Photos are stored in one shared directory (see uploads.js), so this DB check --
      // does a warranty_photos row with this filename exist in MY tenant, on a request
      // I'm allowed to see -- is the actual tenant/PM isolation boundary for the file.
      const { rows } = await client.query(
        `SELECT wp.request_id, wr.assigned_pm_id FROM warranty_photos wp
         JOIN warranty_requests wr ON wr.id = wp.request_id
         WHERE wp.filename = $1 AND wp.tenant_id = $2`,
        [filename, effective.tenantId]
      );
      const photo = rows[0];
      if (!photo || !canAccess(effective, { assigned_pm_id: photo.assigned_pm_id })) return res.status(404).end();

      res.sendFile(path.join(WARRANTY_PHOTOS_DIR, filename), (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getWarranty(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Warranty request not found" });
      const { rows: photos } = await client.query(`SELECT filename FROM warranty_photos WHERE request_id = $1`, [row.id]);
      await client.query(`DELETE FROM warranty_requests WHERE id = $1`, [row.id]);
      res.status(204).end();
      for (const p of photos) fs.unlink(path.join(WARRANTY_PHOTOS_DIR, p.filename), () => {});
    });
  } catch (err) {
    next(err);
  }
});

export default router;
