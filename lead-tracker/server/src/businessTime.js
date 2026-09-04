export const DEFAULT_TIMEZONE = "America/Denver";

// "YYYY-MM" for the given instant, in the given tenant's local time. Used for anything
// that should flip over at the tenant's actual midnight on the 1st, not whenever UTC
// happens to cross into a new month. Each tenant sets its own timezone (tenants.timezone)
// since Lead Hammer now hosts businesses outside Utah too.
export function localMonthKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}`;
}

export function localDateKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
