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

import { cleanOutline, signedArea, pointInPolygon } from "./houseGeometry.js";

export const TWO_STORY_M = 4.6; // roof this far above the ground is a second story's
const MIN_BUILDING_M = 1.8; // anything lower than this is a fence, car or bush
const STEP_M = 1.1; // a drop this big over STEP_PX is an eave above a lower roof
const STEP_PX = 3;
const MIN_UPPER_M2 = 12;
const EXPLAINED_EDGE = 0.55; // share of a second story's edge that must be eave or step

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

function maskToRing(grid, m) {
  const corners = traceOuter(m, grid.nx, grid.ny);
  if (!corners) return null;
  const pts = corners.map(([u, v]) => frameToLocal(grid, grid.x0 + (u - 0.5) * grid.step, grid.y0 + (v - 0.5) * grid.step));
  const ring = cleanOutline(pts);
  return ring.length >= 3 && Math.abs(signedArea(ring)) > 4 ? ring : null;
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
  let roofRing = maskToRing(grid, house);
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
      upperRing = maskToRing(grid, closeMask(upper, nx, ny, 2));
      if (!upperRing) levels = 1;
    }
    // ≥ 85%: the whole house is two stories — the upper outline is the roof
    // outline itself (the caller fills that in)
  }

  return {
    ok: true,
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
