// Drafts a JobTread estimate (a "Proposal" customer order) on a lead's job.
// The draft is NEVER sent from here; sending is a separate step that needs
// Sean's approval of that specific proposal (proposalSend.js).
//
// Where things come from:
//   - prices: estimating/pricing.json (the single source of truth)
//   - IDs and Proposal defaults: estimating/jobtread.json
//   - wording/warranty text: estimating/wording.json
//   - costs: the JobTread catalog assemblies, read live every time, so
//     supplier price changes flow into new drafts
//
// Every proposal line is one "installed" line (material + labor combined,
// cost type Other). Material and labor are never shown separately.

import { pave } from "./jobtread.js";
import { proposalMessage } from "./proposalMessage.js";
import { snapshotLines } from "./editDiff.js";
import { PRICING, JOBTREAD, WORDING, roundPriceFor, roundLumpPrice, customerTypeOf, byType, taxRateFor } from "../../estimating/index.js";
import { upgradesFor, defaultDrainCount, sidingProduct, tearOffType, AUTOMATED_SIDING, PAINTED_SIDING } from "../../shared/tradeQuestions.js";

const P = PRICING;
const JT = JOBTREAD;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((t, x) => t + Number(f(x) || 0), 0);

// ---------- reading the catalog ----------

const ITEM_FIELDS = {
  id: {},
  name: {},
  description: {},
  position: {},
  quantity: {},
  quantityFormula: {},
  unitCost: {},
  unitPrice: {},
  costGroup: { id: {} },
  costCode: { id: {} },
  costType: { id: {} },
  unit: { id: {} },
};
const GROUP_FIELDS = {
  id: {},
  name: {},
  isSelected: {},
  minSelectionsRequired: {},
  maxSelectionsAllowed: {},
  parentCostGroup: { id: {} },
};

export async function fetchAssembly(id) {
  const data = await pave({
    costGroup: {
      $: { id },
      ...GROUP_FIELDS,
      descendentCostGroups: { $: { size: 100 }, nodes: GROUP_FIELDS },
      descendentCostItems: { $: { size: 100 }, nodes: ITEM_FIELDS },
    },
  });
  const root = data?.costGroup;
  if (!root) throw new Error("Couldn't load the assembly from the JobTread catalog");
  return root;
}

