import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import exifReader from "exif-reader";
import { randomUUID } from "node:crypto";
import { DB_PATH } from "../db.js";

// same persistent disk as the database and job media, own folder
export const MEASURE_PHOTOS_DIR = path.join(path.dirname(DB_PATH), "measure-photos");
fs.mkdirSync(MEASURE_PHOTOS_DIR, { recursive: true });

export const SAFE_MEASURE_FILENAME = /^[0-9a-f-]+\.(jpg|jpeg|png|heic|heif)$/i;

const EXT_BY_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/heic": ".heic", "image/heif": ".heif" };
const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif"]);

export const measurePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MEASURE_PHOTOS_DIR),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${file._resolvedExt}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname || "").toLowerCase();
    if (!EXTENSIONS.has(ext)) return cb(null, false);
    file._resolvedExt = ext === ".jpeg" ? ".jpg" : ext;
    cb(null, true);
  },
});

// Long edge kept at measurement-friendly resolution: a 40 ft wall across
// 3072 px is ~1/6" per pixel, far finer than a phone photo is actually
// sharp to, while keeping a house's worth of photos to a few MB on the
// shared 1 GB disk.
const MAX_EDGE = 3072;

const num = (v, lo, hi) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// What the phone recorded at the moment of capture. Everything optional —
// a photo picked from the library has none of it — and anything malformed
// is dropped rather than rejected, since the photo itself is still useful.
export function cleanSensors(input) {
  const s = input && typeof input === "object" ? input : {};
  const capturedAt = str(s.capturedAt, 40);
  return {
    capturedAt: capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : null,
    source: s.source === "library" ? "library" : "camera",
    lat: num(s.lat, -90, 90),
    lng: num(s.lng, -180, 180),
    gpsAccuracy: num(s.gpsAccuracy, 0, 10000),
    gpsAgeMs: num(s.gpsAgeMs, 0, 86400000),
    altitude: num(s.altitude, -1000, 10000),
    heading: num(s.heading, 0, 360),
    headingAccuracy: num(s.headingAccuracy, -1, 360),
    headingSource: str(s.headingSource, 20),
    alpha: num(s.alpha, -360, 360),
    beta: num(s.beta, -360, 360),
    gamma: num(s.gamma, -360, 360),
    cameraPitch: num(s.cameraPitch, -90, 90),
    screenAngle: num(s.screenAngle, -360, 360),
    lens: str(s.lens, 80),
    zoom: num(s.zoom, 0, 100),
    imageWidth: num(s.imageWidth, 1, 20000),
    imageHeight: num(s.imageHeight, 1, 20000),
    // rotation between this shot and the previous one in the same sweep is
    // what stitches overlapping shots of a blank stucco wall, where there
    // aren't enough features to match — so keep the raw orientation history
    sweepId: str(s.sweepId, 60),
  };
}

function dmsToDeg(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const d = dms[0] + dms[1] / 60 + dms[2] / 3600;
  return ref === "S" || ref === "W" ? -d : d;
}

// The bits of EXIF the measuring math cares about. A photo taken with the
// iPhone's own camera app carries its 35mm-equivalent focal length (the
// camera's field of view) and lens, and — if location access was on — where
// it was taken and which way it pointed.
export function summarizeExif(buf) {
  if (!buf) return {};
  let e;
  try {
    e = exifReader(buf);
  } catch {
    return {};
  }
  const img = e.Image || {};
  const photo = e.Photo || {};
  const gps = e.GPSInfo || {};
  const taken = photo.DateTimeOriginal instanceof Date ? photo.DateTimeOriginal : null;
  return {
    make: str(img.Make, 60),
    model: str(img.Model, 60),
    lensModel: str(photo.LensModel, 80),
    focalLengthMm: num(photo.FocalLength, 0, 1000),
    focalLength35mm: num(photo.FocalLengthIn35mmFilm, 0, 5000),
    takenAt: taken && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null,
    lat: num(dmsToDeg(gps.GPSLatitude, gps.GPSLatitudeRef), -90, 90),
    lng: num(dmsToDeg(gps.GPSLongitude, gps.GPSLongitudeRef), -180, 180),
    gpsAccuracy: num(gps.GPSHPositioningError, 0, 10000),
    heading: num(gps.GPSImgDirection, 0, 360),
    headingRef: str(gps.GPSImgDirectionRef, 2),
  };
}

// Reads EXIF, then re-encodes to an upright JPEG at most MAX_EDGE on the long
// side. Returns the final filename + dimensions. A format sharp can't
// decode (HEIC on builds without the HEVC decoder) is kept as uploaded.
export async function processUpload(file) {
  let exif = {};
  try {
    const meta = await sharp(file.path).metadata();
    exif = summarizeExif(meta.exif);
  } catch {
    return { filename: file.filename, width: null, height: null, exif };
  }
  const outName = `${randomUUID()}.jpg`;
  const outPath = path.join(MEASURE_PHOTOS_DIR, outName);
  try {
    const info = await sharp(file.path)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(outPath);
    fs.unlink(file.path, () => {});
    return { filename: outName, width: info.width, height: info.height, exif };
  } catch {
    fs.unlink(outPath, () => {});
    return { filename: file.filename, width: null, height: null, exif };
  }
}

// a library photo has no live sensor readings — fill them from EXIF where
// the phone's camera app recorded them
export function sensorsWithExif(sensors, exif) {
  const out = { ...sensors };
  if (out.lat == null && exif.lat != null && exif.lng != null) {
    out.lat = exif.lat;
    out.lng = exif.lng;
    out.gpsAccuracy = exif.gpsAccuracy ?? 10;
  }
  if (out.heading == null && exif.heading != null) {
    out.heading = exif.heading;
    out.headingSource = exif.headingRef === "M" ? "exif-magnetic" : "exif";
  }
  if (!out.capturedAt && exif.takenAt) out.capturedAt = exif.takenAt;
  if (!out.lens && exif.lensModel) out.lens = exif.lensModel;
  return out;
}
