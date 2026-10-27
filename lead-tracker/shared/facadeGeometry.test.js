import { test } from "node:test";
import assert from "node:assert/strict";
import { measureFace, rectangleAspect, focalPx, buildFacadeReport, homography, applyH, checkOpenings } from "./facadeGeometry.js";
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
  // the openings schedule and trim
  assert.equal(rep.openingSchedule.items.length, 1);
  const win = rep.openingSchedule.items[0];
  assert.equal(win.no, 1);
  assert.equal(win.tag, "W-1");
  assert.equal(win.label, "Window");
  assert.ok(Math.abs(win.widthIn - 48) <= 0.5 && Math.abs(win.heightIn - 60) <= 0.5, `${win.widthIn} x ${win.heightIn}`);
  assert.ok(Math.abs(win.sillIn - 36) <= 0.5, `sill ${win.sillIn}`);
  assert.equal(rep.openingSchedule.sizes[0].count, 1);
  near(wf.trim.frieze, W, 0.01, "frieze along the front");
  near(wr.trim.rakeEdges, 2 * Math.hypot(15, 7.5), 0.1, "gable edges on the right");
  near(rep.totals.openings.siding.perimeter, 4 + 4 + 10, 0.1, "window trim");
  assert.ok(rep.totals.bySide.front.siding > 0);
  assert.equal(rep.totals.corners.outside.count, 4);
  assert.equal(rep.totals.corners.inside.count, 0);
  assert.ok(rep.totals.squares[1].area > rep.totals.squares[0].area);
});

test("opening checks: impossible ones are flagged, doors snap to the ground, duplicates drop", () => {
  const rect = (x0, y0, w, h) => [
    [x0, y0 + h],
    [x0 + w, y0 + h],
    [x0 + w, y0],
    [x0, y0],
  ];
  const op = (type, x0, y0, w, h) => ({ type, plane: rect(x0, y0, w, h), width: w, height: h, area: w * h });
  const out = checkOpenings(
    [
      op("garage_door", 2, 0.4, 16, 7), // fine; bottom snaps to 0
      op("garage_door", 2, 9, 16, 7), // floating 9 ft up → suspect
      op("door", 25, 1.2, 3, 6.7), // entry door up two steps — fine, snapped
      op("window", 30, 3, 5, 5),
      op("window", 30.2, 3.1, 5, 5), // same window twice
      op("window", 38, 3, 14, 5), // 14 ft wide window → suspect
    ],
    { widthFt: 40, heightFt: 18, groundWall: true },
  );
  const good = out.filter((o) => !o.suspect);
  const bad = out.filter((o) => o.suspect);
  assert.equal(good.length, 3);
  assert.equal(bad.length, 2);
  const garage = good.find((o) => o.type === "garage_door");
  assert.equal(Math.min(...garage.plane.map((p) => p[1])), 0);
  near(garage.height, 7.4, 1e-9, "garage door grows down to the slab");
  assert.ok(bad.some((o) => o.reasons.some((r) => /above the ground/.test(r))));
});

