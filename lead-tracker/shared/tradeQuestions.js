// Trade questionnaire: the questions asked after Start Estimate, one set per
// trade picked in the estimate basics. Each answer maps to a parameter on the
// JobTread job, which the catalog assembly's quantity formulas read — so the
// numbers can still be adjusted in JobTread afterwards and everything reprices.
//
// Blank answers count as zero (or the default noted in the label); only
// what's truly needed to price the job is required.
//
// Automated so far: gutters, and siding when the product is LP SmartSide.
// Other trades and products are added as their JobTread assemblies are built.

export const TRADE_QUESTIONS = {
  gutters: {
    label: "Gutters",
    questions: [
      { key: "gutterLF", label: "Gutter footage (LF)", type: "number", required: true, param: "Gutter LF" },
      {
        key: "size",
        label: "Gutter size (blank = 5\")",
        type: "single",
        required: false,
        options: [
          { key: "5", label: '5" (2x3 downspouts)' },
          { key: "6", label: '6" (3x4 downspouts)' },
        ],
      },
      { key: "oneStory", label: "1-story downspouts", type: "number", required: false, param: "One Story Downspouts" },
      { key: "twoStory", label: "2-story downspouts", type: "number", required: false, param: "Two Story Downspouts" },
      { key: "threeStory", label: "3-story downspouts", type: "number", required: false, param: "Three Story Downspouts" },
      { key: "offsets", label: "Downspout offsets (brick, etc.)", type: "number", required: false, param: "Downspout Offsets" },
      { key: "miters", label: "Miters (corners)", type: "number", required: false, param: "Miters" },
      {
        key: "tearOffLF",
        label: "Old gutter to tear off (LF)",
        type: "number",
        required: false,
        param: "Gutter Tear-off LF",
      },
      {
        key: "trees",
        label: "Trees near the gutters? (blank = no)",
        type: "single",
        required: false,
        options: [
          { key: "yes", label: "Yes" },
          { key: "no", label: "No" },
        ],
      },
      {
        key: "roofDrainDownspouts",
        label: "Downspouts that drain onto a roof (no drain needed)",
        type: "number",
        required: false,
      },
      // the upgrade options — only asked when that upgrade is offered
      {
        key: "drains",
        label: "In-ground drains (blank = one per downspout that reaches the ground; 0 = don't offer)",
        type: "number",
        required: false,
        param: "In-Ground Drains",
        upgrade: "drains",
      },
      {
        key: "drainsPast8",
        label: "Drains running past 8 ft (only if you know)",
        type: "number",
        required: false,
        param: "Drain Extra Pipe Sections",
        upgrade: "drains",
      },
      {
        key: "drainExtraLF",
        label: "Total extra feet past 8 ft (only if you know)",
        type: "number",
        required: false,
        param: "Drain Extra LF",
        upgrade: "drains",
      },
      {
        key: "lightingLF",
        label: "Permanent lighting footage (for the upgrade option; blank = gutter footage)",
        type: "number",
        required: false,
        param: "Lighting LF",
        upgrade: "lighting",
      },
    ],
  },
  siding: {
    label: "Siding",
    questions: [
      {
        key: "product",
        label: "Siding product (blank = LP SmartSide)",
        type: "single",
        required: false,
        options: [
          { key: "lp", label: "LP SmartSide" },
          { key: "hardie", label: "Hardie (not automated yet)" },
          { key: "vinyl", label: "Vinyl (not automated yet)" },
          { key: "ascend", label: "Ascend (not automated yet)" },
        ],
      },
      {
        key: "wallSF",
        label: "Wall area (sq ft, no window deductions; 10% is added)",
        type: "number",
        required: true,
        param: "Wall SF",
      },
      {
        key: "tearOff",
        label: "What comes off (blank = from the existing exterior)",
        type: "single",
        required: false,
        options: [
          { key: "none", label: "Nothing" },
          { key: "vinyl", label: "Vinyl / aluminum" },
          { key: "wood", label: "Wood / difficult" },
          { key: "stucco", label: "Stucco" },
        ],
      },
      { key: "tearOffSF", label: "Tear-off area (sq ft, blank = wall area)", type: "number", required: false },
      { key: "resheathSF", label: "Resheathing (sq ft, only if needed)", type: "number", required: false, param: "Resheathing SF" },
      { key: "dumpsters", label: "Dumpsters (blank = 1 when there's tear-off)", type: "number", required: false },
    ],
  },
};

