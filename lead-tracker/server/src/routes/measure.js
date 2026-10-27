// House measuring (step 1): the wall map and photo capture. A lead gets one
// measurement project — the roof outline from Google's building data (or
// adjusted by hand), the overhang, and which side is the front — and the
// photos shot around the house, each auto-assigned to the wall it shows.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  buildHouseModel,
  assignShots,
  matchWall,
  wallRef,
  cleanOutline,
  suggestUpperOutline,
  toLocal,
  toLatLng,
  centroidLatLng,
  pickSatelliteZoom,
  SATELLITE_SIZE,
  SATELLITE_SCALE,
  DEFAULT_OVERHANG_IN,
  SLOT_KEYS,
  slotByKey,
  GUIDED_SLOTS,
  wallForSlot,
} from "../../../shared/houseGeometry.js";
import { googleConfigured, geocodeWithBuilding, roofFromSolar, fetchSatelliteImage } from "../measure/google.js";
import { fetchHeightGrid } from "../measure/dsm.js";
import { detectLevels } from "../../../shared/levels.js";
import { createZipWriter } from "../measure/zip.js";
import { startReport, latestReport } from "../measure/report.js";
import { anthropicConfigured } from "../measure/vision.js";
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
const GUIDED_SLOT_ORDER = GUIDED_SLOTS.map((g) => g.key);

const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// older rows from before duplicate checking: hash what's on disk once
(function backfillHashes() {
  const rows = db.prepare(`SELECT id, filename FROM measure_photos WHERE contentHash IS NULL`).all();
  const set = db.prepare(`UPDATE measure_photos SET contentHash = ? WHERE id = ?`);
  for (const r of rows) {
    try {
      set.run(hashFile(path.join(MEASURE_PHOTOS_DIR, r.filename)), r.id);
    } catch {
      // file missing — nothing to compare against
    }
  }
})();

// below this on the long side, a photo can't be measured precisely (a pixel
// on a far wall is inches) — usually a resized copy, not the original
const LOW_RES_PX = 1600;

