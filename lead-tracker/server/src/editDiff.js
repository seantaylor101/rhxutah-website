// Pure comparison helpers for editReview.js: a snapshot of what Lead Hammer
// drafted, and what changed in the proposal Sean actually sent.

// flattens drafted line items into what the customer is priced for:
// one entry per item name (quantities summed), plus the selected total
export function snapshotLines(lines, total) {
  const items = {};
  const walk = (list) => {
    for (const l of list) {
      if (l._type === "costItem") {
        const key = l.name;
        const qty = Number(l.quantity || 0);
        const prev = items[key];
        items[key] = prev
          ? { qty: prev.qty + qty, price: Number(l.unitPrice || 0) }
          : { qty, price: Number(l.unitPrice || 0) };
      } else {
        walk(l.lineItems || []);
      }
    }
  };
  walk(lines);
  return { items, total: Math.round(Number(total || 0) * 100) / 100 };
}

export function fromDocument(costItems) {
  const items = {};
  for (const c of costItems || []) {
    const prev = items[c.name];
    const qty = Number(c.quantity || 0);
    items[c.name] = prev ? { qty: prev.qty + qty, price: Number(c.unitPrice || 0) } : { qty, price: Number(c.unitPrice || 0) };
  }
  return items;
}

const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const num = (n) => Number(Number(n || 0).toFixed(2));

// what changed between the snapshot and what was sent
export function diffSnapshot(snapshot, sentItems, sentTotal) {
  const before = snapshot?.items || {};
  const after = sentItems || {};
  const changes = [];
  for (const [name, b] of Object.entries(before)) {
    const a = after[name];
    if (!a) {
      if (b.qty) changes.push({ kind: "removed", name, before: b });
      continue;
    }
    if (Math.abs(a.price - b.price) > 0.005) changes.push({ kind: "price", name, before: b, after: a });
    if (Math.abs(a.qty - b.qty) > 0.01) changes.push({ kind: "qty", name, before: b, after: a });
  }
  for (const [name, a] of Object.entries(after)) {
    if (!before[name] && a.qty) changes.push({ kind: "added", name, after: a });
  }
  const totalBefore = Number(snapshot?.total || 0);
  const totalAfter = Number(sentTotal || 0);
  return { changes, totalBefore, totalAfter, totalChanged: Math.abs(totalAfter - totalBefore) > 0.5 };
}

export function describeChange(c) {
  if (c.kind === "removed") return `removed "${c.name}"`;
  if (c.kind === "added") return `added "${c.name}" (${num(c.after.qty)} @ ${money(c.after.price)})`;
  if (c.kind === "price") return `"${c.name}" price ${money(c.before.price)} → ${money(c.after.price)}`;
  return `"${c.name}" qty ${num(c.before.qty)} → ${num(c.after.qty)}`;
}

export function noteFor({ date, fullName, trades, customerType, diff }) {
  const head = `${date} ${fullName} (${trades.join(", ") || "?"}, ${customerType || "?"})`;
  if (!diff.changes.length && !diff.totalChanged) return `${head}: sent as drafted.`;
  const total = diff.totalChanged ? ` Total ${money(diff.totalBefore)} → ${money(diff.totalAfter)}.` : "";
  return `${head}:${total} ${diff.changes.map(describeChange).join("; ")}.`;
}
