import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";

// A flat directory shared by every tenant -- filenames are randomUUID()+extension
// (unguessable), and the serve route (routes/warranty.js GET /photos/:filename) checks
// the requesting tenant actually owns a warranty_photos row for that filename before
// streaming it back, so a flat directory doesn't weaken tenant isolation.
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");
export const WARRANTY_PHOTOS_DIR = path.join(UPLOADS_ROOT, "warranty-photos");
fs.mkdirSync(WARRANTY_PHOTOS_DIR, { recursive: true });

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, WARRANTY_PHOTOS_DIR),
  filename: (req, file, cb) => cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype] || ""}`),
});

export const warrantyPhotoUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(EXT_BY_MIME, file.mimetype)),
});

export const SAFE_FILENAME = /^[0-9a-f-]+\.(jpg|jpeg|png|webp|heic|heif)$/i;
