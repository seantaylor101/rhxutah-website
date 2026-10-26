// Builds a measurement report for one lead in the background: Claude marks
// up each photo (cached per photo), then shared/facadeGeometry.js turns the
// markups + satellite wall widths into wall heights, areas, openings and
// siding squares. Progress is written to the report row as it goes so the
// phone can show it.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { slotByKey } from "../../../shared/houseGeometry.js";
import { buildFacadeReport } from "../../../shared/facadeGeometry.js";
import { markUpPhoto, prepareImage, visionContext, cacheKey, zoomCrop, mapFaceBack, wallListText, VISION_MODEL, PROMPT_VERSION } from "./vision.js";
import { MEASURE_PHOTOS_DIR } from "./photos.js";

const CONCURRENCY = 3;
const MAX_PHOTOS = 24;

const running = new Map(); // leadId → reportId

function parse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function latestReport(leadId) {
  const row = db.prepare(`SELECT * FROM measure_reports WHERE leadId = ? ORDER BY createdAt DESC LIMIT 1`).get(leadId);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    progress: parse(row.progress, {}),
    result: row.result ? parse(row.result, null) : null,
    error: row.error,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

// guided shots first, in walking order, then extras — so if the cap bites,
// it's extras that get left out
function pickPhotos(rows) {
  const rank = (r) => (slotByKey(r.slot) ? 0 : 1);
  return rows
    .filter((r) => /\.(jpe?g|png)$/i.test(r.filename))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_PHOTOS);
}

async function markUpOne(photo, model, markUp) {
  const sensors = parse(photo.sensors, {});
  const exif = parse(photo.exif, {});
  const slot = slotByKey(photo.slot);
  const ctx = visionContext(model, photo, slot);
  const wallIds = model.walls.filter((w) => ctx.sides.includes(w.side)).map((w) => w.id);
  const key = cacheKey(ctx.text, wallIds);
  const base = {
    photoId: photo.id,
    slot: photo.slot || "extra",
    slotKind: slot ? slot.kind : "extra",
    focal35: exif.focalLength35mm ?? null,
    lens: sensors.lens || exif.lensModel || null,
  };

  const filePath = path.join(MEASURE_PHOTOS_DIR, photo.filename);
  const save = (imageWidth, imageHeight, markup, cost) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO measure_photo_markups (photoId, cacheKey, imageWidth, imageHeight, markup, costUsd, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(photo.id, key, imageWidth, imageHeight, JSON.stringify(markup), cost, new Date().toISOString());

  let imageWidth;
  let imageHeight;
  let markup;
  let cost = 0;
  let prevCost = 0;
  const cached = db.prepare(`SELECT * FROM measure_photo_markups WHERE photoId = ? AND cacheKey = ?`).get(photo.id, key);
  if (cached) {
    imageWidth = cached.imageWidth;
    imageHeight = cached.imageHeight;
    markup = parse(cached.markup, { faces: [] });
    prevCost = cached.costUsd || 0;
  } else {
    const image = await prepareImage(filePath);
    const { cost: c = 0, ...keep } = await markUp({ image, contextText: ctx.text, wallIds });
    imageWidth = image.width;
    imageHeight = image.height;
    markup = keep;
    cost += c;
    save(imageWidth, imageHeight, markup, prevCost + cost);
  }

  // second, zoomed-in look at each of the photo's main walls (up to 3,
  // biggest first) for more precise corners and openings
  if (markup.usable && !markup.zoomed) {
    const span = (f) => {
      const c = f.corners || {};
      const p = [c.baseLeft, c.baseRight, c.topLeft, c.topRight].filter(Boolean);
      if (p.length < 4) return 0;
      return (Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x))) * (Math.max(...p.map((q) => q.y)) - Math.min(...p.map((q) => q.y)));
    };
    const targets = (markup.faces || [])
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => model.walls.some((w) => w.id === f.wallId))
      .sort((a, b) => span(b.f) - span(a.f))
      .slice(0, 3);
    const faces = [...(markup.faces || [])];
    for (const { f, i } of targets) {
      try {
        const crop = await zoomCrop(filePath, { width: imageWidth, height: imageHeight }, f);
        if (!crop) continue;
        const wall = model.walls.find((w) => w.id === f.wallId);
        const line = wallListText(model, [wall.side]).split("\n").find((l) => l.trim().startsWith(`${wall.id}:`)) || "";
        const zoomText = `This crop shows wall ${wall.id} (${wall.label}), from ${ctx.text.split("\n")[0].replace(/^This photo is /, "a photo that is ")}\n${line.trim()}\nMark only ${wall.id}.`;
        const { cost: c = 0, ...z } = await markUp({ image: crop.image, contextText: zoomText, wallIds: [wall.id], zoom: true });
        cost += c;
        const zf = (z.faces || []).find((x) => x.wallId === wall.id);
        if (z.usable && zf) faces[i] = { ...mapFaceBack(zf, crop.back), zoomed: true };
      } catch {
        // keep the first look for this wall
      }
    }
    markup = { ...markup, faces, zoomed: true };
    save(imageWidth, imageHeight, markup, prevCost + cost);
  }
  return { ...base, imageWidth, imageHeight, ...markup, cost, cached: !!cached && cost === 0 };
}

