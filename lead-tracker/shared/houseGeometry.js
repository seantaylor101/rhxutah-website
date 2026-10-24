// House-measurement geometry shared by the server and the client — the same
// code turns a roof outline into numbered walls and decides which wall a
// photo was aimed at, so the phone can show it live (even offline, from a
// cached outline) and the server can redo it authoritatively after upload
// or after the outline is edited.
//
// Coordinates: a local flat plane in meters around an origin lat/lng —
// x = east, y = north. A house is small enough that the earth's curvature
// doesn't matter at this scale.
//
// Azimuths/headings are compass degrees: 0 = north, 90 = east, clockwise.

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQ = 111320;
const DEG = Math.PI / 180;

export const IN_PER_M = 39.3701;
export const DEFAULT_OVERHANG_IN = 16;

// ---- coordinate conversion ----

export function toLocal(origin, lat, lng) {
  return [(lng - origin.lng) * M_PER_DEG_LNG_EQ * Math.cos(origin.lat * DEG), (lat - origin.lat) * M_PER_DEG_LAT];
}

export function toLatLng(origin, x, y) {
  return { lat: origin.lat + y / M_PER_DEG_LAT, lng: origin.lng + x / (M_PER_DEG_LNG_EQ * Math.cos(origin.lat * DEG)) };
}

export function centroidLatLng(latLngs) {
  const n = latLngs.length;
  return {
    lat: latLngs.reduce((s, p) => s + p[0], 0) / n,
    lng: latLngs.reduce((s, p) => s + p[1], 0) / n,
  };
}

// ---- small vector helpers ----

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

export function normalizeDeg(d) {
  return ((d % 360) + 360) % 360;
}

// signed difference a - b folded into (-180, 180]
export function angleDiff(a, b) {
  let d = normalizeDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

function azimuthOf(v) {
  return normalizeDeg(Math.atan2(v[0], v[1]) / DEG);
}

function dirFromAzimuth(az) {
  return [Math.sin(az * DEG), Math.cos(az * DEG)];
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += cross(pts[i], pts[(i + 1) % pts.length]);
  return a / 2;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

// where line (p + t·u) meets line (q + s·v); null if parallel
function intersectLines(p, u, q, v) {
  const d = cross(u, v);
  if (Math.abs(d) < 1e-9) return null;
  const t = cross(sub(q, p), v) / d;
  return add(p, mul(u, t));
}

// ---- outline cleanup ----

function dedupe(pts, minDist) {
  const out = [];
  for (const p of pts) if (!out.length || len(sub(p, out[out.length - 1])) >= minDist) out.push(p);
  while (out.length > 2 && len(sub(out[0], out[out.length - 1])) < minDist) out.pop();
  return out;
}

function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  const left = douglasPeucker(pts.slice(0, idx + 1), tol);
  const right = douglasPeucker(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

// closed-ring Douglas-Peucker: split at the vertex farthest from the first
// one so neither half's endpoints are arbitrary
function simplifyRing(pts, tol) {
  if (pts.length <= 4) return pts;
  let far = 0;
  let farD = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = len(sub(pts[i], pts[0]));
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), tol);
  const b = douglasPeucker(pts.slice(far).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function dropCollinear(pts, maxTurnDeg) {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const next = out[(i + 1) % out.length];
      const turn = Math.abs(angleDiff(azimuthOf(sub(out[i], prev)), azimuthOf(sub(next, out[i]))));
      if (turn < maxTurnDeg) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

// Turns a straight/right-angle-ish polygon traced from aerial imagery into
// one with true square corners: finds the house's dominant axis, snaps every
// edge within `snapDeg` of it (or its perpendicular) onto it, then rebuilds
// the corners as intersections of the snapped edge lines. Edges that are
// genuinely angled (a bay, a 45° corner) stay as they are.
export function regularizeOutline(ptsIn, { snapDeg = 12, minEdge = 0.3 } = {}) {
  const pts = ptsIn.slice();
  if (pts.length < 3) return pts;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const e = sub(pts[(i + 1) % pts.length], pts[i]);
    const w = len(e);
    const a4 = 4 * Math.atan2(e[1], e[0]);
    sx += w * Math.cos(a4);
    sy += w * Math.sin(a4);
  }
  const dominant = Math.atan2(sy, sx) / 4; // radians, math convention

  let lines = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const e = sub(b, a);
    const ang = Math.atan2(e[1], e[0]);
    const k = Math.round((ang - dominant) / (Math.PI / 2));
    const snapped = dominant + (k * Math.PI) / 2;
    const off = Math.abs(ang - snapped) / DEG;
    const u = off <= snapDeg ? [Math.cos(snapped), Math.sin(snapped)] : norm(e);
    lines.push({ p: mul(add(a, b), 0.5), u, w: len(e), corner: b });
  }

  // merge consecutive lines that ended up parallel and (nearly) on top of
  // each other; when parallel but offset (a jog whose short connector got
  // simplified away) put a perpendicular connector back in
  const merged = [];
  for (const l of lines) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(cross(last.u, l.u)) < 1e-6) {
      const offset = Math.abs(cross(last.u, sub(l.p, last.p)));
      if (offset < minEdge) {
        const w = last.w + l.w;
        last.p = add(mul(last.p, last.w / w), mul(l.p, l.w / w));
        last.w = w;
        last.corner = l.corner;
        continue;
      }
      merged.push({ p: last.corner, u: [-last.u[1], last.u[0]], w: offset, corner: last.corner });
    }
    merged.push({ ...l });
  }
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (Math.abs(cross(last.u, first.u)) < 1e-6) {
      const offset = Math.abs(cross(first.u, sub(first.p, last.p)));
      if (offset < minEdge) {
        const w = last.w + first.w;
        first.p = add(mul(last.p, last.w / w), mul(first.p, first.w / w));
        first.w = w;
        merged.pop();
      } else {
        merged.push({ p: last.corner, u: [-last.u[1], last.u[0]], w: offset, corner: last.corner });
      }
    }
  }
  lines = merged;
  if (lines.length < 3) return ptsIn;

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i];
    const l2 = lines[(i + 1) % lines.length];
    const x = intersectLines(l1.p, l1.u, l2.p, l2.u);
    if (x) out.push(x);
  }
  const result = dropCollinear(dedupe(out, minEdge), 2);

  // a bad regularization (wildly different area) means the input wasn't
  // the right-angled shape this assumes — keep the plain simplified one
  const a0 = Math.abs(signedArea(ptsIn));
  const a1 = Math.abs(signedArea(result));
  if (result.length < 3 || Math.abs(a1 - a0) / a0 > 0.08) return ptsIn;
  return result;
}

