import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { DB_PATH } from "./db.js";

// lives next to the sqlite file so it sits on the same persistent Render
// disk — photos survive deploys the same way the database already does
export const WARRANTY_PHOTOS_DIR = path.join(path.dirname(DB_PATH), "warranty-photos");
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
  // silently drop non-image files rather than erroring the whole request —
  // the route handler 400s if that leaves nothing to save
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(EXT_BY_MIME, file.mimetype)),
});

// every stored filename is our own randomUUID() + a known extension, so a
// strict match here doubles as the path-traversal guard for the serve and
// delete routes
export const SAFE_FILENAME = /^[0-9a-f-]+\.(jpg|jpeg|png|webp|heic|heif)$/i;

// photos/videos attached to a lead's job profile to show the crew what needs
// doing — same persistent disk as warranty photos, own folder
export const JOB_MEDIA_DIR = path.join(path.dirname(DB_PATH), "job-media");
fs.mkdirSync(JOB_MEDIA_DIR, { recursive: true });

const VIDEO_EXT_BY_MIME = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};
const JOB_MEDIA_EXT_BY_MIME = { ...EXT_BY_MIME, ...VIDEO_EXT_BY_MIME };

export function jobMediaKind(filename) {
  return /\.(mp4|mov|webm)$/i.test(filename) ? "video" : "image";
}

export const jobMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, JOB_MEDIA_DIR),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${JOB_MEDIA_EXT_BY_MIME[file.mimetype] || ""}`),
  }),
  // the 1GB Render disk is shared with the database and warranty photos, so
  // cap a single upload at a short phone clip's worth rather than unlimited
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(JOB_MEDIA_EXT_BY_MIME, file.mimetype)),
});

export const SAFE_JOB_MEDIA_FILENAME = /^[0-9a-f-]+\.(jpg|jpeg|png|webp|heic|heif|mp4|mov|webm)$/i;
