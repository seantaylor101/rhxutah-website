// House measuring (step 1): the wall map and photo capture. A lead gets one
// measurement project — the roof outline from Google's building data (or
// adjusted by hand), the overhang, and which side is the front — and the
// photos shot around the house, each auto-assigned to the wall it shows.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  buildHouseModel,
  assignShots,
  matchWall,
  wallRef,
  cleanOutline,
  toLocal,
  toLatLng,
  centroidLatLng,
  pickSatelliteZoom,
  SATELLITE_SIZE,
  SATELLITE_SCALE,
  DEFAULT_OVERHANG_IN,
  SLOT_KEYS,
  slotByKey,
  wallForSlot,
} from "../../../shared/houseGeometry.js";
import { googleConfigured, geocodeWithBuilding, roofFromSolar, fetchSatelliteImage } from "../measure/google.js";
import {
  measurePhotoUpload,
  processUpload,
  cleanSensors,
  sensorsWithExif,
  MEASURE_PHOTOS_DIR,
  SAFE_MEASURE_FILENAME,
} from "../measure/photos.js";

const router = Router();

function leadOr404(id, res) {
  const row = db.prepare(`SELECT id, name, address FROM leads WHERE id = ?`).get(id);
  if (!row) res.status(404).json({ error: "Lead not found" });
  return row || null;
}

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function loadProject(leadId) {
  const row = db.prepare(`SELECT * FROM measure_projects WHERE leadId = ?`).get(leadId);
  if (!row) return null;
  return { address: row.address, updatedAt: row.updatedAt, ...parseJson(row.data, {}) };
}

