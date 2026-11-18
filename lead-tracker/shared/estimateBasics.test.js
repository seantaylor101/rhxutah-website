import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanEstimateBasics,
  parseEstimateBasics,
  missingEstimateBasics,
  emptyEstimateBasics,
  ESTIMATE_BASICS_REQUIRED_COUNT,
} from "./estimateBasics.js";

test("clean drops unknown keys and invalid options", () => {
  const out = cleanEstimateBasics({
    customerType: "retail",
    trades: ["gutters", "bogus", "gutters", "siding"],
    stories: "7",
    hacker: "x",
    notes: "  blue house  ",
  });
  assert.equal(out.customerType, "retail");
  assert.deepEqual(out.trades, ["gutters", "siding"]);
  assert.equal(out.stories, "");
  assert.equal(out.notes, "blue house");
  assert.ok(!("hacker" in out));
});

test("parse tolerates empty and malformed JSON", () => {
  assert.deepEqual(parseEstimateBasics(""), emptyEstimateBasics());
  assert.deepEqual(parseEstimateBasics("{nope"), emptyEstimateBasics());
});

test("missing lists address plus every unanswered required question", () => {
  assert.equal(missingEstimateBasics(emptyEstimateBasics(), "").length, ESTIMATE_BASICS_REQUIRED_COUNT);
  const full = cleanEstimateBasics({
    customerType: "gc",
    trades: ["gutters"],
    stories: "2",
    existingExterior: ["vinyl"],
    measurements: "onSite",
    timeline: "asap",
  });
  assert.deepEqual(missingEstimateBasics(full, "123 Main St, Lehi"), []);
  assert.deepEqual(
    missingEstimateBasics(full, "").map((m) => m.key),
    ["address"]
  );
});
