import { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { COOKIE_NAME, signSession } from "../auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { logAccess } from "../activityLog.js";

const router = Router();
const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Constant-time compare: hash both sides to a fixed-length digest first so
// timingSafeEqual (which requires equal-length buffers) never short-circuits
// on the attacker-controlled input's length, and never throws on a mismatch.
function safeCompare(a, b) {
  const hashA = createHash("sha256").update(String(a)).digest();
  const hashB = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(hashA, hashB);
}

// Small in-memory per-IP limiter — the passcodes are the entire auth model
// here, so the login endpoint is the actual front door and needs its own
// throttle independent of anything downstream. Resets on redeploy, which is
// fine for this purpose (mirrors the limiter on the public intake route).
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

// Sweep out IPs with no recent attempts so `attempts` doesn't grow unbounded
// over a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of attempts) {
    if (!timestamps.some((t) => now - t < WINDOW_MS)) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

router.post("/login", (req, res) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many attempts — try again later" });
  }

  const { passcode } = req.body || {};
  if (!passcode) return res.status(400).json({ error: "Passcode required" });

  let role = null;
  if (process.env.OWNER_PASSCODE && safeCompare(passcode, process.env.OWNER_PASSCODE)) role = "owner";
  else if (process.env.VIEWER_PASSCODE && safeCompare(passcode, process.env.VIEWER_PASSCODE)) role = "viewer";

  if (!role) return res.status(401).json({ error: "Incorrect passcode" });

  if (role === "viewer") logAccess("viewer");

  res.cookie(COOKIE_NAME, signSession(role), cookieOptions);
  res.json({ role });
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd });
  res.json({ ok: true });
});

router.get("/me", requireAuth("viewer"), (req, res) => {
  // the client checks this once every time the app opens — the natural
  // point to log a project-manager "opened the app" event
  if (req.role === "viewer") logAccess("viewer");
  res.json({ role: req.role });
});

export default router;
