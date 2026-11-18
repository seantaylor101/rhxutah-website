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

test("retail gutters-only job with trees: $3,147.92, guards + drains offered, no lighting", () => {
  const r = buildGutterLines(assembly, ans, { customerType: "retail", trades: ["gutters"] });
  assert.equal(r.total, 3147.92);
  const items = flat(r.lines).filter((l) => l._type === "costItem");
  assert.equal(items.find((i) => i.name.startsWith('5" K-style')).quantity, 150);
  assert.equal(items.find((i) => i.name === "2x3 downspout - material").quantity, 98);
  const names = groupNames(r);
  assert.ok(names.includes('Gutter Guards for 5" Gutters'));
  assert.ok(!names.includes('Gutter Guards for 6" Gutters'), "only the guards that fit");
  assert.ok(names.includes("In-Ground Downspout Drains"));
  assert.ok(!names.some((n) => /lighting/i.test(n)), "no lights on a gutters-only job");
  assert.equal(items.find((i) => i.name === "In-ground drain - labor").quantity, 6, "one drain per downspout by default");
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
  assert.ok(names.includes("In-Ground Downspout Drains"));
  assert.ok(!names.some((n) => /lighting/i.test(n)));
  assert.ok(!names.some((n) => n.startsWith('6"')));
  assert.equal(r.total, 3147.92, "upgrades stay optional — not in the total");
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
  assert.equal(Math.round((15 * 6.58 + 15 * 5 + min.unitPrice) * 100) / 100, 350);
});

test("required questions and cleaning", () => {
  assert.deepEqual(
    missingTradeAnswers("gutters", { gutterLF: 100 }, { customerType: "retail" }).map((m) => m.key),
    ["size", "oneStory", "twoStory", "miters", "tearOffLF", "trees"]
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
  const params = calls.find((c) => c.updateJob).updateJob.$.parameters;
  assert.ok(params.some((p) => p.name === "Gutter LF" && p.value === 150));
  assert.ok(!calls.some((c) => Object.keys(c).some((k) => /send/i.test(k))), "nothing sends");
});
