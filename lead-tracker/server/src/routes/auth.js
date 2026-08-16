import { Router } from "express";
import { db } from "../db.js";
import { COOKIE_NAME, signSession } from "../auth.js";
import { requireAuth, userFromRow } from "../middleware/requireAuth.js";
import { verifyPassword } from "../passwords.js";

const router = Router();
const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Small in-memory per-IP limiter — the login endpoint is the actual front
// door and needs its own throttle independent of anything downstream.
// Resets on redeploy, which is fine for this purpose (mirrors the limiter
// on the public intake route).
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

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase());
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  res.cookie(COOKIE_NAME, signSession(row.id), cookieOptions);
  res.json({ user: userFromRow(row) });
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd });
  res.json({ ok: true });
});

router.get("/me", requireAuth("viewer"), (req, res) => {
  res.json({ user: req.user });
});

export default router;