// Evaluates the assembly formulas the way JobTread does ({Param} * numbers).
export function evalFormula(formula, params) {
  const expr = String(formula).replace(/\{([^}]+)\}/g, (_, name) => `(${Number(params[name] ?? 0)})`);
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${expr});`)();
  return Number.isFinite(v) ? v : 0;
}

// Every catalog item with its quantity for these parameters and the names of
// the groups it sits in (outermost first, root excluded). Used for COSTS
// only; prices come from pricing.json.
export function catalogItems(root, params = {}) {
  const groups = new Map((root.descendentCostGroups?.nodes || []).map((g) => [g.id, g]));
  const path = (groupId) => {
    const out = [];
    let g = groups.get(groupId);
    while (g) {
      out.unshift(g.name);
      g = groups.get(g.parentCostGroup?.id);
    }
    return out;
  };
  return (root.descendentCostItems?.nodes || []).map((i) => {
    const qty = i.quantityFormula ? evalFormula(i.quantityFormula, params) : Number(i.quantity || 0);
    return {
      name: i.name,
      groups: path(i.costGroup?.id),
      qty,
      unitCost: Number(i.unitCost || 0),
      unitPrice: Number(i.unitPrice || 0),
      cost: qty * Number(i.unitCost || 0),
    };
  });
}

const inGroup = (re) => (i) => i.groups.some((g) => re.test(g));
const named = (re) => (i) => re.test(i.name);
const costOf = (items) => sum(items, (i) => i.cost);
// per-unit cost of catalog items matching `re` (ignores quantities; for
// lines priced per unit when the parameter isn't set, e.g. guard options)
const unitCostOf = (items, re) => sum(items.filter(named(re)), (i) => i.unitCost);

// ---------- building proposal lines ----------

// one installed line: material + labor combined, cost type Other
export function installedLine({ name, description = null, unit = "lf", qty, unitPrice, cost = 0, costCode, insurance = false }) {
  const q = round2(qty);
  return {
    _type: "costItem",
    name,
    description: description || null,
    quantity: q,
    quantityFormula: null,
    unitCost: q ? round2(cost / q) : 0,
    unitPrice: roundPriceFor(unit, unitPrice),
    isTaxable: !!insurance,
    showQuantity: false,
    costCodeId: costCode ?? null,
    costTypeId: JT.costTypes.other,
    unitId: JT.units[unit],
    organizationCostItemId: null,
  };
}

export function group(name, lineItems, { description = null, isSelected = false, min = null, max = null } = {}) {
  return {
    _type: "costGroup",
    name,
    description: description || null,
    quantity: null,
    quantityFormula: null,
    isSelected,
    minSelectionsRequired: min,
    maxSelectionsAllowed: max,
    showChildDeltas: false,
    showChildren: true,
    showChildCosts: true,
    showDescription: true,
    lineItems,
  };
}

// a parent with each option as a child group. Exclusive choices are min 0 /
// max 1 (min 1 when one must be picked, like gutter size); the recommended
// option is pre-selected. Independent add-ons (exclusive: false) allow as
// many picks as there are options.
export function optionSet(name, options, { required = false, exclusive = true, description } = {}) {
  return group(name, options, {
    description,
    min: required ? 1 : 0,
    max: exclusive ? 1 : Math.max(1, options.length),
  });
}

const sentence = (...parts) => parts.filter(Boolean).join(" ");
// manufacturer warranty sentence with the maker's own registration/claims
// links (estimating/wording.json); manufacturers with no confirmed official
// page get the sentence without a link
export function manufacturerNote(key) {
  const m = WORDING.manufacturers[key];
  if (!m) return "";
  const links = (m.links || []).map((l) => ` ${l.label}: ${l.url}`).join(".");
  return WORDING.warranty.manufacturer.replace("{maker}", m.maker).replace("{links}", links ? `${links}.` : "");
}

// manufacturers on these lines whose links Sean hasn't confirmed yet
export function unverifiedManufacturerLinks(keys) {
  return [...new Set(keys)].filter((k) => {
    const m = WORDING.manufacturers[k];
    return m && (m.links || []).length && !m.verified;
  });
}
const LIFETIME = WORDING.warranty.lifetime;

// what the customer gets by default: option children count only when
// selected; plain groups always count
export function selectedPriceTotal(lines) {
  let total = 0;
  const walk = (list, parentIsSelectionSet) => {
    for (const l of list) {
      if (l._type === "costItem") total += Number(l.quantity || 0) * Number(l.unitPrice || 0);
      else {
        if (parentIsSelectionSet && !l.isSelected) continue;
        walk(l.lineItems || [], l.maxSelectionsAllowed != null || l.minSelectionsRequired != null);
      }
    }
  };
  walk(lines, false);
  return round2(total);
}

// ---------- gutters ----------

export function gutterRatesFor(basics, { accountId } = {}) {
  const deal = accountId && P.gutters.customerRates[accountId];
  return deal ? deal.rates : byType(P.gutters.ratesPerFoot, basics);
}

// minimum = rate x minimumFeet rounded to $5, never below the floor
export function gutterMinimum(rates, six, customerType) {
  const rate = rates[six ? 6 : 5] ?? rates[5];
  const prorated = roundLumpPrice(rate * P.gutters.minimum.minimumFeet);
  return Math.max(prorated, P.gutters.minimum.floor[customerType] || 0);
}

// gutter + downspout footage billed: box miters 3 ft each, downspouts
// 13/23/33 ft by story, +2 ft per offset
export function billedFootage(answers = {}) {
  const n = (k) => Number(answers[k] || 0);
  const t = P.gutters.takeoff;
  const ds = t.downspoutFeetByStory;
  return (
    n("gutterLF") +
    t.feetPerMiter * n("miters") +
    ds[1] * n("oneStory") +
    ds[2] * n("twoStory") +
    ds[3] * n("threeStory") +
    t.feetPerOffset * n("offsets")
  );
}

export function gutterParams(answers = {}, basics = {}) {
  const n = (k) => Number(answers[k] || 0);
  const offered = upgradesFor(basics, { gutters: answers });
  const extraLF = n("drainExtraLF");
  return {
    "Gutter LF": n("gutterLF"),
    "One Story Downspouts": n("oneStory"),
    "Two Story Downspouts": n("twoStory"),
    "Three Story Downspouts": n("threeStory"),
    "Downspout Offsets": n("offsets"),
    Miters: n("miters"),
    "Gutter Tear-off LF": n("tearOffLF"),
    "In-Ground Drains": offered.drains ? defaultDrainCount(answers) : 0,
    "Drain Extra Pipe Sections": n("drainsPast8") || Math.ceil(extraLF / 10),
    "Drain Extra LF": extraLF,
    "Lighting LF": offered.lighting ? n("lightingLF") || n("gutterLF") : 0,
  };
}

const upgradeGroup = inGroup(/optional upgrades/i);
const sizeOf = (i) => (i.groups.find((g) => /^[56]"/.test(g)) || "")[0];

function gutterLine({ size, footage, rate, minimum, color, tearOff, catalog, insurance }) {
  const cost = costOf(catalog.filter((i) => !upgradeGroup(i) && !inGroup(/drain|lighting/i)(i) && (!sizeOf(i) || sizeOf(i) === String(size))));
  const name = `${size}" seamless gutters & ${size === 6 ? "3x4" : "2x3"} downspouts${color ? `, ${color}` : ""} - installed`;
  const description = sentence(WORDING.gutters.description, tearOff ? WORDING.gutters.tearOff : "", LIFETIME);
  const costCode = JT.costCodes.gutters;
  if (rate * footage < minimum) {
    // small job: one lump-sum line at the minimum
    return installedLine({ name: `${name} (${Math.round(footage)} LF)`, description, unit: "lump", qty: 1, unitPrice: minimum, cost, costCode, insurance });
  }
  return installedLine({ name, description, unit: "lf", qty: footage, unitPrice: rate, cost, costCode, insurance });
}

export function repairUnitPrice(preset) {
  if (preset.priceFrom === "corrugatedExtension") {
    const c = P.gutterRepairs.corrugatedExtension;
    return roundLumpPrice(c.parts.pipe4x10 + c.elbowsPerExtension * c.parts.elbow4in90 + c.laborAdd);
  }
  return preset.price;
}
function repairUnitCost(preset) {
  if (preset.priceFrom === "corrugatedExtension") {
    const c = P.gutterRepairs.corrugatedExtension;
    return round2(c.parts.pipe4x10 + c.elbowsPerExtension * c.parts.elbow4in90);
  }
  return preset.cost || 0;
}

// repair / odd-job lines from the presets; the price can be changed per job
export function repairLines(repairs = [], { insurance = false } = {}) {
  const presets = P.gutterRepairs.presets;
  const lines = [];
  for (const r of repairs) {
    const preset = presets[r.preset];
    if (!preset) continue;
    const name = preset.name.replace("{name}", r.name || "").replace("{qty}", r.qty ?? "");
    const unit = preset.unit;
    // a per-foot item is quantity x price; lump/each items: qty is a count
    // (the cleaning preset's qty is just the footage in its name)
    const qty = unit === "lf" ? Number(r.qty || 0) : preset.qtyLabel ? 1 : Number(r.qty || 1);
    if (!qty) continue;
    const unitPrice = r.price ?? repairUnitPrice(preset);
    lines.push(
      installedLine({
        name,
        unit,
        qty,
        unitPrice,
        cost: repairUnitCost(preset) * qty,
        costCode: /clean|guard/i.test(r.preset) ? JT.costCodes.gutterGuards : JT.costCodes.gutters,
        insurance,
      })
    );
  }
  return lines;
}

