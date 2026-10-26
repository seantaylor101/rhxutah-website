import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "leads.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stage TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    startDate TEXT,
    revenue REAL,
    wonAt TEXT,
    paidAt TEXT,
    source TEXT,
    sourceOther TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    archivedAt TEXT
  );
`);

// migrations for columns added after the table already existed in production
const existingColumns = new Set(db.prepare(`PRAGMA table_info(leads)`).all().map((c) => c.name));
if (!existingColumns.has("job")) {
  db.exec(`ALTER TABLE leads ADD COLUMN job TEXT DEFAULT ''`);
}
if (!existingColumns.has("phone")) {
  db.exec(`ALTER TABLE leads ADD COLUMN phone TEXT DEFAULT ''`);
}
if (!existingColumns.has("email")) {
  db.exec(`ALTER TABLE leads ADD COLUMN email TEXT DEFAULT ''`);
}
if (!existingColumns.has("bidSentAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN bidSentAt TEXT`);
}
if (!existingColumns.has("completedAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN completedAt TEXT`);
}
if (!existingColumns.has("materialCost")) {
  db.exec(`ALTER TABLE leads ADD COLUMN materialCost REAL`);
}
if (!existingColumns.has("laborCost")) {
  db.exec(`ALTER TABLE leads ADD COLUMN laborCost REAL`);
}
if (!existingColumns.has("commission")) {
  db.exec(`ALTER TABLE leads ADD COLUMN commission REAL`);
}
if (!existingColumns.has("reportCompletedAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN reportCompletedAt TEXT`);
}
if (!existingColumns.has("lastReportReminderAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN lastReportReminderAt TEXT`);
}
if (!existingColumns.has("wentWell")) {
  db.exec(`ALTER TABLE leads ADD COLUMN wentWell TEXT DEFAULT ''`);
}
if (!existingColumns.has("wentWrong")) {
  db.exec(`ALTER TABLE leads ADD COLUMN wentWrong TEXT DEFAULT ''`);
}
if (!existingColumns.has("reportTags")) {
  // replaces the wentWell/wentWrong free-text pair above with a JSON array
  // of one-tap tag keys (see jobReportTags.js) — those two columns are left
  // in place, just unused by anything new, rather than migrated/dropped
  db.exec(`ALTER TABLE leads ADD COLUMN reportTags TEXT DEFAULT '[]'`);
}
if (!existingColumns.has("actualWorkDays")) {
  db.exec(`ALTER TABLE leads ADD COLUMN actualWorkDays REAL`);
}
if (!existingColumns.has("appointmentAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN appointmentAt TEXT`);
}
if (!existingColumns.has("appointmentReminderSentAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN appointmentReminderSentAt TEXT`);
}
if (!existingColumns.has("address")) {
  db.exec(`ALTER TABLE leads ADD COLUMN address TEXT DEFAULT ''`);
}
if (!existingColumns.has("lostAt")) {
  // when a lead was actually marked lost — previously the "lost" stage had
  // no timestamp of its own, so a lead moved to lost couldn't be attributed
  // to a month for reporting the way every other stage transition can
  db.exec(`ALTER TABLE leads ADD COLUMN lostAt TEXT`);
}
if (!existingColumns.has("scheduledAt")) {
  // when a won job moved into the new "scheduled" stage (between "won" and
  // "progress") — a PM has actually set a start date and is ready to
  // begin, vs. a job that's won but still sitting unscheduled
  db.exec(`ALTER TABLE leads ADD COLUMN scheduledAt TEXT`);
}
if (!existingColumns.has("scopeOfWork")) {
  // JSON-encoded array of { id, text, done } checklist items, filled out
  // right after a lead is marked won so the project manager knows exactly
  // what to plan for and who to hire
  db.exec(`ALTER TABLE leads ADD COLUMN scopeOfWork TEXT DEFAULT ''`);
}
if (!existingColumns.has("followUps")) {
  // JSON-encoded array of { id, createdAt } — one entry per logged
  // follow-up call/text/email while a lead sits in "bid", so the owner can
  // both see the running count on a lead and measure whether following up
  // more actually correlates with winning the job
  db.exec(`ALTER TABLE leads ADD COLUMN followUps TEXT DEFAULT ''`);
}
if (!existingColumns.has("manager")) {
  // who's running this job day-to-day — "Sean" or "Dave", picked right
  // after a lead is marked won (see the job-manager prompt that runs
  // before the scope-of-work prompt). Gates the "Lead won!" push: it only
  // goes out once Dave is actually tagged as the manager, not on every won
  // job regardless of who's handling it
  db.exec(`ALTER TABLE leads ADD COLUMN manager TEXT`);
}
if (!existingColumns.has("payees")) {
  // JSON-encoded array of { id, name, role: 'sub'|'pm', agreedAmount,
  // payments: [{ id, amount, method, methodOther, date, note, createdAt }],
  // createdAt } — who's owed money on this job (subcontractors and/or the
  // job's PM) and every payment logged against them. Owner-only, same as
  // the other cost fields (materialCost/laborCost/commission) — stripped
  // from the viewer-role response in GET /api/leads.
  db.exec(`ALTER TABLE leads ADD COLUMN payees TEXT DEFAULT ''`);
}
if (!existingColumns.has("contactId")) {
  // which contacts-table row this lead is tied to, set once at creation.
  // Later edits to name/phone/email/address update that same contact
  // directly instead of re-matching from scratch — re-matching after an
  // edit (e.g. the phone just changed) can no longer find the old link and
  // would spin up a duplicate contact instead of updating the real one.
  db.exec(`ALTER TABLE leads ADD COLUMN contactId TEXT`);
}

if (!existingColumns.has("jobDetails")) {
  // JSON-encoded job-profile info the PM works from, kept off the board's
  // lead cards so they stay scannable: { instructions, materials: { ordered,
  // supplier, availability, availableDate }, pickups: [{ id, text, where,
  // done }], equipment: [keys] } — see routes/leads.js normalizeJobDetails
  db.exec(`ALTER TABLE leads ADD COLUMN jobDetails TEXT DEFAULT ''`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

// which role was signed in on the device when it subscribed — lets a
// notification target just the owner or just the viewer instead of every
// registered device. Subscriptions saved before this column existed have no
// role on file until that device unsubscribes/resubscribes (e.g. toggling
// push off and back on in Account settings).
if (!db.prepare(`PRAGMA table_info(push_subscriptions)`).all().some((c) => c.name === "role")) {
  db.exec(`ALTER TABLE push_subscriptions ADD COLUMN role TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    leadId TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    role TEXT,
    createdAt TEXT NOT NULL,
    readAt TEXT
  );
`);

// who this alert is for — "owner", "viewer", or NULL for the handful of
// legacy rows written before alerts were scoped by role. Without this every
// notification (a new lead came in, a final report is due) showed up for
// whichever role opened the panel, including ones the PM has no way to act
// on.
if (!db.prepare(`PRAGMA table_info(notifications)`).all().some((c) => c.name === "role")) {
  db.exec(`ALTER TABLE notifications ADD COLUMN role TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('overheadPercent', '13')`).run();

db.exec(`
  CREATE TABLE IF NOT EXISTS warranty_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    issue TEXT DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'reported',
    createdAt TEXT NOT NULL,
    scheduledAt TEXT,
    resolvedAt TEXT
  );
`);

if (!db.prepare(`PRAGMA table_info(warranty_requests)`).all().some((c) => c.name === "address")) {
  db.exec(`ALTER TABLE warranty_requests ADD COLUMN address TEXT DEFAULT ''`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS warranty_photos (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    filename TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'before',
    createdAt TEXT NOT NULL
  );
`);

// audit trail of every lead/warranty-request stage move, for the owner's
// "who moved what, when" activity log
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entityId TEXT NOT NULL,
    entityName TEXT NOT NULL,
    fromStage TEXT,
    toStage TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_createdAt ON activity_log (createdAt DESC)`);

// records every time the viewer (project manager) role opens the app, so
// the owner can see how often it's actually being used
db.exec(`
  CREATE TABLE IF NOT EXISTS access_log (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_access_log_createdAt ON access_log (createdAt DESC)`);

// owner-only address book, auto-populated as leads come in so a repeat
// customer's info doesn't have to be typed in twice. Lives in this same
// per-deployment sqlite file as everything else — there's no shared/cloud
// store behind it, so a contact entered here can never end up in a
// different business's copy of this app
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    leadCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name COLLATE NOCASE)`);

// photos/videos attached to a lead's job profile (files live in job-media/
// next to this db — see uploads.js)
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_media (
    id TEXT PRIMARY KEY,
    leadId TEXT NOT NULL,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    createdAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_lead_media_leadId ON lead_media (leadId)`);

if (!db.prepare(`PRAGMA table_info(lead_media)`).all().some((c) => c.name === "measureData")) {
  // JSON-encoded { calibration: { corners: [[x,y]x4 in 0..1 image space],
  // realWidth, realHeight } | null, measurements: [{ id, a: [x,y], b: [x,y],
  // label, createdAt }] } — a perspective-correct ruler calibrated against
  // one known-size rectangle in the photo (a door, a brick, a siding
  // panel), so later measurements on that same flat surface account for
  // converging lines instead of just scaling one reference length
  // uniformly across the whole image. See client/src/App.jsx's
  // computeHomography/measureDistanceInches for the math.
  db.exec(`ALTER TABLE lead_media ADD COLUMN measureData TEXT DEFAULT ''`);
}

// per-lead public share link (owner-issued) letting a subcontractor view a
// job's instructions and photo/video references without an app login —
// one row per lead; regenerating the token invalidates the old link
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_shares (
    leadId TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL
  );
`);

// house-measurement projects (one per lead): the roof outline traced from
// aerial data — or adjusted by hand — plus the overhang, which side is the
// front, and the Solar API roof pitch. Walls aren't stored; they're derived
// from this every time by shared/houseGeometry.js so there's one source of
// truth. data = JSON { source, roofOutline: [[lat, lng], ...], overhangIn,
// frontAz, entrance, roof, satellite: { lat, lng, zoom }, lookedUpAt }
db.exec(`
  CREATE TABLE IF NOT EXISTS measure_projects (
    leadId TEXT PRIMARY KEY,
    address TEXT DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

// photos shot for measuring, with the phone's sensor readings at the moment
// of capture (location, compass, tilt, lens) — those can't be recovered
// later, and they're what auto-assigns each photo to a wall and, later,
// what lets the measurement engine stitch a sweep of overlapping shots.
// clientId is generated on the phone when the photo is taken, so a retry
// of an upload that actually went through (spotty jobsite signal) is
// recognized instead of saved twice.
db.exec(`
  CREATE TABLE IF NOT EXISTS measure_photos (
    id TEXT PRIMARY KEY,
    leadId TEXT NOT NULL,
    clientId TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    sensors TEXT NOT NULL DEFAULT '{}',
    exif TEXT NOT NULL DEFAULT '{}',
    wallId TEXT,
    assignMethod TEXT,
    assignConfidence REAL,
    wallRef TEXT,
    capturedAt TEXT,
    createdAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_measure_photos_leadId ON measure_photos (leadId)`);

if (!db.prepare(`PRAGMA table_info(measure_photos)`).all().some((c) => c.name === "slot")) {
  // which shot of the guided walk-around this is ("front", "front-right",
  // … see shared/houseGeometry.js GUIDED_SLOTS) or "extra"/NULL for a
  // free-form photo. A guided shot already says what it shows, so it's
  // never sent to "Check these".
  db.exec(`ALTER TABLE measure_photos ADD COLUMN slot TEXT`);
}

// Claude's markup of each measuring photo, cached so re-running a report
// only pays for photos (or wall maps) that changed. cacheKey covers the
// prompt version and the wall list the photo was marked against.
db.exec(`
  CREATE TABLE IF NOT EXISTS measure_photo_markups (
    photoId TEXT NOT NULL,
    cacheKey TEXT NOT NULL,
    imageWidth INTEGER NOT NULL,
    imageHeight INTEGER NOT NULL,
    markup TEXT NOT NULL,
    costUsd REAL NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (photoId, cacheKey)
  );
`);

// generated measurement reports. status: running | done | error.
// progress = JSON { done, total }; result = JSON (see measure/report.js)
db.exec(`
  CREATE TABLE IF NOT EXISTS measure_reports (
    id TEXT PRIMARY KEY,
    leadId TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    costUsd REAL NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    finishedAt TEXT
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_measure_reports_leadId ON measure_reports (leadId, createdAt DESC)`);
// a server restart kills any report mid-run; don't leave it spinning forever
db.prepare(`UPDATE measure_reports SET status = 'error', error = 'Interrupted by a server restart. Run it again.' WHERE status = 'running'`).run();

if (!db.prepare(`PRAGMA table_info(measure_photos)`).all().some((c) => c.name === "contentHash")) {
  // sha-256 of the stored photo file, to turn away the same photo uploaded
  // twice (re-encoding is deterministic, so the same original gives the
  // same stored file). Filled in for older rows by routes/measure.js.
  db.exec(`ALTER TABLE measure_photos ADD COLUMN contentHash TEXT`);
}
