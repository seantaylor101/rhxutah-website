import { Router } from "express";
import { db } from "../db.js";
import { insertLead } from "./leads.js";
import { sendPushToRole } from "../pushService.js";
import { sendBackupEmail } from "../notifyEmail.js";
import { createNotification } from "../notifications.js";

const router = Router();

// Small in-memory per-IP limiter — this endpoint is unauthenticated by
// necessity (it's called from a public website), so it needs some abuse
// deterrence beyond the shared key. Good enough for real site traffic;
// resets on redeploy, which is fine for this purpose.
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;

// The site's fetch() calls carry a client-visible intake key (it has to be —
// it's called from plain page JS), so anything that scrapes the key can POST
// directly here, skipping the honeypot below and any per-page-load state.
// The one thing that abuse pattern reliably does is fire the same payload
// several times in a row, so collapse repeats of the same name+phone+email
// into the lead that's already there instead of creating fresh duplicates.
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

// Sweep out IPs with no recent hits so `hits` doesn't grow unbounded over a
// long-running process — otherwise every distinct visitor IP stays in memory
// forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of hits) {
    if (!timestamps.some((t) => now - t < WINDOW_MS)) hits.delete(ip);
  }
}, WINDOW_MS).unref();

router.post("/leads", (req, res) => {
  const key = req.get("X-Intake-Key");
  if (!process.env.FORM_INTAKE_KEY || key !== process.env.FORM_INTAKE_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many submissions — try again later" });
  }

  const { name, message, service, phone, email, page, company } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });

  // honeypot field — real visitors never see or fill it, so a filled value
  // means whatever submitted this didn't render/respect the page's own form.
  // Pretend success without creating a lead so the sender doesn't learn to
  // stop sending it.
  if (company && String(company).trim()) {
    return res.status(201).json({ ok: true });
  }

  const trimmedName = String(name).trim();
  const trimmedPhone = String(phone || "").trim();
  const trimmedEmail = String(email || "").trim();

  if (trimmedPhone || trimmedEmail) {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const recentDupe = db
      .prepare(
        `SELECT id FROM leads WHERE name = ? AND phone = ? AND email = ? AND createdAt > ? ORDER BY createdAt DESC LIMIT 1`
      )
      .get(trimmedName, trimmedPhone, trimmedEmail, cutoff);
    if (recentDupe) {
      return res.status(201).json({ ok: true });
    }
  }

  const job = [service, message]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" — ");

  const lead = insertLead(db, {
    name,
    job,
    phone,
    email,
    source: "website",
    sourceOther: page || "",
  });

  res.status(201).json({ ok: true });

  const title = "New lead from your website";
  const body = `${lead.name}${lead.job ? " — " + lead.job : ""}${page ? " (" + page + ")" : ""}`;

  // in-app notification log — persists regardless of whether push/email
  // actually land, so there's always somewhere to see what came in
  try {
    createNotification({ leadId: lead.id, title, body, role: "owner" });
  } catch (err) {
    console.error("failed to log notification:", err.message);
  }

  // best-effort — the lead is already saved, don't let a push/email hiccup
  // affect the response the website form sees. Owner-only: a fresh,
  // unqualified lead isn't something for the project manager to act on yet
  sendPushToRole("owner", { title, body, leadId: lead.id }).catch((err) => console.error("push notify failed:", err.message));

  sendBackupEmail(lead).catch((err) => console.error("backup email failed:", err.message));
});

export default router;
