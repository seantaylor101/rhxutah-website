import { db } from "./db.js";
import { googleConfigured } from "./measure/google.js";

// Turns a shift's raw GPS fixes into "where he was and for how long".
//
// Consecutive fixes within STOP_RADIUS_M of each other are one stop. A stop
// runs from the first fix there until the first fix somewhere else (or the
// clock-out), so the drive between two places counts toward the place he
// left. Fixes only come in while the time-clock app is open, so a stop can
// have a long stretch with no fixes in it; `gapMinutes` says how long, so the
// screen can show it instead of pretending it was watched the whole time.
const STOP_RADIUS_M = 150;
const MAX_ACCURACY_SLACK_M = 400;
const PASSING_THROUGH_MS = 10 * 60 * 1000;
const GAP_WORTH_SHOWING_MS = 20 * 60 * 1000;

export function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function buildStops(points, { clockIn, clockOut, now = new Date() }) {
  const clusters = [];
  for (const p of points) {
    const c = clusters[clusters.length - 1];
    // a poor fix (±300 m) shouldn't look like he drove off
    const radius = Math.max(STOP_RADIUS_M, Math.min(p.accuracy || 0, MAX_ACCURACY_SLACK_M));
    if (c && metersBetween(c.center, p) <= radius) {
      c.points.push(p);
      const n = c.points.length;
      c.center = { lat: c.center.lat + (p.lat - c.center.lat) / n, lng: c.center.lng + (p.lng - c.center.lng) / n };
    } else {
      clusters.push({ center: { lat: p.lat, lng: p.lng }, points: [p] });
    }
  }

  const shiftStart = new Date(clockIn);
  const shiftEnd = clockOut ? new Date(clockOut) : now;
  const stops = clusters.map((c, i) => {
    const first = new Date(c.points[0].ts);
    const lastSeen = new Date(c.points[c.points.length - 1].ts);
    const from = i === 0 && first > shiftStart && first - shiftStart < 10 * 60 * 1000 ? shiftStart : first;
    const next = clusters[i + 1];
    const until = next ? new Date(next.points[0].ts) : shiftEnd;
    // longest stretch with no fix while he was here — between two fixes at
    // the stop, or from the last fix until he showed up somewhere else
    let gapFrom = lastSeen;
    let gapTo = until;
    for (let k = 1; k < c.points.length; k++) {
      const a = new Date(c.points[k - 1].ts);
      const b = new Date(c.points[k].ts);
      if (b - a > gapTo - gapFrom) {
        gapFrom = a;
        gapTo = b;
      }
    }
    const gap = gapTo - gapFrom;
    return {
      n: 0,
      lat: c.center.lat,
      lng: c.center.lng,
      from: from.toISOString(),
      until: until.toISOString(),
      lastSeen: lastSeen.toISOString(),
      minutes: Math.max(0, Math.round((until - from) / 60000)),
      fixes: c.points.length,
      gapMinutes: gap >= GAP_WORTH_SHOWING_MS ? Math.round(gap / 60000) : 0,
      gapFrom: gapFrom.toISOString(),
      gapTo: gapTo.toISOString(),
      // one quick fix between two other places: driving past, not a stop
      passingThrough: c.points.length === 1 && i > 0 && !!next && until - first < PASSING_THROUGH_MS,
      atClockIn: c.points.some((p) => p.kind === "in"),
      atClockOut: c.points.some((p) => p.kind === "out"),
      ongoing: !next && !clockOut,
    };
  });
  // number the real stops 1, 2, 3… (drive-bys get no number) so the list
  // and the pins on the map match
  let n = 0;
  for (const st of stops) st.n = st.passingThrough ? 0 : ++n;
  return stops;
}

// ── street addresses for stops (Google Geocoding, cached) ──────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS geocode_cache (
    key TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

// ~11 m grid: fixes at the same house share one lookup
const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

async function reverseGeocode(lat, lng) {
  const key = cacheKey(lat, lng);
  const hit = db.prepare(`SELECT address FROM geocode_cache WHERE key = ?`).get(key);
  if (hit) return hit.address;
  if (!googleConfigured()) return null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
      `&result_type=street_address|premise|establishment|route&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await r.json().catch(() => null);
    const address = data?.results?.[0]?.formatted_address?.replace(/, USA$/, "");
    if (!address) return null;
    db.prepare(`INSERT OR REPLACE INTO geocode_cache (key, address, createdAt) VALUES (?, ?, ?)`).run(
      key,
      address,
      new Date().toISOString()
    );
    return address;
  } catch {
    return null; // no address is fine — the stop still shows with a Maps link
  }
}

export async function withAddresses(stops) {
  const out = [];
  for (const s of stops) {
    out.push({ ...s, address: s.passingThrough ? null : await reverseGeocode(s.lat, s.lng) });
  }
  return out;
}

// static-map marker labels are one character: 1–9, then A–Z
export function stopLabel(n) {
  return n <= 9 ? String(n) : n <= 35 ? String.fromCharCode(64 + n - 9) : "";
}
