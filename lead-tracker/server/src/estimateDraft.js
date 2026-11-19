// Drafts a JobTread estimate (a "Proposal" customer order) on a lead's job
// from the catalog assemblies, using the trade questionnaire answers as job
// parameters. The draft is never sent — Sean reviews and sends it himself.
//
// The assembly is read from the JobTread catalog every time, so price
// changes there (including the supplier price watcher's) flow straight into
// new drafts.

import { pave } from "./jobtread.js";
import { proposalMessage } from "./proposalMessage.js";
import {
  TRADE_QUESTIONS,
  upgradesFor,
  defaultDrainCount,
  sidingProduct,
  tearOffType,
  AUTOMATED_SIDING,
} from "../../shared/tradeQuestions.js";

export const ASSEMBLIES = {
  gutters: { id: "22PiKu7hJgmr", name: "Seamless Gutter System" },
  siding_lp: { id: "22PiLt4qNebY", name: "LP SmartSide Siding System" },
  siding_hardie: { id: "22PiLwHsrbUv", name: "James Hardie Siding System" },
  siding_ascend: { id: "22PiLwLfsi72", name: "Alside Ascend Siding System" },
  siding_vinyl: { id: "22PiLwPwWcMs", name: "Vinyl Siding System" },
  stucco: { id: "22PiLznBbZJs", name: "Stucco" },
};

// Stucco: full jobs per sq ft on wall area + 10% (Luis $6/sq ft all-in);
// repairs are a flat $2,700 (cost $1,800), popout cut-backs $750 a window
// for any customer (cost $500), and a repair bid never goes under $2,700.
export const STUCCO_RATES = { retail: 10, insurance: 10, gc: 8 };
export const STUCCO_REPAIR_MINIMUM = 2700;
const STUCCO_COST_CODE = "22PiKU5iGnRc";

// Siding prices per square foot, charged on the wall area plus 10% (Sean's
// waste rule, applied to material and labor alike). Covers siding, trim,
// house wrap, sundries and paint (LP and Hardie); tear-off, resheathing, the
// dumpster and metal wraps are priced on their own, and upgrades keep their
// own prices. LP, Hardie and Ascend don't come through insurance, so those
// get the retail rate on an insurance lead.
export const SIDING_RATES = {
  lp: { retail: 14, insurance: 14, gc: 12 },
  hardie: { retail: 14, insurance: 14, gc: 12 },
  ascend: { retail: 12.5, insurance: 12.5, gc: 11 },
  // vinyl insurance: adjusters pay about $6.75-7/sq ft all-in, so the base
  // starts at $6 and tear-off + dumpster bring it to about $7
  vinyl: { retail: 9, insurance: 6, gc: 8 },
};
export const SIDING_WASTE = 1.1;
const PROPOSAL_TEMPLATE_ID = "22PJfnqzbFfh";
const GUTTER_MINIMUM = 350;
// Sean's gutter prices, per foot of gutter PLUS downspout (he bills the
// downspout footage too). Miters and tear-off are included. The line items
// keep their real costs; their prices are scaled so the bid lands on these
// rates. Upgrade options keep their own prices; the $350 minimum still applies.
export const GUTTER_RATES = {
  retail: { 5: 12, 6: 15 },
  insurance: { 5: 10.5, 6: 15 },
  gc: { 5: 8.5, 6: 8.5 },
};
// customers with their own deal, by JobTread customer account
export const CUSTOMER_GUTTER_RATES = {
  "22PLZFJ8Yrtd": { name: "Erick Funn", rates: { 5: 7.5, 6: 7.5 } },
};

export function gutterRatesFor(basics, { accountId } = {}) {
  if (accountId && CUSTOMER_GUTTER_RATES[accountId]) return CUSTOMER_GUTTER_RATES[accountId].rates;
  return GUTTER_RATES[basics?.customerType] || GUTTER_RATES.retail;
}

// gutter + downspout footage billed (downspouts per Sean's takeoff rule)
export function billedFootage(answers = {}) {
  const n = (k) => Number(answers[k] || 0);
  return n("gutterLF") + 13 * n("oneStory") + 23 * n("twoStory") + 33 * n("threeStory") + 2 * n("offsets");
}
const UTAH_TAX_RATE = 0.0745; // line items are non-taxable; kept to match existing proposals
const GUTTERS_COST_CODE = "22PiKU5iG4cy";
const OTHER_COST_TYPE = "22PJfnqzbFfM";
const EACH_UNIT = "22PJfnqzbFeZ";

