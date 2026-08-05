import { Router } from "express";
import { COOKIE_NAME, signSession } from "../auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post("/login", (req, res) => {
  const { passcode } = req.body || {};
  if (!passcode) return res.status(400).json({ error: "Passcode required" });

  let role = null;
  if (passcode === process.env.OWNER_PASSCODE) role = "owner";
  else if (passcode === process.env.VIEWER_PASSCODE) role = "viewer";

  if (!role) return res.status(401).json({ error: "Incorrect passcode" });

  res.cookie(COOKIE_NAME, signSession(role), cookieOptions);
  res.json({ role });
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd });
  res.json({ ok: true });
});

router.get("/me", requireAuth("viewer"), (req, res) => {
  res.json({ role: req.role });
});

export default router;
