import { test } from "node:test";
import assert from "node:assert/strict";
import { measureFace, rectangleAspect, focalPx, buildFacadeReport, homography, applyH } from "./facadeGeometry.js";
import { buildHouseModel, toLatLng } from "./houseGeometry.js";

// A virtual camera photographing a known wall in feet: wall in the z=0
// plane, x along it, y up. Returns image points (y down) for world points.
function camera({ pos, lookAt, f, w = 4032, h = 3024 }) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => {
    const l = Math.hypot(...a);
    return a.map((x) => x / l);
  };
  const dotV = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fwd = norm(sub(lookAt, pos));
  const right = norm(crossV(fwd, [0, 1, 0]));
  const up = crossV(right, fwd);
  return {
    imageWidth: w,
    imageHeight: h,
    f,
    project: ([x, y, z]) => {
      const d = sub([x, y, z], pos);
      const X = dotV(right, d);
      const Y = dotV(up, d);
      const Z = dotV(fwd, d);
      return { x: w / 2 + (f * X) / Z, y: h / 2 - (f * Y) / Z };
    },
  };
}

const W = 40;
const H = 18;
const PEAK = 26;
const WIN = { x0: 6, x1: 10, y0: 3, y1: 8 }; // a 4' × 5' window

function faceFrom(cam, extra = {}) {
  const p = (x, y) => cam.project([x, y, 0]);
  return {
    wallId: "W1",
    leftIsCorner: true,
    rightIsCorner: true,
    baseVisible: true,
    corners: { baseLeft: p(0, 0), baseRight: p(W, 0), topLeft: p(0, H), topRight: p(W, H) },
    peakVisible: true,
    peak: p(W / 2, PEAK),
    material: "siding",
    openings: [{ type: "window", arched: false, corners: [p(WIN.x0, WIN.y1), p(WIN.x1, WIN.y1), p(WIN.x1, WIN.y0), p(WIN.x0, WIN.y0)] }],
    materialRegions: [{ material: "brick", polygon: [p(0, 0), p(W, 0), p(W, 3), p(0, 3)] }],
    ...extra,
  };
}

function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual.toFixed(3)} vs ${expected} (±${tol})`);
}

for (const [name, pos, lookAt] of [
  ["straight on, standing in the yard", [20, 5, 60], [20, 10, 0]],
  ["steep angle from a narrow side yard", [-6, 5, 14], [22, 10, 0]],
  ["tilted up from close", [20, 5, 28], [20, 16, 0]],
  ["corner shot at 45°", [-25, 5, 45], [12, 9, 0]],
]) {
  test(`measures a wall photographed ${name}`, () => {
    const cam = camera({ pos, lookAt, f: 3000 });
    const m = measureFace(faceFrom(cam), W, cam);
    assert.ok(m.ok, m.reason);
    near(m.heightFt, H, 0.05, "eave height");
    near(m.peak[1], PEAK, 0.1, "peak height");
    near(m.peak[0], W / 2, 0.1, "peak position");
    const win = m.openings[0];
    near(win.width, 4, 0.05, "window width");
    near(win.height, 5, 0.05, "window height");
    near(m.regions[0].area, W * 3, 0.5, "brick band area");
    near(m.grossArea, W * H + (W * (PEAK - H)) / 2, 1, "gross area");
  });
}

test("a wrong focal length skews the height, which is why the lens matters", () => {
  const cam = camera({ pos: [-6, 5, 14], lookAt: [22, 10, 0], f: 3000 });
  const wrong = measureFace(faceFrom(cam), W, { ...cam, f: 2400 });
  assert.ok(wrong.ok);
  assert.ok(Math.abs(wrong.heightFt - H) > 0.3, `expected a visible error, got ${wrong.heightFt}`);
});

test("an oblique quad also reveals the focal length on its own", () => {
  const cam = camera({ pos: [-6, 5, 14], lookAt: [22, 10, 0], f: 3000 });
  const face = faceFrom(cam);
  const flip = (p) => [p.x, cam.imageHeight - p.y];
  const r = rectangleAspect(
    flip(face.corners.baseLeft),
    flip(face.corners.baseRight),
    flip(face.corners.topLeft),
    flip(face.corners.topRight),
    3000,
    cam.imageWidth / 2,
    cam.imageHeight / 2,
  );
  near(r.fSelf, 3000, 30, "self-calibrated focal");
});

test("a wall cut off by the frame isn't scaled from the satellite width", () => {
  const cam = camera({ pos: [20, 5, 60], lookAt: [20, 10, 0], f: 3000 });
  const m = measureFace(faceFrom(cam, { rightIsCorner: false }), W, cam);
  assert.equal(m.ok, false);
});

test("focal length from the lens's 35mm-equivalent", () => {
  near(focalPx({ imageWidth: 4032, imageHeight: 3024, focal35: 26 }), 3030, 5, "26mm on a 12MP frame");
  near(focalPx({ imageWidth: 1920, imageHeight: 1440, lens: "Back Ultra Wide Camera" }), 721, 5, "ultra-wide default");
});

test("homography round trip", () => {
  const Hm = homography(
    [
      [10, 10],
      [200, 30],
      [180, 220],
      [5, 190],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  );
  const [x, y] = applyH(Hm, [200, 30]);
  near(x, 1, 1e-9, "x");
  near(y, 0, 1e-9, "y");
});

test("full report: heights, gable from pitch when unseen, openings, squares, corners", () => {
  const FT = 0.3048;
  const O = { lat: 41.0312, lng: -111.9375 };
  const box = [
    [0, 0],
    [W * FT, 0],
    [W * FT, 30 * FT],
    [0, 30 * FT],
  ].map(([x, y]) => {
    const ll = toLatLng(O, x, y);
    return [ll.lat, ll.lng];
  });
  const model = buildHouseModel({ roofOutline: box, overhangIn: 0, frontAz: 180 });
  const front = model.walls.find((w) => w.side === "front");
  const right = model.walls.find((w) => w.side === "right");
  right.roofEdge = "gable"; // pretend Solar said so
  const cam = camera({ pos: [20, 5, 60], lookAt: [20, 10, 0], f: 3000 });
  const face = faceFrom(cam, { wallId: front.id, peakVisible: false });
  const analyses = [{ photoId: "p1", slotKind: "side", imageWidth: cam.imageWidth, imageHeight: cam.imageHeight, focal35: (3000 * 34.6) / 4032, faces: [face] }];
  const rep = buildFacadeReport(model, analyses, { pitch12: 6 });
  const wf = rep.walls.find((w) => w.id === front.id);
  const wr = rep.walls.find((w) => w.id === right.id);
  near(wf.eaveHeight, H, 0.05, "front eave");
  assert.equal(wf.openings.length, 1);
  assert.equal(wf.openings[0].material, "siding");
  near(wf.byMaterial.brick, W * 3, 0.5, "brick on front");
  // the right wall had no photo: height borrowed, gable from 6/12 pitch
  assert.equal(wr.measured, false);
  near(wr.eaveHeight, H, 0.05, "borrowed height");
  near(wr.peakHeight, H + (30 / 2) * 0.5, 0.1, "gable from pitch");
  assert.equal(rep.totals.corners.outside.count, 4);
  assert.equal(rep.totals.corners.inside.count, 0);
  assert.ok(rep.totals.squares[1].area > rep.totals.squares[0].area);
});