function saveProject(leadId, address, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO measure_projects (leadId, address, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(leadId) DO UPDATE SET address = excluded.address, data = excluded.data, updatedAt = excluded.updatedAt`,
  ).run(leadId, address || "", JSON.stringify(data), now, now);
}

function photoRows(leadId) {
  return db.prepare(`SELECT * FROM measure_photos WHERE leadId = ? ORDER BY capturedAt ASC, createdAt ASC`).all(leadId);
}

const isGuided = (slot) => !!slotByKey(slot);

function photoToJson(p) {
  return {
    id: p.id,
    clientId: p.clientId,
    url: `/api/measure/photos/${p.filename}`,
    width: p.width,
    height: p.height,
    sensors: parseJson(p.sensors, {}),
    exif: parseJson(p.exif, {}),
    wallId: p.wallId,
    assignMethod: p.assignMethod,
    assignConfidence: p.assignConfidence,
    slot: p.slot || null,
    needsReview: !isGuided(p.slot) && p.assignMethod !== "manual" && (p.wallId == null || (p.assignConfidence ?? 0) < 0.7),
    capturedAt: p.capturedAt,
    createdAt: p.createdAt,
  };
}

// Re-runs automatic wall assignment for every photo on the lead that wasn't
// pinned by hand, and re-finds the wall for ones that were (wall numbers can
// shift when the outline is edited). Cheap — a house has a few dozen photos.
function reassignAll(leadId) {
  const model = buildHouseModel(loadProject(leadId));
  const rows = photoRows(leadId);
  const update = db.prepare(`UPDATE measure_photos SET wallId = ?, assignMethod = ?, assignConfidence = ?, wallRef = ? WHERE id = ?`);
  if (!model) {
    db.transaction(() => {
      for (const r of rows) if (r.assignMethod !== "manual") update.run(null, null, null, null, r.id);
    })();
    return;
  }
  const shots = rows.map((r) => {
    let manualWallId = null;
    if (r.assignMethod === "manual") {
      const ref = parseJson(r.wallRef, null);
      const w = ref ? matchWall(model, ref) : null;
      manualWallId = w ? w.id : null;
    }
    return { key: r.id, sensors: parseJson(r.sensors, {}), manualWallId, wasManual: r.assignMethod === "manual", slot: r.slot };
  });
  const result = assignShots(model, shots);
  // a guided shot's slot outranks the sensors: it's the wall the slot names
  // (the sensed one if that's on the right side of the house)
  for (const s of shots) {
    if (s.wasManual && s.manualWallId) continue;
    if (!isGuided(s.slot)) continue;
    const wallId = wallForSlot(model, s.slot, result[s.key]?.wallId);
    if (wallId) result[s.key] = { wallId, confidence: 1, needsReview: false, slot: true };
  }
  db.transaction(() => {
    for (const s of shots) {
      const a = result[s.key];
      // a hand-picked wall that no longer exists after an outline edit drops
      // back to automatic rather than pointing at a wall that isn't there
      const manual = s.wasManual && s.manualWallId;
      update.run(
        a?.wallId ?? null,
        manual ? "manual" : a?.slot ? "slot" : a?.wallId ? "auto" : null,
        a?.wallId ? a.confidence : null,
        a?.wallId ? JSON.stringify(wallRef(model, a.wallId)) : null,
        s.key,
      );
    }
  })();
}

function payload(leadId) {
  const project = loadProject(leadId);
  return {
    googleConfigured: googleConfigured(),
    project,
    model: buildHouseModel(project),
    photos: photoRows(leadId).map(photoToJson),
  };
}

router.get("/lead/:leadId", requireAuth("viewer"), (req, res) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  res.json(payload(lead.id));
});

// Address → building outline (squared up), front door side, roof pitch.
// Re-running it replaces the outline, so the client confirms before redoing
// one that's been hand-adjusted.
router.post("/lead/:leadId/lookup", requireAuth("viewer"), async (req, res, next) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  if (!googleConfigured()) return res.status(503).json({ error: "Google Maps isn't set up yet (GOOGLE_MAPS_API_KEY)" });
  const address = String(req.body?.address || lead.address || "").trim().slice(0, 300);
  if (!address) return res.status(400).json({ error: "Add the job's address first" });

  try {
    const geo = await geocodeWithBuilding(address);
    let roofOutline;
    let source;
    if (geo.outline) {
      const origin = centroidLatLng(geo.outline);
      const cleaned = cleanOutline(geo.outline.map(([lat, lng]) => toLocal(origin, lat, lng)));
      roofOutline = cleaned.map(([x, y]) => {
        const ll = toLatLng(origin, x, y);
        return [ll.lat, ll.lng];
      });
      source = "google-building-outline";
    } else {
      // no outline on file for this address — start from a placeholder box
      // on the pin that gets dragged onto the roof by hand
      const o = geo.location;
      roofOutline = [
        [-6, -5],
        [6, -5],
        [6, 5],
        [-6, 5],
      ].map(([x, y]) => {
        const ll = toLatLng(o, x, y);
        return [ll.lat, ll.lng];
      });
      source = "placeholder";
    }

    const center = centroidLatLng(roofOutline);
    const roof = await roofFromSolar(center.lat, center.lng);
    const draft = { roofOutline, overhangIn: DEFAULT_OVERHANG_IN, frontAz: null };
    let frontAz = null;
    if (geo.entrance) {
      // the front is the wall the main entrance is on
      const m = buildHouseModel(draft);
      const p = toLocal(m.origin, geo.entrance.lat, geo.entrance.lng);
      let best = null;
      let bestD = Infinity;
      for (const w of m.walls) {
        const ab = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
        const t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * ab[0] + (p[1] - w.a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
        const d = Math.hypot(p[0] - (w.a[0] + ab[0] * t), p[1] - (w.a[1] + ab[1] * t));
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
      if (best && bestD < 8) frontAz = best.normalAz;
    }

    const prev = loadProject(lead.id) || {};
    saveProject(lead.id, geo.formattedAddress || address, {
      source,
      roofOutline,
      overhangIn: prev.overhangIn ?? DEFAULT_OVERHANG_IN,
      frontAz,
      entrance: geo.entrance,
      roof,
      satellite: { ...center, zoom: pickSatelliteZoom(roofOutline) },
      lookedUpAt: new Date().toISOString(),
    });
    reassignAll(lead.id);
    res.json(payload(lead.id));
  } catch (err) {
    if (err.expose) return res.status(400).json({ error: err.message });
    if (err.name === "TimeoutError") return res.status(504).json({ error: "Google took too long to answer — try again" });
    next(err);
  }
});

function validLatLngRing(ring) {
  return (
    Array.isArray(ring) &&
    ring.length >= 3 &&
    ring.length <= 60 &&
    ring.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 90 &&
        Math.abs(p[1]) <= 180,
    )
  );
}

// hand edits to the outline / overhang / front side. Partial: only the
// fields sent change.
router.put("/lead/:leadId/outline", requireAuth("viewer"), (req, res) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  const body = req.body || {};
  const prev = loadProject(lead.id);
  if (!prev && !("roofOutline" in body)) return res.status(400).json({ error: "Look up the address first" });
  const next = { ...(prev || {}) };
  delete next.address;
  delete next.updatedAt;

  if ("roofOutline" in body) {
    if (!validLatLngRing(body.roofOutline)) return res.status(400).json({ error: "Outline needs 3–60 corners" });
    // everything within a few hundred meters of itself — guards against a
    // corner dragged or typed somewhere absurd
    const c = centroidLatLng(body.roofOutline);
    if (body.roofOutline.some(([lat, lng]) => Math.hypot(...toLocal(c, lat, lng)) > 150)) {
      return res.status(400).json({ error: "Outline is too spread out to be one house" });
    }
    next.roofOutline = body.roofOutline;
    next.source = next.source === "placeholder" || !next.source ? "manual" : `${next.source}+edited`;
    if (!next.satellite) next.satellite = { ...c, zoom: pickSatelliteZoom(body.roofOutline) };
  }
  if ("overhangIn" in body) {
    const n = Number(body.overhangIn);
    if (!Number.isFinite(n) || n < 0 || n > 48) return res.status(400).json({ error: "Overhang must be 0–48 inches" });
    next.overhangIn = n;
  }
  if ("frontAz" in body) {
    if (body.frontAz === null) next.frontAz = null;
    else {
      const n = Number(body.frontAz);
      if (!Number.isFinite(n)) return res.status(400).json({ error: "Invalid front direction" });
      next.frontAz = ((n % 360) + 360) % 360;
    }
  }
  saveProject(lead.id, prev?.address || lead.address, next);
  reassignAll(lead.id);
  res.json(payload(lead.id));
});

// proxied so the API key stays server-side; the phone caches it like any
// image, which is what lets the wall map still show on a dead-signal jobsite
router.get("/lead/:leadId/satellite.jpg", requireAuth("viewer"), async (req, res, next) => {
  const project = loadProject(req.params.leadId);
  if (!project?.satellite || !googleConfigured()) return res.status(404).end();
  try {
    const img = await fetchSatelliteImage(project.satellite, SATELLITE_SIZE, SATELLITE_SCALE);
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "private, max-age=604800");
    res.send(img);
  } catch (err) {
    if (err.name === "TimeoutError") return res.status(504).end();
    next(err);
  }
});

// one photo per request: the phone's offline queue sends them one at a
// time and retries, so each needs to succeed or fail on its own
router.post("/lead/:leadId/photos", requireAuth("viewer"), (req, res, next) => {
  measurePhotoUpload.single("photo")(req, res, async (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Photo is too large (25MB max)" : "Couldn't upload that photo";
      return res.status(400).json({ error: message });
    }
    const file = req.file;
    const cleanup = () => file && fs.unlink(file.path, () => {});
    try {
      const lead = leadOr404(req.params.leadId, res);
      if (!lead) return cleanup();
      if (!file) return res.status(400).json({ error: "No photo given" });

      const clientId = String(req.body?.clientId || "").trim();
      if (!/^[0-9a-zA-Z-]{8,64}$/.test(clientId)) {
        cleanup();
        return res.status(400).json({ error: "Missing photo id" });
      }
      const existing = db.prepare(`SELECT leadId FROM measure_photos WHERE clientId = ?`).get(clientId);
      if (existing) {
        // already got this one on an earlier try whose response never made
        // it back to the phone
        cleanup();
        if (existing.leadId !== lead.id) return res.status(409).json({ error: "Photo belongs to another lead" });
        return res.json(payload(lead.id));
      }

      const processed = await processUpload(file);
      const sensors = sensorsWithExif(cleanSensors(parseJson(req.body?.sensors, {})), processed.exif);
      if (!sensors.imageWidth && processed.width) {
        sensors.imageWidth = processed.width;
        sensors.imageHeight = processed.height;
      }
      const lockedWallId = typeof req.body?.wallId === "string" && /^W\d{1,3}$/.test(req.body.wallId) ? req.body.wallId : null;
      const slot = SLOT_KEYS.has(req.body?.slot) ? req.body.slot : null;
      const model = buildHouseModel(loadProject(lead.id));
      const ref = lockedWallId && model ? wallRef(model, lockedWallId) : null;

      db.prepare(
        `INSERT INTO measure_photos (id, leadId, clientId, filename, width, height, sensors, exif, wallId, assignMethod, wallRef, capturedAt, createdAt, slot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        lead.id,
        clientId,
        processed.filename,
        processed.width,
        processed.height,
        JSON.stringify(sensors),
        JSON.stringify(processed.exif),
        ref ? lockedWallId : null,
        ref ? "manual" : null,
        ref ? JSON.stringify(ref) : null,
        sensors.capturedAt,
        new Date().toISOString(),
        slot,
      );
      reassignAll(lead.id);
      res.status(201).json(payload(lead.id));
    } catch (e) {
      cleanup();
      next(e);
    }
  });
});