// Starts a report and returns its id right away; the work continues in the
// background. One report per lead at a time.
export function startReport({ leadId, project, model, photoRows, markUp = markUpPhoto }) {
  if (running.has(leadId)) return running.get(leadId);
  const photos = pickPhotos(photoRows);
  const id = randomUUID();
  db.prepare(`INSERT INTO measure_reports (id, leadId, status, progress, createdAt) VALUES (?, ?, 'running', ?, ?)`).run(
    id,
    leadId,
    JSON.stringify({ done: 0, total: photos.length }),
    new Date().toISOString(),
  );
  running.set(leadId, id);

  (async () => {
    const analyses = new Array(photos.length);
    const failures = [];
    let done = 0;
    let cost = 0;
    let next = 0;
    const setProgress = () =>
      db.prepare(`UPDATE measure_reports SET progress = ?, costUsd = ? WHERE id = ?`).run(JSON.stringify({ done, total: photos.length }), cost, id);

    const worker = async () => {
      while (next < photos.length) {
        const i = next++;
        try {
          analyses[i] = await markUpOne(photos[i], model, markUp);
          cost += analyses[i].cost || 0;
          if (!analyses[i].usable) failures.push({ photoId: photos[i].id, reason: analyses[i].notes || "Not usable" });
        } catch (err) {
          failures.push({ photoId: photos[i].id, reason: err.message || "Markup failed" });
        }
        done++;
        setProgress();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, photos.length) }, worker));
      const usable = analyses.filter((a) => a && a.usable);
      const roofAreaFt2 = project.roof?.segments?.length
        ? project.roof.segments.reduce((s, x) => s + (x.areaM2 || 0), 0) * 10.7639
        : null;
      const report = buildFacadeReport(model, usable, { pitch12: model.pitch12, roofAreaFt2 });
      const photoInfo = Object.fromEntries(
        photos.map((p, i) => [
          p.id,
          {
            url: `/api/measure/photos/${p.filename}`,
            slot: p.slot || "extra",
            imageWidth: analyses[i]?.imageWidth || null,
            imageHeight: analyses[i]?.imageHeight || null,
            notes: analyses[i]?.notes || "",
          },
        ]),
      );
      const result = {
        ...report,
        photos: photoInfo,
        failures,
        meta: { model: VISION_MODEL, promptVersion: PROMPT_VERSION, photosUsed: usable.length, photosTotal: photos.length, address: project.address || "" },
      };
      db.prepare(`UPDATE measure_reports SET status = 'done', result = ?, costUsd = ?, finishedAt = ? WHERE id = ?`).run(
        JSON.stringify(result),
        cost,
        new Date().toISOString(),
        id,
      );
    } catch (err) {
      console.error("measure report failed", err);
      db.prepare(`UPDATE measure_reports SET status = 'error', error = ?, costUsd = ?, finishedAt = ? WHERE id = ?`).run(
        err.message || "Report failed",
        cost,
        new Date().toISOString(),
        id,
      );
    } finally {
      running.delete(leadId);
    }
  })();

  return id;
}
