// The roof the 3D model draws, built the way a framer would rather than
// traced from the height map: every eave at its wall's height, every slope
// at the house's pitch, rising until it meets another slope. Over a
// square-cornered outline that is exactly a hip roof (the height at a point
// is the eave plus pitch × its distance in from the nearest eave, measured
// square to the walls), and it handles L- and T-shapes, valleys and all.
// A wall marked as a gable end gets no slope of its own: the slopes beside
// it run out to it, leaving the triangle on the wall.
//
// Two levels: the lower roof over the whole outline (a garage or wing roof
// running up against the second story), and the upper roof over the second
// story's outline. Inside the upper outline the upper roof is the roof.
//
// Everything in local meters (x east, y north); heights in meters.

import { pointInPolygon } from "./houseGeometry.js";
import { gridSpec, frameToLocal, localToFrame } from "./levels.js";

const FT = 0.3048;

function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

// heights over one polygon: seeds just outside it at the eave height of the
// wall they're next to (none beside a gable wall), spread inward at
// `slope` per meter of chessboard distance — the square-to-the-walls
// distance a hip roof rises with
function roofOver(grid, inside, seedHeight, slope) {
  const { nx, ny, step } = grid;
  const N = nx * ny;
  const v = new Float32Array(N).fill(Infinity);
  const fixed = new Uint8Array(N);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (inside[k]) continue;
      // only cells touching the polygon seed it
      let touches = false;
      for (let dj = -1; dj <= 1 && !touches; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < ny && inside[b * nx + a]) {
            touches = true;
            break;
          }
        }
      if (!touches) continue;
      const h = seedHeight(frameToLocal(grid, grid.x0 + i * step, grid.y0 + j * step));
      if (h == null) continue;
      v[k] = h;
      fixed[k] = 1;
    }
  const c = slope * step;
  const relax = (k, q) => {
    if (q >= 0 && q < N && v[q] + c < v[k]) v[k] = v[q] + c;
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!inside[k]) continue;
        if (i > 0) relax(k, k - 1);
        if (j > 0) {
          relax(k, k - nx);
          if (i > 0) relax(k, k - nx - 1);
          if (i < nx - 1) relax(k, k - nx + 1);
        }
      }
    for (let j = ny - 1; j >= 0; j--)
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        if (!inside[k]) continue;
        if (i < nx - 1) relax(k, k + 1);
        if (j < ny - 1) {
          relax(k, k + nx);
          if (i < nx - 1) relax(k, k + nx + 1);
          if (i > 0) relax(k, k + nx - 1);
        }
      }
  }
  for (let k = 0; k < N; k++) if (fixed[k]) v[k] = Infinity; // seeds aren't roof
  return v;
}

// Is this wall a gable end? On the height map, the roof along it rises
// well above its ends toward the middle (an eave stays level).
export function isGableWall(wall, heightAt) {
  if (!heightAt || wall.lengthM < 3) return false;
  const u = [(wall.b[0] - wall.a[0]) / wall.lengthM, (wall.b[1] - wall.a[1]) / wall.lengthM];
  const n = [-u[1], u[0]]; // inward for a counter-clockwise ring
  const at = (t) => {
    const hs = [0.3, 0.6]
      .map((d) => heightAt(wall.a[0] + (wall.b[0] - wall.a[0]) * t + n[0] * d, wall.a[1] + (wall.b[1] - wall.a[1]) * t + n[1] * d))
      .filter((h) => h != null);
    return hs.length ? Math.max(...hs) : null;
  };
  const ends = [at(0.12), at(0.88)].filter((h) => h != null);
  const mids = [0.4, 0.5, 0.6].map(at).filter((h) => h != null);
  if (ends.length < 2 || !mids.length) return false;
  const rise = Math.max(...mids) - Math.max(...ends);
  // a real gable rises about pitch × half the wall's width
  return rise > Math.max(1.0, wall.lengthM * 0.12);
}

