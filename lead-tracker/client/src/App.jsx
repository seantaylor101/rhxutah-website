import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { api } from "./api.js";
import { pushSupported, getPushSubscription, enablePush, disablePush, syncPushSubscriptionRole } from "./push.js";

// Self-contained icons (no external icon library) so nothing outside this file has to load.
function Icon({ children, size = 16, color = "currentColor", strokeWidth = 2, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}
const Plus = (p) => (
  <Icon {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);
const X = (p) => (
  <Icon {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Icon>
);
const Check = (p) => (
  <Icon {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);
const Pencil = (p) => (
  <Icon {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Icon>
);
const Trash2 = (p) => (
  <Icon {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Icon>
);
const ArrowRight = (p) => (
  <Icon {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </Icon>
);
const ChevronLeft = (p) => (
  <Icon {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Icon>
);
const ChevronRight = (p) => (
  <Icon {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Icon>
);
const ChevronDown = (p) => (
  <Icon {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Icon>
);
const ChevronUp = (p) => (
  <Icon {...p}>
    <polyline points="18 15 12 9 6 15" />
  </Icon>
);
const Eye = (p) => (
  <Icon {...p}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const Calendar = (p) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Icon>
);
const TrendingUp = (p) => (
  <Icon {...p}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </Icon>
);
const Gear = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);
const History = (p) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </Icon>
);
const User = (p) => (
  <Icon {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Icon>
);
const Grid = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </Icon>
);
const Home = (p) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V21h13V9.5" />
  </Icon>
);
const Menu = (p) => (
  <Icon {...p}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </Icon>
);
const Wrench = (p) => (
  <Icon {...p}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Icon>
);
const MoreVertical = ({ size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle cx="12" cy="5" r="1.7" fill={color} />
    <circle cx="12" cy="12" r="1.7" fill={color} />
    <circle cx="12" cy="19" r="1.7" fill={color} />
  </svg>
);
const Bell = (p) => (
  <Icon {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Icon>
);
const Camera = (p) => (
  <Icon {...p}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </Icon>
);
const Info = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="11.5" />
    <circle cx="12" cy="8" r="1.1" fill={p.color || "currentColor"} stroke="none" />
  </Icon>
);
const Target = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" fill={p.color || "currentColor"} stroke="none" />
  </Icon>
);
const Phone = (p) => (
  <Icon {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </Icon>
);
const MessageCircle = (p) => (
  <Icon {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Icon>
);
const MapPin = (p) => (
  <Icon {...p}>
    <path d="M21 10c0 6.5-9 13-9 13s-9-6.5-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);
const ListChecks = (p) => (
  <Icon {...p}>
    <path d="M3.5 6.5 5 8l2.5-2.5" />
    <path d="M3.5 12.5 5 14l2.5-2.5" />
    <path d="M3.5 18.5 5 20l2.5-2.5" />
    <line x1="11" y1="6" x2="21" y2="6" />
    <line x1="11" y1="12" x2="21" y2="12" />
    <line x1="11" y1="18" x2="21" y2="18" />
  </Icon>
);
const Activity = (p) => (
  <Icon {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Icon>
);
const Search = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Icon>
);
// ---- design tokens ----
// Matches the main RHX site: light content area, dark green header band,
// brand green for primary actions — same palette and font (Open Sans) as rhxutah.com.
const COLORS = {
  bg: "#F7F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF1EC",
  // near-black maroon (solid fallback — the header itself uses a gradient
  // built from this plus headerGlow, sampled from the reference mockup)
  header: "#1E1010",
  headerGlow: "rgba(200,60,40,0.35)",
  headerLine: "rgba(255,232,222,0.1)",
  accent: "#47936B",
  ink: "#242926",
  muted: "#6E7A6F",
  mutedOnDark: "rgba(255,255,255,0.75)",
  border: "#E1E5DD",
  rust: "#C0483B",
  amber: "#C79A3D",
  lost: "#9B9686",
  progress: "#BD7238",
  info: "#6E8CA0",
  // vivid red/orange used for the header's icon tiles and hero CTA —
  // sampled from the reference mockup, distinct from the app-wide rust/
  // accent colors used everywhere else
  heroRed: "#EC4139",
  heroRedDeep: "#D1352A",
};

const STAGES = [
  { key: "new", label: "New Lead", short: "New", color: COLORS.info },
  { key: "bid", label: "Bid Complete / Waiting", short: "Bid Sent", color: COLORS.amber },
  { key: "lost", label: "Lost", short: "Lost", color: COLORS.lost },
  { key: "won", label: "Job Won — Not Started", short: "Won", color: COLORS.accent },
  { key: "progress", label: "Jobs In Progress", short: "In Progress", color: COLORS.progress },
  { key: "completed", label: "Completed This Month", short: "Completed", color: COLORS.info },
  { key: "paid", label: "Paid", short: "Paid", color: COLORS.accent },
];

// the stage a lead normally arrived from, for the "move back" option — a branch
// (lost/won both come from bid), not a straight walk through the STAGES array
const PREVIOUS_STAGE = {
  bid: "new",
  lost: "bid",
  won: "bid",
  progress: "won",
  completed: "progress",
  paid: "completed",
};

const SOURCES = [
  { key: "referral", label: "Referral" },
  { key: "referral_bni", label: "Referral (BNI)" },
  { key: "google", label: "Google Lead" },
  { key: "facebook", label: "Facebook Lead" },
  { key: "website", label: "Website Form" },
  { key: "other", label: "Other" },
];

// source groupings for the performance-metrics breakdown — referral and BNI
// referral are lumped together since they're both word-of-mouth
const METRIC_SOURCE_GROUPS = [
  { key: "all", label: "All sources", match: () => true },
  { key: "referral", label: "Referral", match: (l) => l.source === "referral" || l.source === "referral_bni" },
  { key: "google", label: "Google Lead", match: (l) => l.source === "google" },
  { key: "facebook", label: "Facebook Lead", match: (l) => l.source === "facebook" },
  { key: "website", label: "Website Form", match: (l) => l.source === "website" },
  { key: "other", label: "Other", match: (l) => l.source === "other" },
];

// weekdays from start through end, inclusive of both endpoints — matches how
// overhead is billed (a 5-day work week), so "build pace" and job-cost math
// agree on what a "day" means
// startDate and completedAt are both meant as plain calendar dates (no
// time-of-day), and are always stored/edited as UTC midnight — so compare
// them using UTC day boundaries, not the browser's local timezone. Mixing
// the two (e.g. truncating with local setHours) silently shifts the count
// by a day for anyone west of UTC, which is most of the US.
function businessDaysBetween(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// the calculated calendar-day span is just a starting point — a job can
// finish in less (or more) actual work than the days it happened to span,
// so an explicit override always wins when one's been set
function resolveWorkDays(lead) {
  if (lead.actualWorkDays != null) return lead.actualWorkDays;
  if (!lead.startDate || !lead.completedAt) return null;
  return businessDaysBetween(lead.startDate, lead.completedAt);
}

// inverse of businessDaysBetween: the calendar date `totalDays` business
// days after (and including) startIso — e.g. a 3-day job starting Friday
// ends Tuesday, skipping the weekend in between
function addBusinessDays(startIso, totalDays) {
  const d = new Date(startIso);
  d.setUTCHours(0, 0, 0, 0);
  let count = 1;
  while (count < totalDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return d.toISOString().slice(0, 10);
}

// keyword -> job-type category, first match wins. Covers this business's
// actual services (rhxutah.com: seamless gutters, siding, stucco,
// in-ground drainage, permanent holiday lighting) plus roof/deck/window
// work that shows up in job descriptions even without their own landing
// pages. "job" is free text ("e.g. Gutters, Lehi"), so this is a substring
// match, not an exact one.
const JOB_TYPE_RULES = [
  { key: "gutters", match: /gutter/i },
  { key: "siding", match: /siding|hardie/i },
  { key: "stucco", match: /stucco/i },
  { key: "drainage", match: /drain/i },
  { key: "lighting", match: /\blight/i },
  { key: "roof", match: /roof/i },
  { key: "deck", match: /\bdeck/i },
  { key: "windows", match: /window/i },
];

function jobTypeOf(jobText) {
  const rule = JOB_TYPE_RULES.find((r) => r.match.test(jobText || ""));
  return rule ? rule.key : "other";
}

// starting-assumption workday counts by job type — flat, not scaled by
// revenue like the data-driven estimate below is — used only until a type
// has at least 2 completed jobs of its own to pace off of. Ballpark
// residential-exterior-trade durations for a single crew; siding's number
// is Sean's own stated real-world pace (a full re-side generally runs
// about a week to a week and a half), not a generic online figure, since
// the whole point is that your own numbers beat a generic calculator the
// moment you have any — these are just a placeholder until you do.
const DEFAULT_DAYS_BY_TYPE = {
  gutters: 1,
  siding: 7,
  stucco: 4,
  drainage: 2,
  lighting: 1,
  roof: 2,
  deck: 5,
  windows: 2,
  other: 3,
};

// a scheduled job on the calendar shows its known actual span once
// completed, or — before then — a projected one. Prefers the same
// workdays-per-$1,000 build-pace figure the Final Report modal uses to
// compare a job against average (see FinalReportModal's expectedWorkDays),
// but computed per job TYPE rather than blended across every type of job
// this business does — a siding job and a gutter job don't take the same
// number of days per dollar, so blending them skews estimates for both.
// Falls back to the flat per-type default above until that type has
// enough of its own completed-job history (>=2) to trust its own pace.
function projectedJobSpan(lead, allMetrics) {
  if (!lead.startDate) return null;
  const start = lead.startDate.slice(0, 10);
  if (lead.completedAt) {
    return { start, end: lead.completedAt.slice(0, 10), projected: false };
  }
  const manualDays = resolveWorkDays(lead);
  let estDays;
  if (manualDays != null) {
    estDays = manualDays;
  } else {
    const revenue = lead.revenue || 0;
    const type = jobTypeOf(lead.job);
    const typeStats = allMetrics.avgDaysPerThousandByType?.[type];
    estDays =
      typeStats && typeStats.sample >= 2 && revenue > 0
        ? Math.max(1, Math.round(typeStats.value * (revenue / 1000)))
        : DEFAULT_DAYS_BY_TYPE[type];
  }
  return { start, end: addBusinessDays(start, estDays), projected: true };
}

// the dataviz skill's validated default categorical palette — its fixed
// order is specifically chosen so ADJACENT slots clear CVD/contrast
// separation gates, which is exactly what's needed here since lanes stack
// directly next to each other in the same week. Assigned by LANE, not a
// hash of the lead id, so two jobs that happen to land side by side are
// always maximally distinct rather than a coincidence of their ids' hashes
// (bg/text pairs picked per-swatch by fill luminance, per the same skill's
// mark-label rule, rather than assuming white always reads).
const LANE_COLORS = [
  { bg: "#2a78d6", text: COLORS.ink }, // blue
  { bg: "#eb6834", text: COLORS.ink }, // orange
  { bg: "#1baf7a", text: COLORS.ink }, // aqua
  { bg: "#eda100", text: COLORS.ink }, // yellow
  { bg: "#e87ba4", text: COLORS.ink }, // magenta
  { bg: "#008300", text: "#fff" }, // green
  { bg: "#4a3aa7", text: "#fff" }, // violet
  { bg: "#e34948", text: COLORS.ink }, // red
];

function laneColor(lane) {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

// jobs shown on the job calendar: won or further along, with a start date
// set — same "AT_OR_AFTER_WON" scope the server enforces for who can edit
// startDate, so a lead that's since been marked lost (which leaves
// startDate in place but no longer means anything) never shows up
const CALENDAR_STAGES = new Set(["won", "progress", "completed", "paid"]);

function computeMetrics(subset, overheadPercent = 13) {
  const days = (fromIso, toIso) => (new Date(toIso) - new Date(fromIso)) / 86400000;
  const avg = (nums) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null);

  const wonLeads = subset.filter((l) => l.wonAt);
  const lostLeads = subset.filter((l) => l.stage === "lost");
  const wonWithRevenue = wonLeads.filter((l) => l.revenue != null);
  const bidLeads = subset.filter((l) => l.bidSentAt);
  const paceLeads = subset.filter(
    (l) => l.completedAt && l.startDate && l.revenue > 0 && resolveWorkDays(l) != null
  );
  // same pace figure as avgDaysPerThousand below, but split out per job
  // type (see jobTypeOf) — feeds the job calendar's per-type duration
  // projections, since a siding job and a gutter job don't take the same
  // number of days per dollar and blending them skews estimates for both
  const paceDaysByType = {};
  for (const l of paceLeads) {
    const type = jobTypeOf(l.job);
    (paceDaysByType[type] ||= []).push(resolveWorkDays(l) / (l.revenue / 1000));
  }
  const avgDaysPerThousandByType = Object.fromEntries(
    Object.entries(paceDaysByType).map(([type, arr]) => [type, { value: avg(arr), sample: arr.length }])
  );
  const decidedCount = wonLeads.length + lostLeads.length;

  // same job-level profit math as the Final Report modal (revenue minus
  // material/labor/overhead), averaged across won jobs that actually have
  // cost data entered — feeds the income-goal calculator's "my averages"
  const costedLeads = wonWithRevenue.filter((l) => l.materialCost != null && l.laborCost != null && l.revenue > 0);
  const profitMargins = costedLeads.map((l) => {
    const overheadCost = (l.revenue * overheadPercent) / 100;
    const profit = l.revenue - l.materialCost - l.laborCost - overheadCost;
    return (profit / l.revenue) * 100;
  });

  // "estimate win rate" is scoped to leads that actually got a bid sent,
  // separate from lead win rate — a source can look great on one and
  // mediocre on the other, and that gap is itself useful information
  const estimatedLeads = subset.filter((l) => l.bidSentAt);
  const estimatedWon = estimatedLeads.filter((l) => l.wonAt);
  const estimatedLost = estimatedLeads.filter((l) => l.stage === "lost");
  const estimateDecidedCount = estimatedWon.length + estimatedLost.length;

  // follow-up effectiveness — scoped to leads that got a bid sent and
  // reached a decision, since logging only happens while a lead sits in
  // "bid". Bucketed by how many follow-ups were logged before the decision,
  // so the win rate per bucket shows whether following up more actually
  // correlates with winning, and the won-only average answers "how many
  // follow-ups does it typically take to win"
  const followupEligible = subset.filter((l) => l.bidSentAt && (l.wonAt || l.stage === "lost"));
  const followupBucketOrder = ["0", "1", "2", "3+"];
  const followupBucketLabel = (n) => (n >= 3 ? "3+" : String(n));
  const followupBuckets = {};
  followupBucketOrder.forEach((k) => (followupBuckets[k] = { won: 0, lost: 0 }));
  followupEligible.forEach((l) => {
    const key = followupBucketLabel((l.followUps || []).length);
    if (l.wonAt) followupBuckets[key].won++;
    else followupBuckets[key].lost++;
  });
  const followupWinRateByBucket = followupBucketOrder
    .map((key) => {
      const { won, lost } = followupBuckets[key];
      const decided = won + lost;
      return { key, won, lost, decided, winRate: decided ? won / decided : null };
    })
    .filter((b) => b.decided > 0);
  const followupCountsOnWon = wonLeads.filter((l) => l.bidSentAt).map((l) => (l.followUps || []).length);

  return {
    totalLeads: subset.length,
    closeRate: decidedCount ? wonLeads.length / decidedCount : null,
    closeRateWon: wonLeads.length,
    closeRateLost: lostLeads.length,
    closeRateSample: decidedCount,
    estimateWinRate: estimateDecidedCount ? estimatedWon.length / estimateDecidedCount : null,
    estimateWinRateWon: estimatedWon.length,
    estimateWinRateLost: estimatedLost.length,
    estimateWinRateSample: estimateDecidedCount,
    avgWonRevenue: avg(wonWithRevenue.map((l) => l.revenue)),
    avgWonRevenueSample: wonWithRevenue.length,
    avgProfitMargin: avg(profitMargins),
    avgProfitMarginSample: profitMargins.length,
    // raw distributions, kept alongside the averages above so each metric's
    // info modal can chart where the underlying numbers actually land
    // instead of just the single blended figure
    wonRevenues: wonWithRevenue.map((l) => l.revenue),
    avgRevenuePerLead: subset.length ? wonWithRevenue.reduce((s, l) => s + l.revenue, 0) / subset.length : null,
    avgDaysNewToBid: avg(bidLeads.map((l) => days(l.createdAt, l.bidSentAt))),
    avgDaysNewToBidSample: bidLeads.length,
    bidDays: bidLeads.map((l) => days(l.createdAt, l.bidSentAt)),
    avgDaysNewToWon: avg(wonLeads.map((l) => days(l.createdAt, l.wonAt))),
    avgDaysNewToWonSample: wonLeads.length,
    wonDays: wonLeads.map((l) => days(l.createdAt, l.wonAt)),
    avgDaysPerThousand: avg(paceLeads.map((l) => resolveWorkDays(l) / (l.revenue / 1000))),
    avgDaysPerThousandSample: paceLeads.length,
    paceDays: paceLeads.map((l) => resolveWorkDays(l) / (l.revenue / 1000)),
    avgDaysPerThousandByType,
    avgFollowupsOnWon: avg(followupCountsOnWon),
    avgFollowupsOnWonSample: followupCountsOnWon.length,
    followupWinRateByBucket,
  };
}

// reverse-engineers a take-home target into a lead volume: take-home implies
// a required revenue (via profit margin), revenue implies a job count (via
// average job value), and job count implies a lead count (via win rate)
function computeGoalPlan({ annualTakeHome, monthlyOverhead, winRatePercent, avgJobValue, profitMarginPercent }) {
  if (!(annualTakeHome > 0) || !(winRatePercent > 0) || !(avgJobValue > 0) || !(profitMarginPercent > 0)) {
    return null;
  }
  // job profit (the profit-margin cut of revenue) has to cover fixed
  // overhead — rent/bills, salaried staff like a project manager — before
  // anything left over becomes the owner's take-home, so both get divided
  // by the same margin to find the revenue required
  const annualOverhead = (monthlyOverhead > 0 ? monthlyOverhead : 0) * 12;
  const requiredRevenue = (annualTakeHome + annualOverhead) / (profitMarginPercent / 100);
  const jobsPerYear = requiredRevenue / avgJobValue;
  const leadsPerYear = jobsPerYear / (winRatePercent / 100);
  return {
    requiredRevenue,
    requiredRevenuePerMonth: requiredRevenue / 12,
    annualOverhead,
    jobsPerYear,
    jobsPerMonth: jobsPerYear / 12,
    leadsPerYear,
    leadsPerMonth: leadsPerYear / 12,
    leadsPerWeek: leadsPerYear / 52,
  };
}

// same math as computeGoalPlan, but reading straight off the saved settings
// (not in-progress draft inputs) — used anywhere that needs "the current
// goal" without an editing form attached, like the dashboard tile and the
// Goals page's read-only status view
function computeGoalPlanFromSettings(settings, myMetrics) {
  const takeHomeNum = Number(settings.goalMonthlyTakeHome) || 0;
  const overheadNum = Number(settings.goalMonthlyOverhead) || 0;
  const source = settings.goalDataSource;
  const missing = [];
  if (source === "mine") {
    if (!myMetrics.closeRateSample) missing.push("win rate");
    if (!myMetrics.avgWonRevenueSample) missing.push("average job value");
    if (!myMetrics.avgProfitMarginSample) missing.push("profit margin");
  }
  const inputs =
    source === "national"
      ? {
          winRatePercent: settings.goalNationalWinRate,
          avgJobValue: settings.goalNationalAvgJobValue,
          profitMarginPercent: settings.goalNationalProfitMargin,
        }
      : {
          winRatePercent: myMetrics.closeRate != null ? myMetrics.closeRate * 100 : null,
          avgJobValue: myMetrics.avgWonRevenue,
          profitMarginPercent: myMetrics.avgProfitMargin,
        };
  const plan =
    !missing.length && takeHomeNum > 0
      ? computeGoalPlan({ annualTakeHome: takeHomeNum * 12, monthlyOverhead: overheadNum, ...inputs })
      : null;
  return { plan, missing, takeHomeNum };
}

function fmtDays(n) {
  if (n == null) return "—";
  return `${n.toFixed(1)} days`;
}

function fmtPercent(n) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

// ---- histogram bucketing, shared by every distribution chart below ----

// snaps a raw bucket width up to a "nice" 1/2/5-times-a-power-of-ten step,
// the same rounding a hand-drawn axis would use, so bucket edges read as
// round numbers ($5K, 10 days) instead of arbitrary fractions
function niceStep(raw) {
  if (!isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = raw / Math.pow(10, exp);
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * Math.pow(10, exp);
}

function percentile(sortedNums, p) {
  const idx = (sortedNums.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedNums[lo];
  return sortedNums[lo] + (sortedNums[hi] - sortedNums[lo]) * (idx - lo);
}

// buckets purely off whatever range the actual data spans — no fixed
// dollar/day thresholds — so this reads right whether a business's jobs
// run $100–$1,000 or $20,000–$1.8M. Bucket width is sized off the 90th
// percentile rather than the true max: with a right-skewed spread (a
// handful of $30K remodels among a pile of $500 repairs, say), sizing off
// the absolute max would stretch every bucket wide enough to swallow the
// whole cluster into one bar. Anything past the 90th-percentile range
// lands in a final open-ended "+" bucket instead of distorting the rest.
function histogramBuckets(values, targetCount = 6) {
  const nums = (values || []).filter((n) => n != null && isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return [];

  const min = nums[0];
  const max = nums[nums.length - 1];
  if (max === min) return [{ min, max, count: nums.length, overflow: false }];

  const p90 = percentile(nums, 0.9);
  const coreMax = p90 > min ? p90 : max;
  const step = niceStep((coreMax - min) / targetCount);
  const startBucket = Math.floor(min / step) * step;
  const coreBucketCount = Math.max(1, Math.ceil((coreMax - startBucket) / step));

  const buckets = Array.from({ length: coreBucketCount }, (_, i) => ({
    min: startBucket + i * step,
    max: startBucket + (i + 1) * step,
    count: 0,
    overflow: false,
  }));

  const lastCoreBound = startBucket + coreBucketCount * step;
  const hasOverflow = max > lastCoreBound;
  if (hasOverflow) buckets.push({ min: lastCoreBound, max, count: 0, overflow: true });

  nums.forEach((n) => {
    if (hasOverflow && n > lastCoreBound) {
      buckets[buckets.length - 1].count++;
      return;
    }
    const idx = Math.min(coreBucketCount - 1, Math.floor((n - startBucket) / step));
    buckets[idx].count++;
  });

  return buckets;
}

function fmtMoneyShort(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${Math.round(n)}`;
}

function fmtDaysBound(n) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

// drives both the metricsGrid render and each tile's info pop-up, so the
// number shown and the explanation of it can't drift apart
const METRIC_INFO = [
  {
    key: "closeRate",
    label: "Lead Win Rate",
    value: (m) => fmtPercent(m.closeRate),
    sub: (m) => (m.closeRateSample ? `${m.closeRateWon} won / ${m.closeRateSample} decided` : "no decided leads yet"),
    description:
      "Of every lead that reached a final outcome — won or lost — the share that ended up won. This includes all decided leads, whether or not an estimate was ever sent.",
    chart: (m) => (
      <ProportionBar
        segments={[
          { label: "Won", count: m.closeRateWon, color: COLORS.accent },
          { label: "Lost", count: m.closeRateLost, color: COLORS.rust },
        ]}
        note={
          m.totalLeads > m.closeRateSample
            ? `${m.totalLeads - m.closeRateSample} more lead${m.totalLeads - m.closeRateSample === 1 ? "" : "s"} still open, not counted yet`
            : null
        }
      />
    ),
  },
  {
    key: "estimateWinRate",
    label: "Estimate Win Rate",
    value: (m) => fmtPercent(m.estimateWinRate),
    sub: (m) =>
      m.estimateWinRateSample ? `${m.estimateWinRateWon} won / ${m.estimateWinRateSample} decided` : "no decided estimates yet",
    description:
      "Same idea as Lead Win Rate, but narrowed to leads that actually got a bid sent. It isolates how well pricing and follow-up close deals once a number is in the customer's hands, separate from how many leads make it to a bid at all.",
    chart: (m) => (
      <ProportionBar
        segments={[
          { label: "Won", count: m.estimateWinRateWon, color: COLORS.accent },
          { label: "Lost", count: m.estimateWinRateLost, color: COLORS.rust },
        ]}
      />
    ),
  },
  {
    key: "avgWonRevenue",
    label: "Average Job Value",
    value: (m) => (m.avgWonRevenue != null ? fmtCurrency(m.avgWonRevenue) : "—"),
    sub: (m) => (m.avgWonRevenueSample ? `across ${m.avgWonRevenueSample} won jobs` : "no won leads with revenue yet"),
    description:
      "The average revenue on jobs that were won and have a revenue amount entered. A single average can be misleading here — a $500 repair, a $2,000 gutter job, and a $30,000 remodel can blend into one number that doesn't look like any real job. The chart below shows how won jobs actually cluster by size.",
    chart: (m) => (
      <Histogram buckets={histogramBuckets(m.wonRevenues)} formatBound={fmtMoneyShort} unitLabel="Won jobs by revenue" />
    ),
  },
  {
    key: "avgRevenuePerLead",
    label: "Revenue per Lead",
    value: (m) => (m.avgRevenuePerLead != null ? fmtCurrency(m.avgRevenuePerLead) : "—"),
    sub: () => "blends win rate + deal size",
    description:
      "Total revenue from won jobs divided by every lead in the group — won, lost, or still open. Unlike Average Job Value, this factors in how many leads actually convert, so it reflects what a typical incoming lead is worth to the business.",
    chart: (m) => (
      <ComparisonBars
        items={[
          { label: "Average Job Value (won jobs only)", value: m.avgWonRevenue || 0, formatted: m.avgWonRevenue != null ? fmtCurrency(m.avgWonRevenue) : "—" },
          { label: "Revenue per Lead (every lead)", value: m.avgRevenuePerLead || 0, formatted: m.avgRevenuePerLead != null ? fmtCurrency(m.avgRevenuePerLead) : "—" },
        ]}
      />
    ),
  },
  {
    key: "avgDaysNewToBid",
    label: "Time to Estimate",
    value: (m) => fmtDays(m.avgDaysNewToBid),
    sub: (m) => (m.avgDaysNewToBidSample ? `across ${m.avgDaysNewToBidSample} estimates` : "no bids sent yet"),
    description:
      "The average number of days between a lead coming in and an estimate being sent. Shorter is better — it measures how quickly leads get a bid in hand.",
    chart: (m) => (
      <Histogram buckets={histogramBuckets(m.bidDays)} formatBound={fmtDaysBound} unitLabel="Days from lead to bid sent" />
    ),
  },
  {
    key: "avgDaysNewToWon",
    label: "Sales Cycle",
    value: (m) => fmtDays(m.avgDaysNewToWon),
    sub: (m) => (m.avgDaysNewToWonSample ? `across ${m.avgDaysNewToWonSample} won jobs` : "no won leads yet"),
    description:
      "The average number of days between a lead coming in and the job being won. Covers the whole sales process end to end, not just the estimate step.",
    chart: (m) => (
      <Histogram buckets={histogramBuckets(m.wonDays)} formatBound={fmtDaysBound} unitLabel="Days from lead to won" />
    ),
  },
  {
    key: "avgDaysPerThousand",
    label: "Workdays per $1K",
    value: (m) => (m.avgDaysPerThousand != null ? `${m.avgDaysPerThousand.toFixed(2)} days` : "—"),
    sub: (m) =>
      m.avgDaysPerThousandSample
        ? `per $1,000 completed revenue, ${m.avgDaysPerThousandSample} jobs`
        : "no completed jobs with start date + revenue yet",
    description:
      "A build-pace measure: how many workdays it takes on average to complete $1,000 of job revenue, based on completed jobs with a start date, completion date (or a manual work-days entry), and revenue. Lower means more revenue completed per day worked.",
    chart: (m) => (
      <Histogram buckets={histogramBuckets(m.paceDays, 5)} formatBound={fmtDaysBound} unitLabel="Workdays per $1,000, by completed job" />
    ),
  },
  {
    key: "avgFollowupsOnWon",
    label: "Follow-up Effectiveness",
    value: (m) => (m.avgFollowupsOnWon != null ? m.avgFollowupsOnWon.toFixed(1) : "—"),
    sub: (m) =>
      m.avgFollowupsOnWonSample
        ? `avg follow-ups on ${m.avgFollowupsOnWonSample} won job${m.avgFollowupsOnWonSample === 1 ? "" : "s"}`
        : "no won jobs with a bid sent yet",
    description:
      "How many times a lead typically gets followed up with (logged from the Bid Sent stage) before the job is won, and — below — how the win rate changes by follow-up count. Scoped to leads that got a bid sent and reached a decision (won or lost), since that's the only window follow-ups get logged in.",
    chart: (m) =>
      m.followupWinRateByBucket.length ? (
        <ComparisonBars
          items={m.followupWinRateByBucket.map((b) => ({
            label: `${b.key} follow-up${b.key === "1" ? "" : "s"}`,
            value: b.winRate != null ? b.winRate * 100 : 0,
            formatted: b.winRate != null ? `${fmtPercent(b.winRate)} (${b.won}/${b.decided})` : "—",
          }))}
        />
      ) : (
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>Not enough data yet.</div>
      ),
  },
];

// bucketed distribution chart — used for every metric where the average
// alone hides how spread out the underlying jobs/leads actually are
function Histogram({ buckets, formatBound, unitLabel }) {
  if (!buckets.length) {
    return <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>Not enough data yet.</div>;
  }
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110, borderBottom: `1px solid ${COLORS.border}` }}>
        {buckets.map((b, i) => (
          <div
            key={i}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
          >
            <div style={{ fontFamily: FONT_UTIL, fontSize: 10.5, color: COLORS.muted, marginBottom: 2, minHeight: 13 }}>
              {b.count > 0 ? b.count : ""}
            </div>
            <div
              style={{
                width: "100%",
                maxWidth: 24,
                height: b.count > 0 ? `${Math.max((b.count / maxCount) * 100, 4)}%` : 2,
                background: b.count > 0 ? COLORS.accent : COLORS.border,
                borderRadius: "4px 4px 0 0",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontFamily: FONT_UTIL, fontSize: 9.5, color: COLORS.muted }}>
            {b.overflow ? `${formatBound(b.min)}+` : `${formatBound(b.min)}–${formatBound(b.max)}`}
          </div>
        ))}
      </div>
      {unitLabel && (
        <div style={{ marginTop: 10, fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted }}>{unitLabel}</div>
      )}
    </div>
  );
}

// two-segment won/lost bar — used for the win-rate metrics
function ProportionBar({ segments, note }) {
  const total = segments.reduce((s, seg) => s + seg.count, 0);
  if (!total) {
    return <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>Not enough data yet.</div>;
  }
  return (
    <div>
      <div style={{ display: "flex", height: 28, borderRadius: 6, overflow: "hidden", gap: 2 }}>
        {segments
          .filter((seg) => seg.count > 0)
          .map((seg) => (
            <div key={seg.label} style={{ width: `${(seg.count / total) * 100}%`, background: seg.color }} />
          ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.ink }}>
              {seg.label}: {seg.count} ({Math.round((seg.count / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
      {note && <div style={{ marginTop: 8, fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted }}>{note}</div>}
    </div>
  );
}

// side-by-side magnitude bars — used to show how two related dollar
// figures compare (e.g. per-won-job vs per-lead)
function ComparisonBars({ items }) {
  const max = Math.max(...items.map((it) => it.value || 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((it) => (
        <div key={it.label}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              fontFamily: FONT_UTIL,
              fontSize: 12,
              color: COLORS.muted,
              marginBottom: 3,
            }}
          >
            <span>{it.label}</span>
            <span style={{ color: COLORS.ink, fontWeight: 600 }}>{it.formatted}</span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: COLORS.surfaceMuted, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(4, ((it.value || 0) / max) * 100)}%`,
                height: "100%",
                background: COLORS.accent,
                borderRadius: 5,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// best-effort last name for alphabetical sorting — takes the final word of
// a multi-word name, falling back to the whole name for a single-word one
// (a company name, a first name only, etc.)
function lastNameOf(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || "";
}

function sourceLabel(lead) {
  if (!lead.source) return null;
  if (lead.source === "other") return lead.sourceOther ? `Other — ${lead.sourceOther}` : "Other";
  if (lead.source === "website") return lead.sourceOther ? `Website Form — ${lead.sourceOther}` : "Website Form";
  const s = SOURCES.find((s) => s.key === lead.source);
  return s ? s.label : lead.source;
}

function fmtDateOnly(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// for timestamps that are really just a calendar date stored as UTC
// midnight (completedAt) — formatting in the viewer's local timezone would
// show the day before for anyone west of UTC
function fmtDateOnlyUTC(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:MM" in local time, with
// no timezone suffix — build it from the local field values, not toISOString
// (which would shift to UTC and drift the displayed time)
function isoToDateTimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}

// buckets a timestamp into the week/month/year it falls in, for the History
// view's per-period breakdown — shared so every event type (new lead, bid
// sent, lost, won, completed, paid) lands in the period it actually
// happened in, not whatever period the lead as a whole gets filed under
function periodInfo(dateStr, granularity) {
  const d = new Date(dateStr);
  if (granularity === "week") {
    const ws = startOfWeek(d);
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    return {
      key: ws.toISOString().slice(0, 10),
      label: `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(
        undefined,
        { month: "short", day: "numeric", year: "numeric" }
      )}`,
      sortDate: ws,
    };
  }
  if (granularity === "year") {
    return { key: `${d.getFullYear()}`, label: `${d.getFullYear()}`, sortDate: new Date(d.getFullYear(), 0, 1) };
  }
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    sortDate: new Date(d.getFullYear(), d.getMonth(), 1),
  };
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

function endOfWeek(d) {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}

function endOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addYears(d, n) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

// local YYYY-MM-DD for <input type="date">, avoiding UTC-shift bugs from toISOString()
function toDateInputValue(d) {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function fmtRangeDate(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtRangeDate(new Date(iso));
}

const BACKUP_TIERS = [
  { key: "5min", label: "Every 5 minutes" },
  { key: "hourly", label: "Hourly" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
];

function fmtBackupDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCurrency(n) {
  if (!n && n !== 0) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// which leads contributed to a period's received/won/earned numbers — shared
// by the This week/This month cards and the "Look back" panel
// end is optional — omit it (pass null) for an open-ended "start through
// right now" range. An explicit upper bound of `new Date()` looks
// equivalent, but isn't: it pins the range to whatever the *device's own
// clock* reads at the moment the drilldown is opened, and a lead's wonAt
// (or createdAt/paidAt) is stamped from the *server's* clock at the moment
// the action happened. Any drift between the two — a phone's clock running
// a few minutes slow is common — makes an entry that's genuinely inside
// "this week" look like it's from slightly after "now" and silently drops
// it from the list, while the dashboard tile's own total (which has never
// bounded above) still counts it. Matching that same "no upper bound"
// behavior here is what keeps the drilldown's total in sync with the tile
// that opened it.
function breakdownForRange(allLeads, start, end) {
  const inRange = (iso) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= start && (end == null || d <= end);
  };
  const all = allLeads || [];
  return {
    received: all.filter((l) => inRange(l.createdAt)),
    won: all.filter((l) => inRange(l.wonAt)),
    earned: all.filter((l) => inRange(l.paidAt)),
  };
}

export default function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 18, marginBottom: 8 }}>
            The board hit a snag
          </div>
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13, marginBottom: 16, maxWidth: 320 }}>
            Something went wrong while loading. Reloading usually fixes it — if it keeps happening, let me know what
            this says:
          </div>
          <div
            style={{
              fontFamily: FONT_UTIL,
              fontSize: 11,
              color: COLORS.rust,
              background: "#FBEAE7",
              border: "1px solid #F0C9C2",
              borderRadius: 8,
              padding: 12,
              maxWidth: 340,
              wordBreak: "break-word",
            }}
          >
            {String(this.state.error && this.state.error.message)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// header hamburger menu — houses Settings (owner-only) and Account, so the
// primary header actions (Home/History/notifications) can stay prominent
// without crowding in two more icon buttons
function HeaderMenu({ editable, onOpenSettings, onOpenContacts, onOpenAccount, btnStyle = headerIconBtn, iconSize = 20, iconColor = COLORS.surface, label }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={btnStyle} aria-label="Menu">
        <Menu size={iconSize} color={iconColor} strokeWidth={2} />
        {label && <span style={headerTileLabel}>{label}</span>}
      </button>
      {open && (
        <>
          <div style={moreMenuScrim} onClick={() => setOpen(false)} />
          <div style={moreMenuPopover}>
            {editable && (
              <button
                onClick={() => {
                  setOpen(false);
                  onOpenContacts();
                }}
                style={moreMenuItem}
              >
                Contacts
              </button>
            )}
            {editable && (
              <button
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                style={moreMenuItem}
              >
                Settings
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                onOpenAccount();
              }}
              style={moreMenuItem}
            >
              Account
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [role, setRole] = useState(null); // null = not signed in on this device
  const [leads, setLeads] = useState(null); // null = loading
  const [activeStage, setActiveStage] = useState("new");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showLeadSearch, setShowLeadSearch] = useState(false);
  const [view, setView] = useState("dashboard"); // 'dashboard' | 'goals' | 'metrics' | 'board' | 'archive' | 'warranty' | 'contacts' | 'calendar'
  const [warrantyRequests, setWarrantyRequests] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [showLookback, setShowLookback] = useState(false);
  const [lookbackStart, setLookbackStart] = useState("");
  const [lookbackEnd, setLookbackEnd] = useState("");
  const [highlightedLeadId, setHighlightedLeadId] = useState(null);
  const [drilldown, setDrilldown] = useState(null); // { title, range: [start, end] } | null
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settings, setSettings] = useState({
    overheadPercent: 13,
    goalMonthlyTakeHome: 0,
    goalMonthlyOverhead: 0,
    goalDataSource: "national",
    goalNationalWinRate: 25,
    goalNationalAvgJobValue: 9500,
    goalNationalProfitMargin: 24,
    goalMonthConfirmed: "",
    popupPushEnabled: true,
    popupGoalEnabled: true,
    popupWarrantyEnabled: true,
    popupMissingInfoEnabled: true,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reportLead, setReportLead] = useState(null);
  const [showBackupsModal, setShowBackupsModal] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [showGoalPrompt, setShowGoalPrompt] = useState(false);
  const [showWarrantyAlert, setShowWarrantyAlert] = useState(false);
  const [warrantyLoaded, setWarrantyLoaded] = useState(false);
  const [warrantyAlertDelayElapsed, setWarrantyAlertDelayElapsed] = useState(false);
  const [scopeOfWorkLead, setScopeOfWorkLead] = useState(null);
  const [scopeOfWorkRequired, setScopeOfWorkRequired] = useState(false);
  const [managerPromptLead, setManagerPromptLead] = useState(null);
  const [showMissingInfoAlert, setShowMissingInfoAlert] = useState(false);
  const bootHtmlRef = useRef(null);
  // bumped by every leads/warranty mutation so a slower-resolving fetch
  // issued before that mutation can tell it's now stale and skip applying
  // — otherwise a periodic auto-refresh (or one triggered by the tab
  // regaining focus) that happens to be in flight when an edit commits can
  // land after the edit's own confirmed update and silently overwrite it
  // with pre-edit data
  const leadsVersionRef = useRef(0);
  const warrantyVersionRef = useRef(0);
  const lastLeadsJsonRef = useRef("");
  const lastWarrantyJsonRef = useRef("");
  const pushPromptCheckedRef = useRef(false);
  const goalPromptCheckedRef = useRef(false);
  const warrantyAlertShownRef = useRef(false);
  const missingInfoAlertShownRef = useRef(false);
  const showPushPromptRef = useRef(false);
  const editable = role === "owner";

  // installed PWAs get suspended in the background instead of reloading, so
  // a device can sit on a build from days ago until it's force-quit — check
  // whether a newer index.html has been deployed both whenever the app
  // comes back to the foreground AND on a standing timer (a device that's
  // simply left open, never backgrounded, would otherwise never see a
  // shipped fix — exactly the scenario that made an already-fixed bug look
  // like it was still broken), and offer a tap-to-refresh rather than
  // leaving stale UI/logic up until a force-quit
  useEffect(() => {
    const fetchIndexHtml = () => fetch("/", { cache: "no-store" }).then((r) => r.text());
    fetchIndexHtml()
      .then((html) => {
        bootHtmlRef.current = html;
      })
      .catch(() => {});

    const checkForUpdate = () => {
      if (!bootHtmlRef.current) return;
      fetchIndexHtml()
        .then((html) => {
          if (html !== bootHtmlRef.current) setUpdateAvailable(true);
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") checkForUpdate();
    }, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setRole(me.role);
      } catch {
        setRole(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  const loadLeads = useCallback(async () => {
    const version = leadsVersionRef.current;
    try {
      const data = await api.listLeads();
      if (leadsVersionRef.current !== version) return; // an edit/move/etc. raced ahead of this fetch — don't clobber it
      // the 30s background poll (below) re-fetches even when nothing
      // changed — skip the state update in that case so it doesn't hand
      // every list/card a fresh array/object identity and force a
      // needless re-render (which is what was making the app visibly
      // "jerk" every 30s while someone was mid-scroll or mid-edit)
      const json = JSON.stringify(data);
      if (json !== lastLeadsJsonRef.current) {
        lastLeadsJsonRef.current = json;
        setLeads(data);
      }
      setError("");
    } catch {
      if (leadsVersionRef.current !== version) return;
      setError("Couldn't load your saved leads.");
      // don't blank out a board that already loaded successfully — a
      // transient failure (deploy restart, brief network blip) shouldn't
      // make leads appear to vanish; only fall back to empty on a first
      // load that never succeeded
      setLeads((prev) => (prev === null ? [] : prev));
    }
  }, []);

  useEffect(() => {
    if (role) loadLeads();
  }, [role, loadLeads]);

  const loadWarrantyRequests = useCallback(async () => {
    const version = warrantyVersionRef.current;
    try {
      const data = await api.listWarrantyRequests();
      if (warrantyVersionRef.current !== version) return;
      const json = JSON.stringify(data);
      if (json !== lastWarrantyJsonRef.current) {
        lastWarrantyJsonRef.current = json;
        setWarrantyRequests(data);
      }
    } catch {
      // keep whatever was already loaded rather than blanking the badge/list
      // on a transient failure
    } finally {
      setWarrantyLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (role) loadWarrantyRequests();
  }, [role, loadWarrantyRequests]);

  // owner-only address book — never fetched for a viewer session, so it
  // never even reaches a device signed in as the project manager
  const loadContacts = useCallback(async () => {
    if (role !== "owner") return;
    try {
      const data = await api.listContacts();
      setContacts(data);
    } catch {
      // keep whatever was already loaded on a transient failure
    }
  }, [role]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch {
      // keep the default already in state
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  // shared by the Settings modal and the income-goal panel, so both stay in
  // sync with whichever one last saved
  const saveSettings = async (patch) => {
    const updated = await api.updateSettings(patch);
    setSettings(updated);
    return updated;
  };

  const setMonthlyGoalFromPrompt = async (amount) => {
    await saveSettings({ goalMonthlyTakeHome: amount });
    setShowGoalPrompt(false);
    setView("goals");
  };

  useEffect(() => {
    if (role) loadSettings();
  }, [role, loadSettings]);

  // offer to enable push the first time the app is ever opened on a device
  // — runs once (guarded by the ref, not just the effect deps, since `leads`
  // changes on every refresh) and only if push hasn't already been decided
  // one way or the other. Marks itself "seen" the moment the prompt is
  // shown, not on a particular button, so it never nags again regardless of
  // how the prompt gets dismissed (Enable, Not now, tap-outside, back-gesture)
  useEffect(() => {
    if (pushPromptCheckedRef.current) return;
    if (!role || leads === null || !settingsLoaded) return;
    pushPromptCheckedRef.current = true;
    if (!settings.popupPushEnabled) return;
    if (!pushSupported()) return;
    if (localStorage.getItem("rhxPushPromptSeen")) return;
    getPushSubscription()
      .then((sub) => {
        if (sub) return;
        localStorage.setItem("rhxPushPromptSeen", "1");
        setShowPushPrompt(true);
      })
      .catch(() => {});
  }, [role, leads, settingsLoaded, settings.popupPushEnabled]);

  useEffect(() => {
    showPushPromptRef.current = showPushPrompt;
  }, [showPushPrompt]);

  // keeps an already-subscribed device's role current on the server every
  // time the app opens — see syncPushSubscriptionRole for why this matters
  useEffect(() => {
    if (role) syncPushSubscriptionRole();
  }, [role]);

  // owner-only monthly ritual: every time the app opens (not just once) in
  // a calendar month whose goal hasn't been confirmed yet, prompt for that
  // month's take-home goal. Driven by the server's goalMonthConfirmed
  // (stamped whenever the take-home is saved, from either this prompt or
  // the regular Income Goal panel) rather than a local "seen" flag, so it
  // keeps asking on every open — across devices — until an actual number
  // is set, not just until the prompt has been shown once. Delayed so it
  // doesn't stack on top of the once-ever push prompt on the rare session
  // where both would otherwise fire together — the push flow is fully
  // async (a service-worker subscription lookup) but settles well within
  // this delay in practice
  useEffect(() => {
    if (goalPromptCheckedRef.current) return;
    if (!role || leads === null || !settingsLoaded) return;
    if (role !== "owner") return;
    goalPromptCheckedRef.current = true;
    if (!settings.popupGoalEnabled) return;
    const monthKey = new Date().toISOString().slice(0, 7);
    if (settings.goalMonthConfirmed === monthKey) return;
    // deliberately no cleanup here — `leads` (a dependency) can get a new
    // array reference again shortly after mount, which would re-run this
    // effect; a clearTimeout cleanup would cancel the pending timeout right
    // as the ref-guard above silently blocks it from ever being rescheduled
    setTimeout(() => {
      if (showPushPromptRef.current) return;
      setShowGoalPrompt(true);
    }, 1200);
  }, [role, leads, settingsLoaded, settings.goalMonthConfirmed, settings.popupGoalEnabled]);

  // gives the push/goal prompts (which fire on their own 1200ms delay) a
  // head start before the warranty alert gets a turn — set once per mount,
  // deliberately not re-triggered by anything else
  useEffect(() => {
    const t = setTimeout(() => setWarrantyAlertDelayElapsed(true), 1800);
    return () => clearTimeout(t);
  }, []);

  // owner-only: once per app open, after the warranty-request alert (if any)
  // is exited, nudge to fill in phone/email/address on leads that are
  // missing them — a plain "Close" popup, no other action
  const maybeShowMissingInfoAlert = useCallback(() => {
    if (missingInfoAlertShownRef.current) return;
    if (role !== "owner" || leads === null || !settingsLoaded) return;
    missingInfoAlertShownRef.current = true;
    if (!settings.popupMissingInfoEnabled) return;
    const missing = leads.filter(
      (l) => !l.archived && l.stage !== "lost" && (!l.phone || !l.email || !l.address)
    );
    if (missing.length > 0) setShowMissingInfoAlert(true);
  }, [role, leads, settingsLoaded, settings.popupMissingInfoEnabled]);

  // every time the app opens (any role), if there's at least one unresolved
  // warranty request, prompt for it — unlike the monthly goal prompt this
  // has no "confirmed" state to suppress it, since simply having the app
  // open doesn't resolve a warranty request; it keeps showing once per
  // session for as long as anything is still open. Re-checks (rather than a
  // one-shot check) whenever the other two auto-popups' state changes, so a
  // goal/push prompt that's still open at the 1800ms mark doesn't
  // permanently suppress this for the rest of the session — it fires as
  // soon as they clear instead
  useEffect(() => {
    if (warrantyAlertShownRef.current) return;
    if (!role || !warrantyLoaded || !warrantyAlertDelayElapsed || !settingsLoaded) return;
    if (showPushPrompt || showGoalPrompt) return;
    const stillOpen = settings.popupWarrantyEnabled
      ? warrantyRequests.filter((w) => w.stage !== "resolved").length
      : 0;
    if (stillOpen === 0) {
      // no warranty popup this session (either nothing's open, or the
      // toggle is off) — the missing-customer-info alert would otherwise
      // wait forever for a "warranty popup exited" event that's never
      // coming, so give it its turn right here instead
      maybeShowMissingInfoAlert();
      return;
    }
    warrantyAlertShownRef.current = true;
    setShowWarrantyAlert(true);
  }, [
    role,
    warrantyLoaded,
    warrantyAlertDelayElapsed,
    settingsLoaded,
    settings.popupWarrantyEnabled,
    warrantyRequests,
    showPushPrompt,
    showGoalPrompt,
    maybeShowMissingInfoAlert,
  ]);

  // light auto-refresh while the app is actually visible, so a PWA left
  // open in the background doesn't keep showing stale data — pauses when
  // backgrounded and refetches immediately the moment it's foregrounded
  useEffect(() => {
    if (!role) return;
    let interval = null;
    const refresh = () => {
      loadLeads();
      loadWarrantyRequests();
    };
    const start = () => {
      if (interval) return;
      refresh();
      interval = setInterval(refresh, 30000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [role, loadLeads, loadWarrantyRequests]);

  const navigateToLead = useCallback(
    (leadId) => {
      const lead = (leads || []).find((l) => l.id === leadId);
      if (!lead) return;
      setView(lead.archived ? "archive" : "board");
      if (!lead.archived) setActiveStage(lead.stage);
      setHighlightedLeadId(leadId);
    },
    [leads]
  );

  // deep-link from a push notification tap: either this window is opened
  // fresh with ?lead=<id>, or the service worker posts a message to an
  // already-open tab it just focused
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get("lead");
    if (leadId && leads) {
      navigateToLead(leadId);
      params.delete("lead");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event) => {
      if (event.data && event.data.type === "OPEN_LEAD" && event.data.leadId) {
        navigateToLead(event.data.leadId);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigateToLead]);

  useEffect(() => {
    if (!highlightedLeadId) return;
    const el = document.getElementById(`lead-${highlightedLeadId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightedLeadId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightedLeadId]);

  const handleLogin = async (passcode) => {
    const res = await api.login(passcode); // throws on a bad passcode
    setRole(res.role);
    setShowAccountModal(false);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // clearing local state below still logs this device out either way
    }
    setRole(null);
    leadsVersionRef.current++;
    setLeads(null);
    setShowAccountModal(false);
  };

  const enablePushFromPrompt = async () => {
    await enablePush();
    setShowPushPrompt(false);
  };

  const addLead = async (name, job, phone, email, source, sourceOther) => {
    if (!name.trim() || !source) return;
    try {
      const lead = await api.addLead({ name, job, phone, email, source, sourceOther });
      leadsVersionRef.current++;
      setLeads((prev) => [lead, ...(prev || [])]);
      setShowAdd(false);
      setActiveStage("new");
      setView("board");
      setError("");
      loadContacts();
    } catch {
      setError("Couldn't add that lead — try again.");
    }
  };

  const moveLead = async (id, stage, date, revert, workDays) => {
    leadsVersionRef.current++;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, stage } : l)));
    try {
      const updated = await api.moveLead(id, stage, date, revert, workDays);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      setError("");
      // just marked won — first prompt for who's managing the job (this is
      // also what decides whether Dave gets the "Lead won!" push, see
      // saveJobManager below), then the scope-of-work checklist so the
      // project manager knows exactly what to plan for
      if (!revert && stage === "won") setManagerPromptLead(updated);
    } catch {
      setError("Couldn't save that move — try again.");
      loadLeads();
    }
  };

  // resolves the required job-manager prompt (Sean or Dave — no skip
  // option), then chains straight into the equally-required scope-of-work
  // prompt for the same lead, so marking a lead won always ends with both
  // done, not just started
  const saveJobManager = async (id, manager) => {
    setManagerPromptLead(null);
    leadsVersionRef.current++;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, manager } : l)));
    try {
      const updated = await api.editLead(id, { manager });
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      setScopeOfWorkRequired(true);
      setScopeOfWorkLead(updated);
    } catch {
      setError("Couldn't save the job manager — try again.");
      loadLeads();
      // still required — the lead was already moved to won, so don't leave
      // the flow stuck on a failed save with no way to reach the scope prompt
      const lead = (leads || []).find((l) => l.id === id);
      setScopeOfWorkRequired(true);
      if (lead) setScopeOfWorkLead(lead);
    }
  };

  // the manual "Add scope of work" button (available any time after a win,
  // not just right after it) always opens in non-required/dismissible mode
  const openScopeOfWork = (lead) => {
    setScopeOfWorkRequired(false);
    setScopeOfWorkLead(lead);
  };

  const saveScopeOfWork = async (id, items) => {
    const updated = await api.setScopeOfWork(id, items);
    leadsVersionRef.current++;
    setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    return updated;
  };

  const toggleScopeOfWorkItem = async (id, itemId, done) => {
    leadsVersionRef.current++;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, scopeOfWork: l.scopeOfWork.map((i) => (i.id === itemId ? { ...i, done } : i)) } : l
      )
    );
    try {
      const updated = await api.toggleScopeOfWorkItem(id, itemId, done);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch {
      loadLeads();
    }
  };

  const deleteContact = async (id) => {
    const prevContacts = contacts;
    setContacts((prev) => prev.filter((c) => c.id !== id));
    try {
      await api.deleteContact(id);
    } catch {
      setContacts(prevContacts);
    }
  };

  const logFollowup = async (id) => {
    leadsVersionRef.current++;
    try {
      const updated = await api.logFollowup(id);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch {
      setError("Couldn't log that follow-up — try again.");
      loadLeads();
    }
  };

  const removeFollowup = async (id, followupId) => {
    leadsVersionRef.current++;
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, followUps: l.followUps.filter((f) => f.id !== followupId) } : l))
    );
    try {
      const updated = await api.removeFollowup(id, followupId);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch {
      loadLeads();
    }
  };

  const editField = async (id, field, value) => {
    const patch = typeof field === "object" ? field : { [field]: value };
    leadsVersionRef.current++;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    try {
      const updated = await api.editLead(id, patch);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      setError("");
    } catch {
      setError("Couldn't save that change — try again.");
      loadLeads();
    }
  };

  // separate from editField/api.editLead — the viewer role is allowed to
  // schedule/reschedule a won job's start date even though every other field
  // on the lead stays owner-only, so this goes through its own endpoint
  const editStartDate = async (id, startDate) => {
    leadsVersionRef.current++;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, startDate } : l)));
    try {
      const updated = await api.editStartDate(id, startDate);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      setError("");
    } catch {
      setError("Couldn't save that change — try again.");
      loadLeads();
    }
  };

  const deleteLead = async (id) => {
    const prevLeads = leads;
    leadsVersionRef.current++;
    setLeads((prev) => prev.filter((l) => l.id !== id));
    try {
      await api.deleteLead(id);
      setError("");
    } catch {
      setError("Couldn't delete that lead — try again.");
      setLeads(prevLeads);
    }
  };

  const openWarrantyCount = useMemo(
    () => warrantyRequests.filter((w) => w.stage !== "resolved").length,
    [warrantyRequests]
  );

  const addWarrantyRequest = async (payload) => {
    try {
      const created = await api.addWarrantyRequest(payload);
      warrantyVersionRef.current++;
      setWarrantyRequests((prev) => [created, ...prev]);
      setError("");
    } catch {
      setError("Couldn't add that warranty request — try again.");
    }
  };

  const moveWarrantyRequest = async (id, stage, revert) => {
    warrantyVersionRef.current++;
    setWarrantyRequests((prev) => prev.map((w) => (w.id === id ? { ...w, stage } : w)));
    try {
      const updated = await api.moveWarrantyRequest(id, stage, revert);
      setWarrantyRequests((prev) => prev.map((w) => (w.id === id ? updated : w)));
      setError("");
    } catch {
      setError("Couldn't save that move — try again.");
      loadWarrantyRequests();
    }
  };

  const editWarrantyField = async (id, field, value) => {
    const patch = typeof field === "object" ? field : { [field]: value };
    warrantyVersionRef.current++;
    setWarrantyRequests((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    try {
      const updated = await api.editWarrantyRequest(id, patch);
      setWarrantyRequests((prev) => prev.map((w) => (w.id === id ? updated : w)));
      setError("");
    } catch {
      setError("Couldn't save that change — try again.");
      loadWarrantyRequests();
    }
  };

  const deleteWarrantyRequest = async (id) => {
    const prev = warrantyRequests;
    warrantyVersionRef.current++;
    setWarrantyRequests((p) => p.filter((w) => w.id !== id));
    try {
      await api.deleteWarrantyRequest(id);
      setError("");
    } catch {
      setError("Couldn't delete that warranty request — try again.");
      setWarrantyRequests(prev);
    }
  };

  // left to throw on failure — the photo picker shows the error inline
  // next to the upload button instead of the global banner
  const uploadWarrantyPhotos = async (id, files, type) => {
    const updated = await api.uploadWarrantyPhotos(id, files, type);
    warrantyVersionRef.current++;
    setWarrantyRequests((prev) => prev.map((w) => (w.id === id ? updated : w)));
  };

  const deleteWarrantyPhoto = async (id, photoId) => {
    try {
      const updated = await api.deleteWarrantyPhoto(id, photoId);
      warrantyVersionRef.current++;
      setWarrantyRequests((prev) => prev.map((w) => (w.id === id ? updated : w)));
    } catch {
      setError("Couldn't delete that photo — try again.");
    }
  };

  const counts = useMemo(() => {
    const c = {};
    STAGES.forEach((s) => (c[s.key] = 0));
    (leads || []).forEach((l) => {
      if (l.archived) return;
      c[l.stage] = (c[l.stage] || 0) + 1;
    });
    return c;
  }, [leads]);

  // soonest not-yet-passed sales appointment, for the dashboard's
  // Appointments tile
  const upcomingAppointment = useMemo(() => {
    const now = Date.now();
    return (leads || [])
      .filter((l) => !l.archived && l.appointmentAt && new Date(l.appointmentAt).getTime() >= now)
      .sort((a, b) => new Date(a.appointmentAt) - new Date(b.appointmentAt))[0] || null;
  }, [leads]);

  const visible = useMemo(
    () =>
      (leads || [])
        .filter((l) => !l.archived && l.stage === activeStage)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [leads, activeStage]
  );

  // FLIP animation: when a lead leaves this stage's list (moved to another
  // bucket) or reorders within it (a date edit changed its sort position),
  // the cards that shift as a result visibly slide into their new spot
  // instead of snapping there — otherwise the next lead lands exactly where
  // the tapped one was, and it's easy to not notice the list changed at all
  // and act on the wrong card next
  const cardNodesRef = useRef(new Map());
  const cardRefCallbacksRef = useRef(new Map());
  const cardAnimsRef = useRef(new Map());
  const prevTopsRef = useRef(new Map());
  const getCardRef = useCallback((id) => {
    if (!cardRefCallbacksRef.current.has(id)) {
      cardRefCallbacksRef.current.set(id, (el) => {
        if (el) cardNodesRef.current.set(id, el);
        else cardNodesRef.current.delete(id);
      });
    }
    return cardRefCallbacksRef.current.get(id);
  }, []);

  useLayoutEffect(() => {
    const nodes = cardNodesRef.current;
    const anims = cardAnimsRef.current;
    const prevTops = prevTopsRef.current;

    // a move/edit lands in two state updates (an optimistic one, then a
    // server-confirmed one a beat later), so this effect can fire again
    // while the previous run's animation is still playing. Cancel any
    // in-flight animation before measuring — getBoundingClientRect reflects
    // a mid-animation visual position, not the card's true resting layout
    // position, and reading that would throw off the delta. Using the Web
    // Animations API (rather than a manual transform + CSS transition)
    // means a fresh animate() call takes effect immediately, with no
    // deferred-frame handoff that a fast-arriving second update could race
    nodes.forEach((_, id) => anims.get(id)?.cancel());

    const nextTops = new Map();
    nodes.forEach((node, id) => {
      nextTops.set(id, node.getBoundingClientRect().top);
    });
    nextTops.forEach((top, id) => {
      const prevTop = prevTops.get(id);
      if (prevTop == null || prevTop === top) return;
      const node = nodes.get(id);
      if (!node) return;
      const anim = node.animate(
        [{ transform: `translateY(${prevTop - top}px)` }, { transform: "translateY(0)" }],
        { duration: 420, easing: "ease-out" }
      );
      anims.set(id, anim);
    });
    prevTopsRef.current = nextTops;
  }, [visible]);

  const stats = useMemo(() => {
    const now = new Date();
    const wStart = startOfWeek(now);
    const mStart = startOfMonth(now);
    const lastWStart = new Date(wStart);
    lastWStart.setDate(lastWStart.getDate() - 7);
    const lastWEnd = new Date(wStart.getTime() - 1);
    const prevWStart = new Date(lastWStart);
    prevWStart.setDate(prevWStart.getDate() - 7);
    const prevWEnd = new Date(lastWStart.getTime() - 1);
    const all = leads || [];
    const inRange = (iso, start) => iso && new Date(iso) >= start;
    const inWindow = (iso, start, end) => iso && new Date(iso) >= start && new Date(iso) <= end;
    return {
      leadsWeek: all.filter((l) => inRange(l.createdAt, wStart)).length,
      leadsMonth: all.filter((l) => inRange(l.createdAt, mStart)).length,
      wonWeek: all.filter((l) => inRange(l.wonAt, wStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      wonMonth: all.filter((l) => inRange(l.wonAt, mStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      earnedWeek: all.filter((l) => inRange(l.paidAt, wStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      earnedMonth: all.filter((l) => inRange(l.paidAt, mStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      lastWeekStart: lastWStart,
      lastWeekEnd: lastWEnd,
      leadsLastWeek: all.filter((l) => inWindow(l.createdAt, lastWStart, lastWEnd)).length,
      wonLastWeek: all.filter((l) => inWindow(l.wonAt, lastWStart, lastWEnd)).reduce((s, l) => s + (l.revenue || 0), 0),
      earnedLastWeek: all.filter((l) => inWindow(l.paidAt, lastWStart, lastWEnd)).reduce((s, l) => s + (l.revenue || 0), 0),
      previousWeekStart: prevWStart,
      previousWeekEnd: prevWEnd,
      leadsPreviousWeek: all.filter((l) => inWindow(l.createdAt, prevWStart, prevWEnd)).length,
      wonPreviousWeek: all.filter((l) => inWindow(l.wonAt, prevWStart, prevWEnd)).reduce((s, l) => s + (l.revenue || 0), 0),
      earnedPreviousWeek: all.filter((l) => inWindow(l.paidAt, prevWStart, prevWEnd)).reduce((s, l) => s + (l.revenue || 0), 0),
    };
  }, [leads]);

  // unfiltered baseline used by the final-report "vs average pace" comparison
  // and the income-goal calculator's "my averages" mode, independent of
  // whatever source filter is selected in the metrics panel
  const allSourcesMetrics = useMemo(
    () => computeMetrics(leads || [], settings.overheadPercent),
    [leads, settings.overheadPercent]
  );

  const lookbackResult = useMemo(() => {
    if (!lookbackStart || !lookbackEnd) return null;
    const start = new Date(lookbackStart + "T00:00:00");
    const end = new Date(lookbackEnd + "T23:59:59");
    if (end < start) return null;
    const breakdown = breakdownForRange(leads, start, end);
    return {
      start,
      end,
      breakdown,
      leadsCount: breakdown.received.length,
      won: breakdown.won.reduce((s, l) => s + (l.revenue || 0), 0),
      earned: breakdown.earned.reduce((s, l) => s + (l.revenue || 0), 0),
    };
  }, [leads, lookbackStart, lookbackEnd]);

  const applyLookbackPreset = (kind) => {
    const now = new Date();
    let start, end;
    if (kind === "week") {
      start = startOfWeek(now);
      end = endOfWeek(now);
    } else if (kind === "month") {
      start = startOfMonth(now);
      end = endOfMonth(now);
    } else if (kind === "weekLastYear") {
      const ly = addYears(now, -1);
      start = startOfWeek(ly);
      end = endOfWeek(ly);
    } else {
      const ly = addYears(now, -1);
      start = startOfMonth(ly);
      end = endOfMonth(ly);
    }
    setLookbackStart(toDateInputValue(start));
    setLookbackEnd(toDateInputValue(end));
    setShowLookback(true);
  };

  const stageIdx = STAGES.findIndex((s) => s.key === activeStage);

  if (!authChecked) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT_UTIL, fontSize: 14 }}>Checking session…</div>
      </div>
    );
  }

  if (!role) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (leads === null) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT_UTIL, fontSize: 14 }}>Loading board…</div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <style>{`
        * { box-sizing: border-box; }
        input, textarea, button { font-family: inherit; }
        input:focus, textarea:focus, button:focus-visible {
          outline: 2px solid ${COLORS.accent}; outline-offset: 2px;
        }
        ::placeholder { color: #9AA6AD; }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
      `}</style>

      {updateAvailable && (
        <button
          onClick={() => window.location.reload()}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "10px 16px",
            background: COLORS.amber,
            border: "none",
            cursor: "pointer",
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 13,
            color: "#fff",
          }}
        >
          A newer version is available — tap to refresh
        </button>
      )}

      <header style={header}>
        {/* hamburger pinned to the top-right corner, out of the tile row —
            keeps Dashboard/Activity/Alerts to 3 tiles that fit one row
            instead of wrapping, and matches the usual top-right menu spot.
            Styled the same dark-card/red-icon way as the tiles so it still
            reads as part of the same button family. */}
        <div style={{ position: "absolute", top: 18, right: 20 }}>
          <HeaderMenu
            editable={editable}
            onOpenSettings={() => setShowSettingsModal(true)}
            onOpenContacts={() => setView("contacts")}
            onOpenAccount={() => setShowAccountModal(true)}
            btnStyle={headerCornerBtn}
            iconColor={COLORS.heroRed}
          />
        </div>
        {/* logo as its own left column, spanning the full height of
            everything else stacked to its right — matches the reference
            design's layout instead of stacking the logo in its own row */}
        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          <img
            src="/logo-badge.png"
            alt="Lead Hammer"
            style={{ width: 118, height: "auto", flexShrink: 0, alignSelf: "flex-start" }}
          />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* paddingRight keeps this clear of the absolutely-positioned
                corner hamburger, which floats over this top area */}
            <div style={{ paddingRight: 56 }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 800,
                  fontStyle: "italic",
                  fontSize: 21,
                  lineHeight: 1.05,
                  color: "#fff",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Lead Hammer
              </div>
              <div
                style={{
                  fontFamily: FONT_UTIL,
                  fontWeight: 700,
                  fontSize: 10.5,
                  letterSpacing: 1,
                  color: "rgba(255,255,255,0.55)",
                  textTransform: "uppercase",
                  marginTop: 4,
                }}
              >
                Build<span style={{ color: COLORS.heroRed }}>.</span> Track
                <span style={{ color: COLORS.heroRed }}>.</span> Close
                <span style={{ color: COLORS.heroRed }}>.</span>
              </div>
            </div>

            {/* primary nav — always visible, icon-over-label tiles; wraps to
                a 2nd row on narrow phones rather than shrinking illegibly */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              <button onClick={() => setView("dashboard")} style={headerTile} aria-label="Dashboard">
                <Home size={20} color={COLORS.heroRed} strokeWidth={2} />
                <span style={headerTileLabel}>Dashboard</span>
              </button>
              <button onClick={() => setView("archive")} style={headerTile} aria-label="Activity">
                <History size={20} color={COLORS.heroRed} strokeWidth={2} />
                <span style={headerTileLabel}>Activity</span>
              </button>
              <button onClick={() => setShowLeadSearch(true)} style={headerTile} aria-label="Search leads">
                <Search size={20} color={COLORS.heroRed} strokeWidth={2} />
                <span style={headerTileLabel}>Search</span>
              </button>
              <NotificationBell
                onOpenLead={navigateToLead}
                btnStyle={headerTile}
                iconSize={20}
                iconColor={COLORS.heroRed}
                label="Alerts"
              />
            </div>

            {/* New Lead is always available (not just on the board view) —
                it's the header's main CTA now, not a board-only control */}
            <div style={{ display: "flex", alignItems: "center" }}>
              {view === "warranty" ? (
                // WarrantyView renders its own in-content title + back control
                <div />
              ) : editable ? (
                <button onClick={() => setShowAdd(true)} style={heroNewLeadBtn} aria-label="Add new lead">
                  <Plus size={18} strokeWidth={2.5} />
                  New Lead
                </button>
              ) : view === "board" ? (
                <div style={viewBadge}>
                  <Eye size={13} color={COLORS.mutedOnDark} />
                  <span>View only</span>
                </div>
              ) : (
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.surface }}>
                  {view === "dashboard"
                    ? "Dashboard"
                    : view === "goals"
                    ? "Your Goals"
                    : view === "metrics"
                    ? "Performance Metrics"
                    : view === "calendar"
                    ? "Job Calendar"
                    : view === "archive"
                    ? "Archive"
                    : ""}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {view === "dashboard" ? (
        <DashboardView
          editable={editable}
          role={role}
          settings={settings}
          stats={stats}
          counts={counts}
          openWarrantyCount={openWarrantyCount}
          upcomingAppointment={upcomingAppointment}
          myMetrics={allSourcesMetrics}
          onOpenGoals={() => setView("goals")}
          onOpenMetrics={() => setView("metrics")}
          onOpenBoard={() => setView("board")}
          onOpenWarranty={() => setView("warranty")}
          onOpenCalendar={() => setView("calendar")}
          onOpenLead={navigateToLead}
        />
      ) : view === "calendar" ? (
        <CalendarView leads={leads} allMetrics={allSourcesMetrics} onOpenLead={navigateToLead} />
      ) : view === "goals" ? (
        <GoalsView
          settings={settings}
          onSaveSettings={saveSettings}
          myMetrics={allSourcesMetrics}
          wonThisMonth={stats.wonMonth}
        />
      ) : view === "metrics" ? (
        <MetricsView leads={leads} overheadPercent={settings.overheadPercent} />
      ) : view === "contacts" && editable ? (
        <ContactsView contacts={contacts} onDelete={deleteContact} />
      ) : view === "warranty" ? (
        <WarrantyView
          requests={warrantyRequests}
          editable={editable}
          canMove={!!role}
          onMove={moveWarrantyRequest}
          onEditField={editWarrantyField}
          onDelete={deleteWarrantyRequest}
          onAdd={addWarrantyRequest}
          onUploadPhotos={uploadWarrantyPhotos}
          onDeletePhoto={deleteWarrantyPhoto}
          onBack={() => setView("dashboard")}
        />
      ) : (
        <>
      {/* weekly / monthly counters — 2x2: this month, 2 weeks ago / last week, this week */}
      <div style={statsGrid}>
        <button
          onClick={() =>
            setDrilldown({
              title: "This month",
              rangeLabel: `${fmtRangeDate(startOfMonth(new Date()))} – ${fmtRangeDate(new Date())}`,
              breakdown: breakdownForRange(leads, startOfMonth(new Date()), null),
            })
          }
          style={{ ...statCard, ...statCardBtn }}
        >
          <div style={statLabel}>This month</div>
          <div style={statMain}>{stats.leadsMonth} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonMonth)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedMonth)} finalized</div>
        </button>
        <button
          onClick={() =>
            setDrilldown({
              title: "2 weeks ago",
              rangeLabel: `${fmtRangeDate(stats.previousWeekStart)} – ${fmtRangeDate(stats.previousWeekEnd)}`,
              breakdown: breakdownForRange(leads, stats.previousWeekStart, stats.previousWeekEnd),
            })
          }
          style={{ ...statCard, ...statCardBtn }}
        >
          <div style={statLabel}>2 weeks ago</div>
          <div style={statMain}>{stats.leadsPreviousWeek} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonPreviousWeek)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedPreviousWeek)} finalized</div>
        </button>
        <button
          onClick={() =>
            setDrilldown({
              title: "Last week",
              rangeLabel: `${fmtRangeDate(stats.lastWeekStart)} – ${fmtRangeDate(stats.lastWeekEnd)}`,
              breakdown: breakdownForRange(leads, stats.lastWeekStart, stats.lastWeekEnd),
            })
          }
          style={{ ...statCard, ...statCardBtn }}
        >
          <div style={statLabel}>Last week</div>
          <div style={statMain}>{stats.leadsLastWeek} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonLastWeek)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedLastWeek)} finalized</div>
        </button>
        <button
          onClick={() =>
            setDrilldown({
              title: "This week",
              rangeLabel: `${fmtRangeDate(startOfWeek(new Date()))} – ${fmtRangeDate(new Date())}`,
              breakdown: breakdownForRange(leads, startOfWeek(new Date()), null),
            })
          }
          style={{ ...statCard, ...statCardBtn }}
        >
          <div style={statLabel}>This week</div>
          <div style={statMain}>{stats.leadsWeek} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonWeek)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedWeek)} finalized</div>
        </button>
      </div>

      <div style={{ padding: "0 16px" }}>
        <button onClick={() => setShowLookback((v) => !v)} style={lookbackToggle}>
          <Calendar size={14} color={COLORS.accent} />
          <span>Look back at a past period</span>
          {showLookback ? <ChevronUp size={14} color={COLORS.accent} /> : <ChevronDown size={14} color={COLORS.accent} />}
        </button>
      </div>

      {showLookback && (
        <div style={lookbackPanel}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => applyLookbackPreset("weekLastYear")} style={lookbackPresetBtn}>
              This week last year
            </button>
            <button onClick={() => applyLookbackPreset("monthLastYear")} style={lookbackPresetBtn}>
              This month last year
            </button>
            <button onClick={() => applyLookbackPreset("week")} style={lookbackPresetBtn}>
              This week
            </button>
            <button onClick={() => applyLookbackPreset("month")} style={lookbackPresetBtn}>
              This month
            </button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...modalLabel, marginTop: 0 }}>From</label>
              <input
                type="date"
                value={lookbackStart}
                onChange={(e) => setLookbackStart(e.target.value)}
                style={modalInput}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...modalLabel, marginTop: 0 }}>To</label>
              <input
                type="date"
                value={lookbackEnd}
                onChange={(e) => setLookbackEnd(e.target.value)}
                style={modalInput}
              />
            </div>
          </div>
          {lookbackResult ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>
                {fmtRangeDate(lookbackResult.start)} – {fmtRangeDate(lookbackResult.end)}
              </div>
              <div style={statMain}>
                {lookbackResult.leadsCount} <span style={statUnit}>leads</span>
              </div>
              <div style={statSub}>{fmtCurrency(lookbackResult.won)} won</div>
              <div style={statSub}>{fmtCurrency(lookbackResult.earned)} finalized</div>
              <button
                onClick={() =>
                  setDrilldown({
                    title: "Look back",
                    rangeLabel: `${fmtRangeDate(lookbackResult.start)} – ${fmtRangeDate(lookbackResult.end)}`,
                    breakdown: lookbackResult.breakdown,
                  })
                }
                style={{ ...notifMarkAllBtn, marginTop: 10, fontSize: 13 }}
              >
                View leads
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 14, fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>
              Pick a range above, or use one of the shortcuts.
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: "#FBEAE7", color: "#8C2F24", fontSize: 13, padding: "8px 16px", fontFamily: FONT_BODY }}>
          {error}
        </div>
      )}

      {view === "board" ? (
        <>
          {/* stage tabs */}
          <div style={tabsRow}>
            {STAGES.map((s) => {
              const active = s.key === activeStage;
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveStage(s.key)}
                  style={{
                    ...tabBtn,
                    background: active ? s.color : "transparent",
                    color: COLORS.ink,
                    borderColor: s.color,
                  }}
                >
                  {s.short}
                  <span style={{ ...countPill, background: active ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.06)" }}>
                    {counts[s.key] || 0}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setView("warranty")}
              style={{ ...tabBtn, background: COLORS.rust, borderColor: COLORS.rust, color: "#fff", position: "relative" }}
            >
              <Wrench size={13} color="#fff" strokeWidth={2.2} />
              Requests
              {openWarrantyCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -7,
                    right: -7,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    background: "#fff",
                    color: COLORS.rust,
                    fontFamily: FONT_UTIL,
                    fontWeight: 700,
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 4px",
                    border: `2px solid ${COLORS.bg}`,
                  }}
                >
                  {openWarrantyCount}
                </span>
              )}
            </button>
          </div>

          {/* stage nav arrows + heading */}
          <div style={stageHeadRow}>
            <button
              onClick={() => stageIdx > 0 && setActiveStage(STAGES[stageIdx - 1].key)}
              style={{ ...navArrow, opacity: stageIdx > 0 ? 1 : 0.25 }}
              disabled={stageIdx === 0}
              aria-label="Previous stage"
            >
              <ChevronLeft size={18} color={COLORS.ink} />
            </button>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                color: COLORS.ink,
                fontSize: 16,
                textAlign: "center",
                flex: 1,
              }}
            >
              {STAGES[stageIdx].label}
            </div>
            <button
              onClick={() => stageIdx < STAGES.length - 1 && setActiveStage(STAGES[stageIdx + 1].key)}
              style={{ ...navArrow, opacity: stageIdx < STAGES.length - 1 ? 1 : 0.25 }}
              disabled={stageIdx === STAGES.length - 1}
              aria-label="Next stage"
            >
              <ChevronRight size={18} color={COLORS.ink} />
            </button>
          </div>

          {/* cards */}
          <main style={cardsWrap}>
            {visible.length === 0 && (
              <div style={emptyState}>
                <div
                  style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}
                >
                  Nothing here yet
                </div>
                <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
                  {activeStage === "new"
                    ? "Tap “New Lead” to log one."
                    : "Leads land here once they move through the board."}
                </div>
              </div>
            )}
            {visible.map((lead) => (
              <div key={lead.id} ref={getCardRef(lead.id)}>
                <LeadTicket
                  lead={lead}
                  onMove={moveLead}
                  onEditField={editField}
                  onEditStartDate={editStartDate}
                  onDelete={deleteLead}
                  editable={editable}
                  role={role}
                  highlighted={lead.id === highlightedLeadId}
                  onOpenReport={setReportLead}
                  onOpenScopeOfWork={openScopeOfWork}
                  onLogFollowup={logFollowup}
                  onRemoveFollowup={removeFollowup}
                  settings={settings}
                />
              </div>
            ))}
          </main>
        </>
      ) : (
        <ArchiveView leads={leads} editable={editable} onOpenReport={setReportLead} />
      )}
        </>
      )}

      {showAdd && <AddLeadModal onAdd={addLead} onClose={() => setShowAdd(false)} contacts={contacts} />}
      {showPushPrompt && (
        <PushPromptModal onEnable={enablePushFromPrompt} onDismiss={() => setShowPushPrompt(false)} />
      )}
      {showGoalPrompt && (
        <MonthlyGoalPromptModal
          monthLabel={new Date().toLocaleDateString(undefined, { month: "long" })}
          defaultTakeHome={settings.goalMonthlyTakeHome}
          onSetGoal={setMonthlyGoalFromPrompt}
          onDismiss={() => setShowGoalPrompt(false)}
        />
      )}
      {showWarrantyAlert && (
        <WarrantyAlertModal
          count={openWarrantyCount}
          onView={() => {
            setShowWarrantyAlert(false);
            maybeShowMissingInfoAlert();
            setView("warranty");
          }}
          onDismiss={() => {
            setShowWarrantyAlert(false);
            maybeShowMissingInfoAlert();
          }}
        />
      )}
      {showMissingInfoAlert && (
        <MissingInfoAlertModal
          leads={leads}
          onClose={() => setShowMissingInfoAlert(false)}
        />
      )}
      {managerPromptLead && (
        <JobManagerModal lead={managerPromptLead} onPick={(manager) => saveJobManager(managerPromptLead.id, manager)} />
      )}
      {scopeOfWorkLead && (
        <ScopeOfWorkModal
          lead={leads.find((l) => l.id === scopeOfWorkLead.id) || scopeOfWorkLead}
          canEdit={editable}
          required={scopeOfWorkRequired}
          onSave={(items) => saveScopeOfWork(scopeOfWorkLead.id, items)}
          onToggle={(itemId, done) => toggleScopeOfWorkItem(scopeOfWorkLead.id, itemId, done)}
          onClose={() => setScopeOfWorkLead(null)}
        />
      )}
      {showAccountModal && (
        <AccountModal
          role={role}
          onSwitch={handleLogin}
          onLogout={handleLogout}
          onClose={() => setShowAccountModal(false)}
        />
      )}
      {showLeadSearch && (
        <LeadSearchModal
          leads={leads || []}
          onSelect={(id) => {
            setShowLeadSearch(false);
            navigateToLead(id);
          }}
          onClose={() => setShowLeadSearch(false)}
        />
      )}
      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettingsModal(false)}
          onOpenBackups={() => {
            setShowSettingsModal(false);
            setShowBackupsModal(true);
          }}
        />
      )}
      {showBackupsModal && (
        <BackupsModal
          onClose={() => setShowBackupsModal(false)}
          onRestored={() => {
            setShowBackupsModal(false);
            loadLeads();
          }}
        />
      )}
      {reportLead && (
        <FinalReportModal
          lead={leads.find((l) => l.id === reportLead.id) || reportLead}
          settings={settings}
          allMetrics={allSourcesMetrics}
          editable={editable}
          onSaveReport={async (patch) => {
            const updated = await api.updateReport(reportLead.id, patch);
            leadsVersionRef.current++;
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
          }}
          onClose={() => setReportLead(null)}
        />
      )}
      {drilldown && (
        <StatDrilldownModal
          title={drilldown.title}
          rangeLabel={drilldown.rangeLabel}
          breakdown={drilldown.breakdown}
          onOpenLead={(id) => {
            setDrilldown(null);
            navigateToLead(id);
          }}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!passcode || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onLogin(passcode);
    } catch (e) {
      setErr(e.message || "Incorrect passcode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`
        * { box-sizing: border-box; }
        input, button { font-family: inherit; }
        input:focus, button:focus-visible { outline: 2px solid ${COLORS.accent}; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 340 }}>
        <img
          src="/logo-hero.jpg"
          alt="Lead Hammer"
          style={{ width: "100%", maxWidth: 260, display: "block", margin: "0 auto 20px", borderRadius: 12 }}
        />
        <label style={modalLabel}>Passcode</label>
        <input
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={modalInput}
          placeholder="Enter your passcode"
        />
        {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>{err}</div>}
        <button
          onClick={submit}
          disabled={busy || !passcode}
          style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 14, opacity: busy || !passcode ? 0.6 : 1 }}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </div>
    </div>
  );
}

function NotificationBell({ onOpenLead, btnStyle = headerIconBtn, iconSize = 21, iconColor = COLORS.surface, label }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await api.listNotifications();
      setNotifications(data.notifications);
      setUnread(data.unread);
    } catch {
      // keep last known state — this is a background refresh, not worth surfacing an error for
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const openNotification = async (n) => {
    setOpen(false);
    if (!n.readAt) {
      api
        .markNotificationRead(n.id)
        .then(load)
        .catch(() => {});
    }
    if (n.leadId) onOpenLead(n.leadId);
  };

  const markAllRead = (e) => {
    e.stopPropagation();
    api
      .markAllNotificationsRead()
      .then(load)
      .catch(() => {});
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ ...btnStyle, position: "relative" }} aria-label="Notifications">
        <Bell size={iconSize} color={iconColor} strokeWidth={2} />
        {label && <span style={headerTileLabel}>{label}</span>}
        {unread > 0 && <span style={notifBadge}>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div style={moreMenuScrim} onClick={() => setOpen(false)} />
          <div style={notifPanel}>
            <div style={notifPanelHeader}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.ink }}>
                Notifications
              </span>
              {unread > 0 && (
                <button onClick={markAllRead} style={notifMarkAllBtn}>
                  Mark all read
                </button>
              )}
            </div>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 16, fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    style={{ ...notifItem, background: n.readAt ? "transparent" : COLORS.surfaceMuted }}
                  >
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: COLORS.ink }}>
                      {n.title}
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>
                      {n.body}
                    </div>
                    <div style={{ fontFamily: FONT_UTIL, fontSize: 11, color: COLORS.muted, marginTop: 3 }}>
                      {fmtRelativeTime(n.createdAt)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Lets the PWA's native back gesture (iOS edge-swipe, Android back
// button/gesture) close an open modal instead of doing nothing and leaving
// the only way out a force-quit. Push a history entry while the modal is
// mounted; a real back gesture fires popstate (still attached) and closes it
// normally; closing via the UI instead (X, tap-outside, Cancel) unmounts the
// modal first, so the cleanup below detects that and pops the entry itself
// — either way, exactly one history entry per modal.
function useModalBackClose(onClose) {
  useEffect(() => {
    window.history.pushState({ rhxModal: true }, "");
    const handlePopState = () => onClose();
    window.addEventListener("popstate", handlePopState);
    // deliberately not popping this entry back off when the modal closes via
    // the UI instead of a back gesture (X, tap-outside, Cancel) — doing that
    // with history.back() is async, and races with a *different* modal that
    // opens (pushing its own entry synchronously) in that same tick, e.g.
    // Settings closing itself while opening Backups, which would otherwise
    // immediately pop the new modal's entry and self-close it. Leaving a
    // harmless "ghost" entry behind is a fine trade: at most it costs an
    // extra swipe-back later that does nothing visible, never a stuck modal
    // or one that closes itself.
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
}

function StatDrilldownModal({ title, rangeLabel, breakdown, onOpenLead, onClose }) {
  useModalBackClose(onClose);
  const [tab, setTab] = useState("received");
  const tabs = [
    { key: "received", label: `Received (${breakdown.received.length})` },
    { key: "won", label: `Won (${breakdown.won.length})` },
    { key: "earned", label: `Finalized (${breakdown.earned.length})` },
  ];
  const list = breakdown[tab];

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>{title}</div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginBottom: 14 }}>{rangeLabel}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...lookbackPresetBtn,
                background: tab === t.key ? COLORS.accent : "transparent",
                color: tab === t.key ? COLORS.surface : COLORS.accent,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {list.length === 0 ? (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, padding: "8px 0" }}>
              No leads in this category.
            </div>
          ) : (
            list.map((l) => (
              <button key={l.id} onClick={() => onOpenLead(l.id)} style={statDrilldownRow}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: COLORS.ink }}>
                  {l.name}
                </div>
                <div style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                  {STAGES.find((s) => s.key === l.stage)?.short || l.stage}
                  {l.revenue != null ? ` · ${fmtCurrency(l.revenue)}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PushPromptModal({ onEnable, onDismiss }) {
  useModalBackClose(onDismiss);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleEnable = async () => {
    setBusy(true);
    setErr("");
    try {
      await onEnable();
    } catch (e) {
      setErr(e.message || "Couldn't enable notifications");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={onDismiss}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: `${COLORS.accent}1a`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Bell size={24} color={COLORS.accent} />
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 17,
            color: COLORS.ink,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          Stay on top of new leads
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 13.5,
            color: COLORS.muted,
            textAlign: "center",
            marginBottom: 18,
          }}
        >
          Turn on notifications to hear the moment something needs your attention — a new lead, a won job, a
          warranty request. You can change this anytime from Account.
        </div>
        {err && (
          <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 10, textAlign: "center" }}>
            {err}
          </div>
        )}
        <button
          onClick={handleEnable}
          disabled={busy}
          style={{ ...addBtn, width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1 }}
        >
          Enable notifications
        </button>
        <button
          onClick={onDismiss}
          style={{ ...roleOption, marginTop: 10, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Not now</span>
        </button>
      </div>
    </div>
  );
}

function MonthlyGoalPromptModal({ monthLabel, defaultTakeHome, onSetGoal, onDismiss }) {
  useModalBackClose(onDismiss);
  const [draft, setDraft] = useState(defaultTakeHome ? String(defaultTakeHome) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    const n = parseFloat(draft);
    if (isNaN(n) || n < 0) {
      setErr("Enter a non-negative amount");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSetGoal(n);
    } catch (e) {
      setErr(e.message || "Couldn't save that");
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={onDismiss}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: `${COLORS.accent}1a`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Target size={24} color={COLORS.accent} />
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 17,
            color: COLORS.ink,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          It's {monthLabel} — start the month off right
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 15.5,
            fontWeight: 600,
            color: COLORS.ink,
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          How much do you want to make this month?!
        </div>
        <input
          type="number"
          inputMode="decimal"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. 10000"
          style={{ ...modalInput, textAlign: "center", fontSize: 22, fontWeight: 700 }}
        />
        {err && (
          <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8, textAlign: "center" }}>
            {err}
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy}
          style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 14, opacity: busy ? 0.6 : 1 }}
        >
          Set my goal
        </button>
        <button
          onClick={onDismiss}
          style={{ ...roleOption, marginTop: 10, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Not now</span>
        </button>
      </div>
    </div>
  );
}

// deliberately more forceful than the other auto-popups: centered over the
// middle of the screen rather than a bottom sheet, with no tap-outside or
// back-gesture dismissal — the owner/viewer has to actively pick "View
// requests" or "Not now" to get rid of it
function WarrantyAlertModal({ count, onView, onDismiss }) {
  return (
    <div style={{ ...modalOverlay, alignItems: "center", padding: 20, boxSizing: "border-box" }}>
      <div style={{ ...modalCard, borderRadius: 20, border: `1px solid ${COLORS.border}`, maxWidth: 380 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              background: `${COLORS.rust}1a`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Wrench size={26} color={COLORS.rust} />
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 18,
            color: COLORS.ink,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          {count === 1 ? "You have a warranty request" : `You have ${count} warranty requests`} that{" "}
          {count === 1 ? "has" : "have"} not been resolved
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 14,
            color: COLORS.muted,
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          Please take the next steps to resolve the issue.
        </div>
        <button
          onClick={onView}
          style={{ ...addBtn, background: COLORS.rust, width: "100%", justifyContent: "center" }}
        >
          View requests
        </button>
        <button
          onClick={onDismiss}
          style={{ ...roleOption, marginTop: 10, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Not now</span>
        </button>
      </div>
    </div>
  );
}

// owner-only, once per app open (see maybeShowMissingInfoAlert), deliberately
// bare — the ask is just "go fill these in", so a single Close button is all
// this needs
function MissingInfoAlertModal({ leads, onClose }) {
  const missing = (leads || []).filter(
    (l) => !l.archived && l.stage !== "lost" && (!l.phone || !l.email || !l.address)
  );

  return (
    <div style={{ ...modalOverlay, alignItems: "center", padding: 20, boxSizing: "border-box" }}>
      <div style={{ ...modalCard, borderRadius: 20, border: `1px solid ${COLORS.border}`, maxWidth: 380 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              background: `${COLORS.amber}1a`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <User size={26} color={COLORS.amber} />
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 18,
            color: COLORS.ink,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          {missing.length === 1 ? "1 lead is" : `${missing.length} leads are`} missing customer info
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 14,
            color: COLORS.muted,
            textAlign: "center",
            marginBottom: missing.length ? 12 : 20,
          }}
        >
          Please update these leads with a phone number, email, and address when you get a chance.
        </div>
        {missing.length > 0 && (
          <div
            style={{
              maxHeight: 140,
              overflowY: "auto",
              marginBottom: 20,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
            }}
          >
            {missing.map((l) => (
              <div
                key={l.id}
                style={{
                  padding: "8px 12px",
                  borderBottom: `1px solid ${COLORS.border}`,
                  fontFamily: FONT_BODY,
                  fontSize: 13.5,
                  color: COLORS.ink,
                }}
              >
                {l.name}
                <span style={{ color: COLORS.muted }}>
                  {" — missing "}
                  {[!l.phone && "phone", !l.email && "email", !l.address && "address"].filter(Boolean).join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={onClose}
          style={{ ...addBtn, background: COLORS.accent, width: "100%", justifyContent: "center" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function AccountModal({ role, onSwitch, onLogout, onClose }) {
  useModalBackClose(onClose);
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState("checking"); // checking | unsupported | enabled | disabled
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  useEffect(() => {
    if (!pushSupported()) {
      setPushStatus("unsupported");
      return;
    }
    getPushSubscription()
      .then((sub) => setPushStatus(sub ? "enabled" : "disabled"))
      .catch(() => setPushStatus("disabled"));
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushError("");
    try {
      if (pushStatus === "enabled") {
        await disablePush();
        setPushStatus("disabled");
      } else {
        await enablePush();
        setPushStatus("enabled");
      }
    } catch (e) {
      setPushError(e.message || "Couldn't update notifications");
    } finally {
      setPushBusy(false);
    }
  };

  const submit = async () => {
    if (!passcode || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSwitch(passcode);
    } catch (e) {
      setErr(e.message || "Incorrect passcode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>Account</div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          Signed in as <strong style={{ color: COLORS.ink }}>{role === "owner" ? "Editor" : "Viewer"}</strong> on
          this device.
        </div>

        {pushStatus !== "unsupported" && (
          <>
            <button
              onClick={togglePush}
              disabled={pushBusy || pushStatus === "checking"}
              style={{
                ...roleOption,
                borderColor: pushStatus === "enabled" ? COLORS.accent : COLORS.border,
                cursor: "pointer",
                opacity: pushBusy || pushStatus === "checking" ? 0.6 : 1,
              }}
            >
              <Bell size={16} color={pushStatus === "enabled" ? COLORS.accent : COLORS.ink} />
              <div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>
                  {pushStatus === "enabled" ? "Notifications on for this device" : "Get notified of new leads"}
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.muted }}>
                  {pushStatus === "checking"
                    ? "Checking…"
                    : pushStatus === "enabled"
                    ? "Tap to turn off on this device"
                    : "Tap to enable push notifications here"}
                </div>
              </div>
            </button>
            {pushError && (
              <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 6 }}>{pushError}</div>
            )}
          </>
        )}

        <label style={modalLabel}>Switch access with a different passcode</label>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={modalInput}
          placeholder="Enter passcode"
        />
        {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>{err}</div>}
        <button
          onClick={submit}
          disabled={busy || !passcode}
          style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 12, opacity: busy || !passcode ? 0.6 : 1 }}
        >
          Switch
        </button>
        <button
          onClick={onLogout}
          style={{ ...roleOption, marginTop: 16, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>
            Log out on this device
          </span>
        </button>
      </div>
    </div>
  );
}

function stageLabel(type, stage) {
  const list = type === "warranty" ? WARRANTY_STAGES : STAGES;
  return list.find((s) => s.key === stage)?.short || stage;
}

// running activity feed embedded directly on the dashboard, below the
// tiles — lead/warranty moves for everyone, plus (owner-only, since the
// server only includes it for that role) every time the project manager
// opens the app. Fetches fresh each time the dashboard mounts (switching
// views unmounts it, so no separate polling is needed).
function ActivityFeed({ role }) {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .listActivityFeed()
      .then(setEntries)
      .catch(() => setErr("Couldn't load recent activity"));
  }, []);

  const actorLabel = (entryRole) => {
    if (entryRole === role) return "You";
    return entryRole === "owner" ? "The owner" : "Project manager";
  };

  return (
    <div style={{ ...statCard, marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Activity size={15} color={COLORS.muted} />
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: COLORS.ink }}>
          Recent activity
        </div>
      </div>

      {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>{err}</div>}

      {entries === null ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginTop: 8 }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginTop: 8 }}>
          Lead and warranty moves will show up here as they happen.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {entries.map((e) =>
            e.kind === "access" ? (
              <div key={e.id} style={{ padding: "9px 0", borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink }}>
                  Project manager opened the app
                </div>
                <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: "#8A8478" }}>
                  {fmtRelativeTime(e.createdAt)}
                </div>
              </div>
            ) : (
              <div key={e.id} style={{ padding: "9px 0", borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink }}>
                  <strong>{e.entityName}</strong> {e.type === "warranty" ? "(warranty) " : ""}moved
                  {e.fromStage ? ` ${stageLabel(e.type, e.fromStage)} →` : ""} {stageLabel(e.type, e.toStage)}
                </div>
                <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: "#8A8478" }}>
                  {actorLabel(e.role)} · {fmtRelativeTime(e.createdAt)}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// live progress bar comparing this month's actual won revenue against the
// monthly revenue needed to hit the take-home goal — "actual" is whatever's
// already won this calendar month (stats.wonMonth), so this updates on its
// own as the board changes, no separate tracking needed
function GoalProgressMeter({ goal, actual }) {
  const pct = goal > 0 ? (actual / goal) * 100 : 0;
  const hit = pct >= 100;
  const barColor = hit ? COLORS.accent : COLORS.progress;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>This month so far</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: hit ? COLORS.accent : COLORS.ink }}>
          {fmtCurrency(actual)} <span style={{ fontWeight: 400, color: COLORS.muted }}>of {fmtCurrency(goal)}</span>
        </span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: COLORS.surfaceMuted, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: barColor,
            borderRadius: 5,
            transition: "width 400ms ease-out",
          }}
        />
      </div>
      <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 5 }}>
        {hit
          ? `Goal hit — ${Math.round(pct)}% of this month's target${pct > 100 ? `, ${fmtCurrency(actual - goal)} over` : ""}`
          : `${Math.round(pct)}% of the way there — ${fmtCurrency(Math.max(0, goal - actual))} to go`}
      </div>
    </div>
  );
}

// the meter + breakdown tiles, shared by the editing form's live preview and
// the Goals page's read-only status view
function GoalPlanSummary({ plan, wonThisMonth, takeHomeNum }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginBottom: 10 }}>
        To take home {fmtCurrency(takeHomeNum)}/month ({fmtCurrency(takeHomeNum * 12)}/year) at these rates:
      </div>

      <GoalProgressMeter goal={plan.requiredRevenuePerMonth} actual={wonThisMonth} />

      <div style={{ ...metricsGrid, marginTop: 14 }}>
        <div style={metricTile}>
          <div style={metricLabel}>Won revenue needed</div>
          <div style={metricValue}>{fmtCurrency(plan.requiredRevenuePerMonth)}</div>
          <div style={metricSub}>per month{plan.annualOverhead > 0 ? ` (incl. overhead)` : ""}</div>
        </div>
        <div style={metricTile}>
          <div style={metricLabel}>Jobs needed</div>
          <div style={metricValue}>{Math.ceil(plan.jobsPerYear)}</div>
          <div style={metricSub}>per year (~{Math.ceil(plan.jobsPerMonth)}/month)</div>
        </div>
        <div style={metricTile}>
          <div style={metricLabel}>Leads / month</div>
          <div style={metricValue}>{Math.ceil(plan.leadsPerMonth)}</div>
          <div style={metricSub}>{Math.ceil(plan.leadsPerYear)}/year</div>
        </div>
        <div style={metricTile}>
          <div style={metricLabel}>Leads / week</div>
          <div style={metricValue}>{plan.leadsPerWeek.toFixed(1)}</div>
          <div style={metricSub}>plan for {Math.ceil(plan.leadsPerWeek)}</div>
        </div>
      </div>
    </div>
  );
}

// wraps the editable inputs; used both for first-time setup (no onCancel)
// and for revising an existing goal from the Goals page (onCancel provided)
function IncomeGoalEditor({ settings, onSaveSettings, myMetrics, wonThisMonth, onSaved, onCancel }) {
  const [takeHomeDraft, setTakeHomeDraft] = useState(settings.goalMonthlyTakeHome ? String(settings.goalMonthlyTakeHome) : "");
  const [overheadDraft, setOverheadDraft] = useState(settings.goalMonthlyOverhead ? String(settings.goalMonthlyOverhead) : "");
  const [winRateDraft, setWinRateDraft] = useState(String(settings.goalNationalWinRate));
  const [avgJobDraft, setAvgJobDraft] = useState(String(settings.goalNationalAvgJobValue));
  const [marginDraft, setMarginDraft] = useState(String(settings.goalNationalProfitMargin));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const source = settings.goalDataSource;

  const switchSource = async (next) => {
    if (next === source) return;
    try {
      await onSaveSettings({ goalDataSource: next });
    } catch {
      // best-effort — a failed preference switch just doesn't stick, not
      // worth an error banner over
    }
  };

  const takeHomeNum = parseFloat(takeHomeDraft);
  const canSubmit = takeHomeDraft.trim() !== "" && !isNaN(takeHomeNum) && takeHomeNum >= 0;
  const overheadNum = overheadDraft.trim() === "" ? 0 : parseFloat(overheadDraft);

  const submit = async () => {
    if (isNaN(takeHomeNum) || takeHomeNum < 0) {
      setErr("Enter a non-negative take-home amount");
      return;
    }
    if (isNaN(overheadNum) || overheadNum < 0) {
      setErr("Enter a non-negative overhead amount");
      return;
    }
    const patch = { goalMonthlyTakeHome: takeHomeNum, goalMonthlyOverhead: overheadNum };
    if (source === "national") {
      const winRate = parseFloat(winRateDraft);
      const avgJob = parseFloat(avgJobDraft);
      const margin = parseFloat(marginDraft);
      if (isNaN(winRate) || winRate <= 0 || winRate > 100) return setErr("Win rate must be between 0 and 100");
      if (isNaN(avgJob) || avgJob <= 0) return setErr("Average job value must be greater than 0");
      if (isNaN(margin) || margin <= 0 || margin > 100) return setErr("Profit margin must be between 0 and 100");
      patch.goalNationalWinRate = winRate;
      patch.goalNationalAvgJobValue = avgJob;
      patch.goalNationalProfitMargin = margin;
    }
    setBusy(true);
    setErr("");
    try {
      await onSaveSettings(patch);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onSaved?.();
      }, 700);
    } catch (e) {
      setErr(e.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const missing = [];
  if (source === "mine") {
    if (!myMetrics.closeRateSample) missing.push("win rate");
    if (!myMetrics.avgWonRevenueSample) missing.push("average job value");
    if (!myMetrics.avgProfitMarginSample) missing.push("profit margin");
  }

  const inputs =
    source === "national"
      ? { winRatePercent: parseFloat(winRateDraft), avgJobValue: parseFloat(avgJobDraft), profitMarginPercent: parseFloat(marginDraft) }
      : {
          winRatePercent: myMetrics.closeRate != null ? myMetrics.closeRate * 100 : null,
          avgJobValue: myMetrics.avgWonRevenue,
          profitMarginPercent: myMetrics.avgProfitMargin,
        };

  const plan =
    !missing.length && canSubmit && takeHomeNum > 0 && !isNaN(overheadNum) && overheadNum >= 0
      ? computeGoalPlan({ annualTakeHome: takeHomeNum * 12, monthlyOverhead: overheadNum, ...inputs })
      : null;

  return (
    <div style={lookbackPanel}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 14 }}>
        Set the monthly take-home you want, and this works backward to how many leads it takes to get there.
      </div>

      <label style={{ ...modalLabel, marginTop: 0 }}>Desired take-home (per month)</label>
      <input
        type="number"
        inputMode="decimal"
        value={takeHomeDraft}
        onChange={(e) => setTakeHomeDraft(e.target.value)}
        placeholder="e.g. 10000"
        style={modalInput}
      />

      <label style={modalLabel}>Business overhead (per month)</label>
      <input
        type="number"
        inputMode="decimal"
        value={overheadDraft}
        onChange={(e) => setOverheadDraft(e.target.value)}
        placeholder="e.g. 7000"
        style={modalInput}
      />
      <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 4 }}>
        Bills, payroll for staff like a project manager, and other fixed costs — not counting your own take-home.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, marginBottom: 12 }}>
        <button
          onClick={() => switchSource("national")}
          style={{ ...lookbackPresetBtn, ...(source === "national" ? lookbackPresetBtnActive : {}), flex: 1, justifyContent: "center" }}
        >
          National averages
        </button>
        <button
          onClick={() => switchSource("mine")}
          style={{ ...lookbackPresetBtn, ...(source === "mine" ? lookbackPresetBtnActive : {}), flex: 1, justifyContent: "center" }}
        >
          My averages
        </button>
      </div>

      {source === "national" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ ...modalLabel, marginTop: 0 }}>Win rate (%)</label>
            <input type="number" inputMode="decimal" value={winRateDraft} onChange={(e) => setWinRateDraft(e.target.value)} style={modalInput} />
          </div>
          <div>
            <label style={{ ...modalLabel, marginTop: 0 }}>Average job value ($)</label>
            <input type="number" inputMode="decimal" value={avgJobDraft} onChange={(e) => setAvgJobDraft(e.target.value)} style={modalInput} />
          </div>
          <div>
            <label style={{ ...modalLabel, marginTop: 0 }}>Profit margin per job (%)</label>
            <input type="number" inputMode="decimal" value={marginDraft} onChange={(e) => setMarginDraft(e.target.value)} style={modalInput} />
            <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 4 }}>
              What's left from a typical job after materials, labor, and day-to-day job costs — not your monthly
              overhead above, that's already handled separately.
            </div>
          </div>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted }}>
            Based on published industry benchmarks — ~25% average close rate for renovation contractors, ~$9,500
            national average roofing job as a stand-in job value, ~24% average gross profit margin for construction
            businesses (remodeling/specialty trades often run higher — 30–40%+). Edit these to fit your trade and
            region.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: COLORS.ink }}>
            Win rate:{" "}
            {myMetrics.closeRateSample
              ? `${Math.round(myMetrics.closeRate * 100)}% (${myMetrics.closeRateWon} won / ${myMetrics.closeRateSample} decided)`
              : "not enough data yet"}
          </div>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: COLORS.ink }}>
            Average job value:{" "}
            {myMetrics.avgWonRevenueSample ? `${fmtCurrency(myMetrics.avgWonRevenue)} (${myMetrics.avgWonRevenueSample} won jobs)` : "not enough data yet"}
          </div>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: COLORS.ink }}>
            Profit margin per job:{" "}
            {myMetrics.avgProfitMarginSample
              ? `${myMetrics.avgProfitMargin.toFixed(0)}% (${myMetrics.avgProfitMarginSample} jobs with cost data)`
              : "not enough data yet"}
          </div>
        </div>
      )}

      {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 10 }}>{err}</div>}
      {saved && <div style={{ color: COLORS.accent, fontFamily: FONT_BODY, fontSize: 13, marginTop: 10 }}>Saved.</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={submit}
          disabled={busy || !canSubmit}
          style={{ ...addBtn, flex: 1, justifyContent: "center", opacity: busy || !canSubmit ? 0.6 : 1 }}
        >
          Save
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            style={{ ...roleOption, flex: 1, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
          >
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Cancel</span>
          </button>
        )}
      </div>

      {missing.length > 0 && (
        <div style={{ marginTop: 14, fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
          Not enough of your own data yet for {missing.join(", ")} — switch to National averages, or add revenue and cost
          details to more won jobs' final reports.
        </div>
      )}

      {plan && <GoalPlanSummary plan={plan} wonThisMonth={wonThisMonth} takeHomeNum={takeHomeNum} />}
    </div>
  );
}

// wraps the editor: shows a read-only status view (live meter + breakdown)
// by default once a goal exists — the main thing to see at a glance — and
// only reveals the adjustable inputs when "Edit goal" is tapped
function GoalsView({ settings, onSaveSettings, myMetrics, wonThisMonth }) {
  const { plan, missing, takeHomeNum } = computeGoalPlanFromSettings(settings, myMetrics);
  const hasGoal = takeHomeNum > 0;
  const [editing, setEditing] = useState(!hasGoal);

  return (
    <div style={{ padding: 16 }}>
      {hasGoal && !editing ? (
        <div style={lookbackPanel}>
          {plan ? (
            <GoalPlanSummary plan={plan} wonThisMonth={wonThisMonth} takeHomeNum={takeHomeNum} />
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
              Not enough of your own data yet for {missing.join(", ")} — switch to National averages, or add revenue
              and cost details to more won jobs' final reports.
            </div>
          )}
          <button
            onClick={() => setEditing(true)}
            style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 18 }}
          >
            Edit goal
          </button>
        </div>
      ) : (
        <IncomeGoalEditor
          settings={settings}
          onSaveSettings={onSaveSettings}
          myMetrics={myMetrics}
          wonThisMonth={wonThisMonth}
          onSaved={() => setEditing(false)}
          onCancel={hasGoal ? () => setEditing(false) : null}
        />
      )}
    </div>
  );
}

// self-contained: owns its own source filter + drill-down modal state, so it
// only needs the raw leads/overhead inputs to compute from
function MetricsView({ leads, overheadPercent }) {
  const [metricsSource, setMetricsSource] = useState("all");
  const [metricInfo, setMetricInfo] = useState(null); // METRIC_INFO entry | null

  const metrics = useMemo(() => {
    const group = METRIC_SOURCE_GROUPS.find((g) => g.key === metricsSource) || METRIC_SOURCE_GROUPS[0];
    return computeMetrics((leads || []).filter(group.match), overheadPercent);
  }, [leads, metricsSource, overheadPercent]);

  return (
    <div style={{ padding: 16 }}>
      <div style={lookbackPanel}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {METRIC_SOURCE_GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setMetricsSource(g.key)}
              style={{
                ...lookbackPresetBtn,
                ...(metricsSource === g.key ? lookbackPresetBtnActive : {}),
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginBottom: 12 }}>
          Based on {metrics.totalLeads} lead{metrics.totalLeads === 1 ? "" : "s"}
        </div>
        <div style={metricsGrid}>
          {METRIC_INFO.map((info) => (
            <button key={info.key} onClick={() => setMetricInfo(info)} style={{ ...metricTile, ...metricTileBtn }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <div style={metricLabel}>{info.label}</div>
                <Info size={13} color={COLORS.muted} />
              </div>
              <div style={metricValue}>{info.value(metrics)}</div>
              <div style={metricSub}>{info.sub(metrics)}</div>
            </button>
          ))}
        </div>
      </div>

      {metricInfo && (
        <div style={modalOverlay} onClick={() => setMetricInfo(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
                {metricInfo.label}
              </div>
              <button onClick={() => setMetricInfo(null)} style={iconBtnGhost} aria-label="Close">
                <X size={18} color={COLORS.muted} />
              </button>
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: COLORS.ink }}>
              {metricInfo.value(metrics)}
            </div>
            <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginTop: 2, marginBottom: 14 }}>
              {metricInfo.sub(metrics)}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.ink, lineHeight: 1.5, marginBottom: metricInfo.chart ? 18 : 0 }}>
              {metricInfo.description}
            </div>
            {metricInfo.chart && metricInfo.chart(metrics)}
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardTile({ onClick, icon, title, children, accent, big }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...statCard,
        ...statCardBtn,
        display: "block",
        width: "100%",
        borderLeft: `4px solid ${accent || COLORS.accent}`,
        padding: big ? "18px" : "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {icon}
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: big ? 15 : 13.5, color: COLORS.ink }}>
          {title}
        </span>
      </div>
      {children}
    </button>
  );
}

// the home screen — leads with "how am I doing on my goals" as the headline
// tile, with Job Board / Warranty / Appointments as quick-glance tiles below
// that tap through to their full views
function DashboardView({
  editable,
  role,
  settings,
  stats,
  counts,
  openWarrantyCount,
  upcomingAppointment,
  myMetrics,
  onOpenGoals,
  onOpenMetrics,
  onOpenBoard,
  onOpenWarranty,
  onOpenCalendar,
  onOpenLead,
}) {
  const { plan, takeHomeNum } = computeGoalPlanFromSettings(settings, myMetrics);
  const hasGoal = takeHomeNum > 0;
  const pct = plan && plan.requiredRevenuePerMonth > 0 ? (stats.wonMonth / plan.requiredRevenuePerMonth) * 100 : 0;
  const activeLeadsCount = STAGES.reduce((sum, s) => sum + (counts[s.key] || 0), 0);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {editable && (
        <DashboardTile onClick={onOpenGoals} icon={<Target size={16} color={COLORS.accent} />} title="Goals" big>
          {hasGoal && plan ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, flexWrap: "wrap", gap: 4 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: COLORS.ink }}>
                  {fmtCurrency(stats.wonMonth)}
                </span>
                <span style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>
                  of {fmtCurrency(plan.requiredRevenuePerMonth)} this month
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: COLORS.surfaceMuted,
                  border: `1px solid ${COLORS.border}`,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, pct))}%`,
                    background: pct >= 100 ? COLORS.accent : COLORS.progress,
                    borderRadius: 4,
                  }}
                />
              </div>
              <div style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.muted, marginTop: 6 }}>
                {pct >= 100 ? "Goal hit for this month — tap to see the full breakdown" : `${Math.round(pct)}% of the way there — tap for details`}
              </div>
            </>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
              Set a monthly take-home target to see your progress here.
            </div>
          )}
        </DashboardTile>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DashboardTile onClick={onOpenBoard} icon={<Grid size={15} color={COLORS.info} />} title="Job Board" accent={COLORS.info}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: COLORS.ink }}>
            {activeLeadsCount}
            <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 13, color: COLORS.muted }}> active</span>
          </div>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
            {counts.new || 0} new · {counts.won || 0} won · {counts.progress || 0} in progress
          </div>
        </DashboardTile>

        <DashboardTile onClick={onOpenMetrics} icon={<TrendingUp size={15} color={COLORS.accent} />} title="Metrics" accent={COLORS.accent}>
          {myMetrics.closeRateSample ? (
            <>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: COLORS.ink }}>
                {Math.round(myMetrics.closeRate * 100)}%
              </div>
              <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
                close rate — tap for full breakdown
              </div>
            </>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>Not enough data yet</div>
          )}
        </DashboardTile>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DashboardTile onClick={onOpenWarranty} icon={<Wrench size={15} color={COLORS.rust} />} title="Warranty" accent={COLORS.rust}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 22,
              color: openWarrantyCount > 0 ? COLORS.rust : COLORS.ink,
            }}
          >
            {openWarrantyCount}
          </div>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
            {openWarrantyCount === 0
              ? "All clear"
              : `unresolved request${openWarrantyCount === 1 ? "" : "s"}`}
          </div>
        </DashboardTile>

        <DashboardTile
          onClick={() => (upcomingAppointment ? onOpenLead(upcomingAppointment.id) : onOpenBoard())}
          icon={<Calendar size={15} color={COLORS.amber} />}
          title="Next Appointment"
          accent={COLORS.amber}
        >
          {upcomingAppointment ? (
            <>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.ink }}>
                {upcomingAppointment.name}
              </div>
              <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
                {fmtDateTime(upcomingAppointment.appointmentAt)}
              </div>
            </>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>None scheduled</div>
          )}
        </DashboardTile>
      </div>

      <DashboardTile
        onClick={onOpenCalendar}
        icon={<Calendar size={16} color={COLORS.progress} />}
        title="Job Calendar"
        accent={COLORS.progress}
        big
      >
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted }}>
          {(counts.won || 0) + (counts.progress || 0) > 0
            ? `${counts.won || 0} won, ${counts.progress || 0} in progress — tap to see the schedule`
            : "See every won job laid out on a calendar, sized by projected build time"}
        </div>
      </DashboardTile>

      <ActivityFeed role={role} />
    </div>
  );
}

// job schedule as a month calendar — one horizontal bar per won job,
// spanning startDate through either its actual completion date or (while
// still scheduled/in progress) a build-pace-projected end date. Visible to
// both roles, same as the leads data it's drawn from.
function CalendarView({ leads, allMetrics, onOpenLead }) {
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  });

  const toKey = (d) => d.toISOString().slice(0, 10);
  const monthStartKey = toKey(monthStart);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    monthStart
  );

  const monthEnd = useMemo(() => {
    const d = new Date(monthStart);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return d;
  }, [monthStart]);
  const monthEndKey = toKey(monthEnd);

  const gridStart = useMemo(() => {
    const d = new Date(monthStart);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
  }, [monthStart]);
  const gridEnd = useMemo(() => {
    const d = new Date(monthEnd);
    d.setUTCDate(d.getUTCDate() + (6 - d.getUTCDay()));
    return d;
  }, [monthEnd]);
  const gridEndKey = toKey(gridEnd);

  const weeks = useMemo(() => {
    const out = [];
    const cur = new Date(gridStart);
    while (toKey(cur) <= gridEndKey) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        days.push(toKey(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      out.push(days);
    }
    return out;
  }, [gridStart, gridEndKey]);

  // one lane number per job, assigned greedily across the whole visible grid
  // (not per-week) so a multi-week job sits in the same row the whole way
  // across instead of jumping lanes each time the calendar wraps a line
  const jobList = useMemo(() => {
    const gridStartKey = toKey(gridStart);
    const spans = (leads || [])
      .filter((l) => l.startDate && CALENDAR_STAGES.has(l.stage))
      .map((l) => {
        const span = projectedJobSpan(l, allMetrics);
        return span ? { lead: l, ...span } : null;
      })
      .filter((j) => j && j.start <= gridEndKey && j.end >= gridStartKey)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    const laneEnds = [];
    for (const job of spans) {
      let lane = laneEnds.findIndex((end) => end < job.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(job.end);
      } else {
        laneEnds[lane] = job.end;
      }
      job.lane = lane;
      // colored by lane, not by lead id — guarantees jobs stacked next to
      // each other (the only case that actually needs to be distinct) get
      // maximally separated colors instead of a hash-collision gamble
      const { bg, text } = laneColor(lane);
      job.color = bg;
      job.textColor = text;
    }
    return spans;
  }, [leads, allMetrics, gridStart, gridEndKey]);

  const BAR_H = 20;
  const BAR_GAP = 4;
  const DAY_LABEL_H = 22;
  const ROW_PAD = 6;
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div style={cardsWrap}>
      <div style={stageHeadRow}>
        <button
          onClick={() =>
            setMonthStart((d) => {
              const n = new Date(d);
              n.setUTCMonth(n.getUTCMonth() - 1);
              return n;
            })
          }
          style={navArrow}
          aria-label="Previous month"
        >
          <ChevronLeft size={18} color={COLORS.ink} />
        </button>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 16, textAlign: "center", flex: 1 }}>
          {monthLabel}
        </div>
        <button
          onClick={() =>
            setMonthStart((d) => {
              const n = new Date(d);
              n.setUTCMonth(n.getUTCMonth() + 1);
              return n;
            })
          }
          style={navArrow}
          aria-label="Next month"
        >
          <ChevronRight size={18} color={COLORS.ink} />
        </button>
      </div>

      <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted }}>
        One bar per won job, a different color for each — solid once it's actually in progress or done, softer while
        it's just scheduled and the length is a build-pace estimate. Tap a bar to open that lead.
      </div>

      {jobList.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}>
            Nothing scheduled this month
          </div>
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
            Set a start date on a won job and it'll show up here.
          </div>
        </div>
      )}

      <div style={{ ...ticket, flexDirection: "column", padding: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${COLORS.border}` }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={{ fontFamily: FONT_UTIL, fontSize: 11, color: COLORS.muted, textAlign: "center", padding: "6px 0" }}>
              {d}
            </div>
          ))}
        </div>

        {weeks.map((days, wi) => {
          const weekStart = days[0];
          const weekEnd = days[6];
          const rowJobs = jobList.filter((j) => j.start <= weekEnd && j.end >= weekStart);
          const laneCount = rowJobs.length ? Math.max(...rowJobs.map((j) => j.lane)) + 1 : 0;
          const rowHeight = DAY_LABEL_H + laneCount * (BAR_H + BAR_GAP) + ROW_PAD;

          return (
            <div
              key={weekStart}
              style={{
                position: "relative",
                borderBottom: wi < weeks.length - 1 ? `1px solid ${COLORS.border}` : "none",
                height: rowHeight,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                {days.map((dayKey) => {
                  const inMonth = dayKey >= monthStartKey && dayKey <= monthEndKey;
                  const dayNum = Number(dayKey.slice(8, 10));
                  return (
                    <div key={dayKey} style={{ borderRight: `1px solid ${COLORS.border}`, height: DAY_LABEL_H, padding: "4px 0 0 4px" }}>
                      <span style={{ fontFamily: FONT_UTIL, fontSize: 11, color: inMonth ? COLORS.muted : "#C9C4B6" }}>{dayNum}</span>
                    </div>
                  );
                })}
              </div>

              {rowJobs.map((job) => {
                const clippedStart = job.start >= weekStart ? job.start : weekStart;
                const clippedEnd = job.end <= weekEnd ? job.end : weekEnd;
                const startCol = days.indexOf(clippedStart);
                const endCol = days.indexOf(clippedEnd);
                const left = (startCol / 7) * 100;
                const width = ((endCol - startCol + 1) / 7) * 100;
                return (
                  <button
                    key={`${job.lead.id}-${weekStart}`}
                    onClick={() => onOpenLead(job.lead.id)}
                    title={`${job.lead.name}${job.lead.job ? " — " + job.lead.job : ""} · ${fmtDate(job.start)}–${fmtDate(
                      job.end
                    )}${job.projected ? " (projected)" : ""}`}
                    style={{
                      position: "absolute",
                      left: `calc(${left}% + 3px)`,
                      width: `calc(${width}% - 6px)`,
                      top: DAY_LABEL_H + job.lane * (BAR_H + BAR_GAP),
                      height: BAR_H,
                      background: job.color,
                      opacity: job.projected ? 0.55 : 1,
                      border: job.projected ? `1.5px dashed ${job.color}` : "none",
                      borderRadius: 5,
                      color: job.textColor,
                      fontFamily: FONT_UTIL,
                      fontSize: 11,
                      fontWeight: 600,
                      textAlign: "left",
                      padding: "0 6px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    {job.lead.name}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// small pill switch used for the popup on/off toggles below
function ToggleSwitch({ on, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={label}
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        border: "none",
        background: on ? COLORS.accent : "#D8D2C2",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: 9,
          background: "#fff",
          transition: "left 0.15s ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      />
    </button>
  );
}

const POPUP_TOGGLES = [
  {
    key: "popupPushEnabled",
    label: "Enable notifications prompt",
    description: "Asks a device to turn on push notifications, once ever per device.",
  },
  {
    key: "popupGoalEnabled",
    label: "Monthly income goal prompt",
    description: "Asks the owner to set a take-home goal at the start of each month.",
  },
  {
    key: "popupWarrantyEnabled",
    label: "Open warranty requests alert",
    description: "Reminds anyone who opens the app about unresolved warranty requests.",
  },
  {
    key: "popupMissingInfoEnabled",
    label: "Missing customer info alert",
    description: "Reminds the owner about leads missing a phone, email, or address.",
  },
];

function SettingsModal({ settings, onSave, onClose, onOpenBackups }) {
  useModalBackClose(onClose);
  const [draft, setDraft] = useState(String(settings.overheadPercent));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [popupErr, setPopupErr] = useState("");
  const [togglingKey, setTogglingKey] = useState(null);

  const togglePopup = async (key, value) => {
    setTogglingKey(key);
    setPopupErr("");
    try {
      await onSave({ [key]: value });
    } catch (e) {
      setPopupErr(e.message || "Couldn't save that");
    } finally {
      setTogglingKey(null);
    }
  };

  const feedUrl = settings.calendarFeedToken
    ? `${window.location.protocol}//${window.location.host}/api/calendar/feed/${settings.calendarFeedToken}.ics`
    : "";
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://");

  const copyFeedLink = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard API can be unavailable (e.g. non-HTTPS) — the link is
      // still selectable/copyable by hand from the input below
    }
  };

  const submit = async () => {
    const n = parseFloat(draft);
    if (isNaN(n) || n < 0) {
      setErr("Enter a non-negative number");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSave({ overheadPercent: n });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e.message || "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>Settings</div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          Used to calculate overhead cost on a job's final report, as a percentage of that job's revenue.
        </div>

        <label style={modalLabel}>Overhead (% of revenue)</label>
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={modalInput}
          placeholder="13"
        />
        {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>{err}</div>}
        {saved && (
          <div style={{ color: COLORS.accent, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>Saved.</div>
        )}
        <button
          onClick={submit}
          disabled={busy}
          style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 12, opacity: busy ? 0.6 : 1 }}
        >
          Save
        </button>

        {feedUrl && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.ink, marginBottom: 4 }}>
              Sales appointments calendar
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 10 }}>
              Subscribe once from your iPhone or Mac (Settings/Calendar → Add Account → Other → Add Subscribed
              Calendar) and every appointment set in the app will show up automatically, kept in sync in the
              background.
            </div>
            <a
              href={webcalUrl}
              style={{
                ...addBtn,
                width: "100%",
                justifyContent: "center",
                textDecoration: "none",
                boxSizing: "border-box",
              }}
            >
              Subscribe in Apple Calendar
            </a>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input readOnly value={feedUrl} style={{ ...modalInput, flex: 1, fontSize: 12 }} onClick={(e) => e.target.select()} />
              <button
                onClick={copyFeedLink}
                style={{ ...iconBtn, background: COLORS.accent, flexShrink: 0 }}
                aria-label="Copy calendar link"
              >
                <Check size={18} color="#fff" />
              </button>
            </div>
            {linkCopied && (
              <div style={{ color: COLORS.accent, fontFamily: FONT_BODY, fontSize: 12.5, marginTop: 6 }}>
                Link copied.
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.ink, marginBottom: 2 }}>
            Popups
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>
            Turn off any of these auto-popups. Applies to everyone using the app.
          </div>
          {POPUP_TOGGLES.map(({ key, label, description }) => (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 0",
                borderBottom: `1px solid ${COLORS.border}`,
                opacity: togglingKey === key ? 0.6 : 1,
              }}
            >
              <div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>{label}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                  {description}
                </div>
              </div>
              <ToggleSwitch
                on={settings[key] !== false}
                onChange={(next) => togglePopup(key, next)}
                label={label}
              />
            </div>
          ))}
          {popupErr && (
            <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>{popupErr}</div>
          )}
        </div>

        <button
          onClick={onOpenBackups}
          style={{
            ...roleOption,
            marginTop: 20,
            justifyContent: "center",
            borderColor: COLORS.border,
            cursor: "pointer",
          }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>
            Manage backups
          </span>
        </button>
      </div>
    </div>
  );
}

function BackupsModal({ onClose, onRestored }) {
  useModalBackClose(onClose);
  const [backups, setBackups] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .listBackups()
      .then((data) => setBackups(data.backups))
      .catch((e) => setLoadErr(e.message || "Couldn't load backups"));
  }, []);

  const grouped = useMemo(() => {
    const map = {};
    for (const b of backups || []) {
      (map[b.tier] = map[b.tier] || []).push(b);
    }
    return map;
  }, [backups]);

  const doRestore = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    setErr("");
    try {
      await api.restoreBackup(confirmTarget.filename);
      onRestored();
    } catch (e) {
      setErr(e.message || "Restore failed");
      setBusy(false);
    }
  };

  if (confirmTarget) {
    return (
      <div style={modalOverlay} onClick={busy ? undefined : () => setConfirmTarget(null)}>
        <div style={modalCard} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
              Restore this backup?
            </div>
            {!busy && (
              <button onClick={() => setConfirmTarget(null)} style={iconBtnGhost} aria-label="Cancel">
                <X size={18} color={COLORS.muted} />
              </button>
            )}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.ink, marginBottom: 12 }}>
            This replaces <strong>all current leads</strong> — names, stages, revenue, reports, everything — with
            the snapshot from <strong>{fmtBackupDate(confirmTarget.takenAt)}</strong> (
            {fmtRelativeTime(confirmTarget.takenAt)})
            {confirmTarget.leadCount != null ? `, ${confirmTarget.leadCount} leads` : ""}.
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
            Your current data is safety-backed-up first, so this can be undone by restoring again afterward.
          </div>
          {err && (
            <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 12 }}>{err}</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setConfirmTarget(null)}
              disabled={busy}
              style={{ ...roleOption, flex: 1, justifyContent: "center", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
            >
              <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Cancel</span>
            </button>
            <button
              onClick={doRestore}
              disabled={busy}
              style={{ ...addBtn, flex: 1, justifyContent: "center", background: COLORS.rust, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Restoring…" : "Yes, restore"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>Backups</div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          Snapshots of your leads, taken automatically. Restoring replaces all current leads with the chosen
          snapshot.
        </div>

        {loadErr && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13 }}>{loadErr}</div>}
        {!loadErr && backups === null && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>Loading…</div>
        )}
        {!loadErr && backups && backups.length === 0 && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
            No backups yet — the first one is taken within a few minutes of the app starting.
          </div>
        )}

        {BACKUP_TIERS.map(
          (tier) =>
            grouped[tier.key] &&
            grouped[tier.key].length > 0 && (
              <div key={tier.key} style={{ marginBottom: 16 }}>
                <div style={reportSectionLabel}>{tier.label}</div>
                {grouped[tier.key].map((b) => (
                  <div key={b.filename} style={backupRow}>
                    <div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink, fontWeight: 600 }}>
                        {fmtRelativeTime(b.takenAt)}
                      </div>
                      <div style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.muted }}>
                        {fmtBackupDate(b.takenAt)}
                        {b.leadCount != null ? ` · ${b.leadCount} leads` : ""}
                      </div>
                    </div>
                    <button onClick={() => setConfirmTarget(b)} style={backupRestoreBtn}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </div>
  );
}

const WARRANTY_STAGES = [
  { key: "reported", label: "Reported", actionLabel: "Schedule", color: COLORS.rust },
  { key: "scheduled", label: "Scheduled", actionLabel: "Mark resolved", color: COLORS.amber },
  { key: "resolved", label: "Resolved", actionLabel: null, color: COLORS.accent },
];

function WarrantyView({
  requests,
  editable,
  canMove,
  onMove,
  onEditField,
  onDelete,
  onAdd,
  onUploadPhotos,
  onDeletePhoto,
  onBack,
}) {
  const [activeStage, setActiveStage] = useState("reported");
  const [showAdd, setShowAdd] = useState(false);

  const counts = useMemo(() => {
    const c = { reported: 0, scheduled: 0, resolved: 0 };
    requests.forEach((w) => {
      c[w.stage] = (c[w.stage] || 0) + 1;
    });
    return c;
  }, [requests]);

  const visible = useMemo(() => {
    if (activeStage === "all") {
      return [...requests].sort((a, b) =>
        lastNameOf(a.name).localeCompare(lastNameOf(b.name), undefined, { sensitivity: "base" })
      );
    }
    return requests
      .filter((w) => w.stage === activeStage)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [requests, activeStage]);

  return (
    <>
      <div style={{ padding: "14px 16px 0" }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}
        >
          <button
            onClick={onBack}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            aria-label="Back to dashboard"
          >
            <ChevronLeft size={20} color={COLORS.ink} />
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: COLORS.ink }}>
              Warranty requests
            </span>
          </button>
          {editable && (
            <button
              onClick={() => setShowAdd(true)}
              style={{ ...addBtn, background: COLORS.rust }}
              aria-label="Add warranty request"
            >
              <Plus size={16} strokeWidth={2.5} />
              New request
            </button>
          )}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 10 }}>
          Track a warranty issue from reported to resolved.
        </div>
      </div>

      <div style={tabsRow}>
        {WARRANTY_STAGES.map((s) => {
          const active = s.key === activeStage;
          return (
            <button
              key={s.key}
              onClick={() => setActiveStage(s.key)}
              style={{
                ...tabBtn,
                background: active ? s.color : "transparent",
                color: active ? "#fff" : COLORS.ink,
                borderColor: s.color,
              }}
            >
              {s.label}
              <span
                style={{ ...countPill, background: active ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.06)" }}
              >
                {counts[s.key] || 0}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setActiveStage("all")}
          style={{
            ...tabBtn,
            background: activeStage === "all" ? COLORS.accent : "transparent",
            color: activeStage === "all" ? "#fff" : COLORS.ink,
            borderColor: COLORS.accent,
          }}
        >
          All (A–Z)
          <span style={{ ...countPill, background: activeStage === "all" ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.06)" }}>
            {requests.length}
          </span>
        </button>
      </div>

      <main style={cardsWrap}>
        {visible.length === 0 && (
          <div style={emptyState}>
            <div
              style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}
            >
              Nothing here
            </div>
            <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
              {activeStage === "all"
                ? "Requests you log will show up here, alphabetically by last name."
                : activeStage === "reported"
                ? "Tap “New request” to log a warranty issue."
                : "Requests land here as they move through the process."}
            </div>
          </div>
        )}
        {visible.map((w) => (
          <WarrantyTicket
            key={w.id}
            request={w}
            editable={editable}
            canMove={canMove}
            onMove={onMove}
            onEditField={onEditField}
            onDelete={onDelete}
            onUploadPhotos={onUploadPhotos}
            onDeletePhoto={onDeletePhoto}
          />
        ))}
      </main>

      {showAdd && (
        <AddWarrantyModal
          onAdd={async (payload) => {
            await onAdd(payload);
            setShowAdd(false);
            setActiveStage("reported");
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </>
  );
}

function WarrantyTicket({ request, editable, canMove, onMove, onEditField, onDelete, onUploadPhotos, onDeletePhoto }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(request.name);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(request.phone || "");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(request.email || "");
  const [editingIssue, setEditingIssue] = useState(false);
  const [issueDraft, setIssueDraft] = useState(request.issue || "");
  const [confirmDel, setConfirmDel] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);

  const stageIdx = WARRANTY_STAGES.findIndex((s) => s.key === request.stage);
  const stage = WARRANTY_STAGES[stageIdx];
  const nextStage = WARRANTY_STAGES[stageIdx + 1];

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed) onEditField(request.id, "name", trimmed);
    else setNameDraft(request.name);
    setEditingName(false);
  };
  const savePhone = () => {
    onEditField(request.id, "phone", phoneDraft.trim());
    setEditingPhone(false);
  };
  const saveEmail = () => {
    onEditField(request.id, "email", emailDraft.trim());
    setEditingEmail(false);
  };
  const saveIssue = () => {
    onEditField(request.id, "issue", issueDraft.trim());
    setEditingIssue(false);
  };

  return (
    <div style={ticket}>
      <div style={{ ...ticketStub, background: stage?.color || COLORS.rust }} />
      <div style={{ flex: 1, padding: "16px 18px 16px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          {!editingName ? (
            <div
              onClick={
                editable
                  ? () => {
                      setNameDraft(request.name);
                      setEditingName(true);
                    }
                  : undefined
              }
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 16,
                color: COLORS.ink,
                cursor: editable ? "pointer" : "default",
                flex: 1,
                minWidth: 0,
              }}
            >
              {request.name}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, flex: 1 }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                style={{ ...inlineInput, flex: 1 }}
              />
              <button onClick={saveName} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save name">
                <Check size={18} color="#fff" />
              </button>
              <button
                onClick={() => setEditingName(false)}
                style={{ ...iconBtn, background: "#B8B0A0" }}
                aria-label="Cancel name edit"
              >
                <X size={18} color="#fff" />
              </button>
            </div>
          )}
          {editable && !confirmDel && (
            <button onClick={() => setConfirmDel(true)} style={iconBtnGhost} aria-label="Delete request">
              <Trash2 size={16} color={COLORS.muted} />
            </button>
          )}
        </div>

        {confirmDel && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.rust }}>Delete this request?</span>
            <button
              onClick={() => onDelete(request.id)}
              style={{ ...iconBtn, background: COLORS.rust }}
              aria-label="Confirm delete"
            >
              <Check size={16} color="#fff" />
            </button>
            <button
              onClick={() => setConfirmDel(false)}
              style={{ ...iconBtn, background: "#B8B0A0" }}
              aria-label="Cancel delete"
            >
              <X size={16} color="#fff" />
            </button>
          </div>
        )}

        {/* phone */}
        <div
          onClick={!editingPhone && editable ? () => { setPhoneDraft(request.phone || ""); setEditingPhone(true); } : undefined}
          style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, cursor: !editingPhone && editable ? "pointer" : "default" }}
        >
          {!editingPhone ? (
            request.phone ? (
              <a href={`tel:${request.phone}`} onClick={(e) => e.stopPropagation()} style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: COLORS.accent, fontWeight: 600, textDecoration: "none" }}>
                {request.phone}
              </a>
            ) : (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 14, color: "#B8B0A0" }}>No phone set</span>
            )
          ) : (
            <>
              <input
                autoFocus
                type="tel"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && savePhone()}
                placeholder="e.g. (801) 555-0100"
                style={{ ...inlineInput, flex: 1 }}
              />
              <button onClick={savePhone} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save phone">
                <Check size={18} color="#fff" />
              </button>
              <button onClick={() => setEditingPhone(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel phone edit">
                <X size={18} color="#fff" />
              </button>
            </>
          )}
        </div>

        {/* email */}
        <div
          onClick={!editingEmail && editable ? () => { setEmailDraft(request.email || ""); setEditingEmail(true); } : undefined}
          style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, cursor: !editingEmail && editable ? "pointer" : "default" }}
        >
          {!editingEmail ? (
            request.email ? (
              <a href={`mailto:${request.email}`} onClick={(e) => e.stopPropagation()} style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: COLORS.accent, fontWeight: 600, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                {request.email}
              </a>
            ) : (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 14, color: "#B8B0A0" }}>No email set</span>
            )
          ) : (
            <>
              <input
                autoFocus
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEmail()}
                placeholder="e.g. name@example.com"
                style={{ ...inlineInput, flex: 1 }}
              />
              <button onClick={saveEmail} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save email">
                <Check size={18} color="#fff" />
              </button>
              <button onClick={() => setEditingEmail(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel email edit">
                <X size={18} color="#fff" />
              </button>
            </>
          )}
        </div>

        {/* issue */}
        <div
          onClick={!editingIssue && editable ? () => { setIssueDraft(request.issue || ""); setEditingIssue(true); } : undefined}
          style={{ marginTop: 10, cursor: !editingIssue && editable ? "pointer" : "default" }}
        >
          {!editingIssue ? (
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: request.issue ? COLORS.ink : "#B8B0A0" }}>
              {request.issue || "No issue description — tap to add"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                autoFocus
                value={issueDraft}
                onChange={(e) => setIssueDraft(e.target.value)}
                placeholder="What's the issue?"
                style={{ ...modalTextarea, minHeight: 54 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveIssue} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save issue">
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingIssue(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel issue edit">
                  <X size={18} color="#fff" />
                </button>
              </div>
            </div>
          )}
        </div>

        <WarrantyPhotos
          request={request}
          editable={editable}
          canMove={canMove}
          onUpload={onUploadPhotos}
          onDeletePhoto={onDeletePhoto}
        />

        <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478", marginTop: 10 }}>
          Reported {fmtDateOnly(request.createdAt)}
        </div>

        {canMove && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {stageIdx > 0 && (
              <button
                onClick={() => onMove(request.id, WARRANTY_STAGES[stageIdx - 1].key, true)}
                style={{ ...actionBtn, background: "transparent", color: COLORS.muted, border: `1px solid ${COLORS.border}` }}
              >
                <ChevronLeft size={14} color={COLORS.muted} />
                Move back
              </button>
            )}
            {nextStage && (
              <button
                onClick={() => (nextStage.key === "resolved" ? setShowResolveModal(true) : onMove(request.id, nextStage.key))}
                style={{ ...actionBtn, background: "transparent", color: nextStage.color, border: `1px solid ${nextStage.color}` }}
              >
                {stage.actionLabel}
                <ArrowRight size={14} color={nextStage.color} />
              </button>
            )}
          </div>
        )}
      </div>

      {showResolveModal && (
        <ResolvePhotoModal
          request={request}
          onUploadPhotos={onUploadPhotos}
          onConfirm={async () => {
            await onMove(request.id, "resolved");
            setShowResolveModal(false);
          }}
          onCancel={() => setShowResolveModal(false)}
        />
      )}
    </div>
  );
}

