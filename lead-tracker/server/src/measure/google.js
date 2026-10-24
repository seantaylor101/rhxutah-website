// Google Maps Platform lookups for the measuring tool. One key
// (GOOGLE_MAPS_API_KEY) with three APIs enabled on it:
//   - Geocoding API      address → location, plus the building's outline and
//                        entrances (extra_computations=BUILDING_AND_ENTRANCES)
//   - Solar API          roof segments with pitch and which way each faces
//   - Maps Static API    the satellite picture the outline is drawn over
// The key stays on the server; the satellite image is proxied (see
// routes/measure.js) so it never appears in a URL the phone can see.

const TIMEOUT_MS = 15000;

export function googleConfigured() {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function key() {
  return process.env.GOOGLE_MAPS_API_KEY;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// GeoJSON rings are [lng, lat]; everything else in the app is [lat, lng]
function ringsFromGeoJson(geom) {
  if (!geom || !geom.type || !Array.isArray(geom.coordinates)) return [];
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return polys
    .map((poly) => (Array.isArray(poly[0]) ? poly[0] : null))
    .filter(Boolean)
    .map((ring) => {
      const pts = ring.map(([lng, lat]) => [lat, lng]);
      // GeoJSON closes the ring by repeating the first point
      const [a, b] = [pts[0], pts[pts.length - 1]];
      if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
      return pts;
    })
    .filter((r) => r.length >= 3);
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [y1, x1] = ring[i];
    const [y2, x2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

function containsPoint(ring, lat, lng) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringCenter(ring) {
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

// The building-outline fields have moved around between preview versions,
// so this looks for them both on the result and at the top level.
function pickBuilding(data, result, lat, lng) {
  const buildings = [...(result.buildings || []), ...(data.buildings || [])];
  const candidates = [];
  for (const b of buildings) {
    for (const o of b.building_outlines || b.buildingOutlines || []) {
      for (const ring of ringsFromGeoJson(o.display_polygon || o.displayPolygon)) {
        candidates.push({ ring, placeId: b.place_id || b.placeId || null });
      }
    }
  }
  if (!candidates.length) return null;
  const containing = candidates.filter((c) => containsPoint(c.ring, lat, lng));
  if (containing.length) return containing.sort((a, b) => ringArea(b.ring) - ringArea(a.ring))[0];
  return candidates.sort((a, b) => {
    const [la, ga] = ringCenter(a.ring);
    const [lb, gb] = ringCenter(b.ring);
    return Math.hypot(la - lat, ga - lng) - Math.hypot(lb - lat, gb - lng);
  })[0];
}

function pickEntrance(data, result, placeId) {
  const entrances = [...(result.entrances || []), ...(data.entrances || [])]
    .map((e) => ({
      lat: e.location?.lat ?? e.location?.latitude,
      lng: e.location?.lng ?? e.location?.longitude,
      tags: e.entrance_tags || e.entranceTags || [],
      buildingPlaceId: e.building_place_id || e.buildingPlaceId || null,
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  const forBuilding = placeId ? entrances.filter((e) => e.buildingPlaceId === placeId) : entrances;
  const pool = forBuilding.length ? forBuilding : entrances;
  return pool.find((e) => e.tags.includes("PREFERRED")) || pool[0] || null;
}

export async function geocodeWithBuilding(address) {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
    `&extra_computations=BUILDING_AND_ENTRANCES&key=${key()}`;
  const { data } = await getJson(url);
  if (!data || data.status !== "OK" || !data.results?.length) {
    const reason = data?.status === "ZERO_RESULTS" ? "Couldn't find that address" : `Address lookup failed (${data?.status || "no response"})`;
    const err = new Error(reason);
    err.expose = true;
    throw err;
  }
  const result = data.results[0];
  const { lat, lng } = result.geometry.location;
  const building = pickBuilding(data, result, lat, lng);
  return {
    formattedAddress: result.formatted_address,
    location: { lat, lng },
    outline: building ? building.ring : null,
    entrance: building ? pickEntrance(data, result, building.placeId) : null,
  };
}

// Pitch per roof plane, from Google's Solar API (meant for solar panel
// layout, but it's the same roof geometry a roofer needs). Not every house
// has coverage — a miss here just means no pitch hint, not a failed lookup.
export async function roofFromSolar(lat, lng) {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}` +
    `&location.longitude=${lng}&requiredQuality=MEDIUM&key=${key()}`;
  try {
    const { ok, data } = await getJson(url);
    if (!ok || !data?.solarPotential?.roofSegmentStats?.length) return null;
    const segments = data.solarPotential.roofSegmentStats
      .map((s) => ({
        pitchDeg: s.pitchDegrees,
        azimuthDeg: s.azimuthDegrees,
        areaM2: s.stats?.areaMeters2 ?? null,
        center: s.center ? { lat: s.center.latitude, lng: s.center.longitude } : null,
      }))
      .filter((s) => Number.isFinite(s.pitchDeg) && Number.isFinite(s.azimuthDeg));
    if (!segments.length) return null;
    // the pitch most of the roof area is at — what a "7/12 roof" means
    const byPitch = new Map();
    for (const s of segments) {
      const k = Math.round(s.pitchDeg);
      byPitch.set(k, (byPitch.get(k) || 0) + (s.areaM2 || 1));
    }
    const [predominant] = [...byPitch.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      segments,
      predominantPitchDeg: predominant,
      imageryQuality: data.imageryQuality || null,
      imageryDate: data.imageryDate || null,
    };
  } catch {
    return null;
  }
}

export async function fetchSatelliteImage({ lat, lng, zoom }, size, scale) {
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}` +
    `&size=${size}x${size}&scale=${scale}&maptype=satellite&format=jpg&key=${key()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Satellite image failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
