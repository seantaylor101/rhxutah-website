import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGutterLines, draftEstimate, evalFormula, mergeParameters } from "./estimateDraft.js";
import { missingTradeAnswers, cleanTradeAnswers, questionsFor } from "../../shared/tradeQuestions.js";

process.env.JOBTREAD_GRANT_KEY = "test-key";
const assembly = JSON.parse(fs.readFileSync(new URL("./__fixtures__/gutterAssembly.json", import.meta.url)));
const ans = { gutterLF: 150, size: "5", oneStory: 4, twoStory: 2, threeStory: 0, offsets: 0, miters: 4, tearOffLF: 150, trees: "yes" };

const flat = (lines, out = []) => {
  for (const l of lines) {
    out.push(l);
    if (l.lineItems) flat(l.lineItems, out);
  }
  return out;
};

test("formulas evaluate like JobTread's", () => {
  const p = { "One Story Downspouts": 4, "Two Story Downspouts": 2, "Three Story Downspouts": 0, "Downspout Offsets": 1 };
  assert.equal(evalFormula("13*{One Story Downspouts}+23*{Two Story Downspouts}+33*{Three Story Downspouts}+2*{Downspout Offsets}", p), 100);
  assert.equal(evalFormula("{Nope}", {}), 0);
  assert.equal(evalFormula("process.exit()", {}), 0);
});

const groupNames = (r) => flat(r.lines).filter((l) => l._type === "costGroup").map((g) => g.name);

test("retail gutters-only job with trees: $12/ft, guards + drains offered, no lighting", () => {
  const r = buildGutterLines(assembly, ans, { customerType: "retail", trades: ["gutters"] });
  assert.ok(Math.abs(r.total - 1800) <= 0.05, String(r.total));
  const items = flat(r.lines).filter((l) => l._type === "costItem");
  assert.equal(items.find((i) => i.name.startsWith('5" K-style')).quantity, 150);
  assert.equal(items.find((i) => i.name === "2x3 downspout - material").quantity, 98);
  const names = groupNames(r);
  assert.ok(names.includes('Gutter Guards for 5" Gutters'));
  assert.ok(!names.includes('Gutter Guards for 6" Gutters'), "only the guards that fit");
  assert.ok(names.includes("In-Ground Drain for Downspouts"));
  assert.ok(!names.some((n) => /lighting/i.test(n)), "no lights on a gutters-only job");
  assert.equal(items.find((i) => i.name === "In-ground drain - labor").quantity, 6, "one drain per downspout by default");
  assert.equal(priceOf(r.lines, "Standard In-Ground Drain (9x9 catch basin)"), 3000);
});

test("retail remodel with siding: lighting offered too", () => {
  const r = buildGutterLines(assembly, ans, { customerType: "retail", trades: ["gutters", "siding"] });
  assert.ok(groupNames(r).some((n) => /lighting/i.test(n)));
});

test("GC bid: related upgrades only (guards if trees, drains), never lighting, no alternate size", () => {
  const gc = { customerType: "gc", trades: ["gutters", "siding"] };
  const r = buildGutterLines(assembly, ans, gc);
  const names = groupNames(r);
  assert.ok(names.includes('Gutter Guards for 5" Gutters'));
  assert.ok(names.includes("In-Ground Drain for Downspouts"));
  assert.ok(!names.some((n) => /lighting/i.test(n)));
  assert.ok(!names.some((n) => n.startsWith('6"')));
  assert.ok(Math.abs(r.total - 1575) <= 0.05, "upgrades stay optional — not in the total");
  const noTrees = groupNames(buildGutterLines(assembly, { ...ans, trees: "no" }, gc));
  assert.ok(!noTrees.some((n) => /guards/i.test(n)), "no guards without trees");
  assert.ok(!questionsFor("gutters", gc, { gutters: ans }).some((q) => q.key === "lightingLF"));
  assert.ok(questionsFor("gutters", gc, { gutters: ans }).some((q) => q.key === "drains"));
});

