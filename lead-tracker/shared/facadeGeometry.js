// Turning marked-up photos into wall measurements. Shared by the server
// (which builds the report) and the client (which draws it).
//
// The idea: a wall section is a flat rectangle up to the eaves. In a photo
// taken from any angle, its four corners show up as a skewed quadrilateral.
// Given the camera's focal length, that quadrilateral pins down the true
// width-to-height ratio of the rectangle (Zhang & He, "Whiteboard scanning
// and image enhancement", 2007). The satellite outline already gives the
// wall's true width, so the ratio gives its height. A homography from the
// photo onto the now fully-known rectangle then measures anything else
// lying in the wall's plane: the gable peak, window and door corners,
// material boundaries.
//
// Plane coordinates are feet, x along the wall left→right as seen from
// outside, y up from the wall's base.

import { IN_PER_M } from "./houseGeometry.js";

const FT_PER_M = 3.28084;

// ---- small linear algebra ----

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// 3x3 homography taking src[i] → dst[i] (4 point pairs)
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
}

export function applyH(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- camera ----

// Focal length in pixels. Phones report a "35mm-equivalent" focal length,
// which describes the field of view across the long side of a 4:3 frame:
// f_px = f35 × longSide / 34.6 (34.6 mm = long side of 35mm-format's
// diagonal-matched 4:3 frame). Video frames from the in-app camera keep the
// sensor's width, so the same formula holds for them.
export function focalPx({ imageWidth, imageHeight, focal35, lens }) {
  const long = Math.max(imageWidth, imageHeight);
  let f35 = Number(focal35);
  if (!Number.isFinite(f35) || f35 <= 0) f35 = /ultra/i.test(lens || "") ? 13 : /tele/i.test(lens || "") ? 77 : 25;
  return (f35 * long) / 34.6;
}

// Width/height of the real rectangle whose image corners are
// bl, br, tl, tr, for a camera with focal length f and principal point
// (u0, v0). Also returns the focal length implied by the quad itself when
// the view is oblique enough to determine it (null otherwise).
export function rectangleAspect(bl, br, tl, tr, f, u0, v0) {
  const m1 = [bl[0], bl[1], 1];
  const m2 = [br[0], br[1], 1];
  const m3 = [tl[0], tl[1], 1];
  const m4 = [tr[0], tr[1], 1];
  const k2 = dot3(cross3(m1, m4), m3) / dot3(cross3(m2, m4), m3);
  const k3 = dot3(cross3(m1, m4), m2) / dot3(cross3(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return null;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

  let fSelf = null;
  const den = n2[2] * n3[2];
  if (Math.abs(den) > 1e-9) {
    const f2 =
      -(
        n2[0] * n3[0] -
        (n2[0] * n3[2] + n2[2] * n3[0]) * u0 +
        n2[2] * n3[2] * u0 * u0 +
        (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)
      ) / den;
    if (f2 > 0) fSelf = Math.sqrt(f2);
  }
  const norm = (n, ff) => ((n[0] - u0 * n[2]) ** 2 + (n[1] - v0 * n[2]) ** 2) / (ff * ff) + n[2] * n[2];
  const r2 = norm(n2, f) / norm(n3, f);
  if (!(r2 > 0)) return null;
  return { widthOverHeight: Math.sqrt(r2), fSelf };
}

// ---- one wall face in one photo ----

const P = (pt) => (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? [pt.x, pt.y] : null);

// Measures one marked-up wall face. `face` is what the vision step returned
// (pixel points as {x, y}); widthFt is the wall's true width from the
// satellite outline. Returns plane-coordinate geometry in feet, or a reason
// it couldn't be measured.
export function measureFace(face, widthFt, cam) {
  const c = face.corners || {};
  const bl = P(c.baseLeft);
  const br = P(c.baseRight);
  const tl = P(c.topLeft);
  const tr = P(c.topRight);
  if (!bl || !br || !tl || !tr) return { ok: false, reason: "missing corners" };
  if (!face.leftIsCorner || !face.rightIsCorner) return { ok: false, reason: "wall runs out of the photo" };

  const u0 = cam.imageWidth / 2;
  const v0 = cam.imageHeight / 2;
  // image y grows downward; flip so "up the wall" is +y like the plane
  const flip = ([x, y]) => [x, cam.imageHeight - y];
  const asp = rectangleAspect(flip(bl), flip(br), flip(tl), flip(tr), cam.f, u0, cam.imageHeight - v0);
  if (!asp) return { ok: false, reason: "corners don't form a usable rectangle" };
  const heightFt = widthFt / asp.widthOverHeight;
  if (!(heightFt > 3 && heightFt < 45)) return { ok: false, reason: `implausible height (${heightFt.toFixed(1)} ft)` };

  const H = homography([bl, br, tr, tl], [
    [0, 0],
    [widthFt, 0],
    [widthFt, heightFt],
    [0, heightFt],
  ]);
  if (!H) return { ok: false, reason: "degenerate corners" };
  const toPlane = (pt) => applyH(H, pt);

  const peakPt = face.peakVisible ? P(face.peak) : null;
  const peak = peakPt ? toPlane(peakPt) : null;

  const outline = [[0, 0], [widthFt, 0], [widthFt, heightFt]];
  if (peak && peak[1] > heightFt + 0.5) outline.push(peak);
  outline.push([0, heightFt]);

  const openings = (face.openings || [])
    .map((o) => {
      const pts = (o.corners || []).map(P);
      if (pts.length !== 4 || pts.some((p) => !p)) return null;
      const q = pts.map(toPlane); // TL, TR, BR, BL
      const width = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
      const height = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
      const cx = q.reduce((s, p) => s + p[0], 0) / 4;
      const cy = q.reduce((s, p) => s + p[1], 0) / 4;
      if (!(width > 0.5 && height > 0.5 && width < widthFt + 1 && height < heightFt + 30)) return null;
      return { type: o.type, arched: !!o.arched, plane: q, width, height, area: polygonArea(q), center: [cx, cy], image: pts };
    })
    .filter(Boolean);

  const regions = (face.materialRegions || [])
    .map((r) => {
      const pts = (r.polygon || []).map(P).filter(Boolean);
      if (pts.length < 3) return null;
      const q = pts.map(toPlane);
      return { material: r.material, plane: q, area: polygonArea(q), image: pts };
    })
    .filter(Boolean);

  // left and right edges of a wall seen square-on are the same height in
  // the photo; the more they differ, the more oblique (and less reliable)
  const lh = dist(bl, tl);
  const rh = dist(br, tr);
  const frontality = Math.min(lh, rh) / Math.max(lh, rh);

  return {
    ok: true,
    widthFt,
    heightFt,
    peak,
    outline,
    grossArea: polygonArea(outline),
    openings,
    regions,
    material: face.material || "siding",
    baseVisible: face.baseVisible !== false,
    frontality,
    fSelf: asp.fSelf,
    image: { bl, br, tl, tr, peak: peakPt },
  };
}

// ---- whole house ----

function weightedHeight(cands) {
  const top = cands[0].score;
  const use = cands.filter((c) => c.score >= top * 0.75);
  const wsum = use.reduce((s, c) => s + c.score ** 4, 0);
  return use.reduce((s, c) => s + c.heightFt * c.score ** 4, 0) / wsum;
}

// The camera's focal length for one photo: from EXIF when the phone's
// camera app recorded it (reliable); otherwise the lens's typical value,
// refined by what the angled walls in the photo imply about it (each
// oblique rectangle carries its own focal estimate) when those agree with
// the typical value within reason.
function cameraFocal(a, walls) {
  const base = focalPx(a);
  if (Number.isFinite(Number(a.focal35)) && Number(a.focal35) > 0) return base;
  const u0 = a.imageWidth / 2;
  const v0 = a.imageHeight / 2;
  const flip = (p) => [p.x, a.imageHeight - p.y];
  const est = [];
  for (const face of a.faces || []) {
    const c = face.corners || {};
    if (!walls.some((w) => w.id === face.wallId) || !face.leftIsCorner || !face.rightIsCorner) continue;
    if (![c.baseLeft, c.baseRight, c.topLeft, c.topRight].every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
    const lh = dist(P(c.baseLeft), P(c.topLeft));
    const rh = dist(P(c.baseRight), P(c.topRight));
    if (Math.min(lh, rh) / Math.max(lh, rh) > 0.85) continue; // too square-on to say anything about focal
    const r = rectangleAspect(flip(c.baseLeft), flip(c.baseRight), flip(c.topLeft), flip(c.topRight), base, u0, a.imageHeight - v0);
    if (r && r.fSelf && r.fSelf > base * 0.7 && r.fSelf < base * 1.4) est.push(r.fSelf);
  }
  return est.length ? median(est) : base;
}

export const SIDING_MATERIALS = new Set(["siding"]);
export const MATERIAL_LABEL = { siding: "Siding", stucco: "Stucco", brick: "Brick", stone: "Stone", other: "Other" };
const SLOT_WEIGHT = { side: 1, corner: 0.8, extra: 0.6 };

function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- opening sanity checks ----
//
// Claude finds openings; these rules catch the markups that can't be right
// before they're deducted. A failed check doesn't silently drop the opening
// — it's listed as "suspect" (shown, not deducted) so a person can look.
const OPENING_RULES = {
  garage_door: { w: [6.5, 20], h: [6, 10], maxBottom: 1.5, groundOnly: true },
  door: { w: [2, 7.5], h: [5.5, 9.5], maxBottom: 3.5, groundOnly: false },
  window: { w: [0.7, 12], h: [0.7, 9] },
  other: { w: [0.5, 20], h: [0.5, 20] },
};

function iou(a, b) {
  const box = (q) => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))];
  const [ax0, ay0, ax1, ay1] = box(a);
  const [bx0, by0, bx1, by1] = box(b);
  const iw = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const ih = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = iw * ih;
  const uni = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
  return uni > 0 ? inter / uni : 0;
}

export function checkOpenings(openings, { widthFt, heightFt, topFt, groundWall }) {
  const kept = [];
  for (const o of openings) {
    const rule = OPENING_RULES[o.type] || OPENING_RULES.other;
    const ys = o.plane.map((p) => p[1]);
    const xs = o.plane.map((p) => p[0]);
    const bottom = Math.min(...ys);
    const reasons = [];
    if (o.width < rule.w[0] || o.width > rule.w[1]) reasons.push(`${o.type.replace("_", " ")} ${o.width.toFixed(1)} ft wide is outside the normal ${rule.w[0]}–${rule.w[1]} ft`);
    if (o.height < rule.h[0] || o.height > rule.h[1]) reasons.push(`${o.height.toFixed(1)} ft tall is outside the normal ${rule.h[0]}–${rule.h[1]} ft`);
    if (rule.groundOnly && !groundWall) reasons.push("garage door on a wall that doesn't reach the ground");
    if (rule.maxBottom != null && groundWall && bottom > rule.maxBottom) reasons.push(`bottom is ${bottom.toFixed(1)} ft above the ground`);
    if (Math.min(...xs) < -1 || Math.max(...xs) > widthFt + 1 || bottom < -1 || Math.max(...ys) > (topFt || heightFt) + 1) reasons.push("extends past the wall");
    let fixed = o;
    // a door or garage door that's within reach of the base starts at the base
    if (!reasons.length && rule.maxBottom != null && groundWall && bottom > 0) {
      const lift = bottom;
      fixed = { ...o, plane: o.plane.map(([x, y]) => [x, y - lift]), height: o.height + lift, area: o.area + o.width * lift };
    }
    const dup = kept.find((k) => !k.suspect && iou(k.plane, fixed.plane) > 0.5);
    if (dup) continue; // the same opening marked twice
    kept.push(reasons.length ? { ...fixed, suspect: true, reasons } : fixed);
  }
  return kept;
}

// typical heights when a wall has no photo of its own, by kind of wall
const DEFAULT_H1 = 9; // one story, ground to eave
const DEFAULT_H2 = 18; // two story, ground to eave
const TWO_STORY_FT = 14; // a ground wall at least this tall is two stories
const ONE_STORY_MAX_FT = 12;

// Builds the report from the house model (walls from the satellite outline,
// see houseGeometry.buildHouseModel) and every photo's vision analysis:
//   analyses: [{ photoId, slotKind: "side"|"corner"|"extra", imageWidth,
//               imageHeight, focal35, lens, faces: [...] }]
//
// Wall kinds (model.walls[].tier / stories): a ground wall's measured
// rectangle runs ground → eave; an upper wall's runs from where it meets the
// lower roof → eave, so its "height" is the visible height above that roof.
export function buildFacadeReport(model, analyses, { pitch12 = null, roofAreaFt2 = null } = {}) {
  const walls = model.walls;
  const candidates = Object.fromEntries(walls.map((w) => [w.id, []]));
  const rejected = [];

  for (const a of analyses) {
    const cam = { imageWidth: a.imageWidth, imageHeight: a.imageHeight, f: cameraFocal(a, walls) };
    for (const face of a.faces || []) {
      const wall = walls.find((w) => w.id === face.wallId);
      if (!wall) continue;
      const widthFt = wall.lengthM * FT_PER_M;
      const m = measureFace(face, widthFt, cam);
      if (!m.ok) {
        rejected.push({ photoId: a.photoId, wallId: wall.id, reason: m.reason });
        continue;
      }
      const res = a.imageWidth && a.imageHeight ? Math.min(1, Math.max(a.imageWidth, a.imageHeight) / 1600) : 1;
      const score = (SLOT_WEIGHT[a.slotKind] || 0.6) * m.frontality * (m.baseVisible ? 1 : 0.85) * (0.5 + 0.5 * res);
      candidates[wall.id].push({ ...m, photoId: a.photoId, slotKind: a.slotKind, score, face, lowRes: res < 1 });
    }
  }

  const rise = Number.isFinite(pitch12) ? pitch12 / 12 : null;
  const kindOf = (w) => (w.tier === "upper" ? "upper" : w.stories === 2 ? "two" : "one");
  // the photos check the levels the height map found: a ground wall measured
  // well over one story tall is two stories (or the other way round). The
  // measured height is used either way; this keeps a wrong level from
  // skewing the typical heights used for walls nobody photographed.
  const levelFromPhotos = (w, hFt) => {
    if (w.tier === "upper" || w.stories == null || hFt == null) return null;
    if (w.stories === 1 && hFt >= TWO_STORY_FT) return 2;
    if (w.stories === 2 && hFt <= ONE_STORY_MAX_FT) return 1;
    return null;
  };
  const measuredBy = { one: [], two: [], upper: [] };
  for (const w of walls) {
    if (!candidates[w.id].length) continue;
    const hFt = weightedHeight(candidates[w.id].sort((x, y) => y.score - x.score));
    const seen = levelFromPhotos(w, hFt);
    measuredBy[seen ? (seen === 2 ? "two" : "one") : kindOf(w)].push(hFt);
  }
  const h1 = median(measuredBy.one) ?? (model.hasUpper ? DEFAULT_H1 : median(measuredBy.two) ?? DEFAULT_H1);
  const h2 = median(measuredBy.two) ?? (model.hasUpper ? DEFAULT_H2 : h1);
  // an upper wall's absolute base: the lower roof's eave plus the roof's rise
  // over the set-back distance
  const upperBase = (w) => h1 + (w.setbackM != null ? w.setbackM * FT_PER_M * (rise ?? 7 / 12) : 0);

  const wallReports = walls.map((w, i) => {
    const kind = kindOf(w);
    const widthFt = w.lengthM * FT_PER_M;
    const cands = candidates[w.id].sort((a, b) => b.score - a.score);
    const best = cands[0] || null;
    const notes = [];
    // upper walls only count when a photo shows them: a roof can run straight
    // up past where an upper outline puts a wall, and a phantom wall would
    // add siding that isn't there
    const counted = !!best || kind !== "upper";
    let height;
    if (best) height = weightedHeight(cands);
    else if (kind === "upper") height = Math.max(0, h2 - upperBase(w));
    else height = kind === "two" ? h2 : h1;
    if (!best && kind !== "upper") notes.push(`Not measured from a photo; height estimated from the other ${kind === "two" ? "two-story" : "one-story"} walls`);
    if (!best && kind === "upper") notes.push("Upper wall not seen in any photo, so not counted. If there's siding here, add a photo of it.");
    if (best && !best.baseVisible) notes.push("Bottom of wall hidden; base extended from what was visible");
    if (best && best.lowRes) notes.push("Measured from a low-resolution photo");
    const photoLevel = best ? levelFromPhotos(w, height) : null;
    if (photoLevel === 2) notes.push(`Photos show this wall is two stories (${height.toFixed(1)} ft), not one — the photo height is used`);
    if (photoLevel === 1) notes.push(`Photos show this wall is one story (${height.toFixed(1)} ft), not two — the photo height is used`);
    if (cands.length > 1) {
      const spread = Math.max(...cands.map((c) => c.heightFt)) - Math.min(...cands.map((c) => c.heightFt));
      if (spread > Math.max(1.5, height * 0.15)) notes.push(`Photos disagree on height by ${spread.toFixed(1)} ft`);
    }
    // where this wall's rectangle starts and ends above the ground — for the
    // 3D model
    const baseHeight = kind === "upper" ? (best ? Math.max(h1, h2 - height) : upperBase(w)) : 0;
    const eaveHeight = baseHeight + height;

    let peak = null; // above this wall's base
    let peakSource = null;
    if (best && best.peak && best.peak[1] > best.heightFt + 0.5) {
      peak = best.peak[1] * (height / best.heightFt);
      peakSource = "photo";
    } else if (w.roofEdge === "gable" && rise && counted) {
      peak = height + (widthFt / 2) * rise;
      peakSource = "pitch";
      notes.push("Gable peak from roof pitch (not seen in a photo)");
    }
    const gableArea = peak ? (widthFt * (peak - height)) / 2 : 0;
    const grossArea = counted ? widthFt * height + gableArea : 0;

    // materials + openings come from the single best view (using several
    // would count the same window twice)
    const k = best ? height / best.heightFt : 1;
    const scalePts = (pts) => pts.map(([x, y]) => [x, y * k]);
    const regions = best ? best.regions.map((r) => ({ ...r, plane: scalePts(r.plane), area: r.area * k })) : [];
    const primary = best ? best.material : "siding";
    const byGross = {};
    let regionTotal = 0;
    for (const r of regions) {
      const area = Math.min(r.area, grossArea - regionTotal);
      if (area <= 0) continue;
      byGross[r.material] = (byGross[r.material] || 0) + area;
      regionTotal += area;
    }
    if (grossArea > 0) byGross[primary] = (byGross[primary] || 0) + Math.max(0, grossArea - regionTotal);

    // other photos that show this whole wall (corner to corner, so their
    // positions line up) add the openings the best one missed — a window
    // behind a bush, or cut off by the frame
    const extraOpenings = [];
    if (best) {
      const seen = best.openings.map((o) => o.plane.map(([x, y]) => [x, y * k]));
      for (const c of cands.slice(1)) {
        if (!c.face.leftIsCorner || !c.face.rightIsCorner || c.score < best.score * 0.4) continue;
        const kc = height / c.heightFt;
        for (const o of c.openings) {
          const plane = o.plane.map(([x, y]) => [x, y * kc]);
          const center = [o.center[0], o.center[1] * kc];
          if (seen.some((q) => iou(q, plane) > 0.15 || pointInPoly(center, q))) continue;
          seen.push(plane);
          extraOpenings.push({ ...o, plane, center, height: o.height * kc, area: o.area * kc, fromPhotoId: c.photoId });
        }
      }
    }
    const rawOpenings = best
      ? [...best.openings, ...extraOpenings].map((o) => {
          const extra = o.fromPhotoId != null;
          const plane = extra ? o.plane : scalePts(o.plane);
          const center = extra ? o.center : [o.center[0], o.center[1] * k];
          const region = regions.find((r) => pointInPoly(center, r.plane));
          return {
            type: o.type,
            arched: o.arched,
            width: o.width,
            height: extra ? o.height : o.height * k,
            area: extra ? o.area : o.area * k,
            plane,
            material: region ? region.material : primary,
            image: extra ? null : o.image,
            fromPhotoId: extra ? o.fromPhotoId : undefined,
          };
        })
      : [];
    const checked = checkOpenings(rawOpenings, { widthFt, heightFt: height, topFt: peak || height, groundWall: kind !== "upper" });
    const openings = checked.filter((o) => !o.suspect);
    const suspect = checked.filter((o) => o.suspect);
    if (suspect.length) notes.push(`${suspect.length} opening${suspect.length === 1 ? "" : "s"} look wrong and weren't deducted (shown dashed)`);
    if (best && (!best.face.leftIsCorner || !best.face.rightIsCorner)) notes.push("Openings may be incomplete");

    // net (HOVER's "facade" area): gross minus the openings in each material
    const byMaterial = { ...byGross };
    const openingsByMaterial = {};
    for (const o of openings) {
      if (byMaterial[o.material] != null) byMaterial[o.material] = Math.max(0, byMaterial[o.material] - o.area);
      openingsByMaterial[o.material] = (openingsByMaterial[o.material] || 0) + o.area;
    }
    // where each opening sits on the wall: from the wall's left end, and its
    // bottom (sill) above the wall's base
    for (const o of openings) {
      o.left = Math.max(0, Math.min(...o.plane.map((q) => q[0])));
      o.bottom = Math.max(0, Math.min(...o.plane.map((q) => q[1])));
    }
    // trim along this wall's edges (feet): starter strip across the bottom
    // (less doors that reach the ground), the top edge under the eave
    // (frieze), the sloped gable edges, and for an upper wall the line where
    // it meets the lower roof (roof-to-wall flashing)
    const trim = { starter: 0, frieze: 0, rakeEdges: 0, roofToWall: 0 };
    if (counted) {
      const groundDoors = openings.filter((o) => (o.type === "door" || o.type === "garage_door") && o.bottom < 0.5).reduce((t, o) => t + o.width, 0);
      if (kind === "upper") trim.roofToWall = widthFt;
      else trim.starter = Math.max(0, widthFt - groundDoors);
      if (peak) trim.rakeEdges = 2 * Math.hypot(widthFt / 2, peak - height);
      else trim.frieze = widthFt;
    }

    return {
      id: w.id,
      label: w.label,
      side: w.side,
      tier: w.tier || "ground",
      stories: w.stories ?? null,
      photoStories: photoLevel,
      setbackFt: w.setbackM != null ? w.setbackM * FT_PER_M : null,
      widthFt,
      height,
      baseHeight,
      eaveHeight,
      peakHeight: peak,
      peakSource,
      grossArea,
      byGross,
      byMaterial,
      openingsByMaterial,
      trim,
      primaryMaterial: primary,
      openings,
      suspectOpenings: suspect,
      regions,
      outline: peak
        ? [[0, 0], [widthFt, 0], [widthFt, height], [widthFt / 2, peak], [0, height]]
        : [[0, 0], [widthFt, 0], [widthFt, height], [0, height]],
      measured: !!best,
      counted,
      photos: cands.map((c) => ({ photoId: c.photoId, heightFt: c.heightFt, score: c.score })),
      bestPhotoId: best ? best.photoId : null,
      bestImage: best
        ? { ...best.image, openings: best.openings.map((o) => o.image), regions: best.regions.map((r) => ({ material: r.material, image: r.image })) }
        : null,
      roofEdge: w.roofEdge,
      notes,
      index: i,
    };
  });

  // every opening numbered in wall order, as the schedule lists them, and
  // tagged the way HOVER does: W-1… windows, D-1… doors, G-1… garage doors
  let no = 0;
  const perType = {};
  for (const w of wallReports)
    for (const o of w.openings) {
      o.no = ++no;
      const p = TAG_PREFIX[o.type] || "O";
      perType[p] = (perType[p] || 0) + 1;
      o.tag = `${p}-${perType[p]}`;
    }

  const levelMismatches = wallReports.filter((w) => w.photoStories).map((w) => ({ id: w.id, label: w.label, mapStories: w.stories, photoStories: w.photoStories }));
  return {
    walls: wallReports,
    totals: computeTotals(model, wallReports, { rise, roofAreaFt2 }),
    openingSchedule: openingSchedule(wallReports),
    heights: { h1, h2 },
    levelMismatches,
    rejected,
  };
}

const TAG_PREFIX = { window: "W", door: "D", garage_door: "G" };
const OPENING_LABEL = { window: "Window", door: "Door", garage_door: "Garage door" };

// HOVER-style openings list: each one with its size, and the same sizes
// counted together (within an inch) for ordering
function openingSchedule(walls) {
  const inch = (ft) => Math.round(ft * 12 * 2) / 2;
  const items = [];
  for (const w of walls)
    for (const o of w.openings)
      items.push({
        no: o.no,
        tag: o.tag,
        wallId: w.id,
        wallLabel: w.label,
        side: w.side,
        type: o.type,
        label: (o.arched ? "Arched " : "") + (OPENING_LABEL[o.type] || "Opening").toLowerCase().replace(/^./, (c) => (o.arched ? c : c.toUpperCase())),
        widthIn: inch(o.width),
        heightIn: inch(o.height),
        unitedIn: inch(o.width) + inch(o.height),
        areaFt2: o.area,
        sillIn: o.type === "window" ? inch(o.bottom || 0) : null,
        material: o.material,
        group: SIDING_MATERIALS.has(o.material) ? "siding" : "other",
      });
  const sizes = [];
  for (const it of items) {
    const same = sizes.find((g) => g.type === it.type && Math.abs(g.widthIn - it.widthIn) <= 1 && Math.abs(g.heightIn - it.heightIn) <= 1);
    if (same) {
      same.count += 1;
      same.nos.push(it.no);
      same.tags.push(it.tag);
    } else sizes.push({ type: it.type, label: it.label, widthIn: it.widthIn, heightIn: it.heightIn, unitedIn: it.unitedIn, count: 1, nos: [it.no], tags: [it.tag] });
  }
  sizes.sort((a, b) => a.type.localeCompare(b.type) || b.count - a.count || b.unitedIn - a.unitedIn);
  return { items, sizes };
}

function computeTotals(model, walls, { rise, roofAreaFt2 }) {
  const group = (m) => (SIDING_MATERIALS.has(m) ? "siding" : "other");
  const t = {
    gross: { siding: 0, other: 0 },
    facades: { siding: 0, other: 0 }, // net of openings, as HOVER reports it
    byMaterial: {},
    openings: { siding: { count: 0, area: 0, tops: 0, sills: 0, sides: 0 }, other: { count: 0, area: 0, tops: 0, sills: 0, sides: 0 } },
    suspectOpenings: 0,
  };
  for (const w of walls) {
    for (const [m, a] of Object.entries(w.byGross)) t.gross[group(m)] += a;
    for (const [m, a] of Object.entries(w.byMaterial)) {
      t.byMaterial[m] = (t.byMaterial[m] || 0) + a;
      t.facades[group(m)] += a;
    }
    for (const o of w.openings) {
      const g = t.openings[group(o.material)];
      g.count += 1;
      g.area += o.area;
      g.tops += o.width;
      g.sides += 2 * o.height;
      if (o.type !== "door" && o.type !== "garage_door") g.sills += o.width;
    }
    t.suspectOpenings += w.suspectOpenings.length;
  }
  // kept under the old names too, for reports saved before this change
  t.sidingNet = t.facades.siding;
  t.otherNet = t.facades.other;
  t.squares = [0, 10, 18].map((pct) => ({ pct, area: t.facades.siding * (1 + pct / 100), squares: (t.facades.siding * (1 + pct / 100)) / 100 }));

  // corners: walk the ground walls in order; a left turn (outward bulge) is
  // an outside corner, a right turn an inside one, as tall as the shorter of
  // the two walls. Then the corners of upper walls above the lower roof.
  const byId = Object.fromEntries(walls.map((w) => [w.id, w]));
  const mById = Object.fromEntries(model.walls.map((w) => [w.id, w]));
  const ring = model.groundRing || model.walls.map((w) => w.id);
  const corners = { inside: { count: 0, length: 0 }, outside: { count: 0, length: 0 } };
  for (let i = 0; i < ring.length; i++) {
    const a = mById[ring[i]];
    const b = mById[ring[(i + 1) % ring.length]];
    const turn = (a.b[0] - a.a[0]) * (b.b[1] - b.a[1]) - (a.b[1] - a.a[1]) * (b.b[0] - b.a[0]);
    if (Math.abs(turn) < 1e-6) continue;
    const kk = turn > 0 ? "outside" : "inside";
    corners[kk].count += 1;
    corners[kk].length += Math.min(byId[a.id].eaveHeight, byId[b.id].eaveHeight);
  }
  for (const c of model.upperCorners || []) {
    const ws = c.wallIds.map((id) => byId[id]).filter((w) => w && w.counted);
    if (!ws.length) continue;
    const kk = c.outside ? "outside" : "inside";
    corners[kk].count += 1;
    corners[kk].length += Math.min(...ws.map((w) => w.height));
  }
  t.corners = corners;

  // trim & accessories, from each wall's edges and openings
  t.trim = { starter: 0, frieze: 0, rakeEdges: 0, roofToWall: 0 };
  for (const w of walls) for (const k of Object.keys(t.trim)) t.trim[k] += (w.trim && w.trim[k]) || 0;
  for (const g of ["siding", "other"]) t.openings[g].perimeter = t.openings[g].tops + t.openings[g].sills + t.openings[g].sides;

  // net facade area by side of the house, like HOVER's elevation totals
  t.bySide = {};
  for (const w of walls) {
    const side = w.side || "other";
    const row = (t.bySide[side] = t.bySide[side] || { siding: 0, other: 0, openings: 0 });
    for (const [m, a] of Object.entries(w.byMaterial)) row[group(m)] += a;
    row.openings += w.openings.length;
  }

  // roofline, from the satellite's eave/gable read of each wall plus the
  // overhang — estimates, labeled as such in the report
  const overhangFt = (model.overhangIn || 0) / 12;
  let eaves = 0;
  let rakes = 0;
  for (const w of walls) {
    if (!w.counted) continue;
    if (w.peakHeight) {
      const run = w.widthFt / 2 + overhangFt;
      rakes += 2 * Math.hypot(run, rise ? run * rise : w.peakHeight - w.height);
    } else eaves += w.widthFt + 2 * overhangFt;
  }
  t.roofline = { eaves, rakes, soffitArea: (eaves + rakes) * overhangFt, overhangIn: model.overhangIn };
  t.roof = { areaFt2: roofAreaFt2, pitch12: rise ? rise * 12 : null };
  t.measuredWalls = walls.filter((w) => w.measured).length;
  t.totalWalls = walls.length;
  return t;
}

export function fmtFtIn(ft) {
  if (!Number.isFinite(ft)) return "—";
  let whole = Math.floor(ft);
  let inches = Math.round((ft - whole) * 12);
  if (inches === 12) {
    whole += 1;
    inches = 0;
  }
  return `${whole}' ${inches}"`;
}

export { IN_PER_M };
