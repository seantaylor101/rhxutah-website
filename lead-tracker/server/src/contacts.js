import { randomUUID } from "node:crypto";

function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "");
}

// Matches an existing contact by phone first (the most reliable signal
// for "this is the same repeat customer"), falling back to an exact
// case-insensitive name match when no phone is on file for either side.
// Used only when a lead doesn't already know its contactId (a brand new
// lead, or one saved before this column existed) — once a lead is linked,
// later edits go straight through updateContact instead of re-matching.
// Returns the id of the contact the lead is now tied to.
export function upsertContactFromLead(db, { name, phone, email, address }, { isNewLead }) {
  name = (name || "").trim();
  if (!name) return null;
  phone = (phone || "").trim();
  email = (email || "").trim();
  address = (address || "").trim();
  const normPhone = normalizePhone(phone);

  const all = db.prepare(`SELECT * FROM contacts`).all();
  let existing = normPhone ? all.find((c) => normalizePhone(c.phone) === normPhone) : null;
  if (!existing) {
    existing = all.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  }

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE contacts SET name = ?, phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email), address = COALESCE(NULLIF(?, ''), address), updatedAt = ?, leadCount = leadCount + ? WHERE id = ?`
    ).run(name, phone, email, address, now, isNewLead ? 1 : 0, existing.id);
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO contacts (id, name, phone, email, address, leadCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, phone, email, address, isNewLead ? 1 : 0, now, now);
  return id;
}

// direct update once a lead already knows which contact it's tied to — no
// re-matching, so an edit that changes the very field that would've been
// used to find the contact (e.g. the phone) can't lose the link
export function updateContact(db, contactId, { name, phone, email, address }) {
  name = (name || "").trim();
  phone = (phone || "").trim();
  email = (email || "").trim();
  address = (address || "").trim();
  db.prepare(
    `UPDATE contacts SET name = ?, phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email), address = COALESCE(NULLIF(?, ''), address), updatedAt = ? WHERE id = ?`
  ).run(name, phone, email, address, new Date().toISOString(), contactId);
}