const ITEM_FIELDS = {
  id: {},
  name: {},
  description: {},
  position: {},
  quantity: {},
  quantityFormula: {},
  unitCost: {},
  unitPrice: {},
  isTaxable: {},
  showQuantity: {},
  costGroup: { id: {} },
  organizationCostItem: { id: {} },
  costCode: { id: {} },
  costType: { id: {} },
  unit: { id: {} },
};
const GROUP_FIELDS = {
  id: {},
  name: {},
  description: {},
  position: {},
  quantity: {},
  quantityFormula: {},
  isSelected: {},
  minSelectionsRequired: {},
  maxSelectionsAllowed: {},
  showChildDeltas: {},
  showChildren: {},
  showChildCosts: {},
  showDescription: {},
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

// Turns a catalog assembly into document line items, keeping the quantity
// formulas (they read the job parameters). `selectGroup(group)` returns true
// / false to override which selection option is picked; `dropGroup(group)`
// removes a group (and everything under it).
//
// JobTread's API stores formulas but doesn't calculate them (only its web
// screen does), so each quantity is worked out here from `params` and sent as
// a number, with the formula kept alongside.
export function assemblyToLineItems(
  root,
  { params = {}, selectGroup = () => undefined, dropGroup = () => false, dropItem = () => false } = {}
) {
  const groups = root.descendentCostGroups?.nodes || [];
  const items = root.descendentCostItems?.nodes || [];
  const byPos = (a, b) => String(a.position ?? "").localeCompare(String(b.position ?? ""), undefined, { numeric: true });

  const itemLine = (i) => {
    const line = {
      _type: "costItem",
      name: i.name,
      description: i.description ?? null,
      quantity: i.quantityFormula ? Math.round(evalFormula(i.quantityFormula, params) * 100) / 100 : i.quantity,
      quantityFormula: i.quantityFormula ?? null,
      unitCost: i.unitCost,
      unitPrice: i.unitPrice,
      isTaxable: !!i.isTaxable,
      showQuantity: !!i.showQuantity,
      costCodeId: i.costCode?.id ?? null,
      costTypeId: i.costType?.id ?? null,
      unitId: i.unit?.id ?? null,
      organizationCostItemId: i.organizationCostItem?.id ?? null,
    };
    return line;
  };

  const childrenOf = (groupId) => {
    const kids = [
      ...groups.filter((g) => g.parentCostGroup?.id === groupId && !dropGroup(g)).map((g) => ({ kind: "g", v: g })),
      ...items
        .filter((i) => i.costGroup?.id === groupId)
        .filter((i) => !dropItem(i, i.quantityFormula ? evalFormula(i.quantityFormula, params) : Number(i.quantity || 0)))
        .map((i) => ({ kind: "i", v: i })),
    ].sort((a, b) => byPos(a.v, b.v));
    return kids.map((k) => (k.kind === "i" ? itemLine(k.v) : groupLine(k.v)));
  };

  const groupLine = (g) => {
    const override = selectGroup(g);
    return {
      _type: "costGroup",
      name: g.name,
      description: g.description ?? null,
      quantity: g.quantityFormula ? null : g.quantity ?? null,
      quantityFormula: g.quantityFormula ?? null,
      isSelected: override === undefined ? !!g.isSelected : override,
      minSelectionsRequired: g.minSelectionsRequired ?? null,
      maxSelectionsAllowed: g.maxSelectionsAllowed ?? null,
      showChildDeltas: !!g.showChildDeltas,
      showChildren: g.showChildren ?? true,
      showChildCosts: g.showChildCosts ?? true,
      showDescription: g.showDescription ?? true,
      lineItems: childrenOf(g.id),
    };
  };

  return [groupLine(root)];
}

// Evaluates the assembly formulas the way JobTread will ({Param} * numbers),
// to total the selected (non-optional) lines for the minimum-charge check.
export function evalFormula(formula, params) {
  const expr = String(formula).replace(/\{([^}]+)\}/g, (_, name) => String(Number(params[name] ?? 0)));
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${expr});`)();
  return Number.isFinite(v) ? v : 0;
}

// sum of price for what the customer gets by default: groups that are
// selection options count only when selected; optional-upgrade groups
// (min 0) count only their selected children
export function selectedPriceTotal(lines) {
  let total = 0;
  const walk = (list, parentIsSelectionSet) => {
    for (const l of list) {
      if (l._type === "costItem") {
        const qty = Number(l.quantity || 0);
        total += qty * Number(l.unitPrice || 0);
      } else {
        if (parentIsSelectionSet && !l.isSelected) continue;
        const isSelectionSet = l.maxSelectionsAllowed != null || l.minSelectionsRequired != null;
        walk(l.lineItems || [], isSelectionSet);
      }
    }
  };
  walk(lines, false);
  return Math.round(total * 100) / 100;
}

export function gutterParams(answers, basics) {
  const params = {};
  for (const q of TRADE_QUESTIONS.gutters.questions) {
    if (!q.param) continue;
    params[q.param] = Number(answers[q.key] ?? 0);
  }
  // upgrade options still need sensible quantities when they're shown
  const offered = upgradesFor(basics, { gutters: answers });
  if (offered.lighting && !answers.lightingLF) params["Lighting LF"] = params["Gutter LF"];
  params["In-Ground Drains"] = offered.drains ? defaultDrainCount(answers) : 0;
  // one more pipe section per drain past 8 ft; if only the footage is known,
  // one section per 10 ft of it
  if (!answers.drainsPast8 && answers.drainExtraLF) params["Drain Extra Pipe Sections"] = Math.ceil(answers.drainExtraLF / 10);
  return params;
}

export function buildGutterLines(assembly, answers, basics, { accountId } = {}) {
  const six = answers.size === "6";
  const isGc = (basics?.customerType || "") === "gc";
  const offered = upgradesFor(basics, { gutters: answers });
  const anyUpgrade = offered.guards || offered.drains || offered.lighting;
  const params = gutterParams(answers, basics);
  const lines = assemblyToLineItems(assembly, {
    params,
    selectGroup: (g) => {
      // the 12x12 is the customer's choice on the proposal; standard is picked
      // (matched by basin size, so renaming the options in JobTread is safe)
      if (/9x9/i.test(g.name)) return true;
      if (/12x12/i.test(g.name)) return false;
      if (g.name.startsWith('5"')) return !six;
      if (g.name.startsWith('6"') && !/guard/i.test(g.name)) return six;
      return undefined;
    },
    // only upgrades that fit the job (shared/tradeQuestions.js upgradesFor);
    // GC bids show just the gutter size being bid
    dropGroup: (g) =>
      (/optional upgrades/i.test(g.name) && !anyUpgrade) ||
      (/gutter guards/i.test(g.name) && !offered.guards) ||
      (/guards for 6"/i.test(g.name) && !six) ||
      (/guards for 5"/i.test(g.name) && six) ||
      (/in-ground/i.test(g.name) && !offered.drains) ||
      (/lighting/i.test(g.name) && !offered.lighting) ||
      (isGc && g.name.startsWith(six ? '5"' : '6"')),
    // extra-pipe lines only when a long run was entered
    dropItem: (i, qty) => /extended drain run|additional drain pipe/i.test(i.name) && !qty,
  });
  fitOptionalLimits(lines);
  applyPerFootRate(lines, gutterRatesFor(basics, { accountId }), billedFootage(answers), six);
  const total = selectedPriceTotal(lines);
  if (total > 0 && total < GUTTER_MINIMUM) {
    lines[0].lineItems.push({
      _type: "costItem",
      name: "Small job minimum",
      description: `Our minimum for a gutter job is $${GUTTER_MINIMUM}.`,
      quantity: 1,
      quantityFormula: null,
      unitCost: 0,
      unitPrice: Math.round((GUTTER_MINIMUM - total) * 100) / 100,
      isTaxable: false,
      showQuantity: false,
      costCodeId: GUTTERS_COST_CODE,
      costTypeId: OTHER_COST_TYPE,
      unitId: EACH_UNIT,
      organizationCostItemId: null,
    });
  }
  return { lines, params, total: Math.max(total, total > 0 ? GUTTER_MINIMUM : 0) };
}

// Prices the base bid (everything but the optional upgrades) at the
// per-foot rate: shared lines (labor, tear-off) plus the picked size's lines
// come to rate x footage, and the other size option — when it's shown — is
// priced so picking it comes to its own rate x footage.
export function applyPerFootRate(lines, rates, footage, six) {
  if (!rates || !footage) return;
  const shared = [];
  const sizes = { 5: [], 6: [] };
  const collect = (list, bucket) => {
    for (const l of list) {
      if (l._type === "costItem") bucket.push(l);
      else if (/optional upgrades/i.test(l.name)) continue;
      else if (/^5"/.test(l.name)) collect(l.lineItems || [], sizes[5]);
      else if (/^6"/.test(l.name)) collect(l.lineItems || [], sizes[6]);
      else collect(l.lineItems || [], bucket);
    }
  };
  collect(lines, shared);
  const sum = (arr) => arr.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const scale = (arr, f) => arr.forEach((l) => (l.unitPrice = Math.round(Number(l.unitPrice || 0) * f * 100) / 100));
  const picked = six ? 6 : 5;
  const other = six ? 5 : 6;

  const pickedTarget = rates[picked] * footage;
  const before = sum(shared) + sum(sizes[picked]);
  if (!before) return;
  scale(shared, pickedTarget / before);
  scale(sizes[picked], pickedTarget / before);
  absorbCents([...sizes[picked], ...shared], pickedTarget - sum(shared) - sum(sizes[picked]));

  if (sizes[other].length && sum(sizes[other])) {
    const otherTarget = rates[other] * footage - sum(shared);
    scale(sizes[other], otherTarget / sum(sizes[other]));
    absorbCents(sizes[other], otherTarget - sum(sizes[other]));
  }
}

// whole-cent prices leave the total a few cents off; the line with the
// smallest quantity takes the difference most exactly
function absorbCents(arr, drift) {
  drift = Math.round(drift * 100) / 100;
  if (!drift) return;
  const pick = arr.filter((l) => Number(l.quantity) > 0).sort((a, b) => a.quantity - b.quantity)[0];
  if (pick) pick.unitPrice = Math.round((pick.unitPrice + drift / pick.quantity) * 100) / 100;
}

// An optional-choices group ("Optional Upgrades", min 0) shows "select up to
// N" on the proposal. Some options get dropped per job, so N is set to the
// number of options actually left in it.
export function fitOptionalLimits(lines) {
  for (const l of lines) {
    if (l._type !== "costGroup") continue;
    fitOptionalLimits(l.lineItems || []);
    if (l.minSelectionsRequired === 0 && l.maxSelectionsAllowed != null) {
      const options = (l.lineItems || []).filter((c) => c._type === "costGroup").length;
      l.maxSelectionsAllowed = Math.max(1, options);
    }
  }
}

export function sidingParams(answers = {}, basics = {}) {
  const wall = Number(answers.wallSF || 0);
  const type = tearOffType(basics, answers);
  const tearSF = type === "none" ? 0 : Number(answers.tearOffSF ?? wall) || 0;
  // every siding job needs a dumpster — tear-off or not, there's a lot of
  // cut-off waste on install
  const dumpsters =
    answers.dumpsters !== undefined && answers.dumpsters !== "" ? Number(answers.dumpsters) || 0 : wall > 0 ? 1 : 0;
  return {
    "Wall SF": wall,
    "Vinyl Tear-off SF": type === "vinyl" ? tearSF : 0,
    "Wood Tear-off SF": type === "wood" ? tearSF : 0,
    "Stucco Tear-off SF": type === "stucco" ? tearSF : 0,
    "Resheathing SF": Number(answers.resheathSF || 0),
    Dumpsters: dumpsters,
    "Metal Wraps": Number(answers.metalWraps || 0),
  };
}

// drops groups left with nothing in them (e.g. tear-off on new construction)
function pruneEmpty(lines) {
  return lines
    .map((l) => (l._type === "costGroup" ? { ...l, lineItems: pruneEmpty(l.lineItems || []) } : l))
    .filter((l) => l._type !== "costGroup" || (l.lineItems || []).length > 0);
}

// kept for the LP tests and callers
export function buildLpSidingLines(assembly, answers, basics) {
  return buildSidingLines(assembly, answers, basics, "lp");
}

export function buildSidingLines(assembly, answers, basics, product = "lp") {
  const isGc = (basics?.customerType || "") === "gc";
  const offered = upgradesFor(basics, { siding: answers });
  const params = sidingParams(answers, basics);
  let lines = assemblyToLineItems(assembly, {
    params,
    selectGroup: (g) => {
      // retail gets Emerald; GC bids are priced on contractor-grade paint
      // with Emerald shown as the upgrade
      if (/emerald/i.test(g.name)) return !isGc;
      if (/contractor-grade/i.test(g.name)) return isGc;
      return undefined;
    },
    dropGroup: (g) =>
      (!isGc && /contractor-grade/i.test(g.name)) ||
      (/optional upgrades/i.test(g.name) && !offered.insulatedWrap) ||
      (/insulated reflective/i.test(g.name) && !offered.insulatedWrap),
    // tear-off, resheathing, dumpster and metal wrap lines only when they apply
    dropItem: (i, qty) => /tear off|sheathing|dumpster|metal wrap/i.test(i.name) && !qty,
  });
  lines = pruneEmpty(lines);
  fitOptionalLimits(lines);

  // price the base bid at the per-square-foot rate on wall area + 10%
  const rates = SIDING_RATES[product] || SIDING_RATES.lp;
  const rate = rates[basics?.customerType] ?? rates.retail;
  const billedSF = params["Wall SF"] * SIDING_WASTE;
  const shared = [];
  const paint = { picked: [], other: [] };
  const collect = (list, bucket) => {
    for (const l of list) {
      if (l._type === "costItem") bucket.push(l);
      else if (/optional upgrades|tear-off|metal wraps/i.test(l.name)) continue;
      else if (/emerald|contractor-grade/i.test(l.name)) collect(l.lineItems || [], l.isSelected ? paint.picked : paint.other);
      else collect(l.lineItems || [], bucket);
    }
  };
  collect(lines, shared);
  const sum = (arr) => arr.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const before = sum(shared) + sum(paint.picked);
  if (billedSF && before) {
    const target = rate * billedSF;
    const f = target / before;
    for (const l of [...shared, ...paint.picked, ...paint.other]) {
      l.unitPrice = Math.round(Number(l.unitPrice || 0) * f * 100) / 100;
    }
    absorbCents([...paint.picked, ...shared], target - sum(shared) - sum(paint.picked));
  }
  return { lines, params, total: selectedPriceTotal(lines) };
}

export function stuccoParams(answers = {}) {
  const full = answers.jobType === "full";
  const repair = answers.jobType === "repair";
  return {
    "Stucco SF": full ? Number(answers.stuccoSF || 0) : 0,
    "Stucco Repairs": repair && answers.otherRepairs !== "no" ? 1 : 0,
    "Popout Windows": repair ? Number(answers.popouts || 0) : 0,
  };
}

export function buildStuccoLines(assembly, answers, basics) {
  const params = stuccoParams(answers);
  let lines = assemblyToLineItems(assembly, { params, dropItem: (i, qty) => !qty });
  lines = pruneEmpty(lines);
  const rate = STUCCO_RATES[basics?.customerType] ?? STUCCO_RATES.retail;
  for (const l of lines[0]?.lineItems || []) {
    if (/full job/i.test(l.name)) l.unitPrice = rate;
  }
  let total = selectedPriceTotal(lines);
  if (answers.jobType === "repair" && total < STUCCO_REPAIR_MINIMUM && lines[0]) {
    lines[0].lineItems.push({
      _type: "costItem",
      name: "Small job minimum",
      description: `Our minimum for a stucco repair is $${STUCCO_REPAIR_MINIMUM.toLocaleString()}.`,
      quantity: 1,
      quantityFormula: null,
      unitCost: 0,
      unitPrice: Math.round((STUCCO_REPAIR_MINIMUM - total) * 100) / 100,
      isTaxable: false,
      showQuantity: false,
      costCodeId: STUCCO_COST_CODE,
      costTypeId: OTHER_COST_TYPE,
      unitId: EACH_UNIT,
      organizationCostItemId: null,
    });
    total = STUCCO_REPAIR_MINIMUM;
  }
  return { lines, params, total };
}

// merges our parameters into whatever the job already has
export function mergeParameters(existing, params) {
  const list = Array.isArray(existing) ? existing.filter((p) => !(p.name in params)) : [];
  // keep only the fields updateJob accepts for number/formula parameters
  const kept = list.map((p) => (p.formula ? { name: p.name, formula: p.formula } : { name: p.name, value: p.value ?? 0 }));
  return [...kept, ...Object.entries(params).map(([name, value]) => ({ name, value }))];
}

// creates the draft Proposal on the job; returns { documentId, fullName, total }
export async function draftEstimate({ lead, basics, answers, link }) {
  const trades = basics.trades || [];
  const doGutters = trades.includes("gutters");
  const product = sidingProduct(answers);
  const doSiding = trades.includes("siding") && AUTOMATED_SIDING.includes(product);
  const doStucco = trades.includes("stucco") && !!answers.stucco?.jobType;
  if (!doGutters && !doSiding && !doStucco) throw new Error("None of the work on this lead is automated yet");

  const [gutterAssembly, sidingAssembly, stuccoAssembly, jobData, templateData] = await Promise.all([
    doGutters ? fetchAssembly(ASSEMBLIES.gutters.id) : null,
    doSiding ? fetchAssembly(ASSEMBLIES[`siding_${product}`].id) : null,
    doStucco ? fetchAssembly(ASSEMBLIES.stucco.id) : null,
    pave({
      job: {
        $: { id: link.jobId },
        parameters: {},
        location: { name: {}, address: {}, account: { id: {}, name: {} } },
      },
    }),
    pave({
      documentTemplate: {
        $: { id: PROPOSAL_TEMPLATE_ID },
        footer: {},
        dueDays: {},
        requireSignature: {},
        showFinancing: {},
        includeInBudget: {},
        showChildCosts: {},
        showCostItemFiles: {},
      },
    }),
  ]);
  const job = jobData?.job;
  if (!job) throw new Error("Couldn't find the JobTread job for this lead");
  const tpl = templateData?.documentTemplate || {};

  const lines = [];
  const params = {};
  let total = 0;
  // siding, then stucco, then gutters — the order the work goes on the house
  if (doSiding) {
    const r = buildSidingLines(sidingAssembly, answers.siding || {}, basics, product);
    lines.push(...r.lines);
    Object.assign(params, r.params);
    total += r.total;
  }
  if (doStucco) {
    const r = buildStuccoLines(stuccoAssembly, answers.stucco || {}, basics);
    lines.push(...r.lines);
    Object.assign(params, r.params);
    total += r.total;
  }
  if (doGutters) {
    const r = buildGutterLines(gutterAssembly, answers.gutters || {}, basics, { accountId: job.location.account.id });
    lines.push(...r.lines);
    Object.assign(params, r.params);
    total += r.total;
  }

  await pave({ updateJob: { $: { id: link.jobId, parameters: mergeParameters(job.parameters, params) } } });

  const e164 = (() => {
    const d = String(lead.phone || "").replace(/\D/g, "");
    return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null;
  })();
  const created = await pave({
    createDocument: {
      $: {
        jobId: link.jobId,
        accountId: job.location.account.id,
        type: "customerOrder",
        name: "Proposal",
        taxRate: UTAH_TAX_RATE,
        fromName: "Sean Taylor",
        fromOrganizationName: "Ridgeline Home Exteriors",
        fromAddress: "2051 Wallflower Cir, Saratoga Springs, UT 84045, USA",
        fromEmailAddress: "sean@rhxutah.com",
        fromPhoneNumber: "+18018000831",
        toName: lead.name,
        toOrganizationName: job.location.account.name,
        toAddress: job.location.address,
        toEmailAddress: String(lead.email || "").trim() || null,
        toPhoneNumber: e164,
        jobLocationName: job.location.name,
        jobLocationAddress: job.location.address,
        footer: tpl.footer ?? null,
        dueDays: tpl.dueDays ?? 30,
        requireSignature: tpl.requireSignature ?? true,
        showFinancing: tpl.showFinancing ?? true,
        includeInBudget: tpl.includeInBudget ?? true,
        showChildCosts: tpl.showChildCosts ?? true,
        showCostItemFiles: tpl.showCostItemFiles ?? true,
        showQuantity: false,
        // pre-filled email for JobTread's Send screen, in Sean's words
        emailMessage: proposalMessage({ lead, basics, answers, offered: upgradesFor(basics, answers) }),
        lineItems: lines,
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
    price: doc.price ?? total,
    estimatedTotal: total,
    createdAt: new Date().toISOString(),
  };
}