test("two levels: an unseen upper wall isn't counted; a seen one is measured from the roof up", () => {
  const ll = (pts) =>
    pts.map(([x, y]) => {
      const p = toLatLng({ lat: 41, lng: -111.9 }, x * 0.3048, y * 0.3048);
      return [p.lat, p.lng];
    });
  // 40 x 30 ft two-story block, 20 x 20 ft one-story garage out front-left
  const ground = ll([[0, -20], [20, -20], [20, 0], [40, 0], [40, 30], [0, 30]]);
  const upper = ll([[0, 0], [40, 0], [40, 30], [0, 30]]);
  const model = buildHouseModel({ roofOutline: ground, upperOutline: upper, overhangIn: 0, frontAz: 180 });
  const upperFront = model.walls.find((w) => w.tier === "upper" && w.side === "front");
  const garage = model.walls.find((w) => w.tier === "ground" && w.side === "front" && w.stories === 1);
  // photo of the front: garage wall 20 wide x 9 tall; upper wall 20 wide,
  // 8 ft visible above the garage roof
  const cam = camera({ pos: [20, 5, 80], lookAt: [20, 10, 0], f: 3000 });
  const p = (x, y) => cam.project([x, y, 0]);
  const facesFor = (withUpper) => [
    { wallId: garage.id, leftIsCorner: true, rightIsCorner: true, baseVisible: true, corners: { baseLeft: p(0, 0), baseRight: p(20, 0), topLeft: p(0, 9), topRight: p(20, 9) }, peakVisible: false, peak: { x: 0, y: 0 }, material: "brick", materialRegions: [], openings: [] },
    ...(withUpper
      ? [{ wallId: upperFront.id, leftIsCorner: true, rightIsCorner: true, baseVisible: true, corners: { baseLeft: p(0, 12), baseRight: p(20, 12), topLeft: p(0, 20), topRight: p(20, 20) }, peakVisible: false, peak: { x: 0, y: 0 }, material: "stucco", materialRegions: [], openings: [] }]
      : []),
  ];
  const run = (withUpper) =>
    buildFacadeReport(model, [{ photoId: "f", slotKind: "side", imageWidth: cam.imageWidth, imageHeight: cam.imageHeight, focal35: (3000 * 34.6) / 4032, faces: facesFor(withUpper) }], { pitch12: 6 });
  const without = run(false).walls.find((w) => w.id === upperFront.id);
  assert.equal(without.counted, false);
  assert.equal(without.grossArea, 0);
  const rep = run(true);
  const up = rep.walls.find((w) => w.id === upperFront.id);
  assert.equal(up.counted, true);
  near(up.height, 8, 0.05, "visible height above the garage roof");
  near(up.grossArea, 160, 1, "20 x 8");
  assert.equal(rep.walls.find((w) => w.id === garage.id).stories, 1);
  near(rep.heights.h1, 9, 0.05, "one-story height");
  // flush two-story walls with no photo fall back to the default two-story height
  const back = rep.walls.find((w) => w.side === "back" && w.tier === "ground");
  assert.equal(back.stories, 2);
  near(back.height, 18, 1e-9, "default two-story height");
});

test("benchmark scoring compares against the HOVER reference", async () => {
  const { scoreOutline, scoreReport } = await import("./benchmark.js");
  const fs = await import("node:fs");
  const ref = JSON.parse(fs.readFileSync(new URL("./benchmarks/house-a-hover.json", import.meta.url)));
  const o = scoreOutline({ footprintAreaFt2: 1876, perimeterFt: 199 }, ref);
  assert.equal(Math.round(o[0].diffPct), 15);
  const result = {
    walls: [{ side: "back", byMaterial: { siding: 683 } }],
    totals: {
      facades: { siding: 1647, other: 744 },
      openings: { siding: { count: 17, area: 298 }, other: { count: 10, area: 302 } },
      squares: [{ squares: 16.94 }],
    },
    heights: { h1: 8.83, h2: 18.42 },
  };
  const rows = scoreReport(result, ref);
  assert.equal(rows.find((r) => r.metric === "Siding facades (net)").diffPct, 0);
  assert.equal(rows.find((r) => r.metric === "Siding, back").diffPct, 0);
});

test("photos overrule the height map's level: a 'one-story' wall measured at 18 ft is flagged two-story", () => {
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
  // the height map said one story
  const model = buildHouseModel({ roofOutline: box, overhangIn: 0, frontAz: 180, levels: { count: 1 } });
  const front = model.walls.find((w) => w.side === "front");
  assert.equal(front.stories, 1);
  const cam = camera({ pos: [20, 5, 60], lookAt: [20, 10, 0], f: 3000 });
  const rep = buildFacadeReport(model, [{ photoId: "p1", slotKind: "side", imageWidth: cam.imageWidth, imageHeight: cam.imageHeight, focal35: (3000 * 34.6) / 4032, faces: [faceFrom(cam, { wallId: front.id })] }], { pitch12: 6 });
  const wf = rep.walls.find((w) => w.id === front.id);
  near(wf.height, H, 0.05, "photo height used");
  assert.equal(wf.photoStories, 2);
  assert.equal(rep.levelMismatches.length, 1);
  // and the unphotographed walls borrow the two-story height, not 9 ft
  near(rep.walls.find((w) => w.side === "back").height, H, 0.05, "borrowed height");
});

