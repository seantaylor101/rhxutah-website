import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toLocal,
  toLatLng,
  cleanOutline,
  insetPolygon,
  buildHouseModel,
  assignShotProbabilities,
  assignShots,
  wallCoverage,
  matchWall,
  wallRef,
  sideFor,
  signedArea,
  slotTargets,
  suggestUpperOutline,
  wallForSlot,
  pointInPolygon,
  worldPixel,
  latLngFromWorldPixel,
} from "./houseGeometry.js";

const ORIGIN = { lat: 41.0312, lng: -111.9375 }; // Kaysville-ish

const FT = 0.3048;

function rotate([x, y], deg) {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

// a rectangle traced the way aerial footprints come back: extra points
// along the edges, a few centimeters of wobble, slightly rotated
function noisyRect(w, h, deg) {
  const pts = [];
  const corners = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let seed = 7;
  const jitter = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.12;
  };
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (let k = 0; k < 5; k++) {
      const t = k / 5;
      pts.push(rotate([a[0] + (b[0] - a[0]) * t + jitter(), a[1] + (b[1] - a[1]) * t + jitter()], deg));
    }
  }
  return pts;
}

function edgeLengths(pts) {
  return pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]));
}

function projectFromLocal(localPts, extra = {}) {
  return {
    roofOutline: localPts.map(([x, y]) => {
      const ll = toLatLng(ORIGIN, x, y);
      return [ll.lat, ll.lng];
    }),
    overhangIn: 0,
    ...extra,
  };
}

test("local <-> lat/lng round trip", () => {
  const ll = toLatLng(ORIGIN, 12.5, -7.25);
  const [x, y] = toLocal(ORIGIN, ll.lat, ll.lng);
  assert.ok(Math.abs(x - 12.5) < 1e-6 && Math.abs(y + 7.25) < 1e-6);
});

test("web mercator round trip", () => {
  const [x, y] = worldPixel(ORIGIN.lat, ORIGIN.lng, 20);
  const back = latLngFromWorldPixel(x, y, 20);
  assert.ok(Math.abs(back.lat - ORIGIN.lat) < 1e-9 && Math.abs(back.lng - ORIGIN.lng) < 1e-9);
});

test("cleanOutline squares up a noisy traced rectangle", () => {
  const out = cleanOutline(noisyRect(12, 15, 23));
  assert.equal(out.length, 4);
  const lens = edgeLengths(out).sort((a, b) => a - b);
  assert.ok(Math.abs(lens[0] - 12) < 0.15 && Math.abs(lens[1] - 12) < 0.15, `short sides ${lens}`);
  assert.ok(Math.abs(lens[2] - 15) < 0.15 && Math.abs(lens[3] - 15) < 0.15, `long sides ${lens}`);
  assert.ok(signedArea(out) > 0, "counter-clockwise");
});

test("cleanOutline keeps the jogs of an L-shaped house", () => {
  const L = [
    [0, 0],
    [14, 0],
    [14, 6],
    [8, 6],
    [8, 11],
    [0, 11],
  ];
  // densify + wobble
  const pts = [];
  L.forEach((a, i) => {
    const b = L[(i + 1) % L.length];
    for (let k = 0; k < 4; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / 4 + (k % 2 ? 0.04 : -0.03), a[1] + ((b[1] - a[1]) * k) / 4]);
  });
  const out = cleanOutline(pts);
  assert.equal(out.length, 6);
  assert.ok(Math.abs(Math.abs(signedArea(out)) - (14 * 6 + 8 * 5)) < 2);
});

test("insetPolygon pulls a square in by the overhang", () => {
  const sq = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const lens = edgeLengths(insetPolygon(sq, 0.5));
  for (const l of lens) assert.ok(Math.abs(l - 9) < 1e-9);
});

test("walls are numbered from the front and named like HOVER", () => {
  // 40 x 30 ft box, front facing south
  const box = [
    [0, 0],
    [40 * FT, 0],
    [40 * FT, 30 * FT],
    [0, 30 * FT],
  ];
  const model = buildHouseModel(projectFromLocal(box, { frontAz: 180 }));
  assert.equal(model.walls.length, 4);
  const w1 = model.walls[0];
  assert.equal(w1.id, "W1");
  assert.equal(w1.side, "front");
  assert.ok(Math.abs(w1.lengthIn - 480) < 0.5, `front length ${w1.lengthIn}`);
  const bySide = Object.fromEntries(model.walls.map((w) => [w.side, w]));
  // standing at the street (south) facing north, east is on your right
  assert.ok(Math.abs(bySide.right.normalAz - 90) < 1);
  assert.ok(Math.abs(bySide.left.normalAz - 270) < 1);
  assert.equal(sideFor(0, 180), "back");
});

