import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildGutterLines,
  buildSidingLines,
  buildStuccoLines,
  buildSoffitFasciaLines,
  buildPaintingLines,
  buildDrainageLines,
  buildLightingLines,
  buildAllLines,
  sidingParams,
  draftEstimate,
  evalFormula,
  mergeParameters,
  billedFootage,
  gutterMinimum,
  gutterRatesFor,
  selectedPriceTotal,
  manufacturerNote,
} from "./estimateDraft.js";
import { PRICING, JOBTREAD, WORDING } from "../../estimating/index.js";
import { cleanTradeAnswers, missingTradeAnswers, upgradesFor } from "../../shared/tradeQuestions.js";

process.env.JOBTREAD_GRANT_KEY = "test-key";
const fixture = (n) => JSON.parse(fs.readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)));
const gutterAsm = fixture("gutterAssembly");
const lpAsm = fixture("lpSidingAssembly");

const flat = (lines, out = []) => {
  for (const l of lines) {
    out.push(l);
    if (l.lineItems) flat(l.lineItems, out);
  }
  return out;
};
const items = (lines) => flat(lines).filter((l) => l._type === "costItem");
const groupNamed = (lines, re) => flat(lines).find((l) => l._type === "costGroup" && re.test(l.name));
const priceOf = (g) => items(g.lineItems).reduce((s, i) => s + i.quantity * i.unitPrice, 0);
const LIFETIME = WORDING.warranty.lifetime;

// every rule that applies to every line, on every draft
function assertProposalRules(lines) {
  for (const i of items(lines)) {
    assert.equal(i.costTypeId, JOBTREAD.costTypes.other, `${i.name}: installed lines use cost type Other`);
    assert.ok(!/ - (material|labor)$/i.test(i.name), `${i.name}: never split material/labor`);
    assert.ok(!/haul/i.test(`${i.name} ${i.description || ""}`), `${i.name}: no haul-away filler`);
    const step = i.unitId === JOBTREAD.units.each || i.unitId === JOBTREAD.units.lump ? 5 : 0.25;
    assert.ok(Math.abs(i.unitPrice / step - Math.round(i.unitPrice / step)) < 1e-9, `${i.name}: $${i.unitPrice} lands on a clean number`);
  }
}

const NEVER_LIFETIME = /clean|relocate|cancel|re-slope|extension|remove|tear off|repair|foundation plaster|cut-back|minimum|dumpster|paint|difficult access|resheathing/i;
function assertWarranty(lines) {
  for (const i of items(lines)) {
    if (NEVER_LIFETIME.test(i.name) && !/siding|soffit|stucco, full/i.test(i.name)) {
      assert.ok(!(i.description || "").includes(LIFETIME), `${i.name}: no lifetime warranty`);
    }
  }
}

test("formulas evaluate like JobTread's", () => {
  const p = { "One Story Downspouts": 4, "Two Story Downspouts": 2, "Three Story Downspouts": 0, "Downspout Offsets": 1 };
  assert.equal(evalFormula("13*{One Story Downspouts}+23*{Two Story Downspouts}+33*{Three Story Downspouts}+2*{Downspout Offsets}", p), 100);
  assert.equal(evalFormula("{Nope}*2", p), 0);
  assert.equal(evalFormula("process.exit()", p), 0);
});

// ---------- reference job: Scott Peterson, #492 ----------

const scott = {
  color: "Dark Bronze",
  repairs: [
    { preset: "cleanPartial", qty: 60 },
    { preset: "relocateDownspout" },
    { preset: "cancelDownspout" },
    { preset: "reslope" },
    { preset: "corrugatedExtension" },
    { preset: "removeGuards", qty: 50 },
  ],
  guardOptions: [
    { label: "West & North Sides", lf: 132, difficultLF: 50, difficultNote: "tree cover & 8' grade drop", recommended: true, reason: "Heavy tree cover on the west and north sides." },
    { label: "East Side Only", lf: 80 },
  ],
};