// full cleanup pipeline for an outline from aerial data: local meters in,
// counter-clockwise local meters out
export function cleanOutline(ptsIn, { regularize = true } = {}) {
  let pts = dedupe(ptsIn, 0.1);
  if (signedArea(pts) < 0) pts.reverse();
  pts = simplifyRing(pts, 0.3);
  pts = dropCollinear(pts, 6);
  if (regularize) pts = regularizeOutline(pts);
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

// moves every edge of a counter-clockwise polygon `d` meters inward (left of
// travel) and rebuilds corners as intersections — exact for the square
// corners houses mostly have, and fine for the occasional angled one
export function insetPolygon(pts, d) {
  if (!d) return pts.map((p) => p.slice());
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const u = norm(sub(b, a));
    const inward = [-u[1], u[0]];
    return { p: add(a, mul(inward, d)), u };
  });
  return lines.map((l, i) => {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    return intersectLines(prev.p, prev.u, l.p, l.u) || l.p;
  });
}

// ---- walls ----

// which side of the house a wall is on, given the outward-facing azimuth of
// the front. Named the way HOVER does: standing at the street looking at the
// front, "right" is on your right.
export function sideFor(normalAz, frontAz) {
  if (frontAz == null || !Number.isFinite(frontAz)) return null;
  const d = angleDiff(normalAz, frontAz);
  if (Math.abs(d) <= 45) return "front";
  if (Math.abs(d) >= 135) return "back";
  return d > 0 ? "left" : "right";
}

const SIDE_LABEL = { front: "Front", right: "Right", back: "Back", left: "Left" };

export function rise12FromDeg(deg) {
  return Math.round(Math.tan(deg * DEG) * 12 * 2) / 2;
}

// Roof-segment hints (from the Solar API) for each wall: a segment sloping
// down toward a wall means that wall sits under an eave (gutter edge, flat
// top); segments sloping sideways to it mean a gable/rake end (triangle on
// top). Only a hint — the photos have the final say.
function roofEdgeHint(wall, roofSegments) {
  if (!roofSegments || !roofSegments.length) return null;
  let eave = 0;
  let gable = 0;
  for (const s of roofSegments) {
    if (!s.local) continue;
    const dist = distToSegment(s.local, wall.a, wall.b);
    if (dist > Math.max(6, wall.lengthM * 0.6)) continue;
    const d = Math.abs(angleDiff(s.azimuthDeg, wall.normalAz));
    const w = s.areaM2 || 1;
    if (d <= 35) eave += w;
    else if (d >= 55 && d <= 125) gable += w;
  }
  if (!eave && !gable) return null;
  return eave >= gable ? "eave" : "gable";
}

