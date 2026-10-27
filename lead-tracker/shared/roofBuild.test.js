import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoof } from "./roofBuild.js";
import { buildHouseModel, toLatLng } from "./houseGeometry.js";

const O = { lat: 41, lng: -111.9 };
const ll = (pts) =>
  pts.map(([x, y]) => {
    const p = toLatLng(O, x, y);
    return [p.lat, p.lng];
  });
const FT = 0.3048;

test("a rectangle gets a hip roof: eaves at wall height, ridge at pitch × half the width", () => {
  // 10 × 16 m roof outline, no overhang, one story
  const model = buildHouseModel({ roofOutline: ll([[0, 0], [10, 0], [10, 16], [0, 16]]), overhangIn: 0, frontAz: 180, levels: { count: 1 } });
  const roof = buildRoof(model, { h1Ft: 9, pitch12: 6 });
  const c = model.roofLocal.reduce((t, p) => [t[0] + p[0] / 4, t[1] + p[1] / 4], [0, 0]);
  const ridge = roof.heightAt(c[0], c[1]);
  assert.ok(Math.abs(ridge - (9 * FT + 0.5 * 5)) < 0.15, `ridge ${ridge}`);
  // near the front eave: barely above the wall
  assert.ok(Math.abs(roof.heightAt(c[0], c[1] - 7.8) - (9 * FT + 0.5 * 0.2)) < 0.15);
  // a hip: halfway along the end the roof is lower than at the middle of the ridge
  assert.ok(roof.heightAt(c[0], c[1] + 7) < ridge - 1);
});

test("a gable-end wall keeps the slopes running out to it", () => {
  const model = buildHouseModel({ roofOutline: ll([[0, 0], [10, 0], [10, 16], [0, 16]]), overhangIn: 0, frontAz: 180, levels: { count: 1 } });
  const front = model.walls.find((w) => w.side === "front");
  const roof = buildRoof(model, { h1Ft: 9, pitch12: 6, gable: (w) => w.id === front.id });
  const c = model.roofLocal.reduce((t, p) => [t[0] + p[0] / 4, t[1] + p[1] / 4], [0, 0]);
  // at the front wall's middle the roof is at ridge height
  assert.ok(Math.abs(roof.heightAt(c[0], c[1] - 7.8) - (9 * FT + 2.5)) < 0.2);
});

test("two levels: a garage roof in front runs up to the second story's wall", () => {
  const ground = ll([[0, -6], [14, -6], [14, 10], [0, 10]]);
  const upper = ll([[0, 0], [14, 0], [14, 10], [0, 10]]);
  const model = buildHouseModel({ roofOutline: ground, upperOutline: upper, overhangIn: 0, frontAz: 180 });
  const roof = buildRoof(model, { h1Ft: 9, h2Ft: 18, pitch12: 7 });
  const x = model.roofLocal.reduce((t, p) => t + p[0] / 4, 0);
  const yOf = (y) => y - 2; // the model is centered on the outline's corners: (7, 2)
  // garage roof: low at the front, rising toward the upper wall
  const front = roof.heightAt(x, yOf(-5.8));
  const back = roof.heightAt(x, yOf(-0.3));
  assert.ok(front < 9 * FT + 0.3 && back > front + 2, `${front} → ${back}`);
  // upper roof: starts at the two-story eave
  assert.ok(Math.abs(roof.heightAt(x, yOf(0.2)) - (18 * FT + 0.2 * 7 / 12)) < 0.2);
});