function guardLines({ size, lf, difficultLF, difficultNote, color, catalog, insurance }) {
  const guardGroup = new RegExp(`guards for ${size}"`, "i");
  const unitCost = sum(catalog.filter(inGroup(guardGroup)), (i) => i.unitCost);
  const out = [
    installedLine({
      name: `${size}" Bulldog gutter guards${color ? `, ${color}` : ""} - installed`,
      description: sentence(LIFETIME, manufacturerNote("bulldog")),
      unit: "lf",
      qty: lf,
      unitPrice: P.gutterGuards.ratesPerFoot[size],
      cost: unitCost * lf,
      costCode: JT.costCodes.gutterGuards,
      insurance,
    }),
  ];
  if (difficultLF > 0) {
    const d = P.gutterGuards.difficultAccess;
    out.push(
      installedLine({
        name: `Difficult access - ${difficultNote || "tree cover, grade drop or 2nd story"}`,
        unit: "lf",
        qty: difficultLF,
        unitPrice: d.pricePerFoot,
        cost: d.costPerFoot * difficultLF,
        costCode: JT.costCodes.gutterGuards,
        insurance,
      })
    );
  }
  return out;
}

const LETTERS = "ABCD";
export function guardOptionSet(options, { size, color, catalog, insurance }) {
  const children = options.map((o, n) =>
    group(
      `Option ${LETTERS[n]}: ${o.label} (${Math.round(o.lf)} LF)${o.recommended ? " - Recommended" : ""}`,
      guardLines({ size, lf: o.lf, difficultLF: o.difficultLF || 0, difficultNote: o.difficultNote, color, catalog, insurance }),
      { description: o.reason, isSelected: !!o.recommended }
    )
  );
  return optionSet("Gutter Guard Options", children);
}

// drain lines: standard 9x9 or high-capacity 12x12, plus run past 8 ft
function drainOption({ high, count, catalog, insurance }) {
  const d = P.drainage;
  const re = high ? /12x12/i : /9x9/i;
  const unitCost = sum(catalog.filter(inGroup(re)), (i) => i.unitCost);
  return group(
    high ? "Higher-Capacity In-Ground Drain (12x12 catch basin)" : "Standard In-Ground Drain (9x9 catch basin)",
    [
      installedLine({
        name: `In-ground downspout drain, ${high ? "12x12" : "9x9"} catch basin - installed`,
        description: LIFETIME,
        unit: "each",
        qty: count,
        unitPrice: high ? d.highCapacityEach : d.standardEach,
        cost: unitCost * count,
        costCode: JT.costCodes.drainage,
        insurance,
      }),
    ],
    { isSelected: !high }
  );
}

function drainRunLines({ sections, extraLF, catalog, insurance }) {
  const d = P.drainage;
  const out = [];
  if (extraLF > 0) {
    out.push(
      installedLine({
        name: `Extended drain run past ${d.includedRunFeet} ft - installed`,
        unit: "lf",
        qty: extraLF,
        unitPrice: d.extraPerFoot,
        cost: d.crewExtraPerFoot * extraLF,
        costCode: JT.costCodes.drainage,
        insurance,
      })
    );
  }
  if (sections > 0) {
    out.push(
      installedLine({
        name: "Additional 10 ft drain pipe section - installed",
        unit: "each",
        qty: sections,
        unitPrice: d.extraPipeSection,
        cost: unitCostOf(catalog, /additional drain pipe/i) * sections,
        costCode: JT.costCodes.drainage,
        insurance,
      })
    );
  }
  return out;
}

// drains: a size choice (9x9 picked unless `optional`) + any long-run lines
export function drainGroup({ count, sections, extraLF, catalog, insurance, optional = false }) {
  const sizes = [drainOption({ high: false, count, catalog, insurance }), drainOption({ high: true, count, catalog, insurance })];
  if (optional) sizes[0].isSelected = false;
  return group(
    "In-Ground Downspout Drains",
    [optionSet("Drain Size", sizes, { required: !optional }), ...drainRunLines({ sections, extraLF, catalog, insurance })],
    { description: WORDING.drains }
  );
}

function lightingLines({ lf, catalog, insurance }) {
  const l = P.lighting;
  const perFootCost = unitCostOf(catalog, /permanent holiday lighting - /i);
  return [
    installedLine({
      name: "Permanent holiday & accent lighting - installed",
      description: LIFETIME,
      unit: "lf",
      qty: lf,
      unitPrice: l.perFoot,
      cost: perFootCost * lf,
      costCode: JT.costCodes.lighting,
      insurance,
    }),
    installedLine({
      name: "Permanent lighting controller",
      unit: "each",
      qty: 1,
      unitPrice: l.controller,
      cost: unitCostOf(catalog, /control box/i),
      costCode: JT.costCodes.lighting,
      insurance,
    }),
  ];
}

