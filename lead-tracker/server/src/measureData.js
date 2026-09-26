// Validates the calibration + measurement lines saved against a job photo.
// The actual homography math (perspective correction) lives client-side —
// this is just making sure nothing malformed or absurd lands in the
// database, not re-deriving the geometry.
import { randomUUID } from "node:crypto";

const MAX_MEASUREMENTS = 40;

function isUnitPoint(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((n) => typeof n === "number" && Number.isFinite(n) && n >= -0.05 && n <= 1.05)
  );
}

function validateCalibration(calibration) {
  if (calibration === null) return { ok: true, value: null };
  if (typeof calibration !== "object") return { ok: false, error: "Invalid calibration" };
  const { corners, realWidth, realHeight } = calibration;
  if (!Array.isArray(corners) || corners.length !== 4 || !corners.every(isUnitPoint)) {
    return { ok: false, error: "Calibration needs exactly 4 corner points" };
  }
  const w = Number(realWidth);
  const h = Number(realHeight);
  if (!Number.isFinite(w) || w <= 0 || w > 10000) return { ok: false, error: "Invalid reference width" };
  if (!Number.isFinite(h) || h <= 0 || h > 10000) return { ok: false, error: "Invalid reference height" };
  return { ok: true, value: { corners, realWidth: w, realHeight: h } };
}

function validateMeasurements(measurements) {
  if (!Array.isArray(measurements)) return { ok: false, error: "measurements must be an array" };
  if (measurements.length > MAX_MEASUREMENTS) return { ok: false, error: "Too many measurements on one photo" };
  const cleaned = [];
  for (const m of measurements) {
    if (!m || !isUnitPoint(m.a) || !isUnitPoint(m.b)) return { ok: false, error: "Invalid measurement point" };
    cleaned.push({
      id: typeof m.id === "string" && m.id ? m.id : randomUUID(),
      a: m.a,
      b: m.b,
      label: String(m.label || "").trim().slice(0, 80),
      createdAt: typeof m.createdAt === "string" && m.createdAt ? m.createdAt : new Date().toISOString(),
    });
  }
  return { ok: true, value: cleaned };
}

export function validateMeasureData(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid measure data" };
  const cal = validateCalibration("calibration" in input ? input.calibration : null);
  if (!cal.ok) return cal;
  const meas = validateMeasurements("measurements" in input ? input.measurements : []);
  if (!meas.ok) return meas;
  return { ok: true, value: { calibration: cal.value, measurements: meas.value } };
}

export function parseMeasureData(raw) {
  if (!raw) return { calibration: null, measurements: [] };
  try {
    const parsed = JSON.parse(raw);
    const result = validateMeasureData(parsed);
    return result.ok ? result.value : { calibration: null, measurements: [] };
  } catch {
    return { calibration: null, measurements: [] };
  }
}
