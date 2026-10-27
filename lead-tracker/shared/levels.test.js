import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLevels, gridSpec, frameToLocal } from "./levels.js";
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

test("a main roof that sweeps down over a one-story wing still finds the second story", () => {
  // two-story block u −7..1 with its east roof plane carrying on over a
  // one-story wing to u = 8; one-story garage across the front
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
  assert.ok(!inside(r.upperRing, 0, -7)); // garage
  assert.ok(!inside(r.upperRing, 7, 0)); // far end of the wing
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