export function buildGutterLines(assembly, answers = {}, basics = {}, { accountId } = {}) {
  const type = customerTypeOf(basics);
  const insurance = type === "insurance";
  const deal = accountId && P.gutters.customerRates[accountId];
  const minType = deal ? "gc" : type;
  const isGc = minType === "gc";
  const rates = gutterRatesFor(basics, { accountId });
  const six = answers.size === "6";
  const picked = six ? 6 : 5;
  const offered = upgradesFor(basics, { gutters: answers });
  const params = gutterParams(answers, basics);
  const catalog = catalogItems(assembly, params);
  const footage = billedFootage(answers);
  const color = answers.color || "";
  const flags = [];
  const lines = [];

  if (Number(answers.gutterLF) > 0) {
    const line = (size) =>
      gutterLine({ size, footage, rate: rates[size], minimum: gutterMinimum(rates, size === 6, minType), color, tearOff: Number(answers.tearOffLF) > 0, catalog, insurance });
    if (isGc) {
      // GC bids show just the size being bid
      lines.push(group("Seamless Gutters & Downspouts", [line(picked)]));
    } else {
      const sizes = [5, 6].map((s) =>
        group(s === 5 ? '5" K-Style Gutters with 2x3 Downspouts' : '6" K-Style Gutters with 3x4 Downspouts (more capacity)', [line(s)], { isSelected: s === picked })
      );
      lines.push(optionSet("Seamless Gutters & Downspouts", sizes, { required: true }));
    }
  }

  const repairs = repairLines(answers.repairs, { insurance });
  if (repairs.length) lines.push(group("Gutter Cleaning, Downspout & Repair Work", repairs, { description: WORDING.repairs }));

  if (answers.guardOptions?.length) {
    lines.push(guardOptionSet(answers.guardOptions, { size: picked, color: answers.guardColor || color, catalog, insurance }));
  }

  const upgrades = [];
  if (offered.guards && Number(answers.gutterLF) > 0) {
    upgrades.push(
      group(`Gutter Guards for ${picked}" Gutters`, guardLines({ size: picked, lf: Number(answers.gutterLF), difficultLF: Number(answers.difficultAccessLF || 0), color, catalog, insurance }), {
        description: "Recommended for the trees near the gutters.",
      })
    );
  }
  if (offered.lighting && params["Lighting LF"] > 0) {
    upgrades.push(group("Permanent Holiday & Accent Lighting", lightingLines({ lf: params["Lighting LF"], catalog, insurance })));
  }
  if (upgrades.length) lines.push(optionSet("Optional Upgrades", upgrades, { exclusive: false }));

  if (offered.drains && params["In-Ground Drains"] > 0) {
    lines.push(
      drainGroup({
        count: params["In-Ground Drains"],
        sections: params["Drain Extra Pipe Sections"],
        extraLF: params["Drain Extra LF"],
        catalog,
        insurance,
        optional: true,
      })
    );
    lines[lines.length - 1].name = "Optional In-Ground Downspout Drains";
    if (params["Drain Extra LF"] > 0) flags.push("Drain runs past 8 ft: no fixed drain price until concrete, roots and landscaping are checked.");
  }

  return { lines, params, total: selectedPriceTotal(lines), flags };
}

// ---------- drainage / lighting on their own ----------

export function drainageParams(answers = {}) {
  const n = (k) => Math.max(0, Number(answers[k] || 0));
  const extraLF = n("drainExtraLF");
  return {
    "In-Ground Drains": n("drains"),
    "Drain Extra Pipe Sections": n("drainsPast8") || Math.ceil(extraLF / 10),
    "Drain Extra LF": extraLF,
  };
}

export function buildDrainageLines(assembly, answers = {}, basics = {}) {
  const insurance = customerTypeOf(basics) === "insurance";
  const params = drainageParams(answers);
  const catalog = catalogItems(assembly, params);
  const lines = [
    drainGroup({ count: params["In-Ground Drains"], sections: params["Drain Extra Pipe Sections"], extraLF: params["Drain Extra LF"], catalog, insurance }),
  ];
  const flags = params["Drain Extra LF"] > 0 ? ["Drain runs past 8 ft: no fixed drain price until concrete, roots and landscaping are checked."] : [];
  return { lines, params, total: selectedPriceTotal(lines), flags };
}

export function buildLightingLines(assembly, answers = {}, basics = {}) {
  const insurance = customerTypeOf(basics) === "insurance";
  const lf = Math.max(0, Number(answers.lightingLF || 0));
  const params = { "Lighting LF": lf, "Lighting Control Boxes": lf > 0 ? 1 : 0 };
  const catalog = catalogItems(assembly, params);
  const lines = [group("Permanent Holiday & Accent Lighting", lightingLines({ lf, catalog, insurance }))];
  return { lines, params, total: selectedPriceTotal(lines), flags: [] };
}

// ---------- siding ----------

export const STYLED_SIDING = ["lp", "hardie"];
export const SHAKE_SIDING = ["lp", "hardie", "vinyl"];

export function sidingParams(answers = {}, basics = {}) {
  const wall = Number(answers.wallSF || 0);
  const type = tearOffType(basics, answers);
  const tearSF = type === "none" ? 0 : Number(answers.tearOffSF ?? wall) || 0;
  // every siding job gets a dumpster: lots of cut-off waste even without tear-off
  const dumpsters = answers.dumpsters !== undefined && answers.dumpsters !== "" ? Number(answers.dumpsters) || 0 : wall > 0 ? 1 : 0;
  const styled = STYLED_SIDING.includes(answers.product);
  const batten = styled ? Math.min(Number(answers.battenSF || 0), wall) : 0;
  const shake = answers.product === "vinylShake" ? wall : SHAKE_SIDING.includes(answers.product) ? Math.min(Number(answers.shakeSF || 0), wall - batten) : 0;
  return {
    "Wall SF": wall,
    "Batten SF": batten,
    "Shake SF": shake,
    "Vinyl Tear-off SF": type === "vinyl" ? tearSF : 0,
    "Wood Tear-off SF": type === "wood" ? tearSF : 0,
    "Stucco Tear-off SF": type === "stucco" ? tearSF : 0,
    "Resheathing SF": Number(answers.resheathSF || 0),
    Dumpsters: dumpsters,
    "Metal Wraps": Number(answers.metalWraps || 0),
  };
}