// → { heightAt(x, y), lowerAt(x, y), mesh: { nx, ny, point(i, j), h(i, j), center(i, j) } }
// h1Ft / h2Ft: one- and two-story eave heights; pitch12; overhangIn;
// gable(wall) → true for gable-end walls
export function buildRoof(model, { h1Ft = 9, h2Ft = 18, pitch12 = 7, gable = () => false } = {}) {
  const ring = model.roofLocal;
  if (!ring || ring.length < 3) return null;
  const slope = (pitch12 || 7) / 12;
  const overM = ((model.overhangIn ?? 16) / 12) * FT;
  const grid = gridSpec(ring, { step: 0.25, margin: 1.5 });
  const { nx, ny, step } = grid;
  const N = nx * ny;
  const local = (i, j) => frameToLocal(grid, grid.x0 + i * step, grid.y0 + j * step);
  const inLow = new Uint8Array(N);
  const inUp = new Uint8Array(N);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p = local(i, j);
      const k = j * nx + i;
      inLow[k] = pointInPolygon(p, ring) ? 1 : 0;
      inUp[k] = model.upperRoofLocal && pointInPolygon(p, model.upperRoofLocal) ? 1 : 0;
    }
  const eaveOf = (w) => (w.tier === "upper" || w.stories === 2 ? h2Ft : h1Ft) * FT;
  const gableIds = new Set(model.walls.filter((w) => gable(w)).map((w) => w.id));
  const nearest = (p, walls) => {
    let best = null;
    let bestD = Infinity;
    for (const w of walls) {
      const d = distToSegment(p, w.a, w.b);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  };
  const ground = model.walls.filter((w) => w.tier !== "upper");
  // the roof edge sits an overhang out from the wall, that much lower
  // (a seed cell sits a little outside the roof edge: lower it by that
  // much more, so the edge itself lands at the right height)
  const edgeDist = (p, poly) => Math.min(...poly.map((a, i) => distToSegment(p, a, poly[(i + 1) % poly.length])));
  const seedFor = (walls, poly) => (p) => {
    const w = nearest(p, walls);
    if (!w || gableIds.has(w.id)) return null;
    return eaveOf(w) - (overM + edgeDist(p, poly)) * slope;
  };
  const low = roofOver(grid, inLow, seedFor(ground, ring), slope);
  // the upper roof's eaves: its own walls, and ground walls it sits flush on
  // (only walls under the upper roof's own edge — not a one-story wall
  // that happens to be nearby)
  const onUpper = model.upperWallLocal
    ? model.walls.filter((w) => {
        if (w.tier === "upper") return true;
        const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        return edgeDist(mid, model.upperWallLocal) < 0.5;
      })
    : [];
  const up = model.upperRoofLocal && onUpper.length ? roofOver(grid, inUp, seedFor(onUpper, model.upperRoofLocal), slope) : null;
  const height = new Float32Array(N).fill(NaN);
  for (let k = 0; k < N; k++) {
    if (up && inUp[k] && Number.isFinite(up[k])) height[k] = up[k];
    else if (inLow[k] && Number.isFinite(low[k])) height[k] = low[k];
  }
  const sample = (arr) => (x, y) => {
    const [fx, fy] = localToFrame(grid.theta, x, y);
    const i = Math.round((fx - grid.x0) / step);
    const j = Math.round((fy - grid.y0) / step);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
    const v = arr[j * nx + i];
    return Number.isFinite(v) ? v : null;
  };
  // mesh every 50 cm; the cell between four vertices has its own height at
  // the odd index, which picks the diagonal that follows a hip or valley
  const SUB = 2;
  const mnx = Math.floor((nx - 1) / SUB) + 1;
  const mny = Math.floor((ny - 1) / SUB) + 1;
  const hv = (i, j) => {
    const v = height[j * SUB * nx + i * SUB];
    return Number.isFinite(v) ? v : null;
  };
  return {
    heightAt: sample(height),
    lowerAt: sample(low),
    gableIds,
    mesh: {
      nx: mnx,
      ny: mny,
      point: (i, j) => local(i * SUB, j * SUB),
      h: hv,
      center: (i, j) => {
        const a = i * SUB + 1;
        const b = j * SUB + 1;
        if (a >= nx || b >= ny) return null;
        const v = height[b * nx + a];
        return Number.isFinite(v) ? v : null;
      },
    },
  };
}
