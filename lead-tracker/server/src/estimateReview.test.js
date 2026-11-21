import { test } from "node:test";
import assert from "node:assert/strict";
import { lineKey, summarizeHistory, reviewPrompt, claudeReview } from "./estimateReview.js";

const draft = [
  {
    _type: "costGroup",
    lineItems: [
      { _type: "costItem", name: '5" Bulldog gutter guards, Dark Bronze - installed', quantity: 132, unitPrice: 9.5 },
      { _type: "costItem", name: "Gutter cleaning (partial, approx. 60 LF)", quantity: 1, unitPrice: 150 },
    ],
  },
];

test("line keys ignore color, footage notes and '- installed'", () => {
  assert.equal(lineKey('5" Bulldog gutter guards, Dark Bronze - installed'), lineKey('5" Bulldog gutter guards, White - installed'));
  assert.equal(lineKey("Gutter cleaning (partial, approx. 60 LF)"), lineKey("Gutter cleaning (partial, approx. 120 LF)"));
});

test("past pricing summarized per drafted line", () => {
  const past = [
    { name: '5" Bulldog gutter guards, White - installed', unitPrice: 9.5, document: { fullName: "Proposal 480-1" } },
    { name: '5" Bulldog gutter guards, Dark Bronze - installed', unitPrice: 10, document: { fullName: "Proposal 470-1" } },
    { name: '5" Bulldog gutter guards, Black - installed', unitPrice: 9, document: { fullName: "Proposal 460-1" } },
  ];
  const [guards, cleaning] = summarizeHistory(draft, past);
  assert.deepEqual([guards.count, guards.median, guards.min, guards.max], [3, 9.5, 9, 10]);
  assert.equal(cleaning.count, 0);
});

test("the review prompt carries the draft, the email and the history", () => {
  const p = reviewPrompt({ basics: { customerType: "retail", trades: ["gutters"] }, lines: draft, emailMessage: "Hey Scott", history: [{ name: "x", draftPrice: 9.5, count: 2, median: 9.5, min: 9, max: 10 }] });
  assert.match(p, /Bulldog gutter guards.*@ \$9.5/);
  assert.match(p, /Hey Scott/);
  assert.match(p, /past median \$9.5/);
});

test("without an API key the review is skipped, never thrown", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const r = await claudeReview({ basics: {}, lines: draft });
  assert.ok(r.skipped);
  assert.deepEqual(r.flags, []);
  if (key) process.env.ANTHROPIC_API_KEY = key;
});
