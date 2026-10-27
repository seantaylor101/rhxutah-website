import { test } from "node:test";
import assert from "node:assert/strict";
import { writeArrayBuffer } from "geotiff";
import { rasterSampler, buildGrid, toUtm } from "./dsm.js";
import { toLocal, toLatLng, signedArea } from "../../../shared/houseGeometry.js";
import { detectLevels } from "../../../shared/levels.js";

test("UTM matches a reference projection", () => {
  // reference values from PROJ (EPSG:4326 → EPSG:32612)
  const [x, y] = toUtm(40.7608, -111.891, 12, false);
  assert.ok(Math.abs(x - 424794.833) < 0.01 && Math.abs(y - 4512585.949) < 0.01);
});

test("a GeoTIFF height map in UTM → house grid → second story found", async () => {
  const origin = { lat: 40.61, lng: -111.92 };
  const [cx, cy] = toUtm(origin.lat, origin.lng, 12, false);
  const res = 0.25;
  const W = 320;
  const ox = cx - (W / 2) * res;
  const oy = cy + (W / 2) * res;
  // 14 × 16 m house, garage roof across the front (south) 6 m, two-story behind
  const roofAt = (e, n) => {
    if (Math.abs(e) > 7 || Math.abs(n) > 8) return null;
    return n < -2 ? 3 + 0.2 * (n + 8) : 5.6 + 0.58 * (7 - Math.abs(e));
  };
  const dsm = new Float32Array(W * W);
  const mask = new Uint8Array(W * W);
  for (let r = 0; r < W; r++)
    for (let c = 0; c < W; c++) {
      const e = ox + (c + 0.5) * res - cx;
      const n = oy - (r + 0.5) * res - cy;
      const roof = roofAt(e, n);
      dsm[r * W + c] = r < 3 ? -9999 : 1390 + (roof ?? 0);
      mask[r * W + c] = roof != null ? 1 : 0;
    }
  // positioned the way Google's files are: a ModelTransformation matrix
  // (north–south step negative), no tiepoint
  const meta = {
    width: W,
    height: W,
    ProjectedCSTypeGeoKey: 32612,
    ModelTransformation: [res, 0, 0, ox, 0, -res, 0, oy, 0, 0, 0, 0, 0, 0, 0, 1],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
  };
  const dsmBuf = await writeArrayBuffer(dsm, { ...meta, SampleFormat: [3], BitsPerSample: [32] });
  const maskBuf = await writeArrayBuffer(mask, { ...meta, SampleFormat: [1], BitsPerSample: [8] });
  const sampleH = await rasterSampler(dsmBuf);
  const sampleM = await rasterSampler(maskBuf, { nearest: true });
  const px = sampleH.meta.pixelOf(origin.lat, origin.lng);
  assert.ok(Math.abs(px.col - W / 2) < 0.6 && Math.abs(px.row - W / 2) < 0.6, `house center at ${px.col}, ${px.row}`);
  assert.ok(Math.abs(sampleH(origin.lat, origin.lng) - (1390 + 5.6 + 0.58 * 7)) < 0.2);

  // Google's outline, a bit too big
  const ring = [
    [-7.6, -8.6],
    [7.6, -8.6],
    [7.6, 8.6],
    [-7.6, 8.6],
  ];
  const grid = buildGrid(origin, ring, sampleH, sampleM);
  const r = detectLevels(grid, ring);
  assert.equal(r.ok, true);
  assert.equal(r.levels, 2);
  assert.ok(Math.abs(Math.abs(signedArea(r.roofRing)) - 224) < 10);
  const ys = r.upperRing.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...ys) + 2) < 0.6 && Math.abs(Math.max(...ys) - 8) < 0.6, `upper ${JSON.stringify(r.upperRing)}`);
  // round trip sanity
  const ll = toLatLng(origin, 3, 4);
  const back = toLocal(origin, ll.lat, ll.lng);
  assert.ok(Math.abs(back[0] - 3) < 1e-6);
});