test("6-inch choice selects the 6-inch option and guards", () => {
  const r = buildGutterLines(assembly, { ...ans, size: "6" }, { customerType: "retail", trades: ["gutters"] });
  const groups = flat(r.lines).filter((l) => l._type === "costGroup");
  assert.ok(groups.find((g) => g.name.startsWith('6"')).isSelected);
  assert.ok(!groups.find((g) => g.name.startsWith('5"')).isSelected);
  assert.ok(groups.some((g) => /guards for 6"/i.test(g.name)) && !groups.some((g) => /guards for 5"/i.test(g.name)));
});

test("small job gets topped up to the $350 minimum", () => {
  const r = buildGutterLines(assembly, { gutterLF: 15, size: "5", oneStory: 0, twoStory: 0, miters: 0, tearOffLF: 0 }, { customerType: "gc" });
  const min = flat(r.lines).find((l) => l.name === "Small job minimum");
  assert.ok(min);
  assert.equal(r.total, 350);
  assert.ok(min.unitPrice > 0);
});

test("only gutter footage is required; blanks count as zero", () => {
  assert.deepEqual(missingTradeAnswers("gutters", {}, {}).map((m) => m.key), ["gutterLF"]);
  const r = buildGutterLines(assembly, { gutterLF: 100 }, { customerType: "gc", trades: ["gutters"] });
  const names = flat(r.lines).map((l) => l.name);
  assert.ok(names.some((n) => n.startsWith('5"')), "blank size = 5 inch");
  assert.ok(!names.some((n) => /guards/i.test(n)), "blank trees = no guards");
  assert.equal(flat(r.lines).find((l) => l.name === "2x3 downspout - material").quantity, 0);
});

test("required questions and cleaning", () => {
  assert.deepEqual(
    missingTradeAnswers("gutters", { gutterLF: 100 }, { customerType: "retail" }).map((m) => m.key),
    []
  );
  assert.deepEqual(missingTradeAnswers("gutters", ans, {}), []);
  assert.deepEqual(cleanTradeAnswers({ gutters: { gutterLF: "-5", size: "7", miters: "3" } }).gutters, { miters: 3 });
});

test("parameters merge without clobbering other ones", () => {
  const out = mergeParameters([{ name: "Wall SF", value: 900 }, { name: "Gutter LF", value: 10 }], { "Gutter LF": 150 });
  assert.deepEqual(out, [{ name: "Wall SF", value: 900 }, { name: "Gutter LF", value: 150 }]);
});