test("overhang is taken off each wall", () => {
  const box = [
    [0, 0],
    [40 * FT, 0],
    [40 * FT, 30 * FT],
    [0, 30 * FT],
  ];
  const model = buildHouseModel(projectFromLocal(box, { frontAz: 180, overhangIn: 12 }));
  // 12" overhang on both ends → 2 ft shorter
  assert.ok(Math.abs(model.walls[0].lengthIn - 456) < 0.5);
});

function boxModel() {
  // 40 x 30 ft box centered on the origin, front facing south
  const w = 40 * FT;
  const h = 30 * FT;
  return buildHouseModel(
    projectFromLocal(
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ],
      { frontAz: 180 },
    ),
  );
}

function shotAt(model, x, y, heading, extra = {}) {
  const ll = toLatLng(model.origin, x, y);
  return { lat: ll.lat, lng: ll.lng, gpsAccuracy: 5, heading, headingAccuracy: 12, ...extra };
}

test("straight-on front shot is the front wall", () => {
  const model = boxModel();
  const probs = assignShotProbabilities(model, shotAt(model, 0, -12, 0), "a");
  const front = model.walls.find((w) => w.side === "front");
  assert.ok(probs[front.id] > 0.85, JSON.stringify(probs));
});

test("tight side-yard shot looking steeply along the wall is still the side wall", () => {
  const model = boxModel();
  const right = model.walls.find((w) => w.side === "right");
  // 4 ft out from the east wall, looking up the side yard at a steep ~65°
  // angle to the wall, with a decent GPS fix
  const probs = assignShotProbabilities(model, shotAt(model, 24 * FT, -5 * FT, 335, { gpsAccuracy: 3 }), "b");
  const [best] = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  assert.equal(best[0], right.id, JSON.stringify(probs));
});

test("same side-yard shot with poor GPS is flagged for review instead of guessed", () => {
  const model = boxModel();
  const shots = [{ key: "a", sensors: { ...shotAt(model, 24 * FT, -5 * FT, 335, { gpsAccuracy: 8 }), capturedAt: "2026-10-24T17:00:00Z" } }];
  assert.equal(assignShots(model, shots).a.needsReview, true);
});

test("no GPS: heading alone picks the facing side, burst prior keeps a sweep together", () => {
  const model = boxModel();
  const t0 = Date.parse("2026-10-24T17:00:00Z");
  const shots = [0, 5, 10].map((s, i) => ({
    key: `k${i}`,
    sensors: { heading: 270 + (i === 2 ? 30 : 0), headingAccuracy: 15, capturedAt: new Date(t0 + s * 1000).toISOString() },
  }));
  const out = assignShots(model, shots);
  const right = model.walls.find((w) => w.side === "right");
  for (const k of ["k0", "k1", "k2"]) assert.equal(out[k].wallId, right.id);
});

test("coverage: two overlapping close-up shots cover most of a wall", () => {
  const model = boxModel();
  const front = model.walls.find((w) => w.side === "front");
  const t = "2026-10-24T17:00:00Z";
  const shots = [
    { key: "a", sensors: { ...shotAt(model, -3, -9, 0), capturedAt: t, imageWidth: 1920, imageHeight: 1440 } },
    { key: "b", sensors: { ...shotAt(model, 3, -9, 0), capturedAt: t, imageWidth: 1920, imageHeight: 1440 } },
  ];
  const assigned = { a: { wallId: front.id }, b: { wallId: front.id } };
  const cov = wallCoverage(model, shots, assigned);
  assert.equal(cov[front.id].photos, 2);
  assert.ok(cov[front.id].fraction > 0.9, String(cov[front.id].fraction));
});

test("matchWall finds the same wall after the outline shifts slightly", () => {
  const model = boxModel();
  const right = model.walls.find((w) => w.side === "right");
  const ref = wallRef(model, right.id);
  const shifted = buildHouseModel({ ...projectFromLocal(model.wallLocal.map(([x, y]) => [x + 0.4, y - 0.2])), frontAz: 180 });
  assert.equal(matchWall(shifted, ref).side, "right");
});

test("guided shot spots sit outside the house on the right sides, aimed back at it", () => {
  const model = boxModel(); // front faces south
  const t = slotTargets(model);
  const front = t.front.pos;
  assert.ok(front[1] < -15 * FT, "front spot is south of the house");
  assert.ok(Math.abs(t.front.aimAz - 0) < 1, "aimed north at the front");
  assert.ok(t.right.pos[0] > 20 * FT, "right spot is east (standing at the street, east is right)");
  assert.ok(t["back-left"].pos[0] < -20 * FT && t["back-left"].pos[1] > 15 * FT, "back-left is north-west");
  for (const s of Object.values(t)) assert.ok(!pointInPolygon(s.pos, model.wallLocal));
});