// pin a photo to a wall by hand (wallId), or hand it back to automatic
// assignment (wallId: null)
router.patch("/photos/:id", requireAuth("viewer"), (req, res) => {
  const photo = db.prepare(`SELECT * FROM measure_photos WHERE id = ?`).get(req.params.id);
  if (!photo) return res.status(404).json({ error: "Photo not found" });
  if ("slot" in (req.body || {})) {
    // which walk-around shot this is (or "extra") — picking a slot hands
    // the wall choice back to the slot
    const slot = req.body.slot === null ? null : String(req.body.slot);
    if (slot !== null && !SLOT_KEYS.has(slot)) return res.status(400).json({ error: "Unknown shot" });
    db.prepare(`UPDATE measure_photos SET slot = ?, assignMethod = NULL, wallRef = NULL WHERE id = ?`).run(slot, photo.id);
    if (!("wallId" in req.body)) {
      reassignAll(photo.leadId);
      return res.json(payload(photo.leadId));
    }
  }
  const wallId = req.body?.wallId;
  if (wallId === null) {
    db.prepare(`UPDATE measure_photos SET assignMethod = NULL, wallRef = NULL WHERE id = ?`).run(photo.id);
  } else {
    const model = buildHouseModel(loadProject(photo.leadId));
    const ref = typeof wallId === "string" && model ? wallRef(model, wallId) : null;
    if (!ref) return res.status(400).json({ error: "Unknown wall" });
    db.prepare(`UPDATE measure_photos SET wallId = ?, assignMethod = 'manual', assignConfidence = 1, wallRef = ? WHERE id = ?`).run(
      wallId,
      JSON.stringify(ref),
      photo.id,
    );
  }
  reassignAll(photo.leadId);
  res.json(payload(photo.leadId));
});

