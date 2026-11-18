// Drafts a JobTread estimate (a "Proposal" customer order) on a lead's job
// from the catalog assemblies, using the trade questionnaire answers as job
// parameters. The draft is never sent — Sean reviews and sends it himself.
//
// The assembly is read from the JobTread catalog every time, so price
// changes there (including the supplier price watcher's) flow straight into
// new drafts.

import { pave } from "./jobtread.js";
import { TRADE_QUESTIONS, offersUpgrades } from "../../shared/tradeQuestions.js";

export const ASSEMBLIES = {
  gutters: { id: "22PiKu7hJgmr", name: "Seamless Gutter System" },
};
const PROPOSAL_TEMPLATE_ID = "22PJfnqzbFfh";
const GUTTER_MINIMUM = 350;
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
export function assemblyToLineItems(root, { params = {}, selectGroup = () => undefined, dropGroup = () => false } = {}) {
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
      ...items.filter((i) => i.costGroup?.id === groupId).map((i) => ({ kind: "i", v: i })),
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
  if (offersUpgrades(basics)) {
    if (!answers.lightingLF) params["Lighting LF"] = params["Gutter LF"];
    if (!answers.drains) {
      params["In-Ground Drains"] =
        params["One Story Downspouts"] + params["Two Story Downspouts"] + params["Three Story Downspouts"];
    }
  }
  return params;
}

export function buildGutterLines(assembly, answers, basics) {
  const six = answers.size === "6";
  const upgrades = offersUpgrades(basics);
  const params = gutterParams(answers, basics);
  const lines = assemblyToLineItems(assembly, {
    params,
    selectGroup: (g) => {
      if (g.name.startsWith('5"')) return !six;
      if (g.name.startsWith('6"') && !/guard/i.test(g.name)) return six;
      return undefined;
    },
    // GC bids: no upsells; and only the guards that fit the gutter size
    dropGroup: (g) =>
      (!upgrades && /optional upgrades/i.test(g.name)) ||
      // GC bids show only the size being bid, not the alternative
      (!upgrades && g.name.startsWith(six ? '5"' : '6"')) ||
      (/guards for 6"/i.test(g.name) && !six) ||
      (/guards for 5"/i.test(g.name) && six),
  });
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

// merges our parameters into whatever the job already has
export function mergeParameters(existing, params) {
  const list = Array.isArray(existing) ? existing.filter((p) => !(p.name in params)) : [];
  // keep only the fields updateJob accepts for number/formula parameters
  const kept = list.map((p) => (p.formula ? { name: p.name, formula: p.formula } : { name: p.name, value: p.value ?? 0 }));
  return [...kept, ...Object.entries(params).map(([name, value]) => ({ name, value }))];
}

// creates the draft Proposal on the job; returns { documentId, fullName, total }
export async function draftEstimate({ lead, basics, answers, link }) {
  const trades = (basics.trades || []).filter((t) => ASSEMBLIES[t]);
  if (!trades.includes("gutters")) throw new Error("Only gutter estimates are automated so far");

  const [assembly, jobData, templateData] = await Promise.all([
    fetchAssembly(ASSEMBLIES.gutters.id),
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

  const { lines, params, total } = buildGutterLines(assembly, answers.gutters || {}, basics);

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
