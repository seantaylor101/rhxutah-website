import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLevels, gridSpec, frameToLocal, squareUp } from "./levels.js";
import { signedArea, pointInPolygon } from "./houseGeometry.js";

const GROUND = 1402.3;
const TURN = (20 * Math.PI) / 180; // houses aren't lined up with north

// house coordinates (u along the front, v toward the back) → local meters
const toWorld = ([u, v]) => [u * Math.cos(TURN) - v * Math.sin(TURN), u * Math.sin(TURN) + v * Math.cos(TURN)];
const toHouse = ([x, y]) => [x * Math.cos(TURN) + y * Math.sin(TURN), -x * Math.sin(TURN) + y * Math.cos(TURN)];
const rect = (u0, v0, u1, v1) => [toWorld([u0, v0]), toWorld([u1, v0]), toWorld([u1, v1]), toWorld([u0, v1])];

// a fake height map from a roof-height function of house coordinates
// (null = not roof), with a tree off to the side and a little noise
function fakeGrid(outlineLocal, roofAt) {
  const spec = gridSpec(outlineLocal);
  const n = spec.nx * spec.ny;
  const h = new Float32Array(n);
  const mask = new Uint8Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.08;
  for (let j = 0; j < spec.ny; j++)
    for (let i = 0; i < spec.nx; i++) {
      const p = frameToLocal(spec, spec.x0 + i * spec.step, spec.y0 + j * spec.step);
      const [u, v] = toHouse(p);
      const roof = roofAt(u, v);
      const k = j * spec.nx + i;
      const tree = Math.hypot(u - 13, v - 2) < 2.2 ? 6.5 : 0;
      h[k] = GROUND + (roof ?? tree) + rand();
      mask[k] = roof != null ? 1 : 0;
    }
  return { ...spec, h, mask };
}

const areaOf = (ring) => Math.abs(signedArea(ring));
const inside = (ring, u, v) => pointInPolygon(toWorld([u, v]), ring);

test("a two-story house with a one-story garage in front: finds the upper story", () => {
  // 14 m wide; garage roof for the front 6 m, two-story gable behind it
  const roofAt = (u, v) => {
    if (Math.abs(u) > 7 || v < -8 || v > 8) return null;
    if (v < -2) return 3.0 + 0.2 * (v + 8); // lower roof up to the upper wall
    return 5.6 + 0.58 * (7 - Math.abs(u)); // main roof
  };
  const outline = rect(-7, -8, 7, 8);
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.groundM - GROUND) < 0.2);
  assert.equal(r.levels, 2);
  assert.equal(r.wholeHouseTwoStory, false);
  // the upper roof is about 14 × 10 m, behind the garage
  assert.ok(Math.abs(areaOf(r.upperRing) - 140) < 14, `upper area ${areaOf(r.upperRing)}`);
  assert.ok(inside(r.upperRing, 0, 3));
  assert.ok(!inside(r.upperRing, 0, -5));
  assert.equal(r.upperRing.length, 4);
});

test("a one-story ranch with a tall ridge stays one story", () => {
  const roofAt = (u, v) => (Math.abs(u) > 6 || Math.abs(v) > 10 ? null : 3.0 + 0.58 * (6 - Math.abs(u)));
  const outline = rect(-6, -10, 6, 10);
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  assert.equal(r.ok, true);
  assert.equal(r.levels, 1);
  assert.equal(r.upperRing, null);
});

test("a plain two-story house is two stories all the way around", () => {
  const roofAt = (u, v) => (Math.abs(u) > 5 || Math.abs(v) > 7 ? null : 5.7 + 0.5 * (5 - Math.abs(u)));
  const outline = rect(-5, -7, 5, 7);
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  assert.equal(r.levels, 2);
  assert.equal(r.wholeHouseTwoStory, true);
});

test("a main roof that sweeps down over a one-story wing is one roof, with a one-story wall under its low side", () => {
  // two-story block u −7..1 with its east roof plane carrying on over a
  // one-story wing to u = 8; one-story garage across the front (a step)
  const roofAt = (u, v) => {
    if (u < -7 || u > 8 || v < -10 || v > 6) return null;
    if (v < -4) return 3.0 + 0.2 * (v + 10);
    if (u < -3) return 5.6 + 0.58 * (u + 7);
    return 7.9 - 0.42 * (u + 3);
  };
  const outline = rect(-7, -10, 8, 6);
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  assert.equal(r.levels, 2);
  assert.ok(inside(r.upperRing, -4, 0));
  assert.ok(inside(r.upperRing, 7, 0)); // the wing is under the main roof: no wall stands on it
  assert.ok(!inside(r.upperRing, 0, -7)); // the garage is a separate, lower roof
  // eaves: west side at two-story height, east side (over the wing) low
  const eaveFacing = (dir) =>
    r.eaves.find((e) => {
      const [ex, ey] = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
      const n = toHouse([ey, -ex]); // outward normal, house coordinates
      return n[0] * dir[0] + n[1] * dir[1] > 0.9 * Math.hypot(...n) && Math.hypot(ex, ey) > 8;
    });
  assert.ok(eaveFacing([-1, 0]).heightM > 4.6, "west eave");
  assert.ok(eaveFacing([1, 0]).heightM < 4.0, "east eave");
});

