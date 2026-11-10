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
  const address = String(lead.address || "").trim();
  const description = [address, lead.job, lead.phone, lead.email].filter(Boolean).join(" — ");

  return [
    "BEGIN:VEVENT",
    `UID:rhx-lead-${lead.id}@rhxutah.com`,
    `DTSTAMP:${formatUTC(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(summary)}`,
    // LOCATION is what Apple Calendar shows under the title and turns into a
    // tap-for-directions map link
    address ? `LOCATION:${escapeText(address)}` : null,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    "END:VEVENT",
  ]
    .filter(Boolean)
    .map(foldLine)
    .join("\r\n");
}

// RFC 5545: content lines over 75 octets are split, each continuation
// starting with a space — long addresses/descriptions otherwise risk being
// cut off by stricter calendar clients
function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // don't split a multi-byte UTF-8 character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return parts.join("\r\n ");
}

export function buildCalendar(leads, { name = "Lead Hammer Appointments" } = {}) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lead Hammer//Appointments//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(name)}`,
    // hints some calendar clients (including Apple Calendar) respect for
    // how often to re-poll a subscribed feed
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    ...leads.map(buildEvent),
    "END:VCALENDAR",
  ].join("\r\n");
}