test("wallForSlot prefers the sensed wall when it's on the slot's side", () => {
  const model = boxModel();
  const right = model.walls.find((w) => w.side === "right");
  const front = model.walls.find((w) => w.side === "front");
  assert.equal(wallForSlot(model, "right", front.id), right.id);
  assert.equal(wallForSlot(model, "front-right", right.id), right.id);
  assert.equal(wallForSlot(model, "front-right", null), front.id);
});

test("two levels: flush walls become two-story, set-back walls ride on the lower roof", () => {
  // main two-story block 12 x 9 m, one-story garage 6 x 6 m sticking out
  // the front-left (front faces south)
  const ll = (pts) =>
    pts.map(([x, y]) => {
      const p = toLatLng({ lat: 41, lng: -111.9 }, x, y);
      return [p.lat, p.lng];
    });
  const ground = ll([
    [0, -6],
    [6, -6],
    [6, 0],
    [12, 0],
    [12, 9],
    [0, 9],
  ]);
  const upper = ll([
    [0, 0],
    [12, 0],
    [12, 9],
    [0, 9],
  ]);
  const model = buildHouseModel({ roofOutline: ground, upperOutline: upper, overhangIn: 0, frontAz: 180 });
  const byKey = (tier, side) => model.walls.filter((w) => w.tier === tier && w.side === side);
  const back = byKey("ground", "back");
  assert.equal(back.length, 1);
  assert.equal(back[0].stories, 2, "back is flush with the upper story");
  const front = byKey("ground", "front").sort((a, b) => a.mid[0] - b.mid[0]);
  assert.deepEqual(
    front.map((w) => [Math.round(w.lengthM), w.stories]),
    [
      [6, 1],
      [6, 2],
    ],
    "garage front is one story; the main block's front right of it is flush two-story",
  );
  const upperFront = byKey("upper", "front");
  assert.equal(upperFront.length, 1, "the main block's front above the garage roof");
  assert.ok(Math.abs(upperFront[0].lengthM - 6) < 0.01);
  assert.ok(Math.abs(upperFront[0].setbackM - 6) < 0.01, `set back over the 6 m garage, got ${upperFront[0].setbackM}`);
  // left side: garage (one story) then main block flush (two story)
  const left = byKey("ground", "left").sort((a, b) => a.mid[1] - b.mid[1]);
  assert.deepEqual(left.map((w) => w.stories), [1, 2]);
  // sight lines ignore upper walls
  const shot = { lat: toLatLng(model.origin, 3, -20).lat, lng: toLatLng(model.origin, 3, -20).lng, gpsAccuracy: 2, heading: 0, headingAccuracy: 5 };
  const probs = assignShotProbabilities(model, shot, "x");
  assert.ok(Object.keys(probs).every((id) => model.walls.find((w) => w.id === id).tier === "ground"));
});

test("upper outline suggestion picks the high roof planes and stays inside the house", () => {
  const ll = (x, y) => toLatLng({ lat: 41, lng: -111.9 }, x, y);
  const corner = (x, y) => {
    const p = ll(x, y);
    return { lat: p.lat, lng: p.lng };
  };
  const ring = [
    [0, -6],
    [6, -6],
    [6, 0],
    [12, 0],
    [12, 9],
    [0, 9],
  ].map(([x, y]) => {
    const p = ll(x, y);
    return [p.lat, p.lng];
  });
  const project = {
    roofOutline: ring,
    frontAz: 180,
    roof: {
      segments: [
        { pitchDeg: 30, azimuthDeg: 90, areaM2: 60, heightM: 1300, bbox: { sw: corner(6, 0), ne: corner(12, 9) } },
        { pitchDeg: 30, azimuthDeg: 270, areaM2: 60, heightM: 1300, bbox: { sw: corner(0, 0), ne: corner(6, 9) } },
        { pitchDeg: 30, azimuthDeg: 180, areaM2: 20, heightM: 1296, bbox: { sw: corner(0, -6), ne: corner(6, 0) } },
      ],
    },
  };
  const up = suggestUpperOutline(project);
  assert.equal(up.length, 4);
  const m = buildHouseModel({ ...project, upperOutline: up, overhangIn: 0 });
  // compare in the model's own frame (centered on the outline)
  const toM = (x, y) => {
    const p = ll(x, y);
    return toLocal(m.origin, p.lat, p.lng);
  };
  const [x0, y0] = toM(0, 0);
  const [x1, y1] = toM(12, 9);
  const xs = m.upperWallLocal.map((p) => p[0]);
  const ys = m.upperWallLocal.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...ys) - y0) < 0.05 && Math.abs(Math.max(...ys) - y1) < 0.05, `y ${Math.min(...ys)}..${Math.max(...ys)}`);
  assert.ok(Math.abs(Math.min(...xs) - x0) < 0.05 && Math.abs(Math.max(...xs) - x1) < 0.05);
});
