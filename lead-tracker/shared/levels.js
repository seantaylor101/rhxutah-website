// Finds the house's levels on its own from Google's roof height map (the
// Solar API's DSM: a grid of surface heights, a few inches apart), so the
// second story never has to be traced by hand:
//
//   - the ground is the low, open ground around the house
//   - the house is the rooftop (Google's roof mask, or anything well above
//     the ground) — its edge also tightens up the building outline when
//     Google's outline came out too big or too small
//   - the second story is the roof that sits at two-story height, kept only
//     when its edges are explained: either the house's own outer eaves, or
//     a step down onto a lower roof (a garage or wing). A tall one-story
//     ridge reaches two-story height too, but its edges slope smoothly into
//     the rest of the roof, so it's thrown out.
//
// Pure geometry on a grid the server builds (server/src/measure/dsm.js):
//   grid = { theta, x0, y0, step, nx, ny, h: Float32Array (meters, NaN = no
//            data), mask: Uint8Array | null }
// Cell (i, j) is at frame point (x0 + i·step, y0 + j·step), and the frame is
// the house's local plane (x east, y north, meters) turned by theta, so a
// square-cornered house lines up with the grid.

import { signedArea, pointInPolygon } from "./houseGeometry.js";

export const TWO_STORY_M = 4.6; // roof this far above the ground is a second story's
const MIN_BUILDING_M = 1.8; // anything lower than this is a fence, car or bush
const STEP_M = 1.1; // a drop this big over STEP_PX is an eave above a lower roof
const STEP_PX = 3;
const MIN_UPPER_M2 = 12;
const EXPLAINED_EDGE = 0.55;
const ROOF_JOG_M = 0.9; // roof-edge jogs smaller than this are smoothed out
const UPPER_JOG_M = 1.5; // the second story's edge is fuzzier (a height cut-off on a sloped roof) // share of a second story's edge that must be eave or step

export function frameToLocal(grid, fx, fy) {
  const c = Math.cos(grid.theta);
  const s = Math.sin(grid.theta);
  return [fx * c - fy * s, fx * s + fy * c];
}

export function localToFrame(theta, x, y) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [x * c + y * s, -x * s + y * c];
}

// the direction a square-cornered outline runs along (radians), the same
// length-weighted 4-fold average regularizeOutline uses
export function outlineAxis(ring) {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const a4 = 4 * Math.atan2(b[1] - a[1], b[0] - a[0]);
    sx += w * Math.cos(a4);
    sy += w * Math.sin(a4);
  }
  return Math.atan2(sy, sx) / 4;
}

// grid covering the outline plus `margin` meters, in the outline's frame
export function gridSpec(ringLocal, { step = 0.25, margin = 7 } = {}) {
  const theta = outlineAxis(ringLocal);
  const f = ringLocal.map(([x, y]) => localToFrame(theta, x, y));
  const x0 = Math.min(...f.map((p) => p[0])) - margin;
  const y0 = Math.min(...f.map((p) => p[1])) - margin;
  const nx = Math.ceil((Math.max(...f.map((p) => p[0])) + margin - x0) / step) + 1;
  const ny = Math.ceil((Math.max(...f.map((p) => p[1])) + margin - y0) / step) + 1;
  return { theta, x0, y0, step, nx, ny };
}

function quantile(values, q) {
  if (!values.length) return null;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

// ---- binary-image helpers (Uint8Array, nx × ny, row-major by j) ----

function morph(src, nx, ny, r, grow) {
  const out = new Uint8Array(src.length);
  // a square, not a disk: the grid runs along the house's walls, so a
  // square keeps square corners square
  const offs = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) offs.push([di, dj]);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let v = grow ? 0 : 1;
      for (const [di, dj] of offs) {
        const a = i + di;
        const b = j + dj;
        const s = a < 0 || b < 0 || a >= nx || b >= ny ? 0 : src[b * nx + a];
        if (grow ? s : !s) {
          v = grow ? 1 : 0;
          break;
        }
      }
      out[j * nx + i] = v;
    }
  return out;
}
const dilate = (m, nx, ny, r) => morph(m, nx, ny, r, true);
const erode = (m, nx, ny, r) => morph(m, nx, ny, r, false);
const openMask = (m, nx, ny, r) => dilate(erode(m, nx, ny, r), nx, ny, r);
const closeMask = (m, nx, ny, r) => erode(dilate(m, nx, ny, r), nx, ny, r);

