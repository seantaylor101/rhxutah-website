import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildGutterLines,
  buildLpSidingLines,
  buildSidingLines,
  buildStuccoLines,
  sidingParams,
  draftEstimate,
  evalFormula,
  mergeParameters,
  billedFootage,
} from "./estimateDraft.js";
import { missingTradeAnswers, cleanTradeAnswers, questionsFor, upgradesFor } from "../../shared/tradeQuestions.js";

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
  assert.ok(Math.abs(r.total - 2976) <= 0.05, String(r.total));
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
  assert.ok(Math.abs(r.total - 2108) <= 0.05, "upgrades stay optional — not in the total");
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
  assert.ok(Math.abs(r.total - 2108) <= 0.05, "drains stay optional");

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

test("per-foot rates on gutter + downspout footage: Erick $7.50, other GCs $8.50, retail $12 (6-inch $15)", () => {
  assert.equal(billedFootage(ans), 248); // 150 gutter + 4x13 + 2x23
  const near = (a, b) => Math.abs(a - b) <= 0.05;
  const gutters = ["gutters"];
  const erick = buildGutterLines(assembly, ans, { customerType: "gc", trades: gutters }, { accountId: "22PLZFJ8Yrtd" });
  assert.ok(near(erick.total, 1860), String(erick.total));
  const gc = buildGutterLines(assembly, ans, { customerType: "gc", trades: gutters });
  assert.ok(near(gc.total, 2108), String(gc.total));
  const retail = buildGutterLines(assembly, ans, { customerType: "retail", trades: gutters });
  assert.ok(near(retail.total, 2976), String(retail.total));
  // the 6-inch choice shown on a retail 5-inch bid is priced at $15/ft
  const shared = flat(retail.lines).filter((l) => l._type === "costItem" && ["Gutter install - labor", "Downspout install - labor", "Remove and haul off existing gutters - labor"].includes(l.name));
  const sharedTotal = shared.reduce((t, l) => t + l.quantity * l.unitPrice, 0);
  const six = priceOf(retail.lines, '6" K-Style Gutters with 3x4 Downspouts (more capacity)');
  assert.ok(near(sharedTotal + six, 3720), String(sharedTotal + six));
  // picking 6-inch up front prices the bid at $15/ft
  const retail6 = buildGutterLines(assembly, { ...ans, size: "6" }, { customerType: "retail", trades: gutters });
  assert.ok(near(retail6.total, 3720), String(retail6.total));
  // costs stay real; upgrades keep their own prices; minimum still applies
  const items = flat(retail.lines).filter((l) => l._type === "costItem");
  assert.equal(items.find((i) => i.name === "Gutter install - labor").unitCost, 2);
  assert.equal(priceOf(retail.lines, "Standard In-Ground Drain (9x9 catch basin)"), 3000);
  const small = buildGutterLines(assembly, { gutterLF: 20, oneStory: 1 }, { customerType: "gc", trades: gutters });
  assert.equal(small.total, 350);
});

test("insurance gutters: $10.50/ft for 5-inch", () => {
  const r = buildGutterLines(assembly, ans, { customerType: "insurance", trades: ["gutters"] });
  assert.ok(Math.abs(r.total - 2604) <= 0.05, String(r.total)); // 248 ft x $10.50
});

const lpAssembly = JSON.parse(fs.readFileSync(new URL("./__fixtures__/lpSidingAssembly.json", import.meta.url)));

test("LP siding: retail $14 / GC $12 per sq ft on wall area + 10%, tear-off and dumpster on top", () => {
  const near = (a, b) => Math.abs(a - b) <= 0.1;
  const retail = buildLpSidingLines(lpAssembly, { wallSF: 2000 }, { customerType: "retail", trades: ["siding"], existingExterior: ["vinyl"] });
  assert.ok(near(retail.total, 30800 + 2000 * 0.9 + 500), String(retail.total));
  const names = flat(retail.lines).map((l) => l.name);
  assert.ok(!names.includes("Contractor-Grade Paint"), "retail gets Emerald only");
  assert.ok(names.includes("Insulated Reflective House Wrap"));
  const gc = buildLpSidingLines(lpAssembly, { wallSF: 2000 }, { customerType: "gc", trades: ["siding"], existingExterior: ["newConstruction"] });
  assert.ok(near(gc.total, 26400 + 500), String(gc.total)); // dumpster even with no tear-off
  const gcGroups = flat(gc.lines).filter((l) => l._type === "costGroup");
  assert.ok(gcGroups.find((g) => g.name === "Contractor-Grade Paint").isSelected);
  assert.ok(!gcGroups.find((g) => g.name === "Sherwin-Williams Emerald Rain Refresh").isSelected, "Emerald is the GC upgrade choice");
  assert.ok(!flat(gc.lines).some((l) => /tear off/i.test(l.name)), "new construction: no tear-off lines");
  assert.ok(flat(gc.lines).some((l) => l.name === "Dumpster"), "dumpster on every siding job");
  // costs stay real
  assert.equal(flat(gc.lines).find((l) => /install/.test(l.name)).unitCost, 2.5);
});