export function buildSidingLines(assembly, answers = {}, basics = {}, product = "lp") {
  const type = customerTypeOf(basics);
  const insurance = type === "insurance";
  const isGc = type === "gc";
  const words = WORDING.siding[product] || WORDING.siding.lp;
  const offered = upgradesFor(basics, { siding: { ...answers, product } });
  const params = sidingParams({ ...answers, product }, basics);
  const catalog = catalogItems(assembly, params);
  const waste = P.waste.siding;
  const wall = params["Wall SF"];
  const batten = params["Batten SF"];
  const shake = params["Shake SF"];
  const lapSF = wall - batten - shake;
  const painted = PAINTED_SIDING.includes(product);
  // retail and every Hardie job: Emerald; GC LP: contractor-grade
  const emerald = !isGc || product === "hardie";
  const flags = [];

  // costs: base items (not tear-off, metal wraps, upgrades or the paint
  // that isn't used), split by style; shared costs go by area
  const notPaint = emerald ? /contractor-grade/i : /emerald/i;
  const base = catalog.filter((i) => !inGroup(/tear-off|metal wraps|optional upgrades/i)(i) && !inGroup(notPaint)(i));
  const battenItems = base.filter(named(/batten|panel/i));
  const shakeItems = base.filter((i) => !battenItems.includes(i) && named(/shake|shingle/i)(i));
  const shared = base.filter((i) => !battenItems.includes(i) && !shakeItems.includes(i));
  const sharedCost = costOf(shared);
  const share = (sf) => (wall ? (sharedCost * sf) / wall : 0);

  const paintNote = painted ? sentence(emerald ? WORDING.siding.paintRetail : WORDING.siding.paintGc, WORDING.warranty.paint) : "";
  const description = sentence(words.description, paintNote, LIFETIME, manufacturerNote(product));
  const costCode = JT.costCodes[`siding_${product}`] || JT.costCodes.siding_lp;
  const rates = P.siding.ratesPerSF[product] || P.siding.ratesPerSF.lp;
  const styleRate = (k) => byType(k === "shake" && /^vinyl/.test(product) ? P.siding.ratesPerSF.vinylShake : P.siding.styleRatesPerSF[k], basics);

  const main = [];
  if (lapSF > 0 && words.lap) {
    main.push(installedLine({ name: `${words.lap} - installed`, description, unit: "sf", qty: lapSF * waste, unitPrice: byType(rates, basics), cost: share(lapSF), costCode, insurance }));
  }
  if (batten > 0 && words.batten) {
    main.push(installedLine({ name: `${words.batten} - installed`, description, unit: "sf", qty: batten * waste, unitPrice: styleRate("batten"), cost: share(batten) + costOf(battenItems), costCode, insurance }));
  }
  if (shake > 0 && words.shake) {
    main.push(installedLine({ name: `${words.shake} - installed`, description, unit: "sf", qty: shake * waste, unitPrice: styleRate("shake"), cost: share(shake) + costOf(shakeItems), costCode, insurance }));
  }
  const lines = [group(words.lap ? words.lap.replace(/ with .*/, "") : words.shake.replace(/ with .*/, ""), main)];

  // tear-off & prep: no lifetime warranty
  const prep = [];
  const prepCode = JT.costCodes.sidingPrep;
  const tear = [
    ["vinyl", "Vinyl Tear-off SF", "Tear off existing vinyl/aluminum siding", /tear off vinyl/i],
    ["wood", "Wood Tear-off SF", "Tear off existing wood siding", /tear off wood/i],
    ["stucco", "Stucco Tear-off SF", "Tear off existing stucco", /stucco tear off/i],
  ];
  for (const [k, param, name, re] of tear) {
    const sf = params[param];
    if (sf > 0) prep.push(installedLine({ name, unit: "sf", qty: sf, unitPrice: P.siding.tearOffPerSF[k], cost: unitCostOf(catalog, re) * sf, costCode: prepCode, insurance }));
  }
  if (params["Resheathing SF"] > 0) {
    const sf = params["Resheathing SF"];
    const cost = costOf(catalog.filter(named(/sheathing/i)));
    prep.push(installedLine({ name: "OSB resheathing - installed", unit: "sf", qty: sf, unitPrice: P.siding.resheathPerSF.price, cost, costCode: prepCode, insurance }));
  }
  if (params.Dumpsters > 0) {
    prep.push(installedLine({ name: "Dumpster", unit: "each", qty: params.Dumpsters, unitPrice: byType(P.siding.dumpster.price, basics), cost: P.siding.dumpster.cost * params.Dumpsters, costCode: prepCode, insurance }));
  }
  if (params["Metal Wraps"] > 0) {
    const n = params["Metal Wraps"];
    prep.push(installedLine({ name: "Metal wrap (window, man door, garage door) - installed", unit: "each", qty: n, unitPrice: P.siding.metalWrapEach, cost: unitCostOf(catalog, /metal wrap/i) * n, costCode, insurance }));
  }
  if (prep.length) lines.push(group("Tear-off & Prep", prep));

  // upgrades: insulated reflective house wrap (all siding jobs); Emerald
  // paint on GC LP bids
  const upgrades = [];
  if (offered.insulatedWrap && wall > 0) {
    const qty = wall * waste;
    upgrades.push(
      group("Insulated Reflective House Wrap", [
        installedLine({
          name: "Insulated reflective house wrap upgrade - installed",
          description: "Premium insulated, reflective wrap in place of standard house wrap, to help keep the walls cooler in summer and warmer in winter.",
          unit: "sf",
          qty,
          unitPrice: P.siding.insulatedWrapUpgradePerSF.price,
          cost: unitCostOf(catalog, /insulated reflective/i) * qty,
          costCode,
          insurance,
        }),
      ])
    );
  }
  if (offered.emeraldPaint && painted && !emerald && wall > 0) {
    const gallons = wall / 150;
    const priceOf = (re) => unitCostOf(catalog.map((i) => ({ ...i, unitCost: i.unitPrice })), re);
    const delta = (priceOf(/emerald rain refresh - material/i) - priceOf(/contractor-grade exterior paint/i)) * gallons;
    const costDelta = (unitCostOf(catalog, /emerald rain refresh - material/i) - unitCostOf(catalog, /contractor-grade exterior paint/i)) * gallons;
    if (delta > 0) {
      upgrades.push(
        group("Sherwin-Williams Emerald Rain Refresh Paint", [
          installedLine({ name: "Upgrade to Sherwin-Williams Emerald Rain Refresh paint", description: WORDING.warranty.paint, unit: "lump", qty: 1, unitPrice: delta, cost: costDelta, costCode, insurance }),
        ])
      );
    }
  }
  if (upgrades.length) lines.push(optionSet("Optional Upgrades", upgrades, { exclusive: false }));

  if (insurance) flags.push("Insurance siding: match the adjuster's estimate line by line before sending (adjusters pay about $6.75–7/sq ft for vinyl).");
  return { lines, params, total: selectedPriceTotal(lines), flags };
}