router.delete("/photos/:id", requireAuth("owner"), (req, res) => {
  const photo = db.prepare(`SELECT * FROM measure_photos WHERE id = ?`).get(req.params.id);
  if (!photo) return res.status(404).json({ error: "Photo not found" });
  db.prepare(`DELETE FROM measure_photos WHERE id = ?`).run(photo.id);
  reassignAll(photo.leadId);
  res.json(payload(photo.leadId));
  fs.unlink(path.join(MEASURE_PHOTOS_DIR, photo.filename), () => {});
});

router.get("/photos/:filename", requireAuth("viewer"), (req, res) => {
  const { filename } = req.params;
  if (!SAFE_MEASURE_FILENAME.test(filename)) return res.status(400).end();
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(path.join(MEASURE_PHOTOS_DIR, filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// called when a lead is deleted
export function deleteMeasureDataForLead(leadId) {
  const files = db.prepare(`SELECT filename FROM measure_photos WHERE leadId = ?`).all(leadId);
  db.prepare(`DELETE FROM measure_photos WHERE leadId = ?`).run(leadId);
  db.prepare(`DELETE FROM measure_projects WHERE leadId = ?`).run(leadId);
  for (const f of files) fs.unlink(path.join(MEASURE_PHOTOS_DIR, f.filename), () => {});
}

export default router;