test("LP siding params: tear-off type from the basics, dumpster on every job", () => {
  assert.deepEqual(sidingParams({ wallSF: 1500 }, { existingExterior: ["wood"] }), {
    "Wall SF": 1500, "Batten SF": 0, "Shake SF": 0, "Vinyl Tear-off SF": 0, "Wood Tear-off SF": 1500, "Stucco Tear-off SF": 0, "Resheathing SF": 0, Dumpsters: 1, "Metal Wraps": 0,
  });
  assert.equal(sidingParams({ wallSF: 1500, tearOff: "none" }, { existingExterior: ["wood"] }).Dumpsters, 1);
  assert.equal(sidingParams({ wallSF: 1500, dumpsters: 0 }, {}).Dumpsters, 0);
  assert.equal(sidingParams({ wallSF: 1500, tearOffSF: 600 }, { existingExterior: ["stucco"] })["Stucco Tear-off SF"], 600);
});

test("draftEstimate: siding + gutters on one proposal, siding first", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const q = JSON.parse(opts.body).query;
    calls.push(q);
    let out = {};
    if (q.costGroup) out = { costGroup: q.costGroup.$.id === "22PiLt4qNebY" ? lpAssembly : assembly };
    else if (q.job) out = { job: { parameters: null, location: { name: "1 Main", address: "1 Main, Lehi", account: { id: "acc", name: "Pat" } } } };
    else if (q.documentTemplate) out = { documentTemplate: { dueDays: 30 } };
    else if (q.createDocument) out = { createDocument: { createdDocument: { id: "d", fullName: "Proposal 1-1", status: "draft", price: 1 } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  await draftEstimate({
    lead: { name: "Pat Doe", address: "1 Main, Lehi", phone: "", email: "" },
    basics: { customerType: "retail", trades: ["siding", "gutters"], existingExterior: ["vinyl"] },
    answers: { siding: { product: "lp", wallSF: 1800 }, gutters: ans },
    link: { jobId: "j" },
  });
  const doc = calls.find((c) => c.createDocument).createDocument.$;
  assert.deepEqual(doc.lineItems.map((l) => l.name), ["LP SmartSide Siding System", "Seamless Gutter System"]);
  assert.match(doc.emailMessage, /new LP SmartSide siding and new gutters and downspouts/);
  assert.match(doc.emailMessage, /insulated reflective house wrap/);
  const params = calls.find((c) => c.updateJob).updateJob.$.parameters;
  assert.ok(params.some((p) => p.name === "Wall SF" && p.value === 1800) && params.some((p) => p.name === "Gutter LF"));
});

// the Ascend and vinyl assemblies have no paint; vinyl adds a Metal Wraps group
function unpainted(withMetalWraps) {
  const a = JSON.parse(JSON.stringify(lpAssembly));
  const paintIds = new Set(a.descendentCostGroups.nodes.filter((g) => /paint|emerald|contractor/i.test(g.name)).map((g) => g.id));
  a.descendentCostGroups.nodes = a.descendentCostGroups.nodes.filter((g) => !paintIds.has(g.id));
  a.descendentCostItems.nodes = a.descendentCostItems.nodes.filter((i) => !paintIds.has(i.costGroup.id) && !/paint/i.test(i.name));
  if (withMetalWraps) {
    a.descendentCostGroups.nodes.push({ id: "mw", name: "Metal Wraps", parentCostGroup: { id: a.id }, position: "qq", isSelected: false, minSelectionsRequired: null, maxSelectionsAllowed: null, showChildDeltas: false, showChildren: true, showChildCosts: true, showDescription: true });
    a.descendentCostItems.nodes.push({ id: "mwi", name: "Metal wrap (window, man door, garage door) - labor", costGroup: { id: "mw" }, position: "k", quantity: null, quantityFormula: "{Metal Wraps}", unitCost: 250, unitPrice: 450, isTaxable: false, showQuantity: false, costCode: { id: "x" }, costType: { id: "x" }, unit: { id: "x" }, organizationCostItem: null });
  }
  return a;
}

test("every siding product prices at its own rate on wall area + 10%", () => {
  // whole-cent prices over 1,000+ sq ft can leave the total a dollar or so off
  const near = (a, b) => Math.abs(a - b) <= 2;
  const newBuild = (ct) => ({ customerType: ct, trades: ["siding"], existingExterior: ["newConstruction"] });
  const base = (r) => r.total - 500; // less the dumpster
  assert.ok(near(base(buildSidingLines(lpAssembly, { wallSF: 1000 }, newBuild("retail"), "hardie")), 14 * 1100));
  assert.ok(near(base(buildSidingLines(lpAssembly, { wallSF: 1000 }, newBuild("gc"), "hardie")), 12 * 1100));
  assert.ok(near(base(buildSidingLines(unpainted(), { wallSF: 1000 }, newBuild("retail"), "ascend")), 12.5 * 1100));
  assert.ok(near(base(buildSidingLines(unpainted(), { wallSF: 1000 }, newBuild("gc"), "ascend")), 11 * 1100));
  assert.ok(near(base(buildSidingLines(unpainted(true), { wallSF: 1000 }, newBuild("retail"), "vinyl")), 9 * 1100));
  assert.ok(near(base(buildSidingLines(unpainted(true), { wallSF: 1000 }, newBuild("gc"), "vinyl")), 8 * 1100));
  assert.ok(near(base(buildSidingLines(unpainted(true), { wallSF: 1000 }, newBuild("insurance"), "vinyl")), 6 * 1100));
});

test("vinyl metal wraps are priced on their own, only when entered", () => {
  const b = { customerType: "retail", trades: ["siding"], existingExterior: ["newConstruction"] };
  const none = buildSidingLines(unpainted(true), { wallSF: 1000, product: "vinyl" }, b, "vinyl");
  assert.ok(!flat(none.lines).some((l) => /metal wrap/i.test(l.name)));
  const four = buildSidingLines(unpainted(true), { wallSF: 1000, product: "vinyl", metalWraps: 4 }, b, "vinyl");
  assert.ok(Math.abs(four.total - (9 * 1100 + 500 + 4 * 450)) <= 0.1, String(four.total));
  assert.ok(questionsFor("siding", b, { siding: { product: "vinyl" } }).some((q) => q.key === "metalWraps"));
  assert.ok(!questionsFor("siding", b, { siding: { product: "lp" } }).some((q) => q.key === "metalWraps"));
  // no Emerald upgrade on factory-finished siding
  assert.ok(!upgradesFor({ customerType: "gc", trades: ["siding"] }, { siding: { product: "ascend" } }).emeraldPaint);
});

test("siding product has no default — it has to be picked", () => {
  const b = { customerType: "retail", trades: ["siding"] };
  assert.deepEqual(missingTradeAnswers("siding", { wallSF: 1500 }, b).map((m) => m.key), ["product"]);
  assert.deepEqual(missingTradeAnswers("siding", { wallSF: 1500, product: "vinyl" }, b), []);
});

const stuccoAssembly = {
  id: "st", name: "Stucco", position: null, isSelected: false, minSelectionsRequired: null, maxSelectionsAllowed: null,
  showChildDeltas: false, showChildren: true, showChildCosts: true, showDescription: true,
  descendentCostGroups: { nodes: [] },
  descendentCostItems: { nodes: [
    { id: "f", name: "Stucco, full job (labor, material, scaffolding)", costGroup: { id: "st" }, position: "m", quantity: null, quantityFormula: "1.1*{Stucco SF}", unitCost: 6, unitPrice: 10, isTaxable: false, showQuantity: false, costCode: { id: "c" }, costType: { id: "t" }, unit: { id: "u" }, organizationCostItem: null },
    { id: "r", name: "Stucco repair", costGroup: { id: "st" }, position: "n", quantity: null, quantityFormula: "{Stucco Repairs}", unitCost: 1800, unitPrice: 2700, isTaxable: false, showQuantity: false, costCode: { id: "c" }, costType: { id: "t" }, unit: { id: "u" }, organizationCostItem: null },
    { id: "p", name: "Stucco popout cut-back - per window", costGroup: { id: "st" }, position: "o", quantity: null, quantityFormula: "{Popout Windows}", unitCost: 500, unitPrice: 750, isTaxable: false, showQuantity: true, costCode: { id: "c" }, costType: { id: "t" }, unit: { id: "u" }, organizationCostItem: null },
  ] },
};

test("stucco: full job per sq ft + 10%, repairs $2,700, popouts $750 with no minimum, foundation $10/LF, gutter-wall $350 + $3,000", () => {
  const near = (a, b) => Math.abs(a - b) <= 0.01;
  const asm = JSON.parse(JSON.stringify(stuccoAssembly));
  asm.descendentCostGroups.nodes.push({ id: "gw", name: "Gutter Against Stucco Wall Repair", parentCostGroup: { id: "st" }, position: "q", isSelected: false, minSelectionsRequired: null, maxSelectionsAllowed: null, showChildDeltas: false, showChildren: true, showChildCosts: true, showDescription: true });
  const item = (id, name, grp, f, c, p) => ({ id, name, costGroup: { id: grp }, position: "m", quantity: null, quantityFormula: f, unitCost: c, unitPrice: p, isTaxable: false, showQuantity: false, costCode: { id: "c" }, costType: { id: "t" }, unit: { id: "u" }, organizationCostItem: null });
  asm.descendentCostItems.nodes.push(
    item("fp", "Foundation plaster - per linear foot", "st", "{Foundation Plaster LF}", 0, 10),
    item("gc", "Gutter cut-back from stucco wall + new end cap", "gw", "{Gutter Wall Spots}", 0, 350),
    item("gs", "Stucco repair where gutter met the wall", "gw", "{Gutter Wall Stucco Repair}", 1800, 3000)
  );
  assert.ok(near(buildStuccoLines(asm, { jobType: "full", stuccoSF: 1000 }, { customerType: "retail" }).total, 11000));
  assert.ok(near(buildStuccoLines(asm, { jobType: "full", stuccoSF: 1000 }, { customerType: "gc" }).total, 8800));
  assert.ok(near(buildStuccoLines(asm, { jobType: "repair" }, { customerType: "gc" }).total, 2700));
  assert.ok(near(buildStuccoLines(asm, { jobType: "repair", popouts: 2, otherRepairs: "no" }, {}).total, 1500), "popouts alone: no minimum");
  assert.ok(near(buildStuccoLines(asm, { jobType: "repair", popouts: 2 }, {}).total, 4200));
  assert.ok(near(buildStuccoLines(asm, { foundationLF: 60 }, {}).total, 600));
  const gw = buildStuccoLines(asm, { gutterWallSpots: 2 }, {});
  assert.ok(near(gw.total, 2 * 350 + 3000), String(gw.total));
  assert.ok(!flat(gw.lines).some((l) => /full job|^Stucco repair$|popout/i.test(l.name)));
  const req = (a) => missingTradeAnswers("stucco", a, {}).map((m) => m.key);
  assert.deepEqual(req({}), []);
  assert.deepEqual(req({ jobType: "full" }), ["stuccoSF"]);
});

test("board-and-batten and shake areas are priced at their own rates", async () => {
  const { buildSidingLines, sidingParams } = await import("./estimateDraft.js");
  const fs = await import("node:fs");
  const asm = JSON.parse(fs.readFileSync(new URL("./__fixtures__/lpSidingAssembly.json", import.meta.url)));
  const basics = { customerType: "gc", trades: ["siding"], existingExterior: ["stucco"] };
  const { lines, params } = buildSidingLines(asm, { product: "lp", wallSF: 2000, battenSF: 500, shakeSF: 300, tearOff: "none", dumpsters: 0 }, basics, "lp");
  assert.equal(params["Batten SF"], 500);
  assert.equal(params["Shake SF"], 300);
  const all = [];
  const walk = (l) => l.forEach((x) => (x._type === "costItem" ? all.push(x) : walk(x.lineItems || [])));
  walk(lines);
  const lap = all.find((x) => /lap siding/.test(x.name));
  assert.equal(lap.quantity, 1200);
  assert.ok(all.some((x) => /shakes primed/i.test(x.name) && x.quantity === 330));
  // base bid = 1.1 x (1200 x $12 + 500 x $15 + 300 x $22)
  const { selectedPriceTotal } = await import("./estimateDraft.js");
  const base = selectedPriceTotal(lines);
  assert.ok(Math.abs(base - 1.1 * (1200 * 12 + 500 * 15 + 300 * 22)) < 3, String(base));
  // vinyl ignores the areas; they can't exceed the wall
  assert.equal(sidingParams({ product: "vinyl", wallSF: 1000, battenSF: 200 })["Batten SF"], 0);
  assert.equal(sidingParams({ product: "hardie", wallSF: 1000, battenSF: 800, shakeSF: 500 })["Shake SF"], 200);
  // with no batten/shake, those lines aren't on the bid
  const plain = buildSidingLines(asm, { product: "lp", wallSF: 2000, tearOff: "none" }, basics, "lp");
  const names = [];
  const w2 = (l) => l.forEach((x) => (x._type === "costItem" ? names.push(x.name) : w2(x.lineItems || [])));
  w2(plain.lines);
  assert.ok(!names.some((n) => /shake|batten|panel/i.test(n)), names.join());
});
