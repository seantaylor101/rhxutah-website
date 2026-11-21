// Checks a drafted estimate against how RHX has priced past jobs and against
// estimating/rules.md. It only FLAGS things for Sean; it never changes a
// price or the proposal.
//
//   pastPricing(): for each drafted line, what Sean charged for the same kind
//     of line on recent proposals (pending or approved) in JobTread.
//   claudeReview(): Claude reads rules.md word for word plus the draft, the
//     cover email and the history, and lists rule problems (warranty on a
//     repair, filler text, private info in an option reason, prices far off
//     history...). Needs ANTHROPIC_API_KEY; skipped without it.

import Anthropic from "@anthropic-ai/sdk";
import { pave, organizationId } from "./jobtread.js";
import { RULES_TEXT } from "../../estimating/index.js";

export const REVIEW_MODEL = "claude-opus-5-5";

const flatItems = (lines, out = []) => {
  for (const l of lines || []) {
    if (l._type === "costItem") out.push(l);
    else flatItems(l.lineItems, out);
  }
  return out;
};

// "5\" Bulldog gutter guards, Dark Bronze - installed" → "5 bulldog gutter guards"
export function lineKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s*-\s*installed$/, "")
    .replace(/\(.*?\)/g, "")
    .replace(/,.*$/, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// summarizes past lines for each drafted line (same key); pure
export function summarizeHistory(draftLines, pastItems) {
  const byKey = new Map();
  for (const p of pastItems) {
    const k = lineKey(p.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const out = [];
  const seen = new Set();
  for (const i of flatItems(draftLines)) {
    const k = lineKey(i.name);
    if (seen.has(k)) continue;
    seen.add(k);
    const past = byKey.get(k) || [];
    const prices = past.map((p) => Number(p.unitPrice)).filter((n) => Number.isFinite(n));
    out.push({
      name: i.name,
      draftPrice: i.unitPrice,
      count: prices.length,
      ...(prices.length
        ? { median: median(prices), min: Math.min(...prices), max: Math.max(...prices), from: [...new Set(past.map((p) => p.document?.fullName).filter(Boolean))].slice(0, 3) }
        : {}),
    });
  }
  return out;
}

export async function pastPricing(draftLines, { size = 200 } = {}) {
  const codes = [...new Set(flatItems(draftLines).map((i) => i.costCodeId).filter(Boolean))];
  if (!codes.length) return [];
  const orgId = await organizationId();
  const data = await pave({
    organization: {
      $: { id: orgId },
      costItems: {
        $: {
          where: {
            and: [
              [["document", "type"], "customerOrder"],
              [["document", "status"], "in", ["pending", "approved"]],
              [["costCode", "id"], "in", codes],
            ],
          },
          size,
          sortBy: [{ field: "createdAt", order: "desc" }],
        },
        nodes: { name: {}, unitPrice: {}, quantity: {}, document: { fullName: {} } },
      },
    },
  });
  return summarizeHistory(draftLines, data?.organization?.costItems?.nodes || []);
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["fix", "check"] },
          line: { type: "string" },
          issue: { type: "string" },
        },
        required: ["severity", "line", "issue"],
        additionalProperties: false,
      },
    },
  },
  required: ["flags"],
  additionalProperties: false,
};

const SYSTEM = `You review a drafted Ridgeline Home Exteriors proposal before Sean sends it.
The estimating rules below are the source of truth. List only real problems:
- "fix": breaks a rule (lifetime warranty on repair/cleaning/tear-off/patch/paint work; material and labor shown separately; "haul away" style filler; customer-private info in a description or the email, e.g. plans to sell; an upgrade on a GC bid unrelated to the work; odd-cent prices; the email restating the whole bid or missing the "sign in the proposal" pointer).
- "check": a price well outside what Sean charged before for the same line, or anything else Sean should look at.
Never suggest new prices on your own; never invent facts about the house. Return an empty list if it's all fine.

<rules>
${RULES_TEXT}
</rules>`;

export function reviewPrompt({ basics, lines, emailMessage, history }) {
  const rows = flatItems(lines).map((i) => `- ${i.name} | qty ${i.quantity} @ $${i.unitPrice}${i.description ? ` | "${i.description}"` : ""}`);
  const hist = (history || [])
    .filter((h) => h.count)
    .map((h) => `- ${h.name}: drafted $${h.draftPrice}; past median $${h.median} (min $${h.min}, max $${h.max}, ${h.count} lines)`);
  return [
    `Customer type: ${basics?.customerType || "retail"}. Work: ${(basics?.trades || []).join(", ")}.`,
    `Draft lines:\n${rows.join("\n")}`,
    `Cover email:\n${emailMessage || "(none)"}`,
    hist.length ? `Past pricing:\n${hist.join("\n")}` : "No past pricing for these lines.",
  ].join("\n\n");
}

let client = null;
export async function claudeReview(input) {
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: "ANTHROPIC_API_KEY isn't set", flags: [] };
  client ||= new Anthropic();
  const response = await client.beta.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    // if a safety classifier misfires on a proposal, retry on the model
    // Anthropic recommends instead of skipping the review (same as vision.js)
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: reviewPrompt(input) }],
  });
  if (response.stop_reason === "refusal") return { skipped: "Review declined", flags: [] };
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const parsed = JSON.parse(text);
    return { flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 20) : [] };
  } catch {
    return { skipped: "Review answer was unreadable", flags: [] };
  }
}

// both, never throwing: a failed review must not lose the draft
export async function reviewDraft({ basics, lines, emailMessage }) {
  let history = [];
  let historyError = null;
  try {
    history = await pastPricing(lines);
  } catch (err) {
    historyError = err.message;
  }
  let ai = { flags: [] };
  try {
    ai = await claudeReview({ basics, lines, emailMessage, history });
  } catch (err) {
    ai = { skipped: `Review failed: ${err.message}`, flags: [] };
  }
  return { history: history.filter((h) => h.count), historyError, flags: ai.flags, reviewSkipped: ai.skipped || null };
}