test("draftEstimate: sets job parameters and creates a draft Proposal (never sends)", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const q = JSON.parse(opts.body).query;
    calls.push(q);
    let out = {};
    if (q.costGroup) out = { costGroup: assembly };
    else if (q.job) out = { job: { parameters: null, location: { name: "1841 E Hubbard Ave", address: "1841 E Hubbard Ave, SLC", account: { id: "acc", name: "Erick Funn" } } } };
    else if (q.documentTemplate) out = { documentTemplate: { footer: "WARRANTY", dueDays: 30, requireSignature: true, showFinancing: true, includeInBudget: true } };
    else if (q.updateJob) out = { updateJob: {} };
    else if (q.createDocument) out = { createDocument: { createdDocument: { id: "doc1", fullName: "Proposal 486-1", status: "draft", price: 3147.92 } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  const r = await draftEstimate({
    lead: { name: "Erick Funn", phone: "8015551234", email: "" },
    basics: { customerType: "gc", trades: ["gutters"] },
    answers: { gutters: ans },
    link: { jobId: "job1" },
  });
  assert.equal(r.documentId, "doc1");
  assert.equal(r.status, "draft");
  const doc = calls.find((c) => c.createDocument).createDocument.$;
  assert.equal(doc.type, "customerOrder");
  assert.equal(doc.dueDays, 30);
  assert.equal(doc.footer, "WARRANTY");
  assert.equal(doc.jobLocationName, "1841 E Hubbard Ave");
  assert.equal(doc.toPhoneNumber, "+18015551234");
  assert.equal(doc.toEmailAddress, null);
  assert.match(doc.emailMessage, /^Hey Erick,\n\nHere is the estimate for the new gutters and downspouts/);
  const params = calls.find((c) => c.updateJob).updateJob.$.parameters;
  assert.ok(params.some((p) => p.name === "Gutter LF" && p.value === 150));
  assert.ok(!calls.some((c) => Object.keys(c).some((k) => /send/i.test(k))), "nothing sends");
});

const priceOf = (lines, groupName) => {
  const g = flat(lines).find((l) => l.name === groupName);
  return flat(g.lineItems).filter((l) => l._type === "costItem").reduce((s, i) => s + i.quantity * i.unitPrice, 0);
};

test("drains: $500 standard / $630 high capacity, roof downspouts skipped, extra pipe only when entered", () => {
  const b = { customerType: "gc", trades: ["gutters"] };
  const r = buildGutterLines(assembly, { ...ans, roofDrainDownspouts: 1 }, b);
  // 6 downspouts, 1 drains onto a roof → 5 drains
  assert.equal(priceOf(r.lines, "Standard In-Ground Drain (9x9 catch basin)"), 2500);
  assert.equal(priceOf(r.lines, "Higher-Capacity In-Ground Drain (12x12 catch basin)"), 3150);
  const groups = flat(r.lines).filter((l) => l._type === "costGroup");
  assert.ok(groups.find((g) => g.name.startsWith("Standard In-Ground Drain")).isSelected);
  assert.ok(!flat(r.lines).some((l) => /extended drain run|additional drain pipe/i.test(l.name)));
  assert.ok(Math.abs(r.total - 1575) <= 0.05, "drains stay optional");

  const long = buildGutterLines(assembly, { ...ans, drains: 2, drainsPast8: 1, drainExtraLF: 6 }, b);
  const ext = flat(long.lines).find((l) => /extended drain run/i.test(l.name));
  const pipe = flat(long.lines).find((l) => /additional drain pipe/i.test(l.name));
  assert.equal(ext.quantity * ext.unitPrice, 90);
  assert.equal(pipe.quantity * pipe.unitPrice, 35);
  assert.ok(flat(long.lines).find((l) => l.name.startsWith("Standard In-Ground Drain")).isSelected, "standard picked");
  assert.ok(!flat(long.lines).find((l) => l.name.startsWith("Higher-Capacity In-Ground Drain")).isSelected, "12x12 left for the customer to choose");

  // every downspout drains onto a roof → no drain option at all
  const none = buildGutterLines(assembly, { ...ans, oneStory: 1, twoStory: 0, roofDrainDownspouts: 1 }, b);
  assert.ok(!flat(none.lines).some((l) => /in-ground/i.test(l.name)));
  const zero = buildGutterLines(assembly, { ...ans, drains: 0 }, b);
  assert.ok(!flat(zero.lines).some((l) => /in-ground/i.test(l.name)), "0 drains = don't offer");
});

test("optional upgrades say how many options are actually on the bid", () => {
  const up = (r) => flat(r.lines).find((l) => l.name === "Optional Upgrades");
  const b = { customerType: "gc", trades: ["gutters"] };
  assert.equal(up(buildGutterLines(assembly, { ...ans, trees: "no" }, b)).maxSelectionsAllowed, 1); // drains only
  assert.equal(up(buildGutterLines(assembly, ans, b)).maxSelectionsAllowed, 2); // guards + drains
  assert.equal(up(buildGutterLines(assembly, ans, { customerType: "retail", trades: ["gutters", "siding"] })).maxSelectionsAllowed, 3);
});

test("per-foot rates: GC $10.50/ft, retail $12/ft, costs untouched, upgrades keep their prices", () => {
  const gc = buildGutterLines(assembly, ans, { customerType: "gc", trades: ["gutters"] });
  assert.ok(Math.abs(gc.total - 1575) <= 0.05, String(gc.total));
  const retail = buildGutterLines(assembly, ans, { customerType: "retail", trades: ["gutters"] });
  assert.ok(Math.abs(retail.total - 1800) <= 0.05, String(retail.total));
  const items = flat(retail.lines).filter((l) => l._type === "costItem");
  assert.equal(items.find((i) => i.name === "Gutter install - labor").unitCost, 2, "costs stay real");
  assert.equal(priceOf(retail.lines, "Standard In-Ground Drain (9x9 catch basin)"), 3000, "drain upgrade still $500 each");
  const small = buildGutterLines(assembly, { gutterLF: 20, oneStory: 1 }, { customerType: "gc", trades: ["gutters"] });
  assert.equal(small.total, 350, "minimum still applies");
});