test("reference job #492 (Scott Peterson): $1,060 base, Option A $2,464, Option B $1,820, no tax", () => {
  const answers = cleanTradeAnswers({ gutters: scott }).gutters;
  const basics = { customerType: "retail", trades: ["gutters"] };
  assert.deepEqual(missingTradeAnswers("gutters", answers, basics), [], "no new gutter footage needed for repairs/guards");
  const r = buildGutterLines(gutterAsm, answers, basics);

  const base = groupNamed(r.lines, /repair work/i);
  assert.equal(priceOf(base), 1060);
  const byName = Object.fromEntries(items(base.lineItems).map((i) => [i.name, i]));
  assert.equal(byName["Gutter cleaning (partial, approx. 60 LF)"].unitPrice, 150);
  assert.equal(byName["Relocate downspout around corner"].unitPrice, 225);
  assert.equal(byName["Cancel downspout & patch outlet"].unitPrice, 100);
  assert.equal(byName["Re-slope gutters to new downspout locations"].unitPrice, 250);
  assert.equal(byName["10' corrugated downspout extension"].unitPrice, 85, "Home Depot parts + $50, rounded");
  assert.equal(byName["10' corrugated downspout extension"].unitCost, 37.17);
  assert.equal(byName["Remove improperly installed gutter guards & seal roof"].quantity, 50);
  assert.equal(byName["Remove improperly installed gutter guards & seal roof"].unitPrice, 5);

  const opts = groupNamed(r.lines, /gutter guard options/i);
  assert.equal(opts.minSelectionsRequired, 0);
  assert.equal(opts.maxSelectionsAllowed, 1);
  const [a, b] = opts.lineItems;
  assert.equal(a.name, "Option A: West & North Sides (132 LF) - Recommended");
  assert.equal(a.isSelected, true, "recommended option pre-selected");
  assert.equal(b.isSelected, false);
  assert.equal(a.description, "Heavy tree cover on the west and north sides.");
  const guard = a.lineItems[0];
  assert.equal(guard.name, '5" Bulldog gutter guards, Dark Bronze - installed');
  assert.equal(guard.unitPrice, 9.5);
  assert.equal(guard.unitCost, 3.18);
  assert.ok(guard.description.includes(LIFETIME), "full guard install: lifetime");
  assert.equal(a.lineItems[1].name, "Difficult access - tree cover & 8' grade drop");
  assert.equal(priceOf(a), 1404);
  assert.equal(priceOf(b), 760);
  assert.equal(r.total, 2464);
  assert.equal(1060 + priceOf(b), 1820);

  assertProposalRules(r.lines);
  assertWarranty(r.lines);
  for (const i of items(base.lineItems)) assert.ok(!(i.description || "").includes(LIFETIME));
});

// ---------- gutters ----------

const ans = { gutterLF: 150, size: "5", oneStory: 4, twoStory: 2, threeStory: 0, offsets: 0, miters: 4, tearOffLF: 150, trees: "yes" };

test("takeoff: miters 3 ft, downspouts 13/23/33 ft, offsets 2 ft", () => {
  assert.equal(billedFootage({ gutterLF: 100, miters: 2, oneStory: 1, twoStory: 1, threeStory: 1, offsets: 1 }), 100 + 6 + 13 + 23 + 33 + 2);
});