test("a window missing from the best photo is picked up from another photo of the whole wall", () => {
  const FT = 0.3048;
  const O = { lat: 41.0312, lng: -111.9375 };
  const box = [[0, 0], [W * FT, 0], [W * FT, 30 * FT], [0, 30 * FT]].map(([x, y]) => {
    const ll = toLatLng(O, x, y);
    return [ll.lat, ll.lng];
  });
  const model = buildHouseModel({ roofOutline: box, overhangIn: 0, frontAz: 180 });
  const front = model.walls.find((w) => w.side === "front");
  const straight = camera({ pos: [20, 5, 60], lookAt: [20, 10, 0], f: 3000 });
  const angled = camera({ pos: [-10, 5, 50], lookAt: [20, 10, 0], f: 3000 });
  const win = (cam, x0) => {
    const p = (x, y) => cam.project([x, y, 0]);
    return { type: "window", arched: false, corners: [p(x0, 8), p(x0 + 3, 8), p(x0 + 3, 3), p(x0, 3)] };
  };
  // the straight-on photo only got the left window (a bush hid the right one)
  const f1 = faceFrom(straight, { wallId: front.id, materialRegions: [], openings: [win(straight, 6)] });
  const f2 = faceFrom(angled, { wallId: front.id, materialRegions: [], openings: [win(angled, 6), win(angled, 30)] });
  const a = (id, cam, face, slotKind) => ({ photoId: id, slotKind, imageWidth: cam.imageWidth, imageHeight: cam.imageHeight, focal35: (3000 * 34.6) / 4032, faces: [face] });
  const rep = buildFacadeReport(model, [a("p1", straight, f1, "side"), a("p2", angled, f2, "corner")], { pitch12: 6 });
  const wf = rep.walls.find((w) => w.id === front.id);
  assert.equal(wf.openings.length, 2);
  const right = wf.openings.find((o) => o.left > 20);
  near(right.left, 30, 0.1, "second window position");
  near(right.width, 3, 0.05, "second window width");
  assert.equal(right.fromPhotoId, "p2");
  assert.equal(rep.openingSchedule.items.length, 2);
});

test("a photo height no wall can have is thrown out for the typical height", () => {
  const FT = 0.3048;
  const O = { lat: 41.0312, lng: -111.9375 };
  const box = [[0, 0], [W * FT, 0], [W * FT, 30 * FT], [0, 30 * FT]].map(([x, y]) => {
    const ll = toLatLng(O, x, y);
    return [ll.lat, ll.lng];
  });
  const model = buildHouseModel({ roofOutline: box, overhangIn: 0, frontAz: 180, levels: { count: 1 } });
  const front = model.walls.find((w) => w.side === "front");
  const cam = camera({ pos: [20, 5, 90], lookAt: [20, 15, 0], f: 3000 });
  const p = (x, y) => cam.project([x, y, 0]);
  // marked 34 ft tall — a one-story wall can't be
  const face = { wallId: front.id, leftIsCorner: true, rightIsCorner: true, baseVisible: true, corners: { baseLeft: p(0, 0), baseRight: p(W, 0), topLeft: p(0, 34), topRight: p(W, 34) }, peakVisible: false, peak: { x: 0, y: 0 }, material: "siding", materialRegions: [], openings: [] };
  const rep = buildFacadeReport(model, [{ photoId: "p1", slotKind: "side", imageWidth: cam.imageWidth, imageHeight: cam.imageHeight, focal35: (3000 * 34.6) / 4032, faces: [face] }], { pitch12: 6 });
  const wf = rep.walls.find((w) => w.id === front.id);
  near(wf.height, 9, 1e-9, "typical one-story height");
  assert.ok(wf.notes.some((n) => /can't be right/.test(n)));
});
