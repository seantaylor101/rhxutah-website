// Sending a drafted Proposal: the ONLY code path that emails a customer, and
// only for a proposal Sean has approved in Lead Hammer.
//
// 1. sendPreview() reads the proposal live from JobTread and returns exactly
//    what would go out (recipient, message, attachments, total) plus an
//    approval key: a hash of all of it.
// 2. Sean reviews it and taps Approve & send. The client sends back that key.
// 3. sendApprovedProposal() reads the proposal again and recomputes the key.
//    If anything changed (recipient, message, attachments, price), it refuses
//    and Sean has to look again. Only then does it create the recipient, send,
//    set the status to "pending" (the API send leaves it "draft", so the
//    customer couldn't sign) and read back the delivery status.

import crypto from "node:crypto";
import { pave } from "./jobtread.js";
import { JOBTREAD } from "../../estimating/index.js";

const DOC_FIELDS = {
  id: {},
  fullName: {},
  status: {},
  type: {},
  price: {},
  priceWithTax: {},
  emailMessage: {},
  toName: {},
  toEmailAddress: {},
  toPhoneNumber: {},
  job: { id: {} },
  files: { $: { size: 20 }, nodes: { id: {}, name: {} } },
  documentRecipients: { $: { size: 20 }, nodes: { id: {}, emailDeliveryStatus: {}, createdAt: {} } },
};

export class SendRefused extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

async function readDocument(documentId) {
  const data = await pave({ document: { $: { id: documentId }, ...DOC_FIELDS } });
  const doc = data?.document;
  if (!doc?.id) throw new SendRefused("That proposal isn't in JobTread anymore", 404);
  return doc;
}

export function approvalKey(preview) {
  const { documentId, recipient, emailMessage, attachments, total } = preview;
  return crypto.createHash("sha256").update(JSON.stringify([documentId, recipient, emailMessage, attachments, total])).digest("hex");
}

// what would go out; `emailMessage` lets Sean edit the message first (the
// key then covers his edited text)
export async function sendPreview(link, documentId, { emailMessage } = {}) {
  const doc = await readDocument(documentId);
  if (doc.job?.id !== link?.jobId) throw new SendRefused("That proposal isn't on this lead's JobTread job", 400);
  const preview = {
    documentId: doc.id,
    fullName: doc.fullName,
    status: doc.status,
    total: Number(doc.priceWithTax ?? doc.price ?? 0),
    recipient: {
      name: String(doc.toName || "").trim(),
      emailAddress: String(doc.toEmailAddress || "").trim(),
      phoneNumber: doc.toPhoneNumber || null,
    },
    emailMessage: emailMessage != null ? String(emailMessage) : String(doc.emailMessage || ""),
    attachments: (doc.files?.nodes || []).map((f) => f.name),
    alreadySent: (doc.documentRecipients?.nodes || []).length > 0 || doc.status !== "draft",
  };
  preview.approvalKey = approvalKey(preview);
  return preview;
}

export async function sendApprovedProposal(link, documentId, { approvalKey: approved, emailMessage } = {}) {
  if (!approved) throw new SendRefused("Review the proposal and approve it first", 400);
  const preview = await sendPreview(link, documentId, { emailMessage });
  if (preview.approvalKey !== approved) {
    throw new SendRefused("The proposal changed since you approved it (recipient, message, attachments or price). Review it again.");
  }
  if (preview.alreadySent) throw new SendRefused("This proposal has already been sent");
  if (!preview.recipient.emailAddress) throw new SendRefused("This proposal has no customer email address", 400);
  if (!preview.recipient.name) throw new SendRefused("This proposal has no customer name", 400);
  if (!preview.emailMessage.trim()) throw new SendRefused("The email message is empty", 400);

  const created = await pave({
    createDocumentRecipient: {
      $: {
        documentId,
        requireSignature: JOBTREAD.proposal.requireSignature,
        assignee: { ...preview.recipient, accountType: "customer" },
      },
      createdDocumentRecipient: { id: {} },
    },
  });
  const recipientId = created?.createDocumentRecipient?.createdDocumentRecipient?.id;
  if (!recipientId) throw new Error("JobTread didn't create the recipient");

  await pave({ sendDocument: { $: { documentRecipientId: recipientId, emailMessage: preview.emailMessage } } });

  // the API send leaves the document "draft"; the customer needs "pending"
  // to sign. notify: false so this doesn't send a second email.
  const target = JOBTREAD.sending.statusAfterSend;
  await pave({ updateDocument: { $: { id: documentId, status: target, notify: false } } });

  const after = await readDocument(documentId);
  const recipient = (after.documentRecipients?.nodes || []).find((r) => r.id === recipientId);
  return {
    documentId,
    fullName: after.fullName,
    status: after.status,
    statusOk: after.status === target,
    recipientId,
    to: preview.recipient.emailAddress,
    emailDeliveryStatus: recipient?.emailDeliveryStatus ?? null,
    sentAt: new Date().toISOString(),
  };
}