// 4-connected components; returns { labels: Int32Array, sizes: [] }
function components(m, nx, ny) {
  const labels = new Int32Array(m.length).fill(-1);
  const sizes = [];
  const stack = [];
  for (let k = 0; k < m.length; k++) {
    if (!m[k] || labels[k] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    labels[k] = id;
    stack.push(k);
    while (stack.length) {
      const c = stack.pop();
      n++;
      const i = c % nx;
      const j = (c - i) / nx;
      for (const [a, b] of [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
      ]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a;
        if (m[q] && labels[q] < 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

function fillHoles(m, nx, ny) {
  // flood the outside from the border; whatever isn't reached is the shape
  const outside = new Uint8Array(m.length);
  const stack = [];
  const push = (i, j) => {
    const k = j * nx + i;
    if (!m[k] && !outside[k]) {
      outside[k] = 1;
      stack.push(k);
    }
  };
  for (let i = 0; i < nx; i++) {
    push(i, 0);
    push(i, ny - 1);
  }
  for (let j = 0; j < ny; j++) {
    push(0, j);
    push(nx - 1, j);
  }
  while (stack.length) {
    const c = stack.pop();
    const i = c % nx;
    const j = (c - i) / nx;
    if (i > 0) push(i - 1, j);
    if (i < nx - 1) push(i + 1, j);
    if (j > 0) push(i, j - 1);
    if (j < ny - 1) push(i, j + 1);
  }
  const out = new Uint8Array(m.length);
  for (let k = 0; k < m.length; k++) out[k] = outside[k] ? 0 : 1;
  return out;
}

// outer boundary of a filled shape, along pixel edges, counter-clockwise,
// as grid-corner coordinates [u, v] (pixel (i, j) spans u i..i+1, v j..j+1)
function traceOuter(m, nx, ny) {
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? m[j * nx + i] : 0);
  const next = new Map(); // "u,v" → list of [u2, v2]
  const addEdge = (u1, v1, u2, v2) => {
    const k = `${u1},${v1}`;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([u2, v2]);
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      // edges with the shape on the left
      if (!at(i, j - 1)) addEdge(i, j, i + 1, j);
      if (!at(i + 1, j)) addEdge(i + 1, j, i + 1, j + 1);
      if (!at(i, j + 1)) addEdge(i + 1, j + 1, i, j + 1);
      if (!at(i - 1, j)) addEdge(i, j + 1, i, j);
    }
  if (!next.size) return null;
  // start at the lowest-then-leftmost corner: it's on the outer boundary
  let start = null;
  for (const k of next.keys()) {
    const [u, v] = k.split(",").map(Number);
    if (!start || v < start[1] || (v === start[1] && u < start[0])) start = [u, v];
  }
  const ring = [start];
  let prev = null;
  let cur = start;
  for (let guard = 0; guard < 200000; guard++) {
    const k = `${cur[0]},${cur[1]}`;
    const opts = next.get(k);
    if (!opts || !opts.length) break;
    let pick = 0;
    if (opts.length > 1 && prev) {
      // two shapes touching at a corner: keep turning left to stay outside
      const din = [cur[0] - prev[0], cur[1] - prev[1]];
      let best = -Infinity;
      opts.forEach((o, idx) => {
        const d = [o[0] - cur[0], o[1] - cur[1]];
        const turn = din[0] * d[1] - din[1] * d[0];
        if (turn > best) {
          best = turn;
          pick = idx;
        }
      });
    }
    const [nu, nv] = opts.splice(pick, 1)[0];
    if (nu === start[0] && nv === start[1]) break;
    prev = cur;
    cur = [nu, nv];
    ring.push(cur);
  }
  return ring.length >= 4 ? ring : null;
}

// drops repeated corners and corners on a straight line (including the
// tip of a zero-width spike)
function dropStraight(ring) {
  let r = ring.slice();
  let changed = true;
  while (changed && r.length > 4) {
    changed = false;
    for (let i = 0; i < r.length; i++) {
      const p = r[(i - 1 + r.length) % r.length];
      const c = r[i];
      const n = r[(i + 1) % r.length];
      const same = c[0] === n[0] && c[1] === n[1];
      const straight = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]) === 0;
      if (same || straight) {
        r.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return r;
}

// A traced outline is all right-angled steps along the grid (which runs
// along the house's walls). Squares it up: every jog shorter than `minLen`
// cells — a tree branch over the eave, the slope of a roof crossing the
// height cut-off — is taken out by sliding the shorter of the two walls
// beside it into line with the longer one.
export function squareUp(ringIn, minLen) {
  let r = dropStraight(ringIn.map((p) => p.slice()));
  for (let guard = 0; guard < 500 && r.length > 4; guard++) {
    let best = -1;
    let bestLen = minLen;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const l = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (l < bestLen) {
        bestLen = l;
        best = i;
      }
    }
    if (best < 0) break;
    const N = r.length;
    const ip = (best - 1 + N) % N;
    const ia = best;
    const ib = (best + 1) % N;
    const inn = (best + 2) % N;
    const [p, a, b, n] = [r[ip], r[ia], r[ib], r[inn]];
    const k = a[1] === b[1] ? 0 : 1; // horizontal jog → line up x; vertical → y
    const lenPrev = Math.abs(a[1 - k] - p[1 - k]);
    const lenNext = Math.abs(n[1 - k] - b[1 - k]);
    if (lenPrev >= lenNext) {
      b[k] = a[k];
      n[k] = a[k];
    } else {
      p[k] = b[k];
      a[k] = b[k];
    }
    r = dropStraight(r);
  }
  return r;
}

function maskToRing(grid, m, minLenM) {
  const corners = traceOuter(m, grid.nx, grid.ny);
  if (!corners) return null;
  const square = squareUp(corners, minLenM / grid.step);
  let ring = square.map(([u, v]) => frameToLocal(grid, grid.x0 + (u - 0.5) * grid.step, grid.y0 + (v - 0.5) * grid.step));
  if (signedArea(ring) < 0) ring = ring.reverse();
  return ring.length >= 4 && Math.abs(signedArea(ring)) > 4 ? ring : null;
}

// area-weighted overlap of two rings, sampled on the grid
function overlap(grid, a, b) {
  let inA = 0;
  let inB = 0;
  let both = 0;
  for (let j = 0; j < grid.ny; j++)
    for (let i = 0; i < grid.nx; i++) {
      const p = frameToLocal(grid, grid.x0 + i * grid.step, grid.y0 + j * grid.step);
      const ia = pointInPolygon(p, a);
      const ib = pointInPolygon(p, b);
      inA += ia;
      inB += ib;
      both += ia && ib;
    }
  const union = inA + inB - both;
  return { iou: union ? both / union : 0, ratio: inA ? inB / inA : 0 };
}

// distance (in cells) from every cell to the nearest cell inside `ringLocal`
// — small enough grids that a two-pass chamfer transform is plenty
function distanceOutside(grid, inside) {
  const { nx, ny } = grid;
  const INF = 1e9;
  const d = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? 0 : INF;
  const D = Math.SQRT2;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) d[k] = Math.min(d[k], d[k - 1] + 1);
      if (j > 0) d[k] = Math.min(d[k], d[k - nx] + 1);
      if (i > 0 && j > 0) d[k] = Math.min(d[k], d[k - nx - 1] + D);
      if (i < nx - 1 && j > 0) d[k] = Math.min(d[k], d[k - nx + 1] + D);
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) d[k] = Math.min(d[k], d[k + 1] + 1);
      if (j < ny - 1) d[k] = Math.min(d[k], d[k + nx] + 1);
      if (i < nx - 1 && j < ny - 1) d[k] = Math.min(d[k], d[k + nx + 1] + D);
      if (i > 0 && j < ny - 1) d[k] = Math.min(d[k], d[k + nx - 1] + D);
    }
  return d;
}

// A roof plane doesn't stop at two-story height: the main roof can sweep
// down to a one-story eave (a saltbox side, a roof carried over a wing), and
// it always dips a little under the cut-off at its own eaves. Neither is a
// "lower roof" with a second-story wall standing on it. A real lower roof
// (garage, porch) meets the upper story at a step — the upper eave hangs
// over it. So the upper roof is grown over every lower cell it carries on
// into smoothly and downhill; what's left behind a step is a lower roof.
// Returns the cells added.
const SMOOTH_M = 0.45; // height change between neighboring cells that's still one roof surface
const STEEPEST = 1.05; // m per m — steeper than a 12/12 roof is a wall, not a roof
function absorbEaveFringe(grid, house, upper, rel) {
  const { nx, ny, step } = grid;
  const N = nx * ny;
  // downhill direction of the roof at each cell (unit vector, or null on a
  // flat spot / ridge / edge)
  const slope = (k) => {
    const i = k % nx;
    const j = (k - i) / nx;
    if (i < 2 || j < 2 || i >= nx - 2 || j >= ny - 2) return null;
    const gx = (rel[k + 2] - rel[k - 2]) / (4 * step);
    const gy = (rel[k + 2 * nx] - rel[k - 2 * nx]) / (4 * step);
    const m = Math.hypot(gx, gy);
    return Number.isFinite(m) && m > 0.08 ? [-gx / m, -gy / m] : null;
  };
  const taken = new Uint8Array(N);
  const dirX = new Float32Array(N);
  const dirY = new Float32Array(N);
  const queue = [];
  const neighbors = (k) => {
    const i = k % nx;
    return [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k >= nx ? k - nx : -1, k + nx < N ? k + nx : -1];
  };
  // one roof surface carrying on: no step, downhill, and sloping the same
  // way as where the growth started (a garage roof that happens to meet the
  // main roof at the same height slopes another way)
  const carriesOn = (from, to, dir) => {
    if (!Number.isFinite(rel[to]) || rel[to] > rel[from] + 0.1 || rel[from] - rel[to] >= SMOOTH_M) return false;
    // the height map blurs a step over a cell or two, so also look two
    // cells further on: steeper than any roof over that span is a step
    const far = to + 2 * (to - from);
    const sameLine = Math.abs(to - from) === 1 ? Math.floor(far / nx) === Math.floor(to / nx) : true;
    if (far >= 0 && far < N && sameLine && Number.isFinite(rel[far]) && rel[from] - rel[far] > STEEPEST * 3 * step) return false;
    // moving down the slope, not sideways along a contour
    const mv = Math.abs(to - from) === 1 ? [to - from, 0] : [0, Math.sign(to - from)];
    if (mv[0] * dir[0] + mv[1] * dir[1] < 0.5) return false;
    const d = slope(to);
    return !d || d[0] * dir[0] + d[1] * dir[1] > 0.8;
  };
  for (let k = 0; k < N; k++) {
    if (!upper[k]) continue;
    for (const q of neighbors(k)) {
      if (q < 0 || !house[q] || upper[q] || taken[q]) continue;
      // start only from solid upper roof: not a cell caught halfway up a
      // blurred step, which would let the growth walk down the step
      const behind = k - (q - k);
      if (behind < 0 || behind >= N || !(Math.abs(rel[behind] - rel[k]) < SMOOTH_M)) continue;
      const dir = slope(k); // the upper roof's own slope, carried on
      if (dir && carriesOn(k, q, dir)) {
        taken[q] = 1;
        dirX[q] = dir[0];
        dirY[q] = dir[1];
        queue.push(q);
      }
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const dir = [dirX[k], dirY[k]];
    for (const q of neighbors(k)) {
      if (q < 0 || !house[q] || upper[q] || taken[q]) continue;
      if (carriesOn(k, q, dir)) {
        taken[q] = 1;
        dirX[q] = dir[0];
        dirY[q] = dir[1];
        queue.push(q);
      }
    }
  }
  for (const k of queue) upper[k] = 1;
  return queue.length;
}

// Which stretches of each side of the outline sit under a two-story roof
// edge: the roof just inside the edge belongs to the upper roof and is at
// two-story height there. This, not the levels' outlines alone, says
// whether the wall under it is one story or two — a main roof that sweeps
// down to a one-story eave sits on a one-story wall, and a one-story gable
// end of a lower roof rises high in the middle but is still one story.
// → [{ a, b, heightM, stories }] runs along the ring's edges (local meters).
const EAVE_DEPTHS_M = [0.5, 0.75, 1.0];
const TWO_STORY_EAVE_M = 4.3;
const MIN_RUN_M = 1.5;
function eaveRuns(grid, ring, rel, upper) {
  const { nx, ny, step } = grid;
  const cell = ([x, y]) => {
    const [fx, fy] = localToFrame(grid.theta, x, y);
    const i = Math.round((fx - grid.x0) / step);
    const j = Math.round((fy - grid.y0) / step);
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i;
  };
  const runs = [];
  ring.forEach((a, idx) => {
    const b = ring[(idx + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.3) return;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const inward = [-u[1], u[0]]; // counter-clockwise ring
    const samples = [];
    for (let t = step / 2; t < L; t += step) {
      let h = Infinity;
      let up = 0;
      for (const d of EAVE_DEPTHS_M) {
        const k = cell([a[0] + u[0] * t + inward[0] * d, a[1] + u[1] * t + inward[1] * d]);
        if (k < 0 || !(rel[k] > MIN_BUILDING_M)) continue; // off the roof
        h = Math.min(h, rel[k]);
        up += upper[k];
      }
      samples.push({ t, h: Number.isFinite(h) ? h : null, two: Number.isFinite(h) && up >= 2 && h >= TWO_STORY_EAVE_M });
    }
    // runs of one / two stories, short ones folded into their neighbors
    let parts = [];
    for (const smp of samples) {
      const last = parts[parts.length - 1];
      if (last && last.two === smp.two) last.items.push(smp);
      else parts.push({ two: smp.two, items: [smp] });
    }
    let changed = true;
    while (changed && parts.length > 1) {
      changed = false;
      let si = -1;
      for (let i = 0; i < parts.length; i++)
        if (parts[i].items.length * step < MIN_RUN_M && (si < 0 || parts[i].items.length < parts[si].items.length)) si = i;
      if (si < 0) break;
      const into = si === 0 ? 1 : si === parts.length - 1 ? si - 1 : parts[si - 1].items.length >= parts[si + 1].items.length ? si - 1 : si + 1;
      const [lo, hi] = into < si ? [into, si] : [si, into];
      parts.splice(lo, 2, { two: parts[into].two, items: [...parts[lo].items, ...parts[hi].items] });
      for (let i = parts.length - 1; i > 0; i--)
        if (parts[i].two === parts[i - 1].two) parts.splice(i - 1, 2, { two: parts[i].two, items: [...parts[i - 1].items, ...parts[i].items] });
      changed = true;
    }
    for (const part of parts) {
      const t0 = Math.max(0, part.items[0].t - step / 2);
      const t1 = Math.min(L, part.items[part.items.length - 1].t + step / 2);
      const hs = part.items.map((x) => x.h).filter((x) => x != null);
      const h = quantile(hs, 0.5);
      runs.push({
        a: [a[0] + u[0] * t0, a[1] + u[1] * t0],
        b: [a[0] + u[0] * t1, a[1] + u[1] * t1],
        heightM: h == null ? null : Math.round(h * 100) / 100,
        stories: hs.length ? (part.two ? 2 : 1) : null,
      });
    }
  });
  return runs;
}

// Main entry. `ringLocal` is the roof outline we have (local meters, from
// Google's building outline). Returns:
//   { ok, reason?, groundM, maxRoofM, levels: 1 | 2,
//     roofRing (local, roof edge, or null to keep the one we have),
//     upperRing (local, the second story's roof edge, or null),
//     upperShare (upper roof area ÷ whole roof), stats }
export function detectLevels(grid, ringLocal) {
  const { nx, ny, step, h } = grid;
  const N = nx * ny;
  const cellM2 = step * step;
  const local = (i, j) => frameToLocal(grid, grid.x0 + i * step, grid.y0 + j * step);

  const inOutline = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) inOutline[j * nx + i] = pointInPolygon(local(i, j), ringLocal) ? 1 : 0;
  const distOut = distanceOutside(grid, inOutline); // cells

  let valid = 0;
  for (let k = 0; k < N; k++) if (inOutline[k] && Number.isFinite(h[k])) valid++;
  const inCount = inOutline.reduce((s, v) => s + v, 0);
  if (!inCount) return { ok: false, reason: "Outline didn't land on the height map's grid" };
  if (valid / inCount < 0.6) return { ok: false, reason: `Height map doesn't cover this house (${Math.round((100 * valid) / inCount)}% of it)` };

  // ground: the low ground in a ring 2–7 m around the house, off the roof
  const around = [];
  for (let k = 0; k < N; k++) {
    const dm = distOut[k] * step;
    if (dm >= 2 && dm <= 7 && Number.isFinite(h[k]) && !(grid.mask && grid.mask[k])) around.push(h[k]);
  }
  if (around.length < 50) return { ok: false, reason: "Not enough open ground around the house in the height map" };
  const groundM = quantile(around, 0.2);
  const rel = new Float32Array(N);
  for (let k = 0; k < N; k++) rel[k] = Number.isFinite(h[k]) ? h[k] - groundM : NaN;

  // the house: rooftop cells within a meter or so of the outline we have
  // (so a neighbor's roof, a tree or a detached shed can't join it)
  const near = Math.round(1.25 / step);
  let house = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (distOut[k] > near || !(rel[k] > MIN_BUILDING_M)) continue;
    house[k] = grid.mask ? grid.mask[k] : 1;
  }
  house = closeMask(house, nx, ny, 2);
  house = openMask(house, nx, ny, 2);
  {
    // keep the piece that overlaps the outline most
    const { labels, sizes } = components(house, nx, ny);
    const score = new Array(sizes.length).fill(0);
    for (let k = 0; k < N; k++) if (labels[k] >= 0 && inOutline[k]) score[labels[k]]++;
    const best = score.indexOf(Math.max(0, ...score));
    for (let k = 0; k < N; k++) house[k] = labels[k] === best && best >= 0 ? 1 : 0;
    house = fillHoles(house, nx, ny);
  }
  const houseCells = house.reduce((s, v) => s + v, 0);
  if (houseCells * cellM2 < 25) return { ok: false, reason: "Couldn't find the roof in the height map" };

  const roofHs = [];
  for (let k = 0; k < N; k++) if (house[k] && Number.isFinite(rel[k])) roofHs.push(rel[k]);
  const maxRoofM = quantile(roofHs, 0.98);

  // a tighter outline from the rooftop itself, used only when it agrees
  // well with Google's (same house, just a better edge)
  let roofRing = maskToRing(grid, house, ROOF_JOG_M);
  if (roofRing) {
    const o = overlap(grid, ringLocal, roofRing);
    if (o.iou < 0.72 || o.ratio < 0.7 || o.ratio > 1.2) roofRing = null;
  }

  // second-story roof: high cells, thin ridges and chimneys opened away
  let high = new Uint8Array(N);
  for (let k = 0; k < N; k++) high[k] = house[k] && rel[k] >= TWO_STORY_M ? 1 : 0;
  high = openMask(high, nx, ny, 4);
  const { labels, sizes } = components(high, nx, ny);
  const stats = [];
  const keep = new Set();
  for (let id = 0; id < sizes.length; id++) {
    const areaM2 = sizes[id] * cellM2;
    let edge = 0;
    let eave = 0;
    let stepped = 0;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (labels[k] !== id) continue;
        const isEdge =
          i === 0 || j === 0 || i === nx - 1 || j === ny - 1 || labels[k - 1] !== id || labels[k + 1] !== id || labels[k - nx] !== id || labels[k + nx] !== id;
        if (!isEdge) continue;
        edge++;
        // next to the outside of the house → an outer eave/rake
        let outer = false;
        let drop = 0;
        for (let dj = -STEP_PX; dj <= STEP_PX && !outer; dj++)
          for (let di = -STEP_PX; di <= STEP_PX; di++) {
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
            const q = b * nx + a;
            if (!house[q]) {
              if (Math.abs(di) <= 2 && Math.abs(dj) <= 2) {
                outer = true;
                break;
              }
              continue;
            }
            if (labels[q] !== id && Number.isFinite(rel[q])) drop = Math.max(drop, rel[k] - rel[q]);
          }
        if (outer) eave++;
        else if (drop >= STEP_M) stepped++;
      }
    const explained = edge ? (eave + stepped) / edge : 0;
    const s = { areaM2: Math.round(areaM2 * 10) / 10, edgeEave: edge ? eave / edge : 0, edgeStep: edge ? stepped / edge : 0, explained };
    stats.push(s);
    if (areaM2 >= MIN_UPPER_M2 && explained >= EXPLAINED_EDGE) keep.add(id);
  }

  const houseM2 = houseCells * cellM2;
  let upper = new Uint8Array(N);
  let upperCells = 0;
  for (let k = 0; k < N; k++)
    if (keep.has(labels[k])) {
      upper[k] = 1;
      upperCells++;
    }
  if (upperCells) upperCells += absorbEaveFringe(grid, house, upper, rel);
  const upperShare = upperCells / houseCells;
  let upperRing = null;
  let levels = 1;
  if (upperCells) {
    levels = 2;
    if (upperShare < 0.85) {
      // more than one separate second-story piece: the biggest, as the model
      // has one upper level
      const cc = components(upper, nx, ny);
      const big = cc.sizes.indexOf(Math.max(...cc.sizes));
      upper = fillHoles(
        upper.map((_, k) => (cc.labels[k] === big ? 1 : 0)),
        nx,
        ny,
      );
      upperRing = maskToRing(grid, closeMask(upper, nx, ny, 2), UPPER_JOG_M);
      if (!upperRing) levels = 1;
    }
    // ≥ 85%: the whole house is two stories — the upper outline is the roof
    // outline itself (the caller fills that in)
  }

  // the roof surface itself, every 50 cm, for the 3D view. The height map
  // blurs the last half meter of an eave down toward the ground, so the rim
  // takes the heights from just inside it, and a small median takes out
  // speckle (vents, a satellite dish).
  const core = erode(house, nx, ny, 2);
  const clean = new Float32Array(N).fill(NaN);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!house[k]) continue;
      const vals = [];
      const r = core[k] ? 1 : 4;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
          const q = b * nx + a;
          if (core[q] && Number.isFinite(rel[q])) vals.push(rel[q]);
        }
      clean[k] = vals.length ? (core[k] ? quantile(vals, 0.5) : quantile(vals, 0.3)) : rel[k];
    }
  const SUB = 2;
  const rnx = Math.ceil(nx / SUB);
  const rny = Math.ceil(ny / SUB);
  const rh = new Array(rnx * rny).fill(null);
  for (let j = 0; j < rny; j++)
    for (let i = 0; i < rnx; i++) {
      const k = j * SUB * nx + i * SUB;
      if (house[k] && Number.isFinite(clean[k])) rh[j * rnx + i] = Math.round(Math.max(0, clean[k]) * 100) / 100;
    }
  const roofSurface = { theta: grid.theta, x0: grid.x0, y0: grid.y0, step: step * SUB, nx: rnx, ny: rny, h: rh };

  const finalRing = roofRing || (signedArea(ringLocal) < 0 ? ringLocal.slice().reverse() : ringLocal);
  return {
    ok: true,
    eaves: eaveRuns(grid, finalRing, rel, upper),
    roofSurface,
    groundM,
    maxRoofM: Math.round(maxRoofM * 100) / 100,
    houseAreaM2: Math.round(houseM2 * 10) / 10,
    levels,
    wholeHouseTwoStory: levels === 2 && upperShare >= 0.85,
    roofRing,
    upperRing,
    upperShare: Math.round(upperShare * 100) / 100,
    stats,
  };
}