// ---------- stucco ----------

export function stuccoParams(answers = {}) {
  const full = answers.jobType === "full";
  const repair = answers.jobType === "repair";
  const spots = Number(answers.gutterWallSpots || 0);
  return {
    "Stucco SF": full ? Number(answers.stuccoSF || 0) : 0,
    "Stucco Repairs": repair && answers.otherRepairs !== "no" ? 1 : 0,
    "Popout Windows": repair ? Number(answers.popouts || 0) : 0,
    "Gutter Wall Spots": spots,
    "Gutter Wall Stucco Repair": spots > 0 ? 1 : 0,
    "Foundation Plaster LF": Number(answers.foundationLF || 0),
  };
}

export function hasStuccoWork(answers = {}) {
  return Object.values(stuccoParams(answers)).some((v) => v > 0);
}

export function buildStuccoLines(assembly, answers = {}, basics = {}) {
  const insurance = customerTypeOf(basics) === "insurance";
  const params = stuccoParams(answers);
  const catalog = catalogItems(assembly, params);
  const s = P.stucco;
  const code = JT.costCodes.stucco;
  const cost = (re) => costOf(catalog.filter(named(re)));
  const colorNote = WORDING.warranty.stuccoColorMatch;
  const items = [];
  if (params["Stucco SF"] > 0) {
    items.push(installedLine({ name: "Stucco, full job - installed", description: LIFETIME, unit: "sf", qty: params["Stucco SF"] * P.waste.siding, unitPrice: byType(s.fullPerSF, basics), cost: cost(/full job/i), costCode: code, insurance }));
  }
  if (params["Stucco Repairs"] > 0) {
    items.push(installedLine({ name: "Stucco repair", description: colorNote, unit: "lump", qty: 1, unitPrice: s.repairMinimum.price, cost: cost(/^stucco repair$/i) || s.repairMinimum.cost, costCode: code, insurance }));
  }
  if (params["Popout Windows"] > 0) {
    items.push(installedLine({ name: "Stucco popout cut-back (per window)", description: colorNote, unit: "each", qty: params["Popout Windows"], unitPrice: s.popoutPerWindow, cost: cost(/popout/i), costCode: code, insurance }));
  }
  if (params["Foundation Plaster LF"] > 0) {
    items.push(installedLine({ name: "Foundation plaster", unit: "lf", qty: params["Foundation Plaster LF"], unitPrice: s.foundationPlasterPerFoot, cost: cost(/foundation plaster/i), costCode: code, insurance }));
  }
  const lines = [];
  if (items.length) lines.push(group("Stucco", items));
  if (params["Gutter Wall Spots"] > 0) {
    lines.push(
      group("Gutter Against Stucco Wall Repair", [
        installedLine({ name: "Gutter cut-back from stucco wall + new end cap", unit: "each", qty: params["Gutter Wall Spots"], unitPrice: s.gutterWall.cutBack, cost: cost(/cut-back from stucco/i), costCode: code, insurance }),
        installedLine({ name: "Stucco repair where the gutter met the wall", description: colorNote, unit: "lump", qty: 1, unitPrice: s.gutterWall.stuccoRepair, cost: cost(/where gutter met/i), costCode: code, insurance }),
      ])
    );
  }
  return { lines, params, total: selectedPriceTotal(lines), flags: [] };
}

// ---------- soffit & fascia ----------

export function soffitFasciaParams(answers = {}) {
  const n = (k) => Math.max(0, Number(answers[k] || 0));
  const both = n("bothLF"), soffitOnly = n("soffitOnlyLF"), fasciaOnly = n("fasciaOnlyLF");
  const depth = Number(answers.overhangIn) > 0 ? Number(answers.overhangIn) : 18;
  const soffitLF = both + soffitOnly;
  return {
    "Soffit And Fascia LF": both,
    "Soffit Only LF": soffitOnly,
    "Fascia Only LF": fasciaOnly,
    "Soffit LF": soffitLF,
    "Fascia LF": both + fasciaOnly,
    "Soffit SF": round2((soffitLF * depth) / 12),
    "Porch Cap SF": n("porchCapSF"),
  };
}

export function hasSoffitFasciaWork(answers = {}) {
  const p = soffitFasciaParams(answers);
  return p["Soffit LF"] + p["Fascia LF"] + p["Porch Cap SF"] > 0;
}