// The whole derived model for a measurement project. `project` holds what's
// stored: { roofOutline: [[lat, lng], ...], overhangIn, frontAz, roof }.
export function buildHouseModel(project) {
  const outline = project && Array.isArray(project.roofOutline) ? project.roofOutline : [];
  if (outline.length < 3) return null;
  const origin = centroidLatLng(outline);
  let roofLocal = outline.map(([lat, lng]) => toLocal(origin, lat, lng));
  if (signedArea(roofLocal) < 0) roofLocal = roofLocal.reverse();
  const overhangIn = Number.isFinite(project.overhangIn) ? project.overhangIn : DEFAULT_OVERHANG_IN;
  const wallLocal = insetPolygon(roofLocal, overhangIn / IN_PER_M);
  const frontAz = Number.isFinite(project.frontAz) ? project.frontAz : null;

  const roofSegments = (project.roof && project.roof.segments ? project.roof.segments : []).map((s) => ({
    ...s,
    local: s.center ? toLocal(origin, s.center.lat, s.center.lng) : null,
  }));

  const raw = wallLocal.map((a, i) => {
    const b = wallLocal[(i + 1) % wallLocal.length];
    const u = norm(sub(b, a));
    const normal = [u[1], -u[0]]; // outward for a counter-clockwise ring
    return { a, b, lengthM: len(sub(b, a)), normalAz: azimuthOf(normal), mid: mul(add(a, b), 0.5) };
  });

  // number walls starting at the front (longest front wall first), else at
  // the southern-most wall, then counter-clockwise around the house
  let start = 0;
  let best = -Infinity;
  raw.forEach((w, i) => {
    const score =
      frontAz != null
        ? sideFor(w.normalAz, frontAz) === "front"
          ? 1000 + w.lengthM
          : -1
        : -w.mid[1];
    if (score > best) {
      best = score;
      start = i;
    }
  });
  const ordered = raw.slice(start).concat(raw.slice(0, start));
  const sideCounts = {};
  const walls = ordered.map((w, i) => {
    const side = sideFor(w.normalAz, frontAz);
    sideCounts[side] = (sideCounts[side] || 0) + 1;
    return { ...w, id: `W${i + 1}`, side, sideIndex: sideCounts[side] };
  });
  for (const w of walls) {
    const many = sideCounts[w.side] > 1;
    w.label = w.side
      ? `${SIDE_LABEL[w.side]}${many ? ` ${String.fromCharCode(64 + w.sideIndex)}` : ""}`
      : `Wall ${w.id.slice(1)}`;
    w.lengthIn = w.lengthM * IN_PER_M;
    w.roofEdge = roofEdgeHint(w, roofSegments);
  }

  return {
    origin,
    roofLocal,
    wallLocal: ordered.map((w) => w.a),
    walls,
    frontAz,
    overhangIn,
    footprintAreaFt2: Math.abs(signedArea(wallLocal)) * 10.7639,
    perimeterFt: walls.reduce((s, w) => s + w.lengthM, 0) * 3.28084,
    pitch12: project.roof && Number.isFinite(project.roof.predominantPitchDeg) ? rise12FromDeg(project.roof.predominantPitchDeg) : null,
  };
}

// after the outline is edited (and walls renumbered), find the wall that
// best matches one a photo was manually pinned to before
export function matchWall(model, ref) {
  if (!model || !ref || !Array.isArray(ref.mid)) return null;
  let bestWall = null;
  let bestD = Infinity;
  for (const w of model.walls) {
    if (Math.abs(angleDiff(w.normalAz, ref.normalAz)) > 25) continue;
    const d = len(sub(w.mid, ref.mid));
    if (d < bestD) {
      bestD = d;
      bestWall = w;
    }
  }
  return bestD <= 4 ? bestWall : null;
}

export function wallRef(model, wallId) {
  const w = model && model.walls.find((x) => x.id === wallId);
  return w ? { normalAz: w.normalAz, mid: w.mid } : null;
}

