// Shared timezone the business actually operates in — used everywhere a
// "what day/month is it right now" decision has to match the owner and PM's
// real calendar, not the server host's (almost always UTC).
export const BUSINESS_TZ = "America/Denver";

// "YYYY-MM" for the given instant, in business-local time. Used for anything
// that should flip over at the business's actual midnight on the 1st, not
// whenever UTC happens to cross into a new month — which, this far behind
// UTC, is still hours before local midnight on the last day of the month.
export function localMonthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}`;
}