export function buildSoffitFasciaLines(assembly, answers = {}, basics = {}) {
  const insurance = customerTypeOf(basics) === "insurance";
  const params = soffitFasciaParams(answers);
  const catalog = catalogItems(assembly, params);
  const code = JT.costCodes.soffitFascia;
  const rate = byType(P.soffitFascia.bothPerFoot, basics);
  const porchRate = byType(P.soffitFascia.porchCapPerSF, basics);
  const notPorch = (i) => !/porch cap/i.test(i.name);
  // material cost per LF of soffit / fascia, then labor per line
  const soffitMatPerLF = params["Soffit LF"] ? costOf(catalog.filter((i) => notPorch(i) && /soffit/i.test(i.name) && !/labor/i.test(i.name))) / params["Soffit LF"] : 0;
  const fasciaMatPerLF = params["Fascia LF"] ? costOf(catalog.filter((i) => notPorch(i) && /fascia/i.test(i.name) && !/labor/i.test(i.name) && !/soffit/i.test(i.name))) / params["Fascia LF"] : 0;
  const laborBoth = unitCostOf(catalog, /soffit & fascia install/i);
  const laborOne = unitCostOf(catalog, /soffit only or fascia only/i);
  const both = params["Soffit And Fascia LF"], soffitOnly = params["Soffit Only LF"], fasciaOnly = params["Fascia Only LF"];
  const items = [];
  if (both > 0) items.push(installedLine({ name: 'Aluminum soffit & 6" fascia - installed', description: LIFETIME, unit: "lf", qty: both, unitPrice: rate, cost: (soffitMatPerLF + fasciaMatPerLF + laborBoth) * both, costCode: code, insurance }));
  if (soffitOnly > 0) items.push(installedLine({ name: "Aluminum soffit - installed", description: LIFETIME, unit: "lf", qty: soffitOnly, unitPrice: rate / 2, cost: (soffitMatPerLF + laborOne) * soffitOnly, costCode: code, insurance }));
  if (fasciaOnly > 0) items.push(installedLine({ name: 'Aluminum 6" fascia - installed', description: LIFETIME, unit: "lf", qty: fasciaOnly, unitPrice: rate / 2, cost: (fasciaMatPerLF + laborOne) * fasciaOnly, costCode: code, insurance }));
  if (params["Porch Cap SF"] > 0) {
    items.push(installedLine({ name: "Aluminum porch cap (soffit ceiling) - installed", description: LIFETIME, unit: "sf", qty: params["Porch Cap SF"], unitPrice: porchRate, cost: costOf(catalog.filter(named(/porch cap/i))), costCode: code, insurance }));
  }
  const lines = items.length ? [group("Aluminum Soffit & Fascia", items)] : [];
  return { lines, params, total: selectedPriceTotal(lines), flags: [] };
}

// ---------- painting ----------

export function paintingParams(answers = {}) {
  const n = (k) => Math.max(0, Number(answers[k] || 0));
  const wall = n("wallSF");
  return {
    "Paint Wall SF": wall,
    // eaves cost less to paint when the walls are being painted too
    "Eave LF With Repaint": wall > 0 ? n("eaveLF") : 0,
    "Eave LF Only": wall > 0 ? 0 : n("eaveLF"),
    "Garage Doors": n("garageDoors"),
    "Man Doors": n("manDoors"),
  };
}

export function hasPaintingWork(answers = {}) {
  return Object.values(paintingParams(answers)).some((v) => v > 0);
}

export function buildPaintingLines(assembly, answers = {}, basics = {}) {
  const insurance = customerTypeOf(basics) === "insurance";
  const params = paintingParams(answers);
  const catalog = catalogItems(assembly, params);
  const p = P.painting;
  const code = JT.costCodes.painting;
  const cost = (re) => costOf(catalog.filter(named(re)));
  const note = WORDING.warranty.paint;
  const eaves = params["Eave LF With Repaint"] + params["Eave LF Only"];
  const items = [];
  if (params["Paint Wall SF"] > 0) items.push(installedLine({ name: "Exterior repaint, Sherwin-Williams Emerald Rain Refresh", description: note, unit: "sf", qty: params["Paint Wall SF"], unitPrice: p.wallPerSF, cost: cost(/exterior repaint/i), costCode: code, insurance }));
  if (eaves > 0) items.push(installedLine({ name: "Paint eaves", description: note, unit: "lf", qty: eaves, unitPrice: p.eavePerFoot, cost: cost(/paint eaves/i), costCode: code, insurance }));
  if (params["Garage Doors"] > 0) items.push(installedLine({ name: "Paint garage door", description: note, unit: "each", qty: params["Garage Doors"], unitPrice: p.garageDoorEach, cost: cost(/garage door/i), costCode: code, insurance }));
  if (params["Man Doors"] > 0) items.push(installedLine({ name: "Paint man door", description: note, unit: "each", qty: params["Man Doors"], unitPrice: p.manDoorEach, cost: cost(/man door/i), costCode: code, insurance }));
  const subtotal = selectedPriceTotal(items);
  if (subtotal > 0 && subtotal < p.minimum) {
    items.push(installedLine({ name: "Small job minimum", description: `Our minimum for a painting job is $${p.minimum}.`, unit: "lump", qty: 1, unitPrice: p.minimum - subtotal, cost: 0, costCode: code, insurance }));
  }
  const lines = items.length ? [group("Exterior Painting", items)] : [];
  return { lines, params, total: selectedPriceTotal(lines), flags: [] };
}

// ---------- the draft ----------

// merges our parameters into whatever the job already has
export function mergeParameters(existing, params) {
  const list = Array.isArray(existing) ? existing.filter((p) => !(p.name in params)) : [];
  const kept = list.map((p) => (p.formula ? { name: p.name, formula: p.formula } : { name: p.name, value: p.value ?? 0 }));
  return [...kept, ...Object.entries(params).map(([name, value]) => ({ name, value }))];
}

// which trades this lead's answers can draft
export function draftPlan(basics = {}, answers = {}) {
  const trades = basics.trades || [];
  const g = answers.gutters || {};
  const product = sidingProduct(answers);
  return {
    gutters: trades.includes("gutters") && (Number(g.gutterLF) > 0 || !!g.repairs?.length || !!g.guardOptions?.length),
    siding: trades.includes("siding") && AUTOMATED_SIDING.includes(product),
    stucco: trades.includes("stucco") && hasStuccoWork(answers.stucco),
    soffitFascia: trades.includes("soffitFascia") && hasSoffitFasciaWork(answers.soffitFascia),
    painting: trades.includes("painting") && hasPaintingWork(answers.painting),
    drainage: trades.includes("drainage") && Number(answers.drainage?.drains) > 0,
    lighting: trades.includes("lighting") && Number(answers.lighting?.lightingLF) > 0,
    product,
  };
}