test("tightens an outline that came out too big", () => {
  const roofAt = (u, v) => (Math.abs(u) > 6 || Math.abs(v) > 8 ? null : 3.0 + 0.5 * (6 - Math.abs(u)));
  const googles = rect(-6.6, -8.7, 6.6, 8.7); // ~20% too much area
  const r = detectLevels(fakeGrid(googles, roofAt), googles);
  assert.ok(r.roofRing);
  assert.ok(Math.abs(areaOf(r.roofRing) - 192) < 8, `roof area ${areaOf(r.roofRing)}`);
  assert.equal(r.roofRing.length, 4);
});

test("no height data → not ok, nothing changed", () => {
  const outline = rect(-5, -5, 5, 5);
  const g = fakeGrid(outline, () => null);
  g.h.fill(NaN);
  const r = detectLevels(g, outline);
  assert.equal(r.ok, false);
});

test("squaring up: small jogs go, real ones stay", () => {
  // a 40 × 30 rectangle with a 1-cell tree notch on top and a real 10 × 8
  // bump-out on the right (cells)
  const ring = [[0, 0], [40, 0], [40, 10], [50, 10], [50, 18], [40, 18], [40, 30], [21, 30], [21, 29], [20, 29], [20, 30], [0, 30]];
  const out = squareUp(ring, 3);
  assert.equal(out.length, 8);
  assert.equal(Math.abs(signedArea(out)), 40 * 30 + 10 * 8);
});

test("the roof is split into its planes: a garage roof and the two slopes of the main gable", () => {
  const roofAt = (u, v) => {
    if (Math.abs(u) > 7 || v < -8 || v > 8) return null;
    if (v < -2) return 3.0 + 0.2 * (v + 8);
    return 5.6 + 0.58 * (7 - Math.abs(u));
  };
  const outline = rect(-7, -8, 7, 8);
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  const big = r.roofSurface.facets.filter((f) => f.areaM2 > 20);
  assert.equal(big.length, 3, JSON.stringify(r.roofSurface.facets));
  // 0.58 m/m = 7/12; the house is turned 20° counter-clockwise, so its
  // slopes face 70° and 250° instead of east and west
  const main = big.filter((f) => Math.abs(f.pitch12 - 7) <= 0.5).map((f) => f.azimuthDeg).sort((a, b) => a - b);
  assert.equal(main.length, 2);
  assert.ok(Math.abs(main[0] - 70) <= 3 && Math.abs(main[1] - 250) <= 3, `azimuths ${main}`);
});

test("a shallow garage roof in front still gets the second-story wall above it", () => {
  // 14 × 16 m two-story house with a garage roof only 2 m deep across the
  // front-left 8 m — under 15% of the roof, but the wall above it is real
  const roofAt = (u, v) => {
    if (Math.abs(u) > 7 || v < -8 || v > 8) return null;
    if (v < -6 && u < 1) return 3.0 + 0.6 * (v + 8); // garage roof, up to 4.2
    if (v < -6) return null;
    return 5.6 + 0.58 * (7 - Math.abs(u));
  };
  const outline = [toWorld([-7, -8]), toWorld([1, -8]), toWorld([1, -6]), toWorld([7, -6]), toWorld([7, 8]), toWorld([-7, 8])];
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  assert.equal(r.levels, 2);
  assert.equal(r.wholeHouseTwoStory, false);
  assert.ok(r.upperRing && !inside(r.upperRing, -3, -7), "garage roof isn't upper roof");
  assert.ok(inside(r.upperRing, -3, -4));
});

test("a wall under a main roof sloping down past it: two stories where the eave is high, one where it comes down low", () => {
  // two-story block u −7..−3 with its gable facing front; its east roof
  // plane runs on down over a one-story wing to u = 8. The front wall's
  // roof line rises to the peak and then runs all the way down.
  const roofAt = (u, v) => {
    if (u < -7 || u > 8 || Math.abs(v) > 6) return null;
    return u < -3 ? 5.6 + 0.58 * (u + 7) : 7.9 - 0.42 * (u + 3);
  };
  const outline = rect(-7, -6, 8, 6);
  const r = detectLevels(fakeGrid(outline, roofAt), outline);
  const front = r.eaves
    .map((e) => ({ ...e, ua: toHouse(e.a), ub: toHouse(e.b) }))
    .filter((e) => Math.abs(e.ua[1] + 6) < 0.6 && Math.abs(e.ub[1] + 6) < 0.6);
  const at = (u) => front.find((e) => Math.min(e.ua[0], e.ub[0]) <= u && Math.max(e.ua[0], e.ub[0]) >= u);
  assert.equal(at(-5).stories, 2, "under the two-story gable");
  assert.equal(at(6).stories, 1, "where the roof has come down to one story");
});