// ---- which wall is this photo of? ----

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function seededRandom(seed) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// first wall a ray from `p` along `dir` hits from the outside, or null
function castRay(model, p, dir) {
  let hit = null;
  let bestT = Infinity;
  for (const w of model.walls) {
    const e = sub(w.b, w.a);
    const denom = cross(dir, e);
    if (Math.abs(denom) < 1e-9) continue;
    const ap = sub(w.a, p);
    const t = cross(ap, e) / denom;
    const s = cross(ap, dir) / denom;
    if (t <= 0.2 || s < -0.02 || s > 1.02) continue;
    if (t < bestT) {
      bestT = t;
      hit = { wall: w, t, s };
    }
  }
  // hitting the inside face of a wall means the sample was effectively
  // inside the house — not a real line of sight
  if (hit && dot(sub(p, hit.wall.a), dirFromAzimuth(hit.wall.normalAz)) <= 0) return null;
  return hit;
}

const SAMPLES = 240;

// Probability that the photo shows each wall. Phone GPS is only good to a
// few meters — about the width of a side yard — and the compass to ±10–20°,
// so instead of trusting one position and one heading this throws a few
// hundred jittered sight lines at the outline (spread by the phone's own
// reported accuracy) and counts which wall each one hits first. Positions
// that land inside the house are thrown out, which is what keeps a side-yard
// shot from being blamed on the wrong side.
export function assignShotProbabilities(model, shot, seedKey = "") {
  if (!model || !shot || !Number.isFinite(shot.heading)) return null;
  const rand = seededRandom(hashString(String(seedKey || shot.capturedAt || "")));
  const sigmaH = Math.min(35, Math.max(8, Number(shot.headingAccuracy) || 15));
  const votes = {};
  let total = 0;

  if (Number.isFinite(shot.lat) && Number.isFinite(shot.lng)) {
    const p0 = toLocal(model.origin, shot.lat, shot.lng);
    const sigmaP = Math.min(25, Math.max(3, Number(shot.gpsAccuracy) || 10));
    let tries = 0;
    while (total < SAMPLES && tries < SAMPLES * 4) {
      tries++;
      const p = [p0[0] + gaussian(rand) * sigmaP, p0[1] + gaussian(rand) * sigmaP];
      if (pointInPolygon(p, model.wallLocal)) continue;
      const hit = castRay(model, p, dirFromAzimuth(shot.heading + gaussian(rand) * sigmaH));
      total++;
      if (hit) votes[hit.wall.id] = (votes[hit.wall.id] || 0) + 1;
    }
    const hits = Object.values(votes).reduce((x, y) => x + y, 0);
    if (!hits) return null;
    // normalized over the sight lines that hit anything — a ray that misses
    // the house just means that jittered position/heading wasn't the real one
    const probs = {};
    for (const [id, n] of Object.entries(votes)) probs[id] = n / hits;
    return probs;
  }

  // no location — fall back on which walls face the camera at all; walls on
  // the same side tie, and the burst/sequence prior in assignShots breaks it
  for (const w of model.walls) {
    const theta = Math.abs(angleDiff(shot.heading, w.normalAz + 180));
    if (theta > 80) continue;
    const s = Math.exp(-((theta / 40) ** 2)) * Math.min(1, w.lengthM / 4);
    votes[w.id] = s;
    total += s;
  }
  if (!total) return null;
  for (const id of Object.keys(votes)) votes[id] /= total;
  return votes;
}

const BURST_MS = 45 * 1000;
export const REVIEW_BELOW = 0.7;

// Assigns every non-manual photo. Shots taken seconds apart are almost
// always the same wall (a sweep up a two-story side, a walk along it), so
// the previous shot's wall gets a boost when the sensors alone are torn.
// Returns { [photoKey]: { wallId, confidence, needsReview } }.
export function assignShots(model, shots) {
  const out = {};
  const sorted = shots
    .slice()
    .sort((a, b) => String(a.sensors?.capturedAt || "").localeCompare(String(b.sensors?.capturedAt || "")));
  let prev = null;
  for (const s of sorted) {
    if (s.manualWallId) {
      out[s.key] = { wallId: s.manualWallId, confidence: 1, needsReview: false, manual: true };
      prev = { wallId: s.manualWallId, t: Date.parse(s.sensors?.capturedAt || "") };
      continue;
    }
    let probs = assignShotProbabilities(model, s.sensors, s.key);
    const t = Date.parse(s.sensors?.capturedAt || "");
    if (probs && prev && prev.wallId && Number.isFinite(t) && Number.isFinite(prev.t) && t - prev.t < BURST_MS) {
      if (probs[prev.wallId]) {
        probs = { ...probs, [prev.wallId]: probs[prev.wallId] * 2 };
        const sum = Object.values(probs).reduce((x, y) => x + y, 0);
        for (const k of Object.keys(probs)) probs[k] /= sum;
      }
    }
    if (!probs || !Object.keys(probs).length) {
      out[s.key] = { wallId: null, confidence: 0, needsReview: true };
      continue;
    }
    const [wallId, confidence] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
    out[s.key] = { wallId, confidence, needsReview: confidence < REVIEW_BELOW };
    prev = { wallId, t };
  }
  return out;
}