// builds every trade's lines (no JobTread writes); the order the work goes
// on the house: siding, stucco, soffit & fascia, painting, gutters, drains,
// lighting
export function buildAllLines({ basics, answers, assemblies, accountId }) {
  const plan = draftPlan(basics, answers);
  const out = { lines: [], params: {}, total: 0, flags: [] };
  const add = (r) => {
    out.lines.push(...r.lines);
    Object.assign(out.params, r.params);
    out.total += r.total;
    out.flags.push(...(r.flags || []));
  };
  if (plan.siding) add(buildSidingLines(assemblies.siding, answers.siding || {}, basics, plan.product));
  if (plan.stucco) add(buildStuccoLines(assemblies.stucco, answers.stucco || {}, basics));
  if (plan.soffitFascia) add(buildSoffitFasciaLines(assemblies.soffitFascia, answers.soffitFascia || {}, basics));
  if (plan.painting) add(buildPaintingLines(assemblies.painting, answers.painting || {}, basics));
  if (plan.gutters) add(buildGutterLines(assemblies.gutters, answers.gutters || {}, basics, { accountId }));
  if (plan.drainage) add(buildDrainageLines(assemblies.drainage, answers.drainage || {}, basics));
  if (plan.lighting) add(buildLightingLines(assemblies.lighting, answers.lighting || {}, basics));
  out.total = round2(out.total);
  if (customerTypeOf(basics) === "insurance") out.flags.push("Insurance job: price off the adjuster's estimate and follow the claim's line structure before sending.");
  const makers = [];
  if (plan.siding) makers.push(plan.product);
  if (out.lines.some(function has(l) { return l._type === "costItem" ? /Bulldog/.test(l.name) : (l.lineItems || []).some(has); })) makers.push("bulldog");
  const unverified = unverifiedManufacturerLinks(makers);
  if (unverified.length) out.flags.push(`Warranty links not confirmed yet for ${unverified.map((k) => WORDING.manufacturers[k].maker).join(", ")}: open them and set "verified": true in estimating/wording.json.`);
  for (const k of makers) {
    const m = WORDING.manufacturers[k];
    if (m && !(m.links || []).length) out.flags.push(`No official warranty link on file for ${m.maker} yet.`);
  }
  return out;
}

const toE164 = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null;
};

// creates the draft Proposal on the job; returns { documentId, fullName, total, ... }
export async function draftEstimate({ lead, basics, answers, link }) {
  const plan = draftPlan(basics, answers);
  const tradesToDraft = ["gutters", "siding", "stucco", "soffitFascia", "painting", "drainage", "lighting"].filter((t) => plan[t]);
  if (!tradesToDraft.length) throw new Error("None of the work on this lead is automated yet");

  const assemblyKey = (t) => (t === "siding" ? `siding_${plan.product}` : t);
  const [assemblyList, jobData, templateData] = await Promise.all([
    Promise.all(tradesToDraft.map((t) => fetchAssembly(JT.assemblies[assemblyKey(t)]))),
    pave({ job: { $: { id: link.jobId }, parameters: {}, location: { name: {}, address: {}, account: { id: {}, name: {} } } } }),
    pave({
      documentTemplate: {
        $: { id: JT.proposalTemplateId },
        footer: {},
        showFinancing: {},
        includeInBudget: {},
        showChildCosts: {},
        showCostItemFiles: {},
      },
    }),
  ]);
  const assemblies = Object.fromEntries(tradesToDraft.map((t, n) => [t, assemblyList[n]]));
  const job = jobData?.job;
  if (!job) throw new Error("Couldn't find the JobTread job for this lead");
  const tpl = templateData?.documentTemplate || {};

  const built = buildAllLines({ basics, answers, assemblies, accountId: job.location.account.id });

  await pave({ updateJob: { $: { id: link.jobId, parameters: mergeParameters(job.parameters, built.params) } } });

  const d = JT.proposal;
  const emailMessage = proposalMessage({ lead, basics, answers, offered: upgradesFor(basics, answers) });
  const created = await pave({
    createDocument: {
      $: {
        jobId: link.jobId,
        accountId: job.location.account.id,
        type: d.type,
        name: d.name,
        taxRate: taxRateFor(basics),
        fromName: d.fromName,
        fromOrganizationName: d.fromOrganizationName,
        fromAddress: d.fromAddress,
        fromEmailAddress: d.fromEmailAddress,
        fromPhoneNumber: d.fromPhoneNumber,
        toName: lead.name,
        toOrganizationName: job.location.account.name,
        toAddress: job.location.address,
        toEmailAddress: String(lead.email || "").trim() || null,
        toPhoneNumber: toE164(lead.phone),
        jobLocationName: job.location.name,
        jobLocationAddress: job.location.address,
        footer: tpl.footer ?? null,
        dueDays: d.dueDays,
        requireSignature: d.requireSignature,
        showFinancing: tpl.showFinancing ?? true,
        includeInBudget: tpl.includeInBudget ?? true,
        showChildCosts: tpl.showChildCosts ?? true,
        showCostItemFiles: tpl.showCostItemFiles ?? true,
        showQuantity: d.showQuantity,
        // the cover email body (JobTread supplies the subject); only sent
        // after Sean approves this proposal in Lead Hammer
        emailMessage,
        lineItems: built.lines,
      },
      createdDocument: { id: {}, fullName: {}, status: {}, price: {} },
    },
  });
  const doc = created?.createDocument?.createdDocument;
  if (!doc?.id) throw new Error("JobTread didn't return the new estimate");
  return {
    documentId: doc.id,
    fullName: doc.fullName,
    status: doc.status,
    price: doc.price ?? built.total,
    estimatedTotal: built.total,
    flags: built.flags,
    createdAt: new Date().toISOString(),
    // what Lead Hammer priced, to compare with what Sean sends (editReview.js)
    snapshot: snapshotLines(built.lines, doc.price ?? built.total),
    // for the review only; not stored on the lead
    lines: built.lines,
    emailMessage,
  };
}
