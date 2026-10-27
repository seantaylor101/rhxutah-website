// Google's roof height map for one house (Solar API dataLayers): the DSM —
// surface height every 25 cm — and the roof mask, as GeoTIFFs. Resampled
// onto a grid lined up with the house (shared/levels.js gridSpec) so the
// level detection never has to know about map projections.
//
// Billing: one dataLayers call per lookup (Google's "Solar API Data
// Layers" SKU — 1,000 a month free, then about $0.075 each). The GeoTIFF
// downloads that follow it aren't billed separately.
import { fromArrayBuffer } from "geotiff";
import { toLatLng } from "../../../shared/houseGeometry.js";
import { gridSpec, frameToLocal } from "../../../shared/levels.js";

const TIMEOUT_MS = 20000;
const NODATA = -9999;

// WGS84 lat/lng → UTM easting/northing (meters) in the given zone — the
// standard series expansion, good to well under a centimeter
export function toUtm(lat, lng, zone, south) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y =
    k0 *
    (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (south) y += 10000000;
  return [x, y];
}

// a reader for one GeoTIFF: (lat, lng) → value (bilinear), NaN off the map
export async function rasterSampler(arrayBuffer, { nearest = false } = {}) {
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const [data] = await image.readRasters();
  const width = image.getWidth();
  const height = image.getHeight();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const keys = image.getGeoKeys() || {};
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326;
  let project;
  if (epsg >= 32601 && epsg <= 32660) project = (lat, lng) => toUtm(lat, lng, epsg - 32600, false);
  else if (epsg >= 32701 && epsg <= 32760) project = (lat, lng) => toUtm(lat, lng, epsg - 32700, true);
  else if (epsg === 4326) project = (lat, lng) => [lng, lat];
  else throw new Error(`Height map is in a projection this doesn't read (EPSG ${epsg})`);

  const at = (c, r) => {
    if (c < 0 || r < 0 || c >= width || r >= height) return NaN;
    const v = data[r * width + c];
    return v === NODATA || !Number.isFinite(v) ? NaN : v;
  };
  const sample = (lat, lng) => {
    const [X, Y] = project(lat, lng);
    // pixel centers sit half a pixel in from the origin corner
    const c = (X - ox) / rx - 0.5;
    const r = (Y - oy) / ry - 0.5;
    if (nearest) return at(Math.round(c), Math.round(r));
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const fc = c - c0;
    const fr = r - r0;
    const v00 = at(c0, r0);
    const v10 = at(c0 + 1, r0);
    const v01 = at(c0, r0 + 1);
    const v11 = at(c0 + 1, r0 + 1);
    if ([v00, v10, v01, v11].some(Number.isNaN)) return at(Math.round(c), Math.round(r));
    return v00 * (1 - fc) * (1 - fr) + v10 * fc * (1 - fr) + v01 * (1 - fc) * fr + v11 * fc * fr;
  };
  // what the file says about itself, for diagnosing a height map that
  // doesn't line up with the house
  let nodata = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === NODATA || !Number.isFinite(v)) nodata++;
    else {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  sample.meta = {
    epsg,
    width,
    height,
    origin: [ox, oy],
    resolution: [rx, ry],
    geoKeys: keys,
    noDataShare: Math.round((nodata / data.length) * 1000) / 1000,
    range: Number.isFinite(min) ? [min, max] : null,
    pixelOf: (lat, lng) => {
      const [X, Y] = project(lat, lng);
      return { X, Y, col: (X - ox) / rx, row: (Y - oy) / ry };
    },
  };
  return sample;
}

// the house-aligned grid levels.js works on, from the two samplers
export function buildGrid(origin, ringLocal, sampleHeight, sampleMask) {
  const spec = gridSpec(ringLocal);
  const n = spec.nx * spec.ny;
  const h = new Float32Array(n);
  const mask = sampleMask ? new Uint8Array(n) : null;
  for (let j = 0; j < spec.ny; j++)
    for (let i = 0; i < spec.nx; i++) {
      const [x, y] = frameToLocal(spec, spec.x0 + i * spec.step, spec.y0 + j * spec.step);
      const { lat, lng } = toLatLng(origin, x, y);
      const k = j * spec.nx + i;
      h[k] = sampleHeight(lat, lng);
      if (mask) mask[k] = sampleMask(lat, lng) > 0.5 ? 1 : 0;
    }
  return { ...spec, h, mask };
}

async function download(url, key) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}key=${key}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Height map download failed (${res.status})`);
  return res.arrayBuffer();
}

// → { grid, imageryDate, imageryQuality, files, diag } or null when Google
// has no height map for this spot (rural, very new construction). `files`
// are the raw GeoTIFFs and `diag` how they lined up with the house, kept so
// a house that doesn't work can be looked at afterwards.
export async function fetchHeightGrid(origin, ringLocal) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const reach = Math.max(...ringLocal.map(([x, y]) => Math.hypot(x, y)));
  const radius = Math.min(100, Math.ceil(reach + 10));
  const url =
    `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${origin.lat}` +
    `&location.longitude=${origin.lng}&radiusMeters=${radius}&view=IMAGERY_LAYERS` +
    `&requiredQuality=LOW&pixelSizeMeters=0.25&key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.dsmUrl) return null;
  const [dsmBuf, maskBuf] = await Promise.all([download(data.dsmUrl, key), data.maskUrl ? download(data.maskUrl, key).catch(() => null) : null]);
  const files = { dsm: Buffer.from(dsmBuf), mask: maskBuf ? Buffer.from(maskBuf) : null };
  const diag = { radius, request: { lat: origin.lat, lng: origin.lng } };
  let sampleHeight;
  try {
    sampleHeight = await rasterSampler(dsmBuf);
  } catch (err) {
    err.heightMap = { files, diag: { ...diag, error: err.message } };
    throw err;
  }
  const sampleMask = maskBuf ? await rasterSampler(maskBuf, { nearest: true }).catch(() => null) : null;
  const grid = buildGrid(origin, ringLocal, sampleHeight, sampleMask);
  const { pixelOf, ...dsmMeta } = sampleHeight.meta;
  let gridNaN = 0;
  for (const v of grid.h) if (Number.isNaN(v)) gridNaN++;
  return {
    grid,
    imageryDate: data.imageryDate || null,
    imageryQuality: data.imageryQuality || null,
    files,
    diag: {
      ...diag,
      dsm: dsmMeta,
      mask: sampleMask ? { ...sampleMask.meta, pixelOf: undefined } : null,
      houseCenterInDsm: pixelOf(origin.lat, origin.lng),
      heightAtCenter: sampleHeight(origin.lat, origin.lng),
      grid: { nx: grid.nx, ny: grid.ny, step: grid.step, noDataShare: Math.round((gridNaN / grid.h.length) * 1000) / 1000 },
    },
  };
}
