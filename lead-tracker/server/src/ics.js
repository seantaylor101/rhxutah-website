// Minimal iCalendar (RFC 5545) generation — just enough to describe a sales
// appointment. Datetimes are emitted in UTC (Z-suffixed) so no VTIMEZONE
// block is needed; calendar apps convert to the viewer's local time.

function escapeText(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatUTC(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function buildEvent(lead) {
  const start = formatUTC(lead.appointmentAt);
  // sales appointments aren't given an explicit duration by the app —
  // default to a 1-hour block, which is enough for calendar apps to render
  // a visible timed event rather than an all-day one
  const end = formatUTC(new Date(new Date(lead.appointmentAt).getTime() + 60 * 60 * 1000).toISOString());
  const summary = `Sales appointment: ${lead.name}`;
  const description = [lead.job, lead.phone, lead.email].filter(Boolean).join(" — ");

  return [
    "BEGIN:VEVENT",
    `UID:rhx-lead-${lead.id}@rhxutah.com`,
    `DTSTAMP:${formatUTC(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(summary)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    "END:VEVENT",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export function buildCalendar(leads, { name = "Lead Slayer Appointments" } = {}) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lead Slayer//Appointments//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(name)}`,
    // hints some calendar clients (including Apple Calendar) respect for
    // how often to re-poll a subscribed feed
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...leads.map(buildEvent),
    "END:VCALENDAR",
  ].join("\r\n");
}
