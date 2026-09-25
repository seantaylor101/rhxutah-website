import { randomUUID } from "node:crypto";

export const PAYEE_ROLES = new Set(["sub", "pm"]);
export const PAYMENT_METHODS = ["Cash", "Check", "Zelle", "Venmo", "PayPal", "Bank transfer", "Card", "Other"];
const METHOD_SET = new Set(PAYMENT_METHODS);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// tolerant read of whatever's stored in the payees column — missing or
// malformed JSON reads as no payees rather than erroring the leads list
export function parsePayees(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

function positiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function validatePayeeInput({ name, role, agreedAmount }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return { ok: false, error: "Name is required" };
  if (!PAYEE_ROLES.has(role)) return { ok: false, error: "role must be 'sub' or 'pm'" };
  const amount = positiveAmount(agreedAmount);
  if (amount === null) return { ok: false, error: "agreedAmount must be a positive number" };
  return { ok: true, value: { name: cleanName, role, agreedAmount: amount } };
}

export function addPayee(payees, input) {
  return [
    ...payees,
    { id: randomUUID(), ...input, payments: [], createdAt: new Date().toISOString() },
  ];
}

export function updatePayee(payees, payeeId, input) {
  let found = false;
  const next = payees.map((p) => {
    if (p.id !== payeeId) return p;
    found = true;
    return { ...p, ...input };
  });
  return found ? next : null;
}

export function removePayee(payees, payeeId) {
  return payees.filter((p) => p.id !== payeeId);
}

// method is one of the fixed list, or "Other" paired with a short freeform
// description — same pattern as the lead-source "other" field elsewhere in
// this app, so payment records stay searchable/consistent instead of a
// wide-open text field
export function validatePaymentInput({ amount, method, methodOther, date, note }) {
  const cleanAmount = positiveAmount(amount);
  if (cleanAmount === null) return { ok: false, error: "amount must be a positive number" };
  if (!METHOD_SET.has(method)) return { ok: false, error: "Pick a payment method from the list" };
  const cleanMethodOther = method === "Other" ? String(methodOther || "").trim() : "";
  if (method === "Other" && !cleanMethodOther) return { ok: false, error: "Describe the payment method" };
  if (!DATE_RE.test(date || "")) return { ok: false, error: "date must be YYYY-MM-DD" };
  return {
    ok: true,
    value: { amount: cleanAmount, method, methodOther: cleanMethodOther, date, note: String(note || "").trim() },
  };
}

export function addPayment(payees, payeeId, input) {
  let found = false;
  const next = payees.map((p) => {
    if (p.id !== payeeId) return p;
    found = true;
    return {
      ...p,
      payments: [...p.payments, { id: randomUUID(), ...input, createdAt: new Date().toISOString() }],
    };
  });
  return found ? next : null;
}

export function removePayment(payees, payeeId, paymentId) {
  let found = false;
  const next = payees.map((p) => {
    if (p.id !== payeeId) return p;
    found = true;
    return { ...p, payments: p.payments.filter((pay) => pay.id !== paymentId) };
  });
  return found ? next : null;
}

export function totalPaid(payee) {
  return payee.payments.reduce((sum, p) => sum + p.amount, 0);
}
