// Trade questionnaire: the questions asked after Start Estimate, one set per
// trade picked in the estimate basics. Each answer maps to a parameter on the
// JobTread job, which the catalog assembly's quantity formulas read — so the
// numbers can still be adjusted in JobTread afterwards and everything reprices.
//
// Only gutters is automated so far; other trades are added as their JobTread
// assemblies are built.

export const TRADE_QUESTIONS = {
  gutters: {
    label: "Gutters",
    questions: [
      { key: "gutterLF", label: "Gutter footage (LF)", type: "number", required: true, param: "Gutter LF" },
      {
        key: "size",
        label: "Gutter size",
        type: "single",
        required: true,
        options: [
          { key: "5", label: '5" (2x3 downspouts)' },
          { key: "6", label: '6" (3x4 downspouts)' },
        ],
      },
      { key: "oneStory", label: "1-story downspouts", type: "number", required: true, param: "One Story Downspouts" },
      { key: "twoStory", label: "2-story downspouts", type: "number", required: true, param: "Two Story Downspouts" },
      { key: "threeStory", label: "3-story downspouts", type: "number", required: false, param: "Three Story Downspouts" },
      { key: "offsets", label: "Downspout offsets (brick, etc.)", type: "number", required: false, param: "Downspout Offsets" },
      { key: "miters", label: "Miters (corners)", type: "number", required: true, param: "Miters" },
      {
        key: "tearOffLF",
        label: "Old gutter to tear off (LF, 0 if none)",
        type: "number",
        required: true,
        param: "Gutter Tear-off LF",
      },
      // upgrade quantities — only asked on retail jobs (GC bids get no upsells)
      {
        key: "drains",
        label: "In-ground drains (for the upgrade option)",
        type: "number",
        required: false,
        param: "In-Ground Drains",
        upgrade: true,
      },
      {
        key: "lightingLF",
        label: "Permanent lighting footage (for the upgrade option)",
        type: "number",
        required: false,
        param: "Lighting LF",
        upgrade: true,
      },
    ],
  },
};

export const AUTOMATED_TRADES = Object.keys(TRADE_QUESTIONS);

// upsell options go only on retail and insurance jobs, never GC bids
export function offersUpgrades(basics) {
  return (basics?.customerType || "") !== "gc";
}

export function questionsFor(trade, basics) {
  const set = TRADE_QUESTIONS[trade];
  if (!set) return [];
  return set.questions.filter((q) => !q.upgrade || offersUpgrades(basics));
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
  return questionsFor(trade, basics)
    .filter((q) => q.required && (answers?.[q.key] === undefined || answers?.[q.key] === ""))
    .map((q) => ({ key: q.key, label: q.label }));
}
