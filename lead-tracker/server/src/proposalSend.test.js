import { test } from "node:test";
import assert from "node:assert/strict";
import { sendPreview, sendApprovedProposal, SendRefused } from "./proposalSend.js";

process.env.JOBTREAD_GRANT_KEY = "test-key";

function mockJobTread(doc) {
  const calls = [];
  const state = { ...doc, documentRecipients: { nodes: [] } };
  globalThis.fetch = async (url, opts) => {
    const q = JSON.parse(opts.body).query;
    calls.push(q);
    let out = {};
    if (q.document) out = { document: state };
    else if (q.createDocumentRecipient) {
      state.documentRecipients.nodes.push({ id: "r1", emailDeliveryStatus: "sent" });
      out = { createDocumentRecipient: { createdDocumentRecipient: { id: "r1" } } };
    } else if (q.sendDocument) out = { sendDocument: {} };
    else if (q.updateDocument) {
      state.status = q.updateDocument.$.status;
      out = { updateDocument: {} };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  return { calls, state };
}

const draft = {
  id: "doc1",
  fullName: "Proposal 492-1",
  status: "draft",
  price: 2464,
  priceWithTax: 2464,
  emailMessage: "Hey Scott,\n\nThanks for having me out.",
  toName: "Scott Peterson",
  toEmailAddress: "scott@example.com",
  toPhoneNumber: "+18015550123",
  job: { id: "job1" },
  files: { nodes: [] },
};
const link = { jobId: "job1" };
const sent = (calls) => calls.some((c) => c.sendDocument || c.createDocumentRecipient);

test("preview shows exactly what goes out, and sends nothing", async () => {
  const { calls } = mockJobTread(draft);
  const p = await sendPreview(link, "doc1");
  assert.deepEqual(p.recipient, { name: "Scott Peterson", emailAddress: "scott@example.com", phoneNumber: "+18015550123" });
  assert.equal(p.total, 2464);
  assert.equal(p.emailMessage, draft.emailMessage);
  assert.ok(p.approvalKey);
  assert.ok(!sent(calls));
});

test("no approval → refused; changed since approval → refused; nothing sent", async () => {
  const { calls, state } = mockJobTread(draft);
  await assert.rejects(sendApprovedProposal(link, "doc1", {}), SendRefused);
  const p = await sendPreview(link, "doc1");
  state.toEmailAddress = "someone-else@example.com";
  await assert.rejects(sendApprovedProposal(link, "doc1", { approvalKey: p.approvalKey }), /changed since you approved/);
  state.toEmailAddress = draft.toEmailAddress;
  // an edited message needs its own approval
  await assert.rejects(sendApprovedProposal(link, "doc1", { approvalKey: p.approvalKey, emailMessage: "different" }), /changed/);
  assert.ok(!sent(calls));
});

test("a proposal on another job can't be sent from this lead", async () => {
  mockJobTread({ ...draft, job: { id: "other" } });
  await assert.rejects(sendPreview(link, "doc1"), /isn't on this lead/);
});

test("approved send: recipient → send → set pending (no second email) → delivery status", async () => {
  const { calls } = mockJobTread(draft);
  const p = await sendPreview(link, "doc1", { emailMessage: "Edited message" });
  const r = await sendApprovedProposal(link, "doc1", { approvalKey: p.approvalKey, emailMessage: "Edited message" });
  const rec = calls.find((c) => c.createDocumentRecipient).createDocumentRecipient.$;
  assert.deepEqual(rec.assignee, { name: "Scott Peterson", emailAddress: "scott@example.com", phoneNumber: "+18015550123", accountType: "customer" });
  assert.equal(rec.requireSignature, true);
  assert.equal(calls.find((c) => c.sendDocument).sendDocument.$.emailMessage, "Edited message");
  const upd = calls.find((c) => c.updateDocument).updateDocument.$;
  assert.deepEqual(upd, { id: "doc1", status: "pending", notify: false });
  assert.equal(r.status, "pending");
  assert.equal(r.statusOk, true);
  assert.equal(r.emailDeliveryStatus, "sent");
  // and it can't go out twice
  const again = await sendPreview(link, "doc1", { emailMessage: "Edited message" });
  await assert.rejects(sendApprovedProposal(link, "doc1", { approvalKey: again.approvalKey, emailMessage: "Edited message" }), /already been sent/);
});
