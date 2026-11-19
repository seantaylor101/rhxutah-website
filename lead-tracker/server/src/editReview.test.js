import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotLines, diffSnapshot, describeChange, noteFor } from "./editDiff.js";

const lines = [
  { _type: "costGroup", name: "Stucco", lineItems: [
    { _type: "costItem", name: "Stucco repair", quantity: 1, unitPrice: 2700 },
    { _type: "costItem", name: "Stucco popout cut-back - per window", quantity: 2, unitPrice: 750 },
  ] },
];

test("snapshot and diff find price, quantity, added and removed lines", () => {
  const snap = snapshotLines(lines, 4200);
  const sent = {
    "Stucco repair": { qty: 1, price: 2300 },
    "Stucco popout cut-back - per window": { qty: 3, price: 750 },
    "Dumpster": { qty: 1, price: 500 },
  };
  const d = diffSnapshot(snap, sent, 5050);
  const text = d.changes.map(describeChange);
  assert.deepEqual(text, [
    '"Stucco repair" price $2,700 → $2,300',
    '"Stucco popout cut-back - per window" qty 2 → 3',
    'added "Dumpster" (1 @ $500)',
  ]);
  assert.ok(d.totalChanged);
  const note = noteFor({ date: "2026-11-19", fullName: "Proposal 490-1", trades: ["stucco"], customerType: "retail", diff: d });
  assert.match(note, /^2026-11-19 Proposal 490-1 \(stucco, retail\): Total \$4,200 → \$5,050\. "Stucco repair" price/);
});

test("sent as drafted", () => {
  const snap = snapshotLines(lines, 4200);
  const d = diffSnapshot(snap, { "Stucco repair": { qty: 1, price: 2700 }, "Stucco popout cut-back - per window": { qty: 2, price: 750 } }, 4200);
  assert.equal(d.changes.length, 0);
  assert.match(noteFor({ date: "d", fullName: "P", trades: [], customerType: "gc", diff: d }), /sent as drafted/);
});
