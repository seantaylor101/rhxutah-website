// Keep in sync with REPORT_TAGS in client/src/App.jsx. One-tap, no-writing
// alternative to a "what went well/wrong" free-text retrospective — still
// builds a pattern over time without the friction of an essay prompt.
export const REPORT_TAGS = [
  { key: "weather_delay", label: "Weather delay" },
  { key: "material_delay", label: "Material delay" },
  { key: "underbid_labor", label: "Underbid labor" },
  { key: "underbid_materials", label: "Underbid materials" },
  { key: "crew_issue", label: "Crew issue" },
  { key: "customer_issue", label: "Customer issue" },
  { key: "great_crew", label: "Great crew" },
  { key: "ahead_of_schedule", label: "Ahead of schedule" },
  { key: "nothing_notable", label: "Nothing notable" },
];
const REPORT_TAG_KEYS = new Set(REPORT_TAGS.map((t) => t.key));

export function cleanReportTags(input) {
  if (!Array.isArray(input)) return { ok: false, error: "reportTags must be an array" };
  const unique = [...new Set(input)].filter((k) => typeof k === "string" && REPORT_TAG_KEYS.has(k));
  return { ok: true, value: unique };
}

// tolerant read — missing/malformed JSON or an unrecognized key (an old tag
// that got renamed) just drops silently rather than erroring the whole lead
export function parseReportTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string" && REPORT_TAG_KEYS.has(k)) : [];
  } catch {
    return [];
  }
}