function photoToJson(p) {
  return {
    id: p.id,
    clientId: p.clientId,
    url: `/api/measure/photos/${p.filename}`,
    width: p.width,
    height: p.height,
    lowRes: !!(p.width && p.height && Math.max(p.width, p.height) < LOW_RES_PX),
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

// the last raw height map per house, kept for the export so a house the
// automatic levels got wrong can be looked into
const heightMapFile = (leadId, kind) => path.join(MEASURE_PHOTOS_DIR, `heightmap-${leadId}-${kind}.tif`);
function keepHeightMap(leadId, files) {
  for (const kind of ["dsm", "mask"]) {
    try {
      if (files?.[kind]) fs.writeFileSync(heightMapFile(leadId, kind), files[kind]);
      else fs.rmSync(heightMapFile(leadId, kind), { force: true });
    } catch (err) {
      console.error("couldn't keep height map", err.message);
    }
  }
}

const ringToLatLng = (origin, ring) =>
  ring.map(([x, y]) => {
    const ll = toLatLng(origin, x, y);
    return [ll.lat, ll.lng];
  });

// Finds the house's levels from Google's roof height map (shared/levels.js)
// and saves them: the second story's outline (or none for a one-story
// house), and a tighter building outline when the roof itself shows Google's
// outline was off. Doesn't override what was set by hand — an outline that
// was dragged keeps its corners, a hand-placed upper story stays put — unless
// `reset` (the "redo automatically" button). When it can't tell, it saves
// the reason so the app can say so.
async function autoLevels(leadId, { reset = false } = {}) {
  const project = loadProject(leadId);
  if (!project?.roofOutline || !googleConfigured()) return;
  const { address, updatedAt, ...next } = project;
  const origin = centroidLatLng(project.roofOutline);
  const ringLocal = project.roofOutline.map(([lat, lng]) => toLocal(origin, lat, lng));
  let levels;
  let diag = null;
  try {
    const hm = await fetchHeightGrid(origin, ringLocal);
    if (hm) {
      keepHeightMap(leadId, hm.files);
      diag = hm.diag;
    }
    const r = hm ? detectLevels(hm.grid, ringLocal) : { ok: false, reason: "Google has no roof height map for this house" };
    if (r.ok && diag) diag.detect = r.stats;
    if (!r.ok) levels = { count: null, reason: r.reason };
    else {
      levels = {
        count: r.levels,
        wholeHouse: r.wholeHouseTwoStory,
        upperShare: r.upperShare,
        tallestRoofFt: Math.round(r.maxRoofM * 3.28084 * 10) / 10,
        imageryDate: hm.imageryDate,
        imageryQuality: hm.imageryQuality,
        eaves: r.eaves.map((e) => ({ a: ringToLatLng(origin, [e.a])[0], b: ringToLatLng(origin, [e.b])[0], heightM: e.heightM, stories: e.stories })),
        // in the frame of `origin` (the outline's center when detected)
        roofSurface: { ...r.roofSurface, origin },
      };
      const byHand = !reset && /manual|edited/.test(project.source || "");
      if (r.roofRing && !byHand) {
        next.googleOutline = project.googleOutline || project.roofOutline;
        next.roofOutline = ringToLatLng(origin, r.roofRing);
        next.source = "height-map";
        levels.outlineFromHeightMap = true;
      }
      if (reset || next.upperSource !== "manual") {
        next.upperOutline = r.levels === 2 ? (r.wholeHouseTwoStory ? next.roofOutline : ringToLatLng(origin, r.upperRing)) : null;
        next.upperSource = "auto";
      }
    }
  } catch (err) {
    console.error("height map failed", err);
    if (err.heightMap) {
      keepHeightMap(leadId, err.heightMap.files);
      diag = err.heightMap.diag;
    } else diag = { error: err.message };
    levels = { count: null, reason: err.name === "TimeoutError" ? "Google's height map took too long to answer" : "Couldn't read Google's height map" };
  }
  next.levels = { ...levels, source: levels.count ? "height-map" : "none", detectedAt: new Date().toISOString(), diag };
  saveProject(leadId, address, next);
  reassignAll(leadId);
}

function reportSummary(leadId) {
  const r = latestReport(leadId);
  if (!r) return null;
  const { result, ...rest } = r;
  return { ...rest, hasResult: !!result };
}

function payload(leadId) {
  const project = loadProject(leadId);
  return {
    googleConfigured: googleConfigured(),
    anthropicConfigured: anthropicConfigured(),
    report: reportSummary(leadId),
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
    await autoLevels(lead.id);
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
  if ("upperOutline" in body) {
    // the second story's roof edge, traced inside the main outline (null = one level)
    if (body.upperOutline === null) next.upperOutline = null;
    else {
      if (!validLatLngRing(body.upperOutline)) return res.status(400).json({ error: "Upper outline needs 3–60 corners" });
      const c = centroidLatLng(next.roofOutline || body.upperOutline);
      if (body.upperOutline.some(([lat, lng]) => Math.hypot(...toLocal(c, lat, lng)) > 150)) {
        return res.status(400).json({ error: "Upper outline is too far from the house" });
      }
      next.upperOutline = body.upperOutline;
    }
    next.upperSource = "manual";
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

// re-reads Google's roof planes (pitch, heights, extents) without touching
// the outline — e.g. for a house looked up before plane heights were kept
router.post("/lead/:leadId/roof", requireAuth("viewer"), async (req, res, next) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  if (!googleConfigured()) return res.status(503).json({ error: "Google Maps isn't set up yet (GOOGLE_MAPS_API_KEY)" });
  const prev = loadProject(lead.id);
  if (!prev?.roofOutline) return res.status(400).json({ error: "Look up the address first" });
  try {
    const c = centroidLatLng(prev.roofOutline);
    const roof = await roofFromSolar(c.lat, c.lng);
    if (!roof) return res.status(404).json({ error: "Google has no roof data for this house" });
    const { address, updatedAt, ...data } = prev;
    saveProject(lead.id, address, { ...data, roof });
    await autoLevels(lead.id);
    res.json(payload(lead.id));
  } catch (err) {
    if (err.name === "TimeoutError") return res.status(504).json({ error: "Google took too long to answer — try again" });
    next(err);
  }
});

// finds the levels again from the height map; reset: true also replaces
// outline corners and an upper story that were placed by hand
router.post("/lead/:leadId/levels", requireAuth("viewer"), async (req, res, next) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  if (!googleConfigured()) return res.status(503).json({ error: "Google Maps isn't set up yet (GOOGLE_MAPS_API_KEY)" });
  if (!loadProject(lead.id)?.roofOutline) return res.status(400).json({ error: "Look up the address first" });
  try {
    await autoLevels(lead.id, { reset: !!req.body?.reset });
    res.json(payload(lead.id));
  } catch (err) {
    next(err);
  }
});

// a starting upper-story outline from the roof planes, to drag into place
router.get("/lead/:leadId/upper-suggestion", requireAuth("viewer"), (req, res) => {
  const project = loadProject(req.params.leadId);
  if (!project) return res.status(404).json({ error: "Look up the address first" });
  const roof = project.roof;
  res.json({
    upperOutline: suggestUpperOutline(project),
    precise: !!roof?.segments?.some((s) => s.bbox),
  });
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
      const contentHash = hashFile(path.join(MEASURE_PHOTOS_DIR, processed.filename));
      const dup = db.prepare(`SELECT id FROM measure_photos WHERE leadId = ? AND contentHash = ?`).get(lead.id, contentHash);
      if (dup) {
        fs.unlink(path.join(MEASURE_PHOTOS_DIR, processed.filename), () => {});
        return res.status(409).json({ error: "That photo is already on this house", duplicate: true });
      }
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
        `INSERT INTO measure_photos (id, leadId, clientId, filename, width, height, sensors, exif, wallId, assignMethod, wallRef, capturedAt, createdAt, slot, contentHash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        contentHash,
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
  db.prepare(`DELETE FROM measure_photo_markups WHERE photoId = ?`).run(photo.id);
  reassignAll(photo.leadId);
  res.json(payload(photo.leadId));
  fs.unlink(path.join(MEASURE_PHOTOS_DIR, photo.filename), () => {});
});

// Create report: Claude marks up the photos, the geometry measures them.
// Runs in the background; the phone polls GET .../report for progress.
router.post("/lead/:leadId/report", requireAuth("viewer"), async (req, res) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  if (!anthropicConfigured()) return res.status(503).json({ error: "Reports aren't set up yet (ANTHROPIC_API_KEY)" });
  // a house set up before levels were automatic: find them now
  if (!loadProject(lead.id)?.levels) await autoLevels(lead.id).catch(() => {});
  const project = loadProject(lead.id);
  const model = buildHouseModel(project);
  if (!model) return res.status(400).json({ error: "Set up the wall map first" });
  if (model.frontAz == null) return res.status(400).json({ error: "Set the front of the house on the wall map first" });
  const rows = photoRows(lead.id);
  if (!rows.length) return res.status(400).json({ error: "Take the walk-around photos first" });
  startReport({ leadId: lead.id, project, model, photoRows: rows });
  res.status(202).json(latestReport(lead.id));
});

router.get("/lead/:leadId/report", requireAuth("viewer"), (req, res) => {
  const lead = leadOr404(req.params.leadId, res);
  if (!lead) return;
  res.json(latestReport(lead.id));
});

// Everything captured for a lead in one zip: each photo (named by its
// walk-around shot), plus measurement.json with the wall map, the derived
// walls, and every photo's saved sensor readings / EXIF / shot / wall.
// For handing the raw capture to the measuring engine or to a person.
router.get("/lead/:leadId/export.zip", requireAuth("viewer"), (req, res) => {
  const lead = db.prepare(`SELECT id, name, address FROM leads WHERE id = ?`).get(req.params.leadId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const data = payload(lead.id);
  const order = new Map(GUIDED_SLOT_ORDER.map((k, i) => [k, i]));
  const rows = photoRows(lead.id).sort(
    (a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99) || String(a.capturedAt || a.createdAt).localeCompare(String(b.capturedAt || b.createdAt)),
  );
  const used = new Map();
  const files = rows.map((r) => {
    const ext = path.extname(r.filename).toLowerCase() || ".jpg";
    const pos = order.has(r.slot) ? String(order.get(r.slot) + 1).padStart(2, "0") : "x";
    const base = `${pos}-${r.slot || "extra"}`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return { row: r, zipName: `photos/${base}${n > 1 || !order.has(r.slot) ? `-${n}` : ""}${ext}` };
  });

  const safeName = (lead.name || "house").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "house";
  res.set("Content-Type", "application/zip");
  res.set("Content-Disposition", `attachment; filename="${safeName}-measure.zip"`);
  res.set("Cache-Control", "no-store");
  const zip = createZipWriter((buf) => res.write(buf));

  const json = {
    exportedAt: new Date().toISOString(),
    lead: { id: lead.id, name: lead.name, address: lead.address },
    project: data.project,
    model: data.model,
    photos: files.map(({ row, zipName }) => ({ file: zipName, ...photoToJson(row) })),
  };
  zip.add("measurement.json", Buffer.from(JSON.stringify(json, null, 2)));
  for (const { row, zipName } of files) {
    try {
      zip.add(zipName, fs.readFileSync(path.join(MEASURE_PHOTOS_DIR, row.filename)));
    } catch {
      // file missing on disk — the JSON still lists it
    }
  }
  for (const kind of ["dsm", "mask"]) {
    const f = heightMapFile(lead.id, kind);
    if (fs.existsSync(f)) zip.add(`heightmap/${kind}.tif`, fs.readFileSync(f));
  }
  zip.finish();
  res.end();
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
  db.prepare(`DELETE FROM measure_photo_markups WHERE photoId IN (SELECT id FROM measure_photos WHERE leadId = ?)`).run(leadId);
  db.prepare(`DELETE FROM measure_photos WHERE leadId = ?`).run(leadId);
  db.prepare(`DELETE FROM measure_projects WHERE leadId = ?`).run(leadId);
  db.prepare(`DELETE FROM measure_reports WHERE leadId = ?`).run(leadId);
  for (const f of files) fs.unlink(path.join(MEASURE_PHOTOS_DIR, f.filename), () => {});
  for (const kind of ["dsm", "mask"]) fs.unlink(heightMapFile(leadId, kind), () => {});
}

export default router;
