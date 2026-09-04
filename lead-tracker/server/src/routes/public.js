import { Router } from "express";
import { withTenant } from "../db/pool.js";
import { insertLead } from "./leads.js";
import { sendPushToTenantAdmins } from "../pushService.js";
import { sendBackupEmail } from "../notifyEmail.js";
import { createNotification } from "../notifications.js";

const router = Router();

// One Express deployment currently serves one public marketing site (rhxutah.com), so
// FORM_INTAKE_KEY maps to exactly one tenant for now -- set PUBLIC_INTAKE_TENANT_ID to
// that tenant's id once it's onboarded. A future client with their own public site would
// need either a second deployment or a key->tenant lookup table; not needed yet.
const INTAKE_TENANT_ID = process.env.PUBLIC_INTAKE_TENANT_ID;

const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of hits) {
    if (!timestamps.some((t) => now - t < WINDOW_MS)) hits.delete(ip);
  }
}, WINDOW_MS).unref();

router.post("/leads", async (req, res, next) => {
  try {
    const key = req.get("X-Intake-Key");
    if (!process.env.FORM_INTAKE_KEY || key !== process.env.FORM_INTAKE_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!INTAKE_TENANT_ID) {
      console.error("PUBLIC_INTAKE_TENANT_ID is not set — public lead intake is disabled");
      return res.status(503).json({ error: "Not configured" });
    }
    if (isRateLimited(req.ip)) {
      return res.status(429).json({ error: "Too many submissions — try again later" });
    }

    const { name, message, service, phone, email, page } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });

    const job = [service, message].map((s) => (s || "").trim()).filter(Boolean).join(" — ");

    const lead = await withTenant(INTAKE_TENANT_ID, (client) =>
      insertLead(client, INTAKE_TENANT_ID, { name, job, phone, email, source: "website", sourceOther: page || "" })
    );

    res.status(201).json({ ok: true });

    const title = "New lead from your website";
    const body = `${lead.name}${lead.job ? " — " + lead.job : ""}${page ? " (" + page + ")" : ""}`;

    try {
      await createNotification(INTAKE_TENANT_ID, { leadId: lead.id, title, body });
    } catch (err) {
      console.error("failed to log notification:", err.message);
    }

    // best-effort — the lead is already saved, don't let a push/email hiccup affect the
    // response the website form sees. Admin-only: a fresh, unqualified lead isn't
    // something for a PM to act on until the admin (or a PM selling their own book)
    // pushes/assigns it.
    sendPushToTenantAdmins(INTAKE_TENANT_ID, { title, body, leadId: lead.id }).catch((err) =>
      console.error("push notify failed:", err.message)
    );
    sendBackupEmail(lead).catch((err) => console.error("backup email failed:", err.message));
  } catch (err) {
    next(err);
  }
});

export default router;