export const AUTOMATED_TRADES = Object.keys(TRADE_QUESTIONS);

// siding is only drafted for the products with a JobTread assembly
export const AUTOMATED_SIDING = ["lp"];
export function sidingProduct(answers = {}) {
  return answers?.siding?.product || "lp";
}

// what's coming off the walls: the answer, or a guess from the existing
// exterior in the basics
export function tearOffType(basics = {}, siding = {}) {
  if (siding.tearOff) return siding.tearOff;
  const ext = new Set(basics.existingExterior || []);
  if (ext.has("newConstruction")) return "none";
  if (ext.has("stucco")) return "stucco";
  if (ext.has("wood") || ext.has("fiberCement") || ext.has("lp")) return "wood";
  if (ext.has("vinyl") || ext.has("aluminum")) return "vinyl";
  return "none";
}

// drains to offer: what was entered, or one per downspout that reaches the
// ground (downspouts draining onto a roof don't get one)
export function defaultDrainCount(g = {}) {
  if (g.drains !== undefined && g.drains !== "") return Number(g.drains) || 0;
  const downspouts = Number(g.oneStory || 0) + Number(g.twoStory || 0) + Number(g.threeStory || 0);
  return Math.max(0, downspouts - Number(g.roofDrainDownspouts || 0));
}

// Upgrades are offered only where they fit the work being done — on GC bids
// too — never as random add-ons:
//   gutter guards: gutter jobs with trees near the gutters
//   in-ground drains: gutter jobs with downspouts that reach the ground
//   permanent lighting: retail remodels that include siding (never a
//     gutters-only job or a GC bid)
//   insulated reflective house wrap: siding jobs
//   Emerald Rain Refresh paint: GC siding bids (retail already gets it)
export function upgradesFor(basics, answers = {}) {
  const trades = new Set(basics?.trades || []);
  const retail = (basics?.customerType || "") !== "gc";
  const gutters = trades.has("gutters");
  const siding = trades.has("siding");
  return {
    guards: gutters && answers?.gutters?.trees === "yes",
    drains: gutters && defaultDrainCount(answers?.gutters) > 0,
    lighting: gutters && retail && siding,
    // siding jobs: insulated wrap for everyone; Emerald is the paint upgrade
    // on GC bids (retail bids already get Emerald)
    insulatedWrap: siding,
    emeraldPaint: siding && !retail,
  };
}

export function questionsFor(trade, basics, answers = {}) {
  const set = TRADE_QUESTIONS[trade];
  if (!set) return [];
  const offered = upgradesFor(basics, answers);
  return set.questions.filter((q) => !q.upgrade || offered[q.upgrade]);
}

function toNumber(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// keeps known questions only; numbers must be zero or more
export function cleanTradeAnswers(input) {
  const out = {};
  for (const [trade, set] of Object.entries(TRADE_QUESTIONS)) {
    const given = (input && input[trade]) || {};
    const answers = {};
    for (const q of set.questions) {
      const v = given[q.key];
      if (q.type === "number") {
        const n = toNumber(v);
        if (n !== null && !Number.isNaN(n)) answers[q.key] = n;
      } else if (q.type === "single") {
        if (q.options.some((o) => o.key === String(v))) answers[q.key] = String(v);
      }
    }
    out[trade] = answers;
  }
  return out;
}

export function missingTradeAnswers(trade, answers, basics) {
  return questionsFor(trade, basics, { [trade]: answers })
    .filter((q) => q.required && (answers?.[q.key] === undefined || answers?.[q.key] === ""))
    .map((q) => ({ key: q.key, label: q.label }));
}