test("retail gutters: one installed line at $12/ft on gutter + downspout footage, 6\" as the other choice", () => {
  const r = buildGutterLines(gutterAsm, ans, { customerType: "retail", trades: ["gutters"] });
  const footage = billedFootage(ans); // 150 + 12 + 52 + 46
  assert.equal(footage, 260);
  const sizes = groupNamed(r.lines, /seamless gutters/i);
  assert.equal(sizes.minSelectionsRequired, 1);
  const [five, six] = sizes.lineItems;
  assert.equal(five.isSelected, true);
  assert.equal(five.lineItems.length, 1, "material + labor combined into one line");
  assert.equal(five.lineItems[0].unitPrice, 12);
  assert.equal(five.lineItems[0].quantity, 260);
  assert.equal(six.lineItems[0].unitPrice, 15);
  assert.ok(five.lineItems[0].description.includes(LIFETIME));
  assert.ok(five.lineItems[0].unitCost > 0 && five.lineItems[0].unitCost < 12);
  // trees → guards offered as an upgrade, plus drains; no lighting without siding
  assert.ok(groupNamed(r.lines, /gutter guards for 5"/i));
  assert.ok(groupNamed(r.lines, /in-ground/i));
  assert.ok(!groupNamed(r.lines, /lighting/i));
  assert.equal(r.total, 260 * 12, "upgrades aren't pre-selected");
  assertProposalRules(r.lines);
});

test("GC rates: Erick $7.50, other GCs $8.50; only the bid size; never lighting", () => {
  const gc = { customerType: "gc", trades: ["gutters", "siding"] };
  const r = buildGutterLines(gutterAsm, ans, gc);
  assert.equal(items(groupNamed(r.lines, /seamless/i).lineItems)[0].unitPrice, 8.5);
  assert.ok(!groupNamed(r.lines, /6" K-Style/));
  assert.ok(!groupNamed(r.lines, /lighting/i));
  const erick = buildGutterLines(gutterAsm, ans, gc, { accountId: "22PLZFJ8Yrtd" });
  assert.equal(items(erick.lines)[0].unitPrice, 7.5);
  assert.deepEqual(gutterRatesFor({ customerType: "insurance" }), { 5: 10.5, 6: 15 });
});

test("small jobs: lump sum at the minimum, never below $500 retail/insurance or $350 GC", () => {
  assert.equal(gutterMinimum({ 5: 12 }, false, "retail"), 500);
  assert.equal(gutterMinimum({ 5: 7.5 }, false, "gc"), 350);
  const r = buildGutterLines(gutterAsm, { gutterLF: 20 }, { customerType: "retail", trades: ["gutters"] });
  const line = items(groupNamed(r.lines, /5" K-Style/).lineItems)[0];
  assert.equal(line.unitId, JOBTREAD.units.lump);
  assert.equal(line.unitPrice, 500);
  assert.match(line.name, /\(20 LF\)/);
  assert.equal(r.total, 500);
});

test("drains: $500 each / $630 12x12 choice, extra run $15/ft + $35 a section, flagged", () => {
  const r = buildDrainageLines(fixture("gutterAssembly"), { drains: 2, drainExtraLF: 12 }, { customerType: "retail" });
  const size = groupNamed(r.lines, /drain size/i);
  assert.equal(size.lineItems[0].isSelected, true);
  assert.equal(items(size.lineItems[0].lineItems)[0].unitPrice, 500);
  assert.equal(items(size.lineItems[1].lineItems)[0].unitPrice, 630);
  assert.equal(r.total, 1000 + 12 * 15 + 2 * 35);
  assert.equal(r.flags.length, 1);
  assertProposalRules(r.lines);
});

test("permanent lighting: $30/ft + $500 controller for every customer", () => {
  for (const customerType of ["retail", "gc", "insurance"]) {
    const r = buildLightingLines(gutterAsm, { lightingLF: 100 }, { customerType });
    assert.equal(r.total, 3500);
  }
});

// ---------- siding ----------

test("LP siding: one installed line at $14 retail / $12 GC on wall + 10%; dumpster $500 / $650 insurance", () => {
  const a = { product: "lp", wallSF: 2000, tearOff: "vinyl" };
  const retail = buildSidingLines(lpAsm, a, { customerType: "retail", trades: ["siding"], existingExterior: ["vinyl"] }, "lp");
  const lap = items(retail.lines)[0];
  assert.match(lap.name, /^LP SmartSide lap siding with trim & house wrap - installed$/);
  assert.equal(lap.quantity, 2200);
  assert.equal(lap.unitPrice, 14);
  assert.match(lap.description, /Emerald Rain Refresh/);
  assert.match(lap.description, /two passes/);
  assert.ok(lap.description.includes(LIFETIME));
  const dumpster = items(retail.lines).find((i) => i.name === "Dumpster");
  assert.equal(dumpster.unitPrice, 500);
  const tear = items(retail.lines).find((i) => /tear off/i.test(i.name));
  assert.equal(tear.unitPrice, 1);
  assert.ok(!(tear.description || "").includes(LIFETIME));

  const gc = buildSidingLines(lpAsm, a, { customerType: "gc", trades: ["siding"] }, "lp");
  assert.equal(items(gc.lines)[0].unitPrice, 12);
  assert.match(items(gc.lines)[0].description, /contractor-grade/);
  assert.ok(groupNamed(gc.lines, /emerald/i), "Emerald offered as the GC upgrade");

  const ins = buildSidingLines(lpAsm, a, { customerType: "insurance", trades: ["siding"] }, "lp");
  assert.equal(items(ins.lines).find((i) => i.name === "Dumpster").unitPrice, 650);
  assert.ok(items(ins.lines).every((i) => i.isTaxable), "insurance lines are taxable");
  assert.ok(ins.flags.length);
  assertProposalRules([...retail.lines, ...gc.lines, ...ins.lines]);
});

test("board & batten / shake areas get their own installed lines and rates", () => {
  const a = { product: "lp", wallSF: 2000, battenSF: 400, shakeSF: 200, tearOff: "none" };
  const r = buildSidingLines(lpAsm, a, { customerType: "retail", trades: ["siding"] }, "lp");
  const prices = items(r.lines).filter((i) => /installed/.test(i.name) && !/wrap upgrade/.test(i.name)).map((i) => [i.quantity, i.unitPrice]);
  assert.deepEqual(prices, [[1540, 14], [440, 17.5], [220, 25.5]]);
  assert.equal(sidingParams(a, {})["Shake SF"], 200);
});

test("insulated reflective house wrap: optional upgrade on every siding job, not pre-selected", () => {
  const r = buildSidingLines(lpAsm, { product: "lp", wallSF: 1000 }, { customerType: "retail", trades: ["siding"] }, "lp");
  const up = groupNamed(r.lines, /optional upgrades/i);
  assert.equal(up.minSelectionsRequired, 0);
  assert.equal(up.lineItems[0].isSelected, false);
  assert.equal(items(up.lineItems)[0].unitPrice, PRICING.siding.insulatedWrapUpgradePerSF.price);
});

test("Hardie jobs always get Emerald, even GC; Emerald upgrade is GC LP only", () => {
  assert.equal(upgradesFor({ customerType: "gc", trades: ["siding"] }, { siding: { product: "hardie" } }).emeraldPaint, false);
  assert.equal(upgradesFor({ customerType: "gc", trades: ["siding"] }, { siding: { product: "lp" } }).emeraldPaint, true);
});

// ---------- stucco, soffit, painting ----------

const stuccoAsm = {
  id: "st",
  name: "Stucco",
  descendentCostGroups: { nodes: [{ id: "gw", name: "Gutter Against Stucco Wall Repair", parentCostGroup: { id: "st" } }] },
  descendentCostItems: {
    nodes: [
      { name: "Stucco, full job (labor, material, scaffolding)", quantityFormula: "1.1*{Stucco SF}", unitCost: 6, costGroup: { id: "st" } },
      { name: "Stucco repair", quantityFormula: "{Stucco Repairs}", unitCost: 1800, costGroup: { id: "st" } },
      { name: "Stucco popout cut-back - per window", quantityFormula: "{Popout Windows}", unitCost: 500, costGroup: { id: "st" } },
      { name: "Foundation plaster - per linear foot", quantityFormula: "{Foundation Plaster LF}", unitCost: 6, costGroup: { id: "st" } },
      { name: "Gutter cut-back from stucco wall + new end cap", quantityFormula: "{Gutter Wall Spots}", unitCost: 75, costGroup: { id: "gw" } },
      { name: "Stucco repair where gutter met the wall", quantityFormula: "{Gutter Wall Stucco Repair}", unitCost: 2000, costGroup: { id: "gw" } },
    ],
  },
};

test("stucco: full $10/$8 per SF + 10% with lifetime; repairs $2,700, popouts $750, no lifetime, color-match note", () => {
  const full = buildStuccoLines(stuccoAsm, { jobType: "full", stuccoSF: 1000 }, { customerType: "gc" });
  assert.equal(full.total, 8800);
  assert.ok(items(full.lines)[0].description.includes(LIFETIME));
  const rep = buildStuccoLines(stuccoAsm, { jobType: "repair", popouts: 2, gutterWallSpots: 1 }, { customerType: "retail" });
  assert.equal(rep.total, 2700 + 1500 + 350 + 3000);
  for (const i of items(rep.lines)) assert.ok(!(i.description || "").includes(LIFETIME), i.name);
  assert.match(items(rep.lines)[0].description, /color-matched/);
  assertProposalRules(rep.lines);
});

const soffitAsm = {
  id: "sf",
  name: "Aluminum Soffit & Fascia",
  descendentCostGroups: { nodes: [] },
  descendentCostItems: {
    nodes: [
      { name: 'Aluminum soffit, Triple 4" - material', quantityFormula: "1.1*{Soffit SF}", unitCost: 2.27, costGroup: { id: "sf" } },
      { name: "Soffit J-channel - material", quantityFormula: "1.1*{Soffit LF}", unitCost: 0.86, costGroup: { id: "sf" } },
      { name: 'Aluminum fascia, Envoy ribbed 6" - material', quantityFormula: "1.1*{Fascia LF}", unitCost: 2.55, costGroup: { id: "sf" } },
      { name: "Soffit & fascia install - labor", quantityFormula: "{Soffit And Fascia LF}", unitCost: 4, costGroup: { id: "sf" } },
      { name: "Soffit only or fascia only - labor", quantityFormula: "{Soffit Only LF}+{Fascia Only LF}", unitCost: 2, costGroup: { id: "sf" } },
      { name: 'Aluminum soffit, Triple 4" - porch cap material', quantityFormula: "1.1*{Porch Cap SF}", unitCost: 2.27, costGroup: { id: "sf" } },
      { name: "Porch cap (aluminum soffit ceiling) install - labor", quantityFormula: "{Porch Cap SF}", unitCost: 2, costGroup: { id: "sf" } },
    ],
  },
};

test("soffit & fascia: $25 retail / $22 GC both, half for one, porch caps $9/SF", () => {
  const r = buildSoffitFasciaLines(soffitAsm, { bothLF: 100, soffitOnlyLF: 20, fasciaOnlyLF: 10, porchCapSF: 50 }, { customerType: "retail" });
  assert.equal(r.total, 2500 + 250 + 125 + 450);
  const gc = buildSoffitFasciaLines(soffitAsm, { bothLF: 100 }, { customerType: "gc" });
  assert.equal(gc.total, 2200);
  assert.ok(items(gc.lines)[0].unitCost > 4, "material and labor cost are carried on the one line");
  assertProposalRules(r.lines);
});

const paintAsm = {
  id: "pt",
  name: "Exterior Painting",
  descendentCostGroups: { nodes: [] },
  descendentCostItems: {
    nodes: [
      { name: "Exterior repaint, Emerald Rain Refresh", quantityFormula: "{Paint Wall SF}", unitCost: 1.55, costGroup: { id: "pt" } },
      { name: "Paint eaves - eaves-only job", quantityFormula: "{Eave LF Only}", unitCost: 3.38, costGroup: { id: "pt" } },
      { name: "Paint garage door - labor", quantityFormula: "{Garage Doors}", unitCost: 200, costGroup: { id: "pt" } },
    ],
  },
};

test("painting: eaves its own line, paint warranty (no lifetime), $500 minimum", () => {
  const r = buildPaintingLines(paintAsm, { eaveLF: 40 }, { customerType: "retail" });
  assert.equal(r.total, 500);
  const eaves = items(r.lines)[0];
  assert.equal(eaves.name, "Paint eaves");
  assert.match(eaves.description, /first year/);
  assert.ok(!eaves.description.includes(LIFETIME));
});

// ---------- the draft ----------

function mockJobTread(assemblyFor) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const q = JSON.parse(opts.body).query;
    calls.push(q);
    let out = {};
    if (q.costGroup) out = { costGroup: assemblyFor(q.costGroup.$.id) };
    else if (q.job) out = { job: { parameters: null, location: { name: "360 W 920 N", address: "360 W 920 N, Orem, UT", account: { id: "acc", name: "Scott Peterson" } } } };
    else if (q.documentTemplate) out = { documentTemplate: { footer: "TERMS", showFinancing: true, includeInBudget: true } };
    else if (q.updateJob) out = { updateJob: {} };
    else if (q.createDocument) out = { createDocument: { createdDocument: { id: "doc1", fullName: "Proposal 492-1", status: "draft", price: 2464 } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  return calls;
}

test("draftEstimate: Proposal defaults from jobtread.json, no tax on retail, draft only (never sends)", async () => {
  const calls = mockJobTread(() => gutterAsm);
  const r = await draftEstimate({
    lead: { name: "Scott Peterson", phone: "801-555-1234", email: "scott@example.com", address: "360 W 920 N, Orem, UT" },
    basics: { customerType: "retail", trades: ["gutters"] },
    answers: cleanTradeAnswers({ gutters: scott }),
    link: { jobId: "job1" },
  });
  assert.equal(r.documentId, "doc1");
  assert.equal(r.estimatedTotal, 2464);
  const doc = calls.find((c) => c.createDocument).createDocument.$;
  const d = JOBTREAD.proposal;
  for (const k of ["type", "name", "fromName", "fromOrganizationName", "fromAddress", "fromEmailAddress", "fromPhoneNumber", "requireSignature", "showQuantity", "dueDays"]) {
    assert.equal(doc[k], d[k], k);
  }
  assert.equal(doc.taxRate, 0);
  assert.match(doc.emailMessage, /^Hey Scott,\n\nThanks for having me out\./);
  assert.ok(!calls.some((c) => Object.keys(c).some((k) => /send|recipient/i.test(k))), "nothing sends");
});

test("draftEstimate: insurance proposals carry 7.45% tax", async () => {
  const calls = mockJobTread(() => gutterAsm);
  await draftEstimate({
    lead: { name: "Pat Doe", address: "1 Main St, Lehi" },
    basics: { customerType: "insurance", trades: ["gutters"] },
    answers: cleanTradeAnswers({ gutters: { gutterLF: 150 } }),
    link: { jobId: "job1" },
  });
  assert.equal(calls.find((c) => c.createDocument).createDocument.$.taxRate, 0.0745);
});

test("siding + gutters on one proposal, siding first; every line follows the rules", () => {
  const basics = { customerType: "retail", trades: ["siding", "gutters"], existingExterior: ["vinyl"] };
  const r = buildAllLines({
    basics,
    answers: cleanTradeAnswers({ siding: { product: "lp", wallSF: 1800 }, gutters: { ...ans } }),
    assemblies: { siding: lpAsm, gutters: gutterAsm },
  });
  assert.match(r.lines[0].name, /LP SmartSide/);
  assert.ok(groupNamed(r.lines, /lighting/i), "full remodel: lighting offered");
  assertProposalRules(r.lines);
  assertWarranty(r.lines);
  assert.equal(r.total, selectedPriceTotal(r.lines));
});

test("parameters merge without clobbering other ones", () => {
  const merged = mergeParameters([{ name: "Other", value: 3 }, { name: "Gutter LF", value: 1 }], { "Gutter LF": 150 });
  assert.deepEqual(merged, [{ name: "Other", value: 3 }, { name: "Gutter LF", value: 150 }]);
});

test("manufacturer warranty links come only from wording.json (maker's own site); none guessed", () => {
  for (const [k, m] of Object.entries(WORDING.manufacturers)) {
    if (k.startsWith("_")) continue;
    for (const l of m.links || []) assert.match(l.url, /^https:\/\/(www\.|claims\.)?(lpcorp|jameshardie|alside|plygem)\.com\//, `${k}: ${l.url}`);
  }
  assert.match(manufacturerNote("lp"), /LP Building Solutions; registering it is the customer's responsibility\. Warranty details & registration: https:\/\/lpcorp\.com\/.+ Claims: https:\/\/lpcorp\.com\/project-resources\/warranty-claims\. Manufacturer defects/);
  assert.ok(!/https?:/.test(manufacturerNote("bulldog")), "no link until there's an official one");
});

test("drafts flag warranty links Sean hasn't confirmed, and makers with no link", () => {
  const r = buildAllLines({
    basics: { customerType: "retail", trades: ["siding", "gutters"] },
    answers: cleanTradeAnswers({ siding: { product: "lp", wallSF: 1000 }, gutters: scott }),
    assemblies: { siding: lpAsm, gutters: gutterAsm },
  });
  assert.ok(r.flags.some((f) => /not confirmed yet for LP Building Solutions/.test(f)));
  assert.ok(r.flags.some((f) => /No official warranty link on file for GPI \(Bulldog\)/.test(f)));
});
