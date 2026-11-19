// Learns from Sean's edits. Every drafted estimate keeps a snapshot of what
// Lead Hammer priced. Once Sean sends the proposal from JobTread (it leaves
// "draft"), this compares what went out with the snapshot and records what
// he changed:
//   - on the lead (shown under the draft in Lead Hammer), and
//   - as a short dated note in the job's private "Lead Hammer edits" field in
//     JobTread, which a weekly review reads to suggest pricing/rule changes.
// It only reads the proposal; it never changes or sends it.

import { db } from "./db.js";
import { pave, organizationId, jobtreadConfigured } from "./jobtread.js";
import { diffSnapshot, describeChange, noteFor, fromDocument } from "./editDiff.js";

export { snapshotLines } from "./editDiff.js";

const EDITS_FIELD = "Lead Hammer edits";
const MAX_FIELD_CHARS = 3500;

async function editsFieldId(orgId) {
  const data = await pave({
    organization: {
      $: { id: orgId },
      customFields: { $: { where: { and: [["targetType", "job"], ["name", EDITS_FIELD]] }, size: 1 }, nodes: { id: {} } },
    },
  });
  const found = data?.organization?.customFields?.nodes?.[0];
  if (found) return found.id;
  const created = await pave({
    createCustomField: {
      $: { organizationId: orgId, name: EDITS_FIELD, targetType: "job", type: "text", minValuesRequired: 0, maxValuesAllowed: 1 },
      createdCustomField: { id: {} },
    },
  });
  return created?.createCustomField?.createdCustomField?.id;
}

async function appendJobNote(jobId, note) {
  const orgId = await organizationId();
  const fieldId = await editsFieldId(orgId);
  const data = await pave({
    job: {
      $: { id: jobId },
      customFieldValues: { $: { where: [["customField", "id"], fieldId], size: 1 }, nodes: { value: {} } },
    },
  });
  const existing = data?.job?.customFieldValues?.nodes?.[0]?.value || "";
  let next = existing ? `${existing}\n${note}` : note;
  if (next.length > MAX_FIELD_CHARS) next = next.slice(next.length - MAX_FIELD_CHARS);
  await pave({ updateJob: { $: { id: jobId, customFieldValues: { [fieldId]: next } } } });
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// one pass over every lead with drafts waiting to be sent
export async function reviewSentDrafts() {
  if (!jobtreadConfigured()) return;
  const rows = db.prepare(`SELECT id, jobtread, estimateBasics FROM leads WHERE jobtread LIKE '%"snapshot"%'`).all();
  for (const row of rows) {
    const link = parseJson(row.jobtread, null);
    if (!link?.estimates?.length) continue;
    const basics = parseJson(row.estimateBasics, {});
    let touched = false;
    for (const est of link.estimates) {
      if (!est.snapshot || est.reviewedAt) continue;
      try {
        const data = await pave({
          document: {
            $: { id: est.documentId },
            status: {},
            price: {},
            fullName: {},
            costItems: { $: { size: 100 }, nodes: { name: {}, quantity: {}, unitPrice: {} } },
          },
        });
        const doc = data?.document;
        if (!doc) {
          est.reviewedAt = new Date().toISOString();
          est.deleted = true;
          touched = true;
          continue;
        }
        if (doc.status === "draft") continue; // not sent yet
        const diff = diffSnapshot(est.snapshot, fromDocument(doc.costItems?.nodes), doc.price);
        est.reviewedAt = new Date().toISOString();
        est.sentStatus = doc.status;
        est.sentPrice = doc.price;
        est.changes = diff.changes.map(describeChange);
        est.totalBefore = diff.totalBefore;
        touched = true;
        const note = noteFor({
          date: est.reviewedAt.slice(0, 10),
          fullName: doc.fullName || est.fullName,
          trades: basics.trades || [],
          customerType: basics.customerType,
          diff,
        });
        await appendJobNote(link.jobId, note);
      } catch (err) {
        console.error("edit review failed for", est.documentId, err.message);
      }
    }
    if (touched) db.prepare(`UPDATE leads SET jobtread = ? WHERE id = ?`).run(JSON.stringify(link), row.id);
  }
}

export function startEditReviewScheduler() {
  const run = () => reviewSentDrafts().catch((err) => console.error("edit review sweep failed:", err.message));
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, 3 * 60 * 60 * 1000);
}