function ResolvePhotoModal({ request, onUploadPhotos, onConfirm, onCancel }) {
  useModalBackClose(onCancel);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");

  const afterPhotos = (request.photos || []).filter((p) => p.type === "after");

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setErr("");
    try {
      await onUploadPhotos(request.id, files, "after");
    } catch (uploadErr) {
      setErr(uploadErr.message || "Couldn't upload that photo");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setConfirming(true);
    await onConfirm();
  };

  return (
    <div style={modalOverlay} onClick={onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink, marginBottom: 8 }}>
          Add a photo of the finished repair
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          At least one after-repair photo is required before this request can be marked resolved.
        </div>

        {afterPhotos.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {afterPhotos.map((p) => (
              <img
                key={p.id}
                src={p.url}
                alt="After-repair photo"
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: `1px solid ${COLORS.border}` }}
              />
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          style={{ display: "none" }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            ...addBtn,
            background: "transparent",
            color: COLORS.accent,
            border: `1px solid ${COLORS.accent}`,
            width: "100%",
            justifyContent: "center",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Camera size={16} color={COLORS.accent} />
          {busy ? "Uploading…" : afterPhotos.length > 0 ? "Add another photo" : "Take or choose a photo"}
        </button>

        {err && <div style={{ marginTop: 10, fontFamily: FONT_BODY, fontSize: 13, color: COLORS.rust }}>{err}</div>}

        <button
          onClick={confirm}
          disabled={afterPhotos.length === 0 || busy || confirming}
          style={{
            ...addBtn,
            width: "100%",
            justifyContent: "center",
            marginTop: 14,
            opacity: afterPhotos.length === 0 || busy || confirming ? 0.5 : 1,
          }}
        >
          {confirming ? "Marking resolved…" : "Mark resolved"}
        </button>
        <button
          onClick={onCancel}
          style={{ ...roleOption, marginTop: 10, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Cancel</span>
        </button>
      </div>
    </div>
  );
}

function WarrantyPhotoGrid({ photos, editable, onDeletePhoto, requestId, onOpen }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {photos.map((p) => (
        <div key={p.id} style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
          <img
            src={p.url}
            onClick={() => onOpen(p.url)}
            alt="Warranty photo"
            style={{
              width: 60,
              height: 60,
              objectFit: "cover",
              borderRadius: 6,
              border: `1px solid ${COLORS.border}`,
              cursor: "pointer",
              display: "block",
            }}
          />
          {editable && (
            <button
              onClick={() => onDeletePhoto(requestId, p.id)}
              aria-label="Delete photo"
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: COLORS.rust,
                border: "2px solid #fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={11} color="#fff" strokeWidth={3} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function WarrantyPhotos({ request, editable, canMove, onUpload, onDeletePhoto }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lightbox, setLightbox] = useState(null);

  const photos = request.photos || [];
  if (!photos.length && !canMove) return null;

  const afterPhotos = photos.filter((p) => p.type === "after");
  const beforePhotos = photos.filter((p) => p.type !== "after");
  const showSplit = afterPhotos.length > 0 && beforePhotos.length > 0;

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setErr("");
    try {
      await onUpload(request.id, files);
    } catch (uploadErr) {
      setErr(uploadErr.message || "Couldn't upload those photos");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      {photos.length > 0 && showSplit && (
        <>
          <div style={photoSectionLabel}>Before</div>
          <WarrantyPhotoGrid
            photos={beforePhotos}
            editable={editable}
            onDeletePhoto={onDeletePhoto}
            requestId={request.id}
            onOpen={setLightbox}
          />
          <div style={{ ...photoSectionLabel, marginTop: 10 }}>After</div>
          <WarrantyPhotoGrid
            photos={afterPhotos}
            editable={editable}
            onDeletePhoto={onDeletePhoto}
            requestId={request.id}
            onOpen={setLightbox}
          />
        </>
      )}
      {photos.length > 0 && !showSplit && (
        <WarrantyPhotoGrid
          photos={photos}
          editable={editable}
          onDeletePhoto={onDeletePhoto}
          requestId={request.id}
          onOpen={setLightbox}
        />
      )}

      {canMove && (
        <div style={{ marginTop: photos.length > 0 ? 8 : 0 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
            style={{ display: "none" }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{
              ...actionBtn,
              background: "transparent",
              color: COLORS.muted,
              border: `1px solid ${COLORS.border}`,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Camera size={14} color={COLORS.muted} />
            {busy ? "Uploading…" : "Add photo"}
          </button>
          {err && (
            <div style={{ marginTop: 6, fontFamily: FONT_BODY, fontSize: 12.5, color: COLORS.rust }}>{err}</div>
          )}
        </div>
      )}

      {lightbox && (
        <div style={modalOverlay} onClick={() => setLightbox(null)}>
          <img
            src={lightbox}
            alt="Warranty photo full size"
            style={{ maxWidth: "92vw", maxHeight: "80vh", borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function AddWarrantyModal({ onAdd, onClose }) {
  useModalBackClose(onClose);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const canSubmit = name.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      await onAdd({ name: name.trim(), phone: phone.trim(), email: email.trim(), issue: issue.trim() });
    } catch (e) {
      setErr(e.message || "Couldn't add that request");
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
            New warranty request
          </div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <label style={modalLabel}>Customer name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Nguyen"
          style={modalInput}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
        />
        <label style={modalLabel}>Phone</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. (801) 555-0100"
          style={modalInput}
        />
        <label style={modalLabel}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. name@example.com"
          style={modalInput}
        />
        <label style={modalLabel}>What's the issue?</label>
        <textarea
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="e.g. Water stain under the north gutter seam"
          style={modalTextarea}
        />
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginTop: 8, marginBottom: 18 }}>
          Timestamped as reported now.
        </div>
        {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button
          onClick={submit}
          disabled={!canSubmit || busy}
          style={{ ...addBtn, background: COLORS.rust, width: "100%", justifyContent: "center", opacity: !canSubmit || busy ? 0.5 : 1 }}
        >
          Add request
        </button>
      </div>
    </div>
  );
}

// owner-only address book — auto-populated as leads come in (see
// contacts.js on the server), so a repeat customer's info is one tap away
// on the next lead instead of retyped from scratch
function ContactsView({ contacts, onDelete }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
    );
  }, [contacts, query]);

  return (
    <main style={cardsWrap}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search contacts…"
        style={modalInput}
      />
      {contacts.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}>
            No contacts yet
          </div>
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
            Every lead you add saves its contact info here, so a repeat customer autofills next time.
          </div>
        </div>
      )}
      {contacts.length > 0 && filtered.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>No contacts match "{query}".</div>
        </div>
      )}
      {filtered.map((c) => (
        <ContactRow key={c.id} contact={c} onDelete={onDelete} />
      ))}
    </main>
  );
}

function ContactRow({ contact: c, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div style={{ ...ticket, flexDirection: "column", padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.ink }}>{c.name}</div>
          {c.leadCount > 0 && (
            <div style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.accent, marginTop: 2 }}>
              {c.leadCount} lead{c.leadCount === 1 ? "" : "s"}
            </div>
          )}
        </div>
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} style={iconBtnGhost} aria-label="Delete contact">
            <Trash2 size={16} color="#9A9184" />
          </button>
        ) : (
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onDelete(c.id)} style={{ ...iconBtn, background: COLORS.rust }} aria-label="Confirm delete contact">
              <Check size={16} color="#fff" />
            </button>
            <button onClick={() => setConfirmDel(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel delete contact">
              <X size={16} color="#fff" />
            </button>
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginTop: 4 }}>
        {[c.phone, c.email, c.address].filter(Boolean).join(" · ") || "No contact details on file"}
      </div>
    </div>
  );
}

function ArchiveView({ leads, editable, onOpenReport }) {
  const [granularity, setGranularity] = useState("month"); // 'week' | 'month' | 'year' | 'all'
  const [openKey, setOpenKey] = useState(null);

  const paidLeads = useMemo(() => (leads || []).filter((l) => l.paidAt), [leads]);

  const allSorted = useMemo(
    () =>
      [...paidLeads].sort((a, b) =>
        lastNameOf(a.name).localeCompare(lastNameOf(b.name), undefined, { sensitivity: "base" })
      ),
    [paidLeads]
  );

  // each stage transition is bucketed into whichever period it actually
  // happened in — a lead created in June and won in August shows up as a
  // "new lead" in June's period and a "won" in August's, not lumped into
  // one or the other
  const periods = useMemo(() => {
    const map = new Map();
    const bucket = (dateStr, field, lead) => {
      if (!dateStr) return;
      const info = periodInfo(dateStr, granularity);
      if (!map.has(info.key)) {
        map.set(info.key, {
          ...info,
          newLeads: [],
          bidsSent: [],
          lost: [],
          won: [],
          completed: [],
          paid: [],
        });
      }
      map.get(info.key)[field].push(lead);
    };
    (leads || []).forEach((l) => {
      bucket(l.createdAt, "newLeads", l);
      bucket(l.bidSentAt, "bidsSent", l);
      bucket(l.lostAt, "lost", l);
      bucket(l.wonAt, "won", l);
      bucket(l.completedAt, "completed", l);
      bucket(l.paidAt, "paid", l);
    });
    return Array.from(map.values()).sort((a, b) => b.sortDate - a.sortDate);
  }, [leads, granularity]);

  return (
    <main style={cardsWrap}>
      <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        {["week", "month", "year", "all"].map((g) => (
          <button
            key={g}
            onClick={() => setGranularity(g)}
            style={{
              ...tabBtn,
              background: granularity === g ? COLORS.accent : "transparent",
              color: granularity === g ? COLORS.surface : COLORS.ink,
              borderColor: COLORS.accent,
            }}
          >
            {g === "all" ? "All (A–Z)" : g[0].toUpperCase() + g.slice(1)}
          </button>
        ))}
      </div>

      {granularity === "all" ? (
        <>
          {allSorted.length === 0 && (
            <div style={emptyState}>
              <div
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}
              >
                Nothing archived yet
              </div>
              <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
                Paid jobs land here — this view lists every one of them, alphabetically by last name.
              </div>
            </div>
          )}
          {allSorted.length > 0 && (
            <div style={{ ...ticket, flexDirection: "column", padding: 0 }}>
              {allSorted.map((l) => (
                <ArchiveLeadRow key={l.id} lead={l} editable={editable} onOpenReport={onOpenReport} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {periods.length === 0 && (
            <div style={emptyState}>
              <div
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}
              >
                Nothing here yet
              </div>
              <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
                Every new lead, bid, win, loss, completion, and payment lands here so you can look back by week,
                month, or year.
              </div>
            </div>
          )}

          {periods.map((p) => {
            const paidRevenue = p.paid.reduce((s, l) => s + (l.revenue || 0), 0);
            const wonRevenue = p.won.reduce((s, l) => s + (l.revenue || 0), 0);
            const completedRevenue = p.completed.reduce((s, l) => s + (l.revenue || 0), 0);
            const open = openKey === p.key;
            return (
              <div key={p.key} style={{ ...ticket, flexDirection: "column", padding: 0 }}>
                <button
                  onClick={() => setOpenKey(open ? null : p.key)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    padding: "12px 14px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.ink }}>
                      {p.label}
                    </div>
                    <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: "#8A8478" }}>
                      {p.newLeads.length} new · {p.won.length} won · {p.paid.length} paid · {fmtCurrency(paidRevenue)}
                    </div>
                  </div>
                  {open ? <ChevronUp size={16} color="#9A9184" /> : <ChevronDown size={16} color="#9A9184" />}
                </button>
                {open && (
                  <div style={{ borderTop: "1px solid #E4DFD1", padding: "12px 14px" }}>
                    <div style={metricsGrid}>
                      <div style={metricTile}>
                        <div style={metricLabel}>New leads</div>
                        <div style={metricValue}>{p.newLeads.length}</div>
                      </div>
                      <div style={metricTile}>
                        <div style={metricLabel}>Bids sent</div>
                        <div style={metricValue}>{p.bidsSent.length}</div>
                      </div>
                      <div style={metricTile}>
                        <div style={metricLabel}>Lost</div>
                        <div style={metricValue}>{p.lost.length}</div>
                      </div>
                      <div style={metricTile}>
                        <div style={metricLabel}>Won</div>
                        <div style={metricValue}>{p.won.length}</div>
                        <div style={metricSub}>{fmtCurrency(wonRevenue)}</div>
                      </div>
                      <div style={metricTile}>
                        <div style={metricLabel}>Completed</div>
                        <div style={metricValue}>{p.completed.length}</div>
                        <div style={metricSub}>{fmtCurrency(completedRevenue)}</div>
                      </div>
                      <div style={metricTile}>
                        <div style={metricLabel}>Paid</div>
                        <div style={metricValue}>{p.paid.length}</div>
                        <div style={metricSub}>{fmtCurrency(paidRevenue)}</div>
                      </div>
                    </div>
                  </div>
                )}
                {open && p.paid.length > 0 && (
                  <div style={{ borderTop: "1px solid #E4DFD1" }}>
                    {p.paid
                      .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
                      .map((l) => (
                        <ArchiveLeadRow key={l.id} lead={l} editable={editable} onOpenReport={onOpenReport} />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}

function ArchiveLeadRow({ lead: l, editable, onOpenReport }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid #EDE8DB",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink, fontWeight: 600 }}>{l.name}</div>
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: "#8A8478" }}>
          {fmtCurrency(l.revenue)} · paid {fmtDate(l.paidAt.slice(0, 10))}
          {sourceLabel(l) ? ` · ${sourceLabel(l)}` : ""}
        </div>
      </div>
      {editable && l.completedAt && (
        <button
          onClick={() => onOpenReport(l)}
          style={{
            ...archiveReportBtn,
            borderColor: l.reportCompletedAt ? COLORS.accent : COLORS.amber,
            color: l.reportCompletedAt ? COLORS.accent : COLORS.amber,
          }}
        >
          Report
        </button>
      )}
    </div>
  );
}

function FinalReportModal({ lead, settings, allMetrics, editable, onSaveReport, onClose }) {
  useModalBackClose(onClose);
  const [materialDraft, setMaterialDraft] = useState(lead.materialCost != null ? String(lead.materialCost) : "");
  const [laborDraft, setLaborDraft] = useState(lead.laborCost != null ? String(lead.laborCost) : "");
  const [commissionDraft, setCommissionDraft] = useState(lead.commission != null ? String(lead.commission) : "");
  const [wentWellDraft, setWentWellDraft] = useState(lead.wentWell || "");
  const [wentWrongDraft, setWentWrongDraft] = useState(lead.wentWrong || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [editingWorkDays, setEditingWorkDays] = useState(false);
  const [workDaysDraft, setWorkDaysDraft] = useState("");
  const wentWellRef = useRef(null);
  const wentWrongRef = useRef(null);

  const autoResizeTextarea = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => autoResizeTextarea(wentWellRef.current), [wentWellDraft]);
  useLayoutEffect(() => autoResizeTextarea(wentWrongRef.current), [wentWrongDraft]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(t);
  }, [saved]);

  const revenue = lead.revenue || 0;
  const workDays = resolveWorkDays(lead);
  const expectedWorkDays =
    allMetrics.avgDaysPerThousand != null && revenue > 0 ? allMetrics.avgDaysPerThousand * (revenue / 1000) : null;
  const deltaDays = workDays != null && expectedWorkDays != null ? workDays - expectedWorkDays : null;
  const overheadCost = revenue > 0 ? (revenue * settings.overheadPercent) / 100 : null;

  const materialCostLive = materialDraft === "" ? 0 : parseFloat(materialDraft) || 0;
  const laborCostLive = laborDraft === "" ? 0 : parseFloat(laborDraft) || 0;
  const commissionLive = commissionDraft === "" ? 0 : parseFloat(commissionDraft) || 0;
  const totalCost = materialCostLive + laborCostLive + commissionLive + (overheadCost || 0);
  const profit = revenue - totalCost;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : null;

  const draftPatch = () => {
    const material = materialDraft === "" ? null : parseFloat(materialDraft);
    const labor = laborDraft === "" ? null : parseFloat(laborDraft);
    const commission = commissionDraft === "" ? null : parseFloat(commissionDraft);
    return {
      materialCost: material == null || isNaN(material) ? null : material,
      laborCost: labor == null || isNaN(labor) ? null : labor,
      commission: commission == null || isNaN(commission) ? null : commission,
      wentWell: wentWellDraft,
      wentWrong: wentWrongDraft,
    };
  };

  const saveReport = async () => {
    setBusy(true);
    setErr("");
    try {
      await onSaveReport(draftPatch());
      setSaved(true);
    } catch (e) {
      setErr(e.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const saveWorkDays = async () => {
    const n = parseFloat(workDaysDraft);
    if (isNaN(n) || n <= 0) {
      setEditingWorkDays(false);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSaveReport({ actualWorkDays: n });
      setEditingWorkDays(false);
    } catch (e) {
      setErr(e.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const toggleComplete = async () => {
    const completing = !lead.reportCompletedAt;
    setBusy(true);
    setErr("");
    try {
      await onSaveReport({ ...draftPatch(), markComplete: completing });
      if (completing) {
        onClose();
      } else {
        setSaved(true);
      }
    } catch (e) {
      setErr(e.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
            Final report
          </div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.muted, marginBottom: 16 }}>
          {lead.name}
          {lead.job ? ` — ${lead.job}` : ""}
        </div>

        <div style={reportSectionLabel}>Time to complete</div>
        <div style={reportRow}>
          <span style={reportRowLabel}>Started</span>
          <span style={reportRowValue}>{lead.startDate ? fmtDate(lead.startDate) : "not set"}</span>
        </div>
        <div style={reportRow}>
          <span style={reportRowLabel}>Completed</span>
          <span style={reportRowValue}>{fmtDateOnlyUTC(lead.completedAt)}</span>
        </div>
        <div
          onClick={
            !editingWorkDays && editable
              ? () => {
                  setWorkDaysDraft(workDays != null ? String(workDays) : "");
                  setEditingWorkDays(true);
                }
              : undefined
          }
          style={{ ...reportRow, cursor: !editingWorkDays && editable ? "pointer" : "default" }}
        >
          <span style={reportRowLabel}>Working days</span>
          {!editingWorkDays ? (
            <span style={reportRowValue}>{workDays != null ? workDays : "—"}</span>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={workDaysDraft}
                onChange={(e) => setWorkDaysDraft(e.target.value)}
                style={{ ...inlineInput, width: 60 }}
              />
              <button onClick={saveWorkDays} style={{ ...iconBtn, background: COLORS.accent }}>
                <Check size={18} color="#fff" />
              </button>
              <button onClick={() => setEditingWorkDays(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                <X size={18} color="#fff" />
              </button>
            </div>
          )}
        </div>
        {!lead.startDate && (
          <div style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
            Set a start date on the board to see time-to-complete stats.
          </div>
        )}
        {workDays != null && (
          <div
            style={{
              fontFamily: FONT_UTIL,
              fontSize: 13,
              fontWeight: 600,
              marginTop: 6,
              color:
                deltaDays == null
                  ? COLORS.muted
                  : deltaDays < -0.5
                  ? COLORS.accent
                  : deltaDays > 0.5
                  ? COLORS.rust
                  : COLORS.muted,
            }}
          >
            {deltaDays == null
              ? revenue > 0
                ? "Not enough completed-job history yet to compare"
                : "Add revenue to compare to average"
              : Math.abs(deltaDays) <= 0.5
              ? "Right on the average pace"
              : deltaDays < 0
              ? `${Math.abs(deltaDays).toFixed(1)} days faster than average`
              : `${deltaDays.toFixed(1)} days slower than average`}
          </div>
        )}

        {editable && (
          <>
            <div style={{ ...reportSectionLabel, marginTop: 18 }}>Cost & profit</div>
            <label style={modalLabel}>Material cost</label>
            <input
              type="number"
              inputMode="decimal"
              value={materialDraft}
              onChange={(e) => setMaterialDraft(e.target.value)}
              placeholder="0"
              style={modalInput}
            />
            <label style={modalLabel}>Labor cost</label>
            <input
              type="number"
              inputMode="decimal"
              value={laborDraft}
              onChange={(e) => setLaborDraft(e.target.value)}
              placeholder="0"
              style={modalInput}
            />
            <label style={modalLabel}>Commission</label>
            <input
              type="number"
              inputMode="decimal"
              value={commissionDraft}
              onChange={(e) => setCommissionDraft(e.target.value)}
              placeholder="0"
              style={modalInput}
            />

            <div style={{ ...reportRow, marginTop: 10 }}>
              <span style={reportRowLabel}>Overhead ({settings.overheadPercent}% of {fmtCurrency(revenue)})</span>
              <span style={reportRowValue}>{overheadCost != null ? fmtCurrency(overheadCost) : "—"}</span>
            </div>

            <div style={{ ...reportRow, marginTop: 8, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
              <span style={{ ...reportRowLabel, fontWeight: 700, color: COLORS.ink }}>Total cost</span>
              <span style={{ ...reportRowValue, fontWeight: 700 }}>{fmtCurrency(totalCost)}</span>
            </div>
            <div style={reportRow}>
              <span style={{ ...reportRowLabel, fontWeight: 700, color: COLORS.ink }}>Profit</span>
              <span style={{ ...reportRowValue, fontWeight: 700, color: profit >= 0 ? COLORS.accent : COLORS.rust }}>
                {fmtCurrency(profit)}
                {profitMargin != null ? ` (${profitMargin.toFixed(0)}%)` : ""}
              </span>
            </div>
          </>
        )}

        <div style={{ ...reportSectionLabel, marginTop: 18 }}>Retrospective</div>
        {editable ? (
          <>
            <label style={modalLabel}>What went well?</label>
            <textarea
              ref={wentWellRef}
              value={wentWellDraft}
              onChange={(e) => setWentWellDraft(e.target.value)}
              placeholder="e.g. Crew finished ahead of schedule, client was easy to reach"
              style={{ ...modalTextarea, overflow: "hidden", resize: "none" }}
            />
            <label style={modalLabel}>What went wrong?</label>
            <textarea
              ref={wentWrongRef}
              value={wentWrongDraft}
              onChange={(e) => setWentWrongDraft(e.target.value)}
              placeholder="e.g. Material delivery was late, underbid the labor"
              style={{ ...modalTextarea, overflow: "hidden", resize: "none" }}
            />
            <button
              onClick={saveReport}
              disabled={busy}
              style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 10, opacity: busy ? 0.6 : 1 }}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <div style={{ marginTop: 6 }}>
              <div style={reportRowLabel}>What went well?</div>
              <div style={{ ...reportRowValue, textAlign: "left", marginTop: 2 }}>{lead.wentWell || "not set"}</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={reportRowLabel}>What went wrong?</div>
              <div style={{ ...reportRowValue, textAlign: "left", marginTop: 2 }}>{lead.wentWrong || "not set"}</div>
            </div>
          </>
        )}

        {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 }}>{err}</div>}
        {saved && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: `${COLORS.accent}1a`,
              border: `1px solid ${COLORS.accent}`,
              borderRadius: 8,
              padding: "8px 12px",
              marginTop: 10,
            }}
          >
            <Check size={14} color={COLORS.accent} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: COLORS.accent }}>
              Changes saved
            </span>
          </div>
        )}

        {editable && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
            {lead.reportCompletedAt ? (
              <>
                <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>
                  Report completed {fmtDateOnly(lead.reportCompletedAt)}
                </div>
                <button
                  onClick={toggleComplete}
                  disabled={busy}
                  style={{ ...roleOption, justifyContent: "center", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
                >
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>
                    Reopen report
                  </span>
                </button>
              </>
            ) : (
              <>
                <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginBottom: 8 }}>
                  You'll get a daily reminder to finish this report until it's marked complete.
                </div>
                <button
                  onClick={toggleComplete}
                  disabled={busy}
                  style={{ ...addBtn, width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1 }}
                >
                  Mark report complete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// runs right after a lead is marked won, before the scope-of-work prompt —
// required, not dismissible (no X, no backdrop/back-button close): picking
// a name is the only way out, same as the scope-of-work prompt right after
// it. Picking Dave here is also what triggers the "Lead won!" push to him
// (see saveJobManager/routes/leads.js PATCH /:id).
function JobManagerModal({ lead, onPick }) {
  return (
    <div style={modalOverlay}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink, marginBottom: 6 }}>
          Who is managing this job?
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          {lead.name} was just marked won. Tag who's running it day-to-day before continuing — Dave gets notified
          only when he's the one tagged.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {["Sean", "Dave"].map((name) => (
            <button
              key={name}
              onClick={() => onPick(name)}
              style={{ ...addBtn, width: "100%", justifyContent: "center" }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// scope-of-work checklist for a won job. `canEdit` (owner) gets full
// add/remove/edit-text controls plus Save; everyone else (the project
// manager) can only check items off as the crew works through them.
// `required` (set only right after the job-manager prompt, not on the
// later "Add scope of work" button) makes this non-dismissible — no X, no
// tap-outside, no browser-back — so Save is the only way through, same as
// the job-manager prompt right before it.
function ScopeOfWorkModal({ lead, canEdit, onSave, onToggle, onClose, required }) {
  useModalBackClose(required ? () => {} : onClose);
  const [items, setItems] = useState(lead.scopeOfWork || []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const addItem = () => {
    const text = draft.trim();
    if (!text) return;
    setItems((prev) => [...prev, { id: `new-${Date.now()}-${prev.length}`, text, done: false }]);
    setDraft("");
  };

  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.id !== id));
  const updateText = (id, text) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, text } : i)));

  const toggle = async (id, done) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done } : i)));
    if (!onToggle) return;
    try {
      await onToggle(id, done);
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !done } : i)));
    }
  };

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      await onSave(items);
      onClose();
    } catch (e) {
      setErr(e.message || "Couldn't save the checklist");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={required ? undefined : onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
            Scope of work
          </div>
          {!required && (
            <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
              <X size={18} color={COLORS.muted} />
            </button>
          )}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          {required
            ? `${lead.name} — job won! List out what needs to happen so the project manager knows exactly what to plan for and who to hire, then save to continue.`
            : canEdit
            ? `${lead.name} — job won! List out what needs to happen so the project manager knows exactly what to plan for and who to hire.`
            : `${lead.name} — check items off as they're taken care of.`}
        </div>

        {items.length === 0 && !canEdit && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.muted, marginBottom: 12 }}>
            Nothing on the checklist yet.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: canEdit ? 12 : 20 }}>
          {items.map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => toggle(item.id, !item.done)}
                aria-label={item.done ? "Mark item not done" : "Mark item done"}
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: 6,
                  border: `1.5px solid ${item.done ? COLORS.accent : COLORS.border}`,
                  background: item.done ? COLORS.accent : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                {item.done && <Check size={15} color="#fff" />}
              </button>
              {canEdit ? (
                <input
                  value={item.text}
                  onChange={(e) => updateText(item.id, e.target.value)}
                  style={{ ...inlineInput, flex: 1 }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    fontFamily: FONT_BODY,
                    fontSize: 14.5,
                    color: item.done ? COLORS.muted : COLORS.ink,
                    textDecoration: item.done ? "line-through" : "none",
                  }}
                >
                  {item.text}
                </span>
              )}
              {canEdit && (
                <button onClick={() => removeItem(item.id)} style={iconBtnGhost} aria-label="Remove item">
                  <X size={16} color="#9A9184" />
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
                placeholder="e.g. Order gutters, schedule crew"
                style={{ ...modalInput, flex: 1 }}
              />
              <button onClick={addItem} style={{ ...iconBtn, background: COLORS.accent, width: 44 }} aria-label="Add item">
                <Plus size={18} color="#fff" />
              </button>
            </div>
            {err && <div style={{ color: COLORS.rust, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <button
              onClick={save}
              disabled={saving}
              style={{ ...addBtn, background: COLORS.accent, width: "100%", justifyContent: "center", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save checklist"}
            </button>
          </>
        )}
        {!canEdit && (
          <button
            onClick={onClose}
            style={{ ...addBtn, background: COLORS.accent, width: "100%", justifyContent: "center" }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function LeadTicket({
  lead,
  onMove,
  onEditField,
  onEditStartDate,
  onDelete,
  editable,
  role,
  highlighted,
  onOpenReport,
  onOpenScopeOfWork,
  onLogFollowup,
  onRemoveFollowup,
  settings,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(lead.name);
  const [editingJob, setEditingJob] = useState(false);
  const [jobDraft, setJobDraft] = useState(lead.job || "");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(lead.phone || "");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(lead.email || "");
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState(lead.address || "");
  const [editingReceived, setEditingReceived] = useState(false);
  const [receivedDraft, setReceivedDraft] = useState("");
  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState(lead.startDate || "");
  const [editingCompleted, setEditingCompleted] = useState(false);
  const [completedDraft, setCompletedDraft] = useState("");
  const [editingRevenue, setEditingRevenue] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState(lead.revenue != null ? String(lead.revenue) : "");
  const [editingSource, setEditingSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(lead.source || "");
  const [sourceOtherDraft, setSourceOtherDraft] = useState(lead.sourceOther || "");
  const [editingAppointment, setEditingAppointment] = useState(false);
  const [appointmentDraft, setAppointmentDraft] = useState(isoToDateTimeLocal(lead.appointmentAt));
  const [editingManager, setEditingManager] = useState(false);
  const [managerDraft, setManagerDraft] = useState(lead.manager || "");
  const [confirmDel, setConfirmDel] = useState(false);

  const stage = STAGES.find((s) => s.key === lead.stage);

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed) onEditField(lead.id, "name", trimmed);
    else setNameDraft(lead.name);
    setEditingName(false);
  };

  const saveJob = () => {
    onEditField(lead.id, "job", jobDraft.trim());
    setEditingJob(false);
  };

  const savePhone = () => {
    onEditField(lead.id, "phone", phoneDraft.trim());
    setEditingPhone(false);
  };

  const saveEmail = () => {
    onEditField(lead.id, "email", emailDraft.trim());
    setEditingEmail(false);
  };

  const saveAddress = () => {
    onEditField(lead.id, "address", addressDraft.trim());
    setEditingAddress(false);
  };

  const openReceivedEdit = () => {
    const d = new Date(lead.createdAt);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    setReceivedDraft(local.toISOString().slice(0, 10));
    setEditingReceived(true);
  };

  const saveReceived = () => {
    if (receivedDraft) onEditField(lead.id, "createdAt", new Date(receivedDraft + "T00:00:00").toISOString());
    setEditingReceived(false);
  };

  // owner keeps going through the general-purpose lead editor; the viewer
  // role only has access to the dedicated start-date endpoint (server-
  // enforced — see routes/leads.js PATCH /:id/start-date)
  const saveStart = () => {
    if (role === "owner") {
      onEditField(lead.id, "startDate", startDraft);
    } else {
      onEditStartDate(lead.id, startDraft);
    }
    setEditingStart(false);
  };

  // completedAt is a plain calendar date at heart (no meaningful time-of-day),
  // stored as UTC midnight — read/write its UTC date directly rather than
  // going through the browser's local timezone, which would drift the date
  // by a day for anyone west of UTC
  const openCompletedEdit = () => {
    setCompletedDraft(new Date(lead.completedAt).toISOString().slice(0, 10));
    setEditingCompleted(true);
  };

  const saveCompleted = () => {
    if (completedDraft) onEditField(lead.id, "completedAt", `${completedDraft}T00:00:00.000Z`);
    setEditingCompleted(false);
  };

  const saveRevenue = () => {
    const n = parseFloat(revenueDraft);
    onEditField(lead.id, "revenue", isNaN(n) ? null : n);
    setEditingRevenue(false);
  };

  const openSourceEdit = () => {
    setSourceDraft(lead.source || "");
    setSourceOtherDraft(lead.sourceOther || "");
    setEditingSource(true);
  };

  const saveSource = () => {
    if (!sourceDraft) {
      setEditingSource(false);
      return;
    }
    const needsOther = sourceDraft === "other" || sourceDraft === "website";
    onEditField(lead.id, {
      source: sourceDraft,
      sourceOther: needsOther ? sourceOtherDraft.trim() : "",
    });
    setEditingSource(false);
  };

  const openManagerEdit = () => {
    setManagerDraft(lead.manager || "");
    setEditingManager(true);
  };

  const saveManager = () => {
    onEditField(lead.id, "manager", managerDraft || null);
    setEditingManager(false);
  };

  const openAppointmentEdit = () => {
    setAppointmentDraft(isoToDateTimeLocal(lead.appointmentAt));
    setEditingAppointment(true);
  };

  const saveAppointment = () => {
    // datetime-local has no timezone info — new Date(...) on it is parsed in
    // the browser's local zone, which is what we want since it's what the
    // owner picked on their own device
    onEditField(lead.id, "appointmentAt", appointmentDraft ? new Date(appointmentDraft).toISOString() : null);
    setEditingAppointment(false);
  };

  const clearAppointment = () => {
    onEditField(lead.id, "appointmentAt", null);
    setEditingAppointment(false);
  };

  return (
    <div
      id={`lead-${lead.id}`}
      style={
        highlighted
          ? { ...ticket, boxShadow: `0 0 0 3px ${COLORS.accent}, 0 4px 16px rgba(36,41,38,0.16)` }
          : ticket
      }
    >
      <div style={{ ...ticketStub, background: stage?.color || COLORS.info }} />
      <div style={{ flex: 1, padding: "16px 18px 16px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          {!editingName ? (
            <div
              onClick={
                editable
                  ? () => {
                      setNameDraft(lead.name);
                      setEditingName(true);
                    }
                  : undefined
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                flex: 1,
                cursor: editable ? "pointer" : "default",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 16,
                  color: COLORS.ink,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {lead.name}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                style={{ ...inlineInput, fontFamily: FONT_DISPLAY, fontSize: 16, flex: 1 }}
              />
              <button onClick={saveName} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save name">
                <Check size={18} color="#fff" />
              </button>
              <button
                onClick={() => {
                  setNameDraft(lead.name);
                  setEditingName(false);
                }}
                style={{ ...iconBtn, background: "#B8B0A0" }}
                aria-label="Cancel name edit"
              >
                <X size={18} color="#fff" />
              </button>
            </div>
          )}
          {editable && !editingName && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <LeadMoreMenu lead={lead} onMove={onMove} />
              {!confirmDel ? (
                <button onClick={() => setConfirmDel(true)} style={iconBtnGhost} aria-label="Delete lead">
                  <Trash2 size={18} color="#9A9184" />
                </button>
              ) : (
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => onDelete(lead.id)} style={{ ...iconBtn, background: COLORS.rust }} aria-label="Confirm delete">
                    <Check size={18} color="#fff" />
                  </button>
                  <button onClick={() => setConfirmDel(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel delete">
                    <X size={18} color="#fff" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* job — separate from the client's name */}
        <div
          onClick={
            !editingJob && editable
              ? () => {
                  setJobDraft(lead.job || "");
                  setEditingJob(true);
                }
              : undefined
          }
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: !editingJob && editable ? "pointer" : "default",
          }}
        >
          {!editingJob ? (
            <span style={{ fontFamily: FONT_UTIL, fontSize: 14, color: lead.job ? "#4A463D" : "#B8B0A0" }}>
              {lead.job || "No job set"}
            </span>
          ) : (
            <>
              <input
                autoFocus
                value={jobDraft}
                onChange={(e) => setJobDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveJob()}
                placeholder="e.g. Gutters, Lehi"
                style={{ ...inlineInput, flex: 1 }}
              />
              <button onClick={saveJob} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save job">
                <Check size={18} color="#fff" />
              </button>
              <button onClick={() => setEditingJob(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel job edit">
                <X size={18} color="#fff" />
              </button>
            </>
          )}
        </div>

        {/* phone — tap the number to call, tap elsewhere in the row to edit */}
        {(lead.phone || editable) && (
          <div
            onClick={
              !editingPhone && editable
                ? () => {
                    setPhoneDraft(lead.phone || "");
                    setEditingPhone(true);
                  }
                : undefined
            }
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingPhone && editable ? "pointer" : "default",
            }}
          >
            {!editingPhone ? (
              lead.phone ? (
                <>
                  <a
                    href={`tel:${lead.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontFamily: FONT_UTIL, fontSize: 14, color: COLORS.accent, fontWeight: 600, textDecoration: "none" }}
                  >
                    {lead.phone}
                  </a>
                  {/* visible to both roles — anyone with the lead open can reach the customer directly */}
                  <a
                    href={`tel:${lead.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Call customer"
                    style={{ ...iconBtnGhost, display: "inline-flex" }}
                  >
                    <Phone size={15} color={COLORS.accent} />
                  </a>
                  <a
                    href={`sms:${lead.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Text customer"
                    style={{ ...iconBtnGhost, display: "inline-flex" }}
                  >
                    <MessageCircle size={15} color={COLORS.accent} />
                  </a>
                  {/* the number and call/text icons above all stopPropagation to
                  avoid triggering edit mode, which can leave no empty row space
                  left to tap on a phone screen — so give edit its own explicit target */}
                  {editable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhoneDraft(lead.phone || "");
                        setEditingPhone(true);
                      }}
                      aria-label="Edit phone"
                      style={{ ...iconBtnGhost, display: "inline-flex" }}
                    >
                      <Pencil size={14} color={COLORS.muted} />
                    </button>
                  )}
                </>
              ) : (
                <span style={{ fontFamily: FONT_UTIL, fontSize: 14, color: "#B8B0A0" }}>No phone set</span>
              )
            ) : (
              <>
                <input
                  autoFocus
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && savePhone()}
                  placeholder="e.g. (801) 555-0123"
                  style={{ ...inlineInput, flex: 1 }}
                />
                <button onClick={savePhone} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save phone">
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingPhone(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel phone edit">
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
        )}

        {/* email — tap the address to compose, tap elsewhere in the row to edit */}
        {(lead.email || editable) && (
          <div
            onClick={
              !editingEmail && editable
                ? () => {
                    setEmailDraft(lead.email || "");
                    setEditingEmail(true);
                  }
                : undefined
            }
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingEmail && editable ? "pointer" : "default",
            }}
          >
            {!editingEmail ? (
              lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontFamily: FONT_UTIL,
                    fontSize: 14,
                    color: COLORS.accent,
                    fontWeight: 600,
                    textDecoration: "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 220,
                  }}
                >
                  {lead.email}
                </a>
              ) : (
                <span style={{ fontFamily: FONT_UTIL, fontSize: 14, color: "#B8B0A0" }}>No email set</span>
              )
            ) : (
              <>
                <input
                  autoFocus
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEmail()}
                  placeholder="e.g. name@example.com"
                  style={{ ...inlineInput, flex: 1 }}
                />
                <button onClick={saveEmail} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save email">
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingEmail(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel email edit">
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
        )}

        {/* address — tap it to open turn-by-turn directions in Apple Maps, tap elsewhere in the row to edit */}
        {(lead.address || editable) && (
          <div
            onClick={
              !editingAddress && editable
                ? () => {
                    setAddressDraft(lead.address || "");
                    setEditingAddress(true);
                  }
                : undefined
            }
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingAddress && editable ? "pointer" : "default",
            }}
          >
            {!editingAddress ? (
              lead.address ? (
                <a
                  href={`https://maps.apple.com/?daddr=${encodeURIComponent(lead.address)}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontFamily: FONT_UTIL,
                    fontSize: 14,
                    color: COLORS.accent,
                    fontWeight: 600,
                    textDecoration: "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 260,
                  }}
                >
                  <MapPin size={14} color={COLORS.accent} />
                  {lead.address}
                </a>
              ) : (
                <span style={{ fontFamily: FONT_UTIL, fontSize: 14, color: "#B8B0A0" }}>No address set</span>
              )
            ) : (
              <>
                <input
                  autoFocus
                  value={addressDraft}
                  onChange={(e) => setAddressDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveAddress()}
                  placeholder="e.g. 123 Main St, Lehi, UT"
                  style={{ ...inlineInput, flex: 1 }}
                />
                <button onClick={saveAddress} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save address">
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingAddress(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel address edit">
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
        )}

        {/* received timestamp */}
        <div
          onClick={!editingReceived && editable ? openReceivedEdit : undefined}
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: !editingReceived && editable ? "pointer" : "default",
          }}
        >
          <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Received</span>
          {!editingReceived ? (
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: "#4A463D" }}>{fmtDateOnly(lead.createdAt)}</span>
          ) : (
            <>
              <input
                type="date"
                value={receivedDraft}
                onChange={(e) => setReceivedDraft(e.target.value)}
                style={inlineInput}
              />
              <button onClick={saveReceived} style={{ ...iconBtn, background: COLORS.accent }}>
                <Check size={18} color="#fff" />
              </button>
              <button onClick={() => setEditingReceived(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                <X size={18} color="#fff" />
              </button>
            </>
          )}
        </div>

        {/* sales appointment — editable at any stage in case it needs rescheduling;
            drives the 7am-of push reminder and the Apple Calendar feed */}
        <div style={{ marginTop: 10 }}>
          <div
            onClick={!editingAppointment && editable ? openAppointmentEdit : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingAppointment && editable ? "pointer" : "default",
            }}
          >
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Appointment</span>
            {!editingAppointment ? (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: lead.appointmentAt ? "#4A463D" : "#B8B0A0" }}>
                {lead.appointmentAt ? fmtDateTime(lead.appointmentAt) : "not set"}
              </span>
            ) : (
              <>
                <input
                  type="datetime-local"
                  autoFocus
                  value={appointmentDraft}
                  onChange={(e) => setAppointmentDraft(e.target.value)}
                  style={inlineInput}
                />
                <button onClick={saveAppointment} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save appointment">
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingAppointment(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel appointment edit">
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
          {editingAppointment && lead.appointmentAt && (
            <button
              onClick={clearAppointment}
              style={{
                marginTop: 6,
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: FONT_UTIL,
                fontSize: 12.5,
                color: COLORS.rust,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Clear appointment
            </button>
          )}
          {!editingAppointment && lead.appointmentAt && (
            <a
              href={`/api/calendar/leads/${lead.id}.ics`}
              style={{
                marginTop: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily: FONT_UTIL,
                fontSize: 12.5,
                color: COLORS.accent,
                textDecoration: "none",
              }}
            >
              <Calendar size={13} color={COLORS.accent} />
              Add to calendar
            </a>
          )}
        </div>

        {/* source — can be corrected at any stage, not just at intake */}
        <div style={{ marginTop: 6 }}>
          <div
            onClick={!editingSource && editable ? openSourceEdit : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingSource && editable ? "pointer" : "default",
            }}
          >
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Source</span>
            {!editingSource ? (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: "#4A463D" }}>
                {sourceLabel(lead) || "not set"}
              </span>
            ) : (
              <>
                <select
                  autoFocus
                  value={sourceDraft}
                  onChange={(e) => setSourceDraft(e.target.value)}
                  style={{ ...inlineInput, appearance: "auto" }}
                >
                  <option value="">Select a source…</option>
                  {SOURCES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button onClick={saveSource} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save source">
                  <Check size={18} color="#fff" />
                </button>
                <button
                  onClick={() => setEditingSource(false)}
                  style={{ ...iconBtn, background: "#B8B0A0" }}
                  aria-label="Cancel source edit"
                >
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
          {editingSource && (sourceDraft === "other" || sourceDraft === "website") && (
            <input
              value={sourceOtherDraft}
              onChange={(e) => setSourceOtherDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveSource()}
              placeholder={sourceDraft === "website" ? "Which page? (optional)" : "Describe the source"}
              style={{ ...inlineInput, width: "100%", marginTop: 6 }}
            />
          )}
        </div>

        {/* revenue — can be attached at any stage */}
        <div
          onClick={
            !editingRevenue && editable
              ? () => {
                  setRevenueDraft(lead.revenue != null ? String(lead.revenue) : "");
                  setEditingRevenue(true);
                }
              : undefined
          }
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: !editingRevenue && editable ? "pointer" : "default",
          }}
        >
          <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Revenue</span>
          {!editingRevenue ? (
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: lead.revenue != null ? "#4A463D" : "#B8B0A0" }}>
              {lead.revenue != null ? fmtCurrency(lead.revenue) : "not set"}
            </span>
          ) : (
            <>
              <input
                type="number"
                inputMode="decimal"
                value={revenueDraft}
                onChange={(e) => setRevenueDraft(e.target.value)}
                placeholder="0"
                style={{ ...inlineInput, width: 90 }}
              />
              <button onClick={saveRevenue} style={{ ...iconBtn, background: COLORS.accent }}>
                <Check size={18} color="#fff" />
              </button>
              <button onClick={() => setEditingRevenue(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                <X size={18} color="#fff" />
              </button>
            </>
          )}
        </div>

        {/* start date, only for won-not-started (and visible afterwards too) —
        editable by the viewer role too (not just editable/owner) since
        scheduling a won job's start date is a project-manager task; the
        server enforces the same "won or later" restriction independently */}
        {(lead.stage === "won" || lead.stage === "progress" || lead.stage === "completed" || lead.stage === "paid") && (
          <div
            onClick={
              !editingStart && (editable || role === "viewer")
                ? () => {
                    setStartDraft(lead.startDate || "");
                    setEditingStart(true);
                  }
                : undefined
            }
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingStart && (editable || role === "viewer") ? "pointer" : "default",
            }}
          >
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Start date</span>
            {!editingStart ? (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: lead.startDate ? "#4A463D" : "#B8482E" }}>
                {lead.startDate ? fmtDate(lead.startDate) : "not set"}
              </span>
            ) : (
              <>
                <input type="date" value={startDraft} onChange={(e) => setStartDraft(e.target.value)} style={inlineInput} />
                <button onClick={saveStart} style={{ ...iconBtn, background: COLORS.accent }}>
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingStart(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
        )}

        {/* who's managing the job day-to-day — first picked via the job-manager
            prompt right after the win; visible to both roles, editable by the
            owner only. Changing it to Dave here (not just from that prompt)
            also fires the "Lead won!" push if the job is still at "won" */}
        {(lead.stage === "won" || lead.stage === "progress" || lead.stage === "completed" || lead.stage === "paid") && (
          <div
            onClick={!editingManager && editable ? openManagerEdit : undefined}
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingManager && editable ? "pointer" : "default",
            }}
          >
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Managed by</span>
            {!editingManager ? (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: lead.manager ? "#4A463D" : "#B8B0A0" }}>
                {lead.manager || "not set"}
              </span>
            ) : (
              <>
                <select
                  autoFocus
                  value={managerDraft}
                  onChange={(e) => setManagerDraft(e.target.value)}
                  style={{ ...inlineInput, appearance: "auto" }}
                >
                  <option value="">Not set</option>
                  <option value="Sean">Sean</option>
                  <option value="Dave">Dave</option>
                </select>
                <button onClick={saveManager} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save manager">
                  <Check size={18} color="#fff" />
                </button>
                <button
                  onClick={() => setEditingManager(false)}
                  style={{ ...iconBtn, background: "#B8B0A0" }}
                  aria-label="Cancel manager edit"
                >
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
        )}

        {/* completed date — the exact day the job finished, used for time-to-complete
            stats on the final report; editable in case a backfilled lead got today's
            date instead of the real completion date */}
        {(lead.stage === "completed" || lead.stage === "paid") && (
          <div
            onClick={
              !editingCompleted && editable
                ? () => {
                    openCompletedEdit();
                  }
                : undefined
            }
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: !editingCompleted && editable ? "pointer" : "default",
            }}
          >
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Completed</span>
            {!editingCompleted ? (
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: "#4A463D" }}>
                {fmtDateOnlyUTC(lead.completedAt)}
              </span>
            ) : (
              <>
                <input
                  type="date"
                  value={completedDraft}
                  onChange={(e) => setCompletedDraft(e.target.value)}
                  style={inlineInput}
                />
                <button onClick={saveCompleted} style={{ ...iconBtn, background: COLORS.accent }}>
                  <Check size={18} color="#fff" />
                </button>
                <button onClick={() => setEditingCompleted(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                  <X size={18} color="#fff" />
                </button>
              </>
            )}
          </div>
        )}

        {lead.stage === "paid" && lead.paidAt && (
          <div style={{ marginTop: 10, fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>
            Paid {fmtDateOnly(lead.paidAt)} · clears next month
          </div>
        )}

        {/* actions — owners get the full stage-move row; the project manager
            (viewer) only gets to advance a job from in-progress to
            completed, which ActionRow's per-stage switch already limits to
            just the "Mark complete" button once lead.stage is "progress" */}
        {(editable || (role === "viewer" && lead.stage === "progress")) && (
          <ActionRow lead={lead} onMove={onMove} onOpenReport={editable ? onOpenReport : undefined} settings={settings} editable={editable} />
        )}

        {editable && lead.stage === "bid" && (
          <FollowUpSection
            lead={lead}
            onLog={() => onLogFollowup(lead.id)}
            onRemove={(followupId) => onRemoveFollowup(lead.id, followupId)}
          />
        )}

        {/* scope-of-work checklist — visible once a job is won; owner can
            always open it to add/edit, the project manager only sees it once
            there's actually something on the list to check off */}
        {onOpenScopeOfWork &&
          ["won", "progress", "completed", "paid"].includes(lead.stage) &&
          (editable || (lead.scopeOfWork && lead.scopeOfWork.length > 0)) && (
            <button
              onClick={() => onOpenScopeOfWork(lead)}
              style={{ ...actionBtn, marginTop: 8, background: "transparent", color: "#6B6558", border: "1px solid #D8D2C2" }}
            >
              <ListChecks size={13} />
              {lead.scopeOfWork && lead.scopeOfWork.length > 0
                ? `Scope of work (${lead.scopeOfWork.filter((i) => i.done).length}/${lead.scopeOfWork.length})`
                : "Add scope of work"}
            </button>
          )}
      </div>
    </div>
  );
}

function LeadMoreMenu({ lead, onMove }) {
  const [open, setOpen] = useState(false);
  const prevStage = PREVIOUS_STAGE[lead.stage];
  if (!prevStage) return null;
  const prevLabel = STAGES.find((s) => s.key === prevStage)?.short || prevStage;

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={iconBtnGhost} aria-label="More options">
        <MoreVertical size={18} color="#9A9184" />
      </button>
      {open && (
        <>
          <div style={moreMenuScrim} onClick={() => setOpen(false)} />
          <div style={moreMenuPopover}>
            <button
              onClick={() => {
                onMove(lead.id, prevStage, undefined, true);
                setOpen(false);
              }}
              style={moreMenuItem}
            >
              Move back to {prevLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const BACKDATE_THRESHOLD_DAYS = 7;

// "won", "completed", and "paid" all stamp a date used for weekly/monthly
// stats, time-to-complete math, and the archive's month grouping — moving a
// long-backlogged lead into any of them without checking would silently
// misdate it to today.
function priorDateFor(lead, stage) {
  if (stage === "won") return lead.createdAt;
  if (stage === "completed") return lead.startDate || lead.wonAt || lead.createdAt;
  if (stage === "paid") return lead.wonAt || lead.createdAt;
  return null;
}

// logs a touch (call/text/email) while a lead sits in "bid" — a running
// tally rather than a fixed checklist, since there's no set number of
// follow-ups; each tap just adds one more dated entry. Expandable so a
// misclick can be undone without losing the rest of the count.
function FollowUpSection({ lead, onLog, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const followUps = lead.followUps || [];

  const log = async () => {
    setBusy(true);
    try {
      await onLog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={log}
          disabled={busy}
          style={{ ...actionBtn, background: "transparent", color: COLORS.accent, border: `1px solid ${COLORS.accent}`, opacity: busy ? 0.6 : 1 }}
        >
          <Phone size={13} />
          Log follow-up
        </button>
        {followUps.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ ...actionBtn, background: "transparent", color: "#6B6558", border: "1px solid #D8D2C2" }}
          >
            {followUps.length} follow-up{followUps.length === 1 ? "" : "s"}
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>
      {expanded && followUps.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {[...followUps]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map((f) => (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: FONT_UTIL,
                  fontSize: 12.5,
                  color: COLORS.muted,
                  padding: "4px 8px",
                  background: COLORS.surfaceMuted,
                  borderRadius: 6,
                }}
              >
                {fmtDateTime(f.createdAt)}
                <button
                  onClick={() => onRemove(f.id)}
                  style={{ background: "transparent", border: "none", padding: 2, cursor: "pointer", display: "flex" }}
                  aria-label="Remove follow-up"
                >
                  <X size={13} color={COLORS.muted} />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ActionRow({ lead, onMove, onOpenReport, settings, editable }) {
  const [confirmStage, setConfirmStage] = useState(null);
  const [pendingCompleteDate, setPendingCompleteDate] = useState(null);
  const [showWorkDays, setShowWorkDays] = useState(false);

  const startWorkDaysStep = (completedDateStr) => {
    setPendingCompleteDate(completedDateStr);
    setShowWorkDays(true);
  };

  const handleClick = (target) => {
    const prior = priorDateFor(lead, target);
    if (prior) {
      const days = (Date.now() - new Date(prior).getTime()) / 86400000;
      if (days > BACKDATE_THRESHOLD_DAYS) {
        setConfirmStage(target);
        return;
      }
    }
    if (target === "completed") {
      startWorkDaysStep(null);
      return;
    }
    onMove(lead.id, target);
  };

  const defaultWorkDays = () => {
    const completedDateStr = pendingCompleteDate || toDateInputValue(new Date());
    if (!lead.startDate) return 1;
    const calculated = businessDaysBetween(lead.startDate, `${completedDateStr}T00:00:00.000Z`);
    return calculated != null && calculated > 0 ? calculated : 1;
  };

  const btn = (label, target, kind = "primary") => (
    <button
      key={target}
      onClick={() => handleClick(target)}
      style={{
        ...actionBtn,
        background: kind === "primary" ? COLORS.accent : "transparent",
        color: kind === "primary" ? COLORS.surface : "#6B6558",
        border: kind === "primary" ? "none" : "1px solid #D8D2C2",
      }}
    >
      {label} {kind === "primary" && <ArrowRight size={12} />}
    </button>
  );

  let actions = [];
  switch (lead.stage) {
    case "new":
      actions = [btn("Bid sent", "bid")];
      break;
    case "bid":
      actions = [btn("Won", "won")];
      break;
    case "lost":
      actions = [btn("Reopen as new", "new", "secondary")];
      break;
    case "won":
      actions = [btn("Start job", "progress")];
      break;
    case "progress":
      actions = [btn("Mark complete", "completed")];
      break;
    case "completed":
      actions = [btn("Mark paid", "paid")];
      break;
    case "paid":
      actions = [];
      break;
    default:
      actions = [];
  }

  // a lead can fall through at any point — even after it's won or the job's
  // underway — so "Lost" is available from every stage except the two
  // endpoints: already-lost, and paid (the money's already collected).
  // Owner-only: this ActionRow also renders in a stripped-down form for the
  // viewer on "progress" leads (to advance to "completed" only) and losing
  // a job is a bigger call than that, so it stays out of that restricted view
  if (editable && lead.stage !== "lost" && lead.stage !== "paid") {
    actions = [...actions, btn("Lost", "lost", "secondary")];
  }

  if (onOpenReport && (lead.stage === "completed" || lead.stage === "paid")) {
    actions = [
      ...actions,
      <button
        key="report"
        onClick={() => onOpenReport(lead)}
        style={{
          ...actionBtn,
          background: "transparent",
          color: lead.reportCompletedAt ? COLORS.accent : COLORS.amber,
          border: `1px solid ${lead.reportCompletedAt ? COLORS.accent : COLORS.amber}`,
        }}
      >
        {lead.reportCompletedAt ? "View report" : "Complete report"}
      </button>,
    ];
  }

  return (
    <>
      {actions.length > 0 && <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{actions}</div>}
      {confirmStage && (
        <BackdateModal
          stage={confirmStage}
          onConfirm={(date) => {
            if (confirmStage === "completed") {
              setConfirmStage(null);
              startWorkDaysStep(date);
            } else {
              onMove(lead.id, confirmStage, date);
              setConfirmStage(null);
            }
          }}
          onCancel={() => setConfirmStage(null)}
        />
      )}
      {showWorkDays && (
        <WorkDaysModal
          defaultDays={defaultWorkDays()}
          onConfirm={(days) => {
            onMove(lead.id, "completed", pendingCompleteDate || undefined, false, days);
            setShowWorkDays(false);
            setPendingCompleteDate(null);
          }}
          onCancel={() => {
            setShowWorkDays(false);
            setPendingCompleteDate(null);
          }}
        />
      )}
    </>
  );
}

function BackdateModal({ stage, onConfirm, onCancel }) {
  useModalBackClose(onCancel);
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const label = stage === "won" ? "won" : stage === "completed" ? "completed" : "paid";
  const referenceLabel =
    stage === "won" ? "received" : stage === "completed" ? "started" : "won";

  return (
    <div style={modalOverlay} onClick={onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink, marginBottom: 8 }}>
          Backdate this {label} date?
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
          This job was {referenceLabel} a while ago, so it looks like it might be getting added late. If it was
          actually {label} earlier, set the real date below — otherwise just confirm today's date.
        </div>
        <label style={modalLabel}>Date {label}</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={modalInput} />
        <button
          onClick={() => onConfirm(date)}
          style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 14 }}
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          style={{ ...roleOption, marginTop: 10, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Cancel</span>
        </button>
      </div>
    </div>
  );
}

function WorkDaysModal({ defaultDays, onConfirm, onCancel }) {
  useModalBackClose(onCancel);
  const [days, setDays] = useState(defaultDays);

  const adjust = (delta) => setDays((d) => Math.max(0.25, Math.round((d + delta) * 4) / 4));

  return (
    <div style={modalOverlay} onClick={onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink, marginBottom: 8 }}>
          How many days did this take?
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
          Used to track build pace on this job's final report. Adjust in quarter-day steps if the crew wasn't on
          site the whole time.
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 10 }}>
          <button onClick={() => adjust(-0.25)} style={stepperBtn} aria-label="Decrease by a quarter day">
            −
          </button>
          <input
            type="number"
            step="0.25"
            min="0.25"
            value={days}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              setDays(isNaN(n) ? 0.25 : Math.max(0.25, n));
            }}
            style={{ ...modalInput, width: 90, textAlign: "center", fontSize: 20, fontWeight: 700 }}
          />
          <button onClick={() => adjust(0.25)} style={stepperBtn} aria-label="Increase by a quarter day">
            +
          </button>
        </div>
        <div
          style={{
            textAlign: "center",
            fontFamily: FONT_UTIL,
            fontSize: 12.5,
            color: COLORS.muted,
            marginTop: 4,
          }}
        >
          {days === 1 ? "day" : "days"}
        </div>

        <button
          onClick={() => onConfirm(days)}
          style={{ ...addBtn, width: "100%", justifyContent: "center", marginTop: 14 }}
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          style={{ ...roleOption, marginTop: 10, justifyContent: "center", borderColor: COLORS.border, cursor: "pointer" }}
        >
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, color: COLORS.ink, fontSize: 14 }}>Cancel</span>
        </button>
      </div>
    </div>
  );
}

function AddLeadModal({ onAdd, onClose, contacts }) {
  useModalBackClose(onClose);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [sourceOther, setSourceOther] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  const canSubmit = name.trim() && source && (source !== "other" || sourceOther.trim());

  const submit = () => {
    if (!canSubmit) return;
    onAdd(name, job, phone, email, source, sourceOther);
  };

  // repeat-customer autofill — matched against the owner's auto-saved
  // contacts list once at least a couple characters are typed
  const nameMatches = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (q.length < 2) return [];
    return (contacts || []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [name, contacts]);

  const pickContact = (c) => {
    setName(c.name);
    if (c.phone) setPhone(c.phone);
    if (c.email) setEmail(c.email);
    setShowSuggestions(false);
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
            Log a new lead
          </div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 6 }}>
          <span style={{ ...modalLabel, margin: 0 }}>Name</span>
          <button
            type="button"
            onClick={() => setShowContactPicker(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              background: "transparent",
              border: "none",
              color: COLORS.accent,
              fontFamily: FONT_BODY,
              fontWeight: 600,
              fontSize: 12.5,
              cursor: "pointer",
              padding: 0,
            }}
            aria-label="Add from contacts"
          >
            <Plus size={14} strokeWidth={2.5} />
            Contacts
          </button>
        </div>
        <div style={{ position: "relative" }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="e.g. Nguyen"
            style={modalInput}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          />
          {showSuggestions && nameMatches.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 5,
                background: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                marginTop: 2,
                boxShadow: "0 4px 12px rgba(36,41,38,0.12)",
                overflow: "hidden",
              }}
            >
              {nameMatches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={() => pickContact(c)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid ${COLORS.border}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: COLORS.ink }}>
                    {c.name}
                  </div>
                  {(c.phone || c.email) && (
                    <div style={{ fontFamily: FONT_UTIL, fontSize: 11.5, color: COLORS.muted, marginTop: 1 }}>
                      {[c.phone, c.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <label style={modalLabel}>Job</label>
        <input
          value={job}
          onChange={(e) => setJob(e.target.value)}
          placeholder="e.g. Gutters, Lehi"
          style={modalInput}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
        />
        <label style={modalLabel}>Phone (optional)</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. (801) 555-0123"
          style={modalInput}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
        />
        <label style={modalLabel}>Email (optional)</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. name@example.com"
          style={modalInput}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
        />
        <label style={modalLabel}>Lead source</label>
        <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...modalInput, appearance: "auto" }}>
          <option value="">Select a source…</option>
          {SOURCES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {(source === "other" || source === "website") && (
          <>
            <label style={modalLabel}>{source === "website" ? "Which page? (optional)" : "Describe the source"}</label>
            <input
              value={sourceOther}
              onChange={(e) => setSourceOther(e.target.value)}
              placeholder={source === "website" ? "e.g. Get a Quote, Contact Us" : "e.g. Yard sign, past client referral…"}
              style={modalInput}
            />
          </>
        )}
        <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: COLORS.muted, marginTop: 8, marginBottom: 18 }}>
          Timestamped now — you can edit the received time after adding.
        </div>
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{ ...addBtn, width: "100%", justifyContent: "center", opacity: canSubmit ? 1 : 0.5 }}
        >
          <Plus size={16} strokeWidth={2.5} /> Add to board
        </button>
      </div>
      {showContactPicker && (
        <ContactPickerModal
          contacts={contacts || []}
          onPick={(c) => {
            pickContact(c);
            setShowContactPicker(false);
          }}
          onClose={() => setShowContactPicker(false)}
        />
      )}
    </div>
  );
}

// find-a-lead-by-name across every stage/bucket at once, rather than
// clicking through each stage tab (or the Archive tab) looking for it —
// picking a result reuses navigateToLead, so it lands exactly where that
// lead already opens from a notification tap
function LeadSearchModal({ leads, onSelect, onClose }) {
  useModalBackClose(onClose);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (leads || [])
      .filter((l) => l.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .slice(0, 25);
  }, [leads, query]);

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
            Find a lead
          </div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          style={{ ...modalInput, marginBottom: 12 }}
        />
        {!query.trim() ? (
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13, padding: "8px 0" }}>
            Searches every stage and the archive, not just the one you're currently viewing.
          </div>
        ) : results.length === 0 ? (
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13, padding: "8px 0" }}>
            No leads named "{query}".
          </div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {results.map((l) => {
              const stage = STAGES.find((s) => s.key === l.stage);
              const stageLabel = l.archived ? "Paid / Archived" : stage ? stage.short : l.stage;
              const stageColor = stage ? stage.color : COLORS.muted;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onSelect(l.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 4px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid ${COLORS.border}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, color: COLORS.ink }}>
                      {l.name}
                    </div>
                    {l.job && (
                      <div
                        style={{
                          fontFamily: FONT_UTIL,
                          fontSize: 12,
                          color: COLORS.muted,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {l.job}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      ...countPill,
                      flexShrink: 0,
                      background: `${stageColor}1A`,
                      color: stageColor,
                      fontWeight: 700,
                    }}
                  >
                    {stageLabel}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// browsable version of the same repeat-customer autofill the Name field's
// typeahead already does — for when you want to pick from the list instead
// of remembering/typing the name first
function ContactPickerModal({ contacts, onPick, onClose }) {
  useModalBackClose(onClose);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
    );
  }, [contacts, query]);

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink }}>
            Add from contacts
          </div>
          <button onClick={onClose} style={iconBtnGhost} aria-label="Close">
            <X size={18} color={COLORS.muted} />
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts…"
          style={{ ...modalInput, marginBottom: 12 }}
        />
        {contacts.length === 0 ? (
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13, padding: "8px 0" }}>
            No contacts yet — they'll show up here as you add leads.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13, padding: "8px 0" }}>
            No contacts match "{query}".
          </div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 4px",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${COLORS.border}`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, color: COLORS.ink }}>
                  {c.name}
                </div>
                {(c.phone || c.email) && (
                  <div style={{ fontFamily: FONT_UTIL, fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- styles ----
const FONT_DISPLAY = "'Raleway', sans-serif";
const FONT_BODY = "'Open Sans', sans-serif";
const FONT_UTIL = "'Open Sans', sans-serif";

const shell = {
  minHeight: "100vh",
  background: COLORS.bg,
  display: "flex",
  flexDirection: "column",
  fontFamily: FONT_BODY,
};

const header = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "18px 20px",
  background: `radial-gradient(ellipse 420px 320px at 10% 35%, ${COLORS.headerGlow}, transparent 65%), linear-gradient(135deg, #170a08 0%, #241009 45%, #150a08 100%)`,
  borderBottom: `1px solid ${COLORS.headerLine}`,
};

const addBtn = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: COLORS.accent,
  color: "#fff",
  border: "none",
  borderRadius: 7,
  padding: "9px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  fontFamily: FONT_BODY,
  cursor: "pointer",
};

const tabsRow = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`,
};

const tabBtn = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 999,
  border: "1px solid",
  fontSize: 12.5,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const countPill = {
  fontFamily: FONT_UTIL,
  fontSize: 10.5,
  borderRadius: 999,
  padding: "1px 6px",
};

const stageHeadRow = {
  display: "flex",
  alignItems: "center",
  padding: "10px 8px",
};

const navArrow = {
  background: "transparent",
  border: "none",
  padding: 8,
  cursor: "pointer",
};

const cardsWrap = {
  flex: 1,
  padding: "8px 16px 32px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  maxWidth: 640,
  width: "100%",
  margin: "0 auto",
};

const emptyState = {
  border: `1px dashed ${COLORS.border}`,
  borderRadius: 10,
  padding: "28px 16px",
  textAlign: "center",
  marginTop: 8,
};

const ticket = {
  display: "flex",
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(36,41,38,0.06)",
};

const ticketStub = {
  width: 6,
};

const iconBtn = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const iconBtnGhost = {
  ...iconBtn,
  background: "transparent",
  width: 32,
  height: 32,
};

const moreMenuScrim = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
};

const moreMenuPopover = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  zIndex: 41,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  boxShadow: "0 4px 16px rgba(36,41,38,0.16)",
  minWidth: 190,
  overflow: "hidden",
};

const moreMenuItem = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  padding: "11px 14px",
  fontFamily: FONT_BODY,
  fontSize: 13.5,
  fontWeight: 600,
  color: COLORS.ink,
  cursor: "pointer",
};

const headerIconBtn = {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: "none",
  background: "rgba(255,255,255,0.16)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

// Home / History / notifications sit right next to the logo now and are
// meant to read as the primary header actions, so they get a bigger
// treatment than the hamburger menu next to them
const prominentHeaderIconBtn = {
  ...headerIconBtn,
  width: 50,
  height: 50,
  borderRadius: 13,
};

// icon-over-label tile used for the header's primary nav row (Dashboard /
// Activity / Alerts / Menu) — dark card, vivid red icon, white label
const headerTile = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  flex: "1 1 56px",
  padding: "8px 2px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.35)",
  cursor: "pointer",
};

// same dark-card look as headerTile, but fixed-size and icon-only — for the
// corner hamburger, which sits outside the tile row but should still read
// as part of the same button family
const headerCornerBtn = {
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const headerTileLabel = {
  fontFamily: FONT_BODY,
  fontWeight: 700,
  fontSize: 11.5,
  color: "#fff",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "100%",
};

// big red CTA for the header only — the app-wide addBtn (green) elsewhere
// is untouched, this is scoped to match the reference mockup's hero button
const heroNewLeadBtn = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  background: `linear-gradient(135deg, ${COLORS.heroRed}, ${COLORS.heroRedDeep})`,
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "14px 20px",
  fontSize: 16,
  fontWeight: 700,
  fontFamily: FONT_BODY,
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(209,53,42,0.4)",
};

const notifBadge = {
  position: "absolute",
  top: -4,
  right: -4,
  minWidth: 19,
  height: 19,
  padding: "0 4px",
  borderRadius: 999,
  background: COLORS.rust,
  color: "#fff",
  fontFamily: FONT_UTIL,
  fontSize: 11,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `2px solid ${COLORS.header}`,
};

const notifPanel = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  zIndex: 41,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(36,41,38,0.2)",
  width: 300,
  maxWidth: "calc(100vw - 32px)",
  overflow: "hidden",
};

const notifPanelHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: `1px solid ${COLORS.border}`,
};

const notifMarkAllBtn = {
  background: "transparent",
  border: "none",
  color: COLORS.accent,
  fontFamily: FONT_BODY,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};

const notifItem = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  borderBottom: `1px solid ${COLORS.border}`,
  padding: "11px 14px",
  cursor: "pointer",
};

const statDrilldownRow = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  borderBottom: `1px solid ${COLORS.border}`,
  padding: "10px 4px",
  cursor: "pointer",
};

const inlineInput = {
  fontFamily: FONT_UTIL,
  // 16px+ keeps iOS Safari from auto-zooming the page when the input gets focus
  fontSize: 16,
  padding: "3px 6px",
  borderRadius: 4,
  border: "1px solid #D8D2C2",
  background: "#fff",
  color: COLORS.ink,
};

const actionBtn = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 11px",
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  cursor: "pointer",
};

const photoSectionLabel = {
  fontFamily: FONT_UTIL,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: COLORS.muted,
  marginBottom: 4,
};

const archiveReportBtn = {
  flex: "0 0 auto",
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid",
  background: "transparent",
  fontSize: 12,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  cursor: "pointer",
};

const stepperBtn = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: `1px solid ${COLORS.accent}`,
  background: "transparent",
  color: COLORS.accent,
  fontSize: 22,
  fontWeight: 700,
  fontFamily: FONT_BODY,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const backupRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderBottom: `1px solid ${COLORS.border}`,
};

const backupRestoreBtn = {
  flex: "0 0 auto",
  padding: "6px 12px",
  borderRadius: 6,
  border: `1px solid ${COLORS.accent}`,
  background: "transparent",
  color: COLORS.accent,
  fontSize: 12.5,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  cursor: "pointer",
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(36,41,38,0.5)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 50,
};

const modalCard = {
  background: COLORS.surface,
  borderTop: `1px solid ${COLORS.border}`,
  borderRadius: "16px 16px 0 0",
  padding: "26px 22px 30px",
  width: "100%",
  maxWidth: 480,
  maxHeight: "88vh",
  overflowY: "auto",
  boxShadow: "0 -4px 24px rgba(36,41,38,0.12)",
};

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  padding: "16px 16px 6px",
};

const statCard = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: "14px 16px",
  boxShadow: "0 1px 3px rgba(36,41,38,0.06)",
};

const statCardBtn = {
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const statLabel = {
  fontFamily: FONT_UTIL,
  fontSize: 12.5,
  color: COLORS.muted,
};

const statMain = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: 24,
  color: COLORS.ink,
  marginTop: 4,
};

const statUnit = {
  fontFamily: FONT_BODY,
  fontSize: 13,
  color: COLORS.muted,
  fontWeight: 400,
};

const statSub = {
  fontFamily: FONT_UTIL,
  fontSize: 12.5,
  fontWeight: 600,
  color: COLORS.accent,
  marginTop: 3,
};

const lookbackToggle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  border: "none",
  padding: "8px 0",
  fontFamily: FONT_BODY,
  fontSize: 13,
  fontWeight: 600,
  color: COLORS.accent,
  cursor: "pointer",
};

const lookbackPanel = {
  margin: "4px 16px 4px",
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: "14px 16px 16px",
  boxShadow: "0 1px 3px rgba(36,41,38,0.06)",
};

const lookbackPresetBtn = {
  flex: "0 0 auto",
  padding: "6px 12px",
  borderRadius: 999,
  border: `1px solid ${COLORS.accent}`,
  background: "transparent",
  color: COLORS.accent,
  fontSize: 12.5,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  cursor: "pointer",
};

const lookbackPresetBtnActive = {
  background: COLORS.accent,
  color: COLORS.surface,
};

const metricsGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const metricTile = {
  background: COLORS.surfaceMuted,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: "10px 12px",
};

const metricTileBtn = {
  display: "block",
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const metricLabel = {
  fontFamily: FONT_UTIL,
  fontSize: 12,
  color: COLORS.muted,
};

const metricValue = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: 18,
  color: COLORS.ink,
  marginTop: 3,
};

const metricSub = {
  fontFamily: FONT_UTIL,
  fontSize: 11,
  color: COLORS.muted,
  marginTop: 3,
};

const viewBadge = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: FONT_UTIL,
  fontSize: 13,
  color: COLORS.mutedOnDark,
  border: `1px solid ${COLORS.headerLine}`,
  borderRadius: 7,
  padding: "8px 12px",
};

const roleOption = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  background: COLORS.surfaceMuted,
  border: "1px solid",
  borderRadius: 8,
  padding: "12px 14px",
  cursor: "pointer",
};

const modalLabel = {
  display: "block",
  fontFamily: FONT_UTIL,
  fontSize: 13,
  color: COLORS.muted,
  marginBottom: 6,
  marginTop: 14,
};

const reportSectionLabel = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: 13,
  color: COLORS.ink,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 8,
};

const reportRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "4px 0",
};

const reportRowLabel = {
  fontFamily: FONT_UTIL,
  fontSize: 13,
  color: COLORS.muted,
};

const reportRowValue = {
  fontFamily: FONT_BODY,
  fontSize: 13.5,
  color: COLORS.ink,
  textAlign: "right",
};

const modalInput = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.surfaceMuted,
  color: COLORS.ink,
  fontFamily: FONT_BODY,
  // 16px+ keeps iOS Safari from auto-zooming the page when the input gets focus
  fontSize: 16,
};

const modalTextarea = {
  ...modalInput,
  minHeight: 70,
  resize: "vertical",
};