// ---- coverage ----

// Rough horizontal field of view across the image width, by lens and how the
// phone was held. Only used to shade how much of each wall has been shot, so
// approximate is fine; the measurement engine works out the real camera
// geometry from the photos themselves.
export function horizontalFovDeg(sensors) {
  const ultra = /ultra/i.test(sensors?.lens || "");
  const portrait = (sensors?.imageHeight || 0) > (sensors?.imageWidth || 0);
  if (ultra) return portrait ? 86 : 104;
  return portrait ? 50 : 64;
}

// fraction (0..1) of each wall's length that falls inside at least one
// assigned photo's field of view, from its reported position and heading
export function wallCoverage(model, shots, assignments) {
  const intervals = {};
  const counts = {};
  for (const s of shots) {
    const a = assignments[s.key];
    if (!a || !a.wallId) continue;
    counts[a.wallId] = (counts[a.wallId] || 0) + 1;
    const w = model.walls.find((x) => x.id === a.wallId);
    const sen = s.sensors || {};
    if (!w || !Number.isFinite(sen.lat) || !Number.isFinite(sen.heading)) continue;
    const p = toLocal(model.origin, sen.lat, sen.lng);
    const half = horizontalFovDeg(sen) / 2;
    const e = sub(w.b, w.a);
    const ts = [];
    for (const off of [-half, -half / 2, 0, half / 2, half]) {
      const dir = dirFromAzimuth(sen.heading + off);
      const denom = cross(dir, e);
      if (Math.abs(denom) < 1e-9) continue;
      const ap = sub(w.a, p);
      const t = cross(ap, e) / denom;
      if (t <= 0) {
        // that edge of the view never reaches the wall line — it's looking
        // past the wall's end, so the view runs out to that end
        ts.push(off < 0 ? -Infinity : Infinity);
        continue;
      }
      ts.push(cross(ap, dir) / denom);
    }
    const finite = ts.filter(Number.isFinite);
    let lo = finite.length ? Math.min(...finite) : 0;
    let hi = finite.length ? Math.max(...finite) : 1;
    if (ts.includes(-Infinity) || ts.includes(Infinity)) {
      // which end it runs off toward depends on which way along the wall the
      // camera is turned
      const along = dot(dirFromAzimuth(sen.heading), norm(e));
      if (along >= 0) hi = 1;
      else lo = 0;
    }
    lo = Math.max(0, lo);
    hi = Math.min(1, hi);
    if (hi > lo) (intervals[w.id] = intervals[w.id] || []).push([lo, hi]);
  }
  const out = {};
  for (const w of model.walls) {
    const iv = (intervals[w.id] || []).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let curLo = null;
    let curHi = null;
    for (const [lo, hi] of iv) {
      if (curHi == null || lo > curHi) {
        if (curHi != null) covered += curHi - curLo;
        curLo = lo;
        curHi = hi;
      } else curHi = Math.max(curHi, hi);
    }
    if (curHi != null) covered += curHi - curLo;
    out[w.id] = { photos: counts[w.id] || 0, fraction: Math.min(1, covered) };
  }
  return out;
}

// ---- satellite image projection (Web Mercator, what Google Static Maps uses) ----

export function worldPixel(lat, lng, zoom) {
  const scale = 256 * 2 ** zoom;
  const s = Math.sin(lat * DEG);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

export function latLngFromWorldPixel(x, y, zoom) {
  const scale = 256 * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = Math.atan(Math.sinh(n)) / DEG;
  return { lat, lng };
}

export const SATELLITE_SIZE = 640;
export const SATELLITE_SCALE = 2;

// highest zoom (≤ 20) at which the whole outline fits comfortably in the
// 640px static map
export function pickSatelliteZoom(latLngs) {
  for (let z = 20; z >= 16; z--) {
    const px = latLngs.map(([lat, lng]) => worldPixel(lat, lng, z));
    const w = Math.max(...px.map((p) => p[0])) - Math.min(...px.map((p) => p[0]));
    const h = Math.max(...px.map((p) => p[1])) - Math.min(...px.map((p) => p[1]));
    if (Math.max(w, h) <= SATELLITE_SIZE * 0.6) return z;
  }
  return 16;
}
