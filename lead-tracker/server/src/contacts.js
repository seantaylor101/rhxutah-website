import { randomUUID } from "node:crypto";

function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "");
}

// Matches an existing contact by phone first, falling back to an exact case-insensitive
// name match when no phone is on file for either side. Used only when a lead doesn't
// already know its contactId -- once linked, later edits go straight through
// updateContact instead of re-matching. Scoped to one tenant's contacts, never crosses
// tenant boundaries (client here is always a tenant-scoped connection from withTenant).
export async function upsertContactFromLead(client, tenantId, { name, phone, email, address }, { isNewLead }) {
  name = (name || "").trim();
  if (!name) return null;
  phone = (phone || "").trim();
  email = (email || "").trim();
  address = (address || "").trim();
  const normPhone = normalizePhone(phone);

  const { rows: all } = await client.query(`SELECT * FROM contacts WHERE tenant_id = $1`, [tenantId]);
  let existing = normPhone ? all.find((c) => normalizePhone(c.phone) === normPhone) : null;
  if (!existing) {
    existing = all.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  }

  const now = new Date().toISOString();
  if (existing) {
    await client.query(
      `UPDATE contacts SET name = $2, phone = COALESCE(NULLIF($3, ''), phone),
         email = COALESCE(NULLIF($4, ''), email), address = COALESCE(NULLIF($5, ''), address),
         updated_at = $6, lead_count = lead_count + $7
       WHERE id = $1`,
      [existing.id, name, phone, email, address, now, isNewLead ? 1 : 0]
    );
    return existing.id;
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO contacts (id, tenant_id, name, phone, email, address, lead_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, tenantId, name, phone, email, address, isNewLead ? 1 : 0, now]
  );
  return id;
}

// Direct update once a lead already knows which contact it's tied to -- no re-matching,
// so an edit that changes the very field that would've been used to find the contact
// (e.g. the phone) can't lose the link.
export async function updateContact(client, tenantId, contactId, { name, phone, email, address }) {
  name = (name || "").trim();
  phone = (phone || "").trim();
  email = (email || "").trim();
  address = (address || "").trim();
  await client.query(
    `UPDATE contacts SET name = $3, phone = COALESCE(NULLIF($4, ''), phone),
       email = COALESCE(NULLIF($5, ''), email), address = COALESCE(NULLIF($6, ''), address),
       updated_at = $7
     WHERE id = $1 AND tenant_id = $2`,
    [contactId, tenantId, name, phone, email, address, new Date().toISOString()]
  );
}
