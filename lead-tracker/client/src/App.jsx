import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "./api.js";

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
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
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

// ---- design tokens ----
// Matches the main RHX site: light content area, dark green header band,
// brand green for primary actions — same palette and font (Open Sans) as rhxutah.com.
const COLORS = {
  bg: "#F7F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF1EC",
  header: "#32473D",
  headerLine: "rgba(255,255,255,0.16)",
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

const SOURCES = [
  { key: "referral", label: "Referral" },
  { key: "referral_bni", label: "Referral (BNI)" },
  { key: "google", label: "Google Lead" },
  { key: "facebook", label: "Facebook Lead" },
  { key: "other", label: "Other" },
];

function sourceLabel(lead) {
  if (!lead.source) return null;
  if (lead.source === "other") return lead.sourceOther ? `Other — ${lead.sourceOther}` : "Other";
  const s = SOURCES.find((s) => s.key === lead.source);
  return s ? s.label : lead.source;
}

function fmtDateOnly(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
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

function fmtCurrency(n) {
  if (!n && n !== 0) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [role, setRole] = useState(null); // null = not signed in on this device
  const [leads, setLeads] = useState(null); // null = loading
  const [activeStage, setActiveStage] = useState("new");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [view, setView] = useState("board"); // 'board' | 'archive'
  const [showLookback, setShowLookback] = useState(false);
  const [lookbackStart, setLookbackStart] = useState("");
  const [lookbackEnd, setLookbackEnd] = useState("");
  const editable = role === "owner";

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
    try {
      const data = await api.listLeads();
      setLeads(data);
      setError("");
    } catch {
      setError("Couldn't load your saved leads.");
      setLeads([]);
    }
  }, []);

  useEffect(() => {
    if (role) loadLeads();
  }, [role, loadLeads]);

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
    setLeads(null);
    setShowAccountModal(false);
  };

  const addLead = async (name, source, sourceOther) => {
    if (!name.trim() || !source) return;
    try {
      const lead = await api.addLead({ name, source, sourceOther });
      setLeads((prev) => [lead, ...(prev || [])]);
      setShowAdd(false);
      setActiveStage("new");
      setError("");
    } catch {
      setError("Couldn't add that lead — try again.");
    }
  };

  const moveLead = async (id, stage, date) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, stage } : l)));
    try {
      const updated = await api.moveLead(id, stage, date);
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      setError("");
    } catch {
      setError("Couldn't save that move — try again.");
      loadLeads();
    }
  };

  const editField = async (id, field, value) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    try {
      const updated = await api.editLead(id, { [field]: value });
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      setError("");
    } catch {
      setError("Couldn't save that change — try again.");
      loadLeads();
    }
  };

  const deleteLead = async (id) => {
    const prevLeads = leads;
    setLeads((prev) => prev.filter((l) => l.id !== id));
    try {
      await api.deleteLead(id);
      setError("");
    } catch {
      setError("Couldn't delete that lead — try again.");
      setLeads(prevLeads);
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

  const visible = useMemo(
    () =>
      (leads || [])
        .filter((l) => !l.archived && l.stage === activeStage)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [leads, activeStage]
  );

  const stats = useMemo(() => {
    const now = new Date();
    const wStart = startOfWeek(now);
    const mStart = startOfMonth(now);
    const all = leads || [];
    const inRange = (iso, start) => iso && new Date(iso) >= start;
    return {
      leadsWeek: all.filter((l) => inRange(l.createdAt, wStart)).length,
      leadsMonth: all.filter((l) => inRange(l.createdAt, mStart)).length,
      wonWeek: all.filter((l) => inRange(l.wonAt, wStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      wonMonth: all.filter((l) => inRange(l.wonAt, mStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      earnedWeek: all.filter((l) => inRange(l.paidAt, wStart)).reduce((s, l) => s + (l.revenue || 0), 0),
      earnedMonth: all.filter((l) => inRange(l.paidAt, mStart)).reduce((s, l) => s + (l.revenue || 0), 0),
    };
  }, [leads]);

  const lookbackResult = useMemo(() => {
    if (!lookbackStart || !lookbackEnd) return null;
    const start = new Date(lookbackStart + "T00:00:00");
    const end = new Date(lookbackEnd + "T23:59:59");
    if (end < start) return null;
    const all = leads || [];
    const inRange = (iso) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d >= start && d <= end;
    };
    return {
      start,
      end,
      leadsCount: all.filter((l) => inRange(l.createdAt)).length,
      won: all.filter((l) => inRange(l.wonAt)).reduce((s, l) => s + (l.revenue || 0), 0),
      earned: all.filter((l) => inRange(l.paidAt)).reduce((s, l) => s + (l.revenue || 0), 0),
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
        .scrollx::-webkit-scrollbar { display: none; }
        .scrollx { -ms-overflow-style: none; scrollbar-width: none; }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
      `}</style>

      <header style={header}>
        <img src="/logo-mark-white.png" alt="" style={{ width: 84, height: 84, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 21, color: COLORS.surface }}>
            RHX Job Board
          </div>
          <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: COLORS.mutedOnDark, marginBottom: 12 }}>
            Track every lead from first contact to paid job
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {editable ? (
              <button onClick={() => setShowAdd(true)} style={addBtn} aria-label="Add new lead">
                <Plus size={16} strokeWidth={2.5} />
                New Lead
              </button>
            ) : (
              <div style={viewBadge}>
                <Eye size={13} color={COLORS.mutedOnDark} />
                <span>View only</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setView(view === "board" ? "archive" : "board")}
                style={headerIconBtn}
                aria-label={view === "board" ? "View past paid jobs" : "Back to board"}
              >
                {view === "board" ? (
                  <History size={21} color={COLORS.surface} strokeWidth={2} />
                ) : (
                  <Grid size={20} color={COLORS.surface} strokeWidth={2} />
                )}
              </button>
              <button onClick={() => setShowAccountModal(true)} style={headerIconBtn} aria-label="Account">
                <User size={21} color={COLORS.surface} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* weekly / monthly counters */}
      <div style={statsRow}>
        <div style={statCard}>
          <div style={statLabel}>This week</div>
          <div style={statMain}>{stats.leadsWeek} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonWeek)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedWeek)} earned</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>This month</div>
          <div style={statMain}>{stats.leadsMonth} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonMonth)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedMonth)} earned</div>
        </div>
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
              <div style={statSub}>{fmtCurrency(lookbackResult.earned)} earned</div>
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
          <div className="scrollx" style={tabsRow}>
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
              <LeadTicket
                key={lead.id}
                lead={lead}
                onMove={moveLead}
                onEditField={editField}
                onDelete={deleteLead}
                editable={editable}
              />
            ))}
          </main>
        </>
      ) : (
        <ArchiveView leads={leads} />
      )}

      {showAdd && <AddLeadModal onAdd={addLead} onClose={() => setShowAdd(false)} />}
      {showAccountModal && (
        <AccountModal
          role={role}
          onSwitch={handleLogin}
          onLogout={handleLogout}
          onClose={() => setShowAccountModal(false)}
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, justifyContent: "center" }}>
          <img src="/logo-mark-accent.png" alt="" style={{ width: 40, height: 40 }} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: COLORS.ink }}>
            RHX Job Board
          </div>
        </div>
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

function AccountModal({ role, onSwitch, onLogout, onClose }) {
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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

function ArchiveView({ leads }) {
  const [granularity, setGranularity] = useState("month"); // 'week' | 'month' | 'year'
  const [openKey, setOpenKey] = useState(null);

  const paidLeads = useMemo(() => (leads || []).filter((l) => l.paidAt), [leads]);

  const periods = useMemo(() => {
    const map = new Map();
    paidLeads.forEach((l) => {
      const d = new Date(l.paidAt);
      let key, label, sortDate;
      if (granularity === "week") {
        const ws = startOfWeek(d);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        key = ws.toISOString().slice(0, 10);
        label = `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(
          undefined,
          { month: "short", day: "numeric", year: "numeric" }
        )}`;
        sortDate = ws;
      } else if (granularity === "year") {
        key = `${d.getFullYear()}`;
        label = key;
        sortDate = new Date(d.getFullYear(), 0, 1);
      } else {
        key = `${d.getFullYear()}-${d.getMonth()}`;
        label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        sortDate = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      if (!map.has(key)) map.set(key, { key, label, sortDate, leads: [] });
      map.get(key).leads.push(l);
    });
    return Array.from(map.values()).sort((a, b) => b.sortDate - a.sortDate);
  }, [paidLeads, granularity]);

  return (
    <main style={cardsWrap}>
      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
        {["week", "month", "year"].map((g) => (
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
            {g[0].toUpperCase() + g.slice(1)}
          </button>
        ))}
      </div>

      {periods.length === 0 && (
        <div style={emptyState}>
          <div
            style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink, fontSize: 15, marginBottom: 4 }}
          >
            Nothing archived yet
          </div>
          <div style={{ fontFamily: FONT_BODY, color: COLORS.muted, fontSize: 13 }}>
            Paid jobs land here so you can look back by week, month, or year.
          </div>
        </div>
      )}

      {periods.map((p) => {
        const revenue = p.leads.reduce((s, l) => s + (l.revenue || 0), 0);
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
                  {p.leads.length} paid · {fmtCurrency(revenue)}
                </div>
              </div>
              {open ? <ChevronUp size={16} color="#9A9184" /> : <ChevronDown size={16} color="#9A9184" />}
            </button>
            {open && (
              <div style={{ borderTop: "1px solid #E4DFD1" }}>
                {p.leads
                  .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
                  .map((l) => (
                    <div key={l.id} style={{ padding: "10px 14px", borderBottom: "1px solid #EDE8DB" }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink, fontWeight: 600 }}>
                        {l.name}
                      </div>
                      <div style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: "#8A8478" }}>
                        {fmtCurrency(l.revenue)} · paid {fmtDate(l.paidAt.slice(0, 10))}
                        {sourceLabel(l) ? ` · ${sourceLabel(l)}` : ""}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}

function LeadTicket({ lead, onMove, onEditField, onDelete, editable }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(lead.name);
  const [editingReceived, setEditingReceived] = useState(false);
  const [receivedDraft, setReceivedDraft] = useState("");
  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState(lead.startDate || "");
  const [editingRevenue, setEditingRevenue] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState(lead.revenue != null ? String(lead.revenue) : "");
  const [confirmDel, setConfirmDel] = useState(false);

  const stage = STAGES.find((s) => s.key === lead.stage);

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed) onEditField(lead.id, "name", trimmed);
    else setNameDraft(lead.name);
    setEditingName(false);
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

  const saveStart = () => {
    onEditField(lead.id, "startDate", startDraft);
    setEditingStart(false);
  };

  const saveRevenue = () => {
    const n = parseFloat(revenueDraft);
    onEditField(lead.id, "revenue", isNaN(n) ? null : n);
    setEditingRevenue(false);
  };

  return (
    <div style={ticket}>
      <div style={{ ...ticketStub, background: stage?.color || COLORS.info }} />
      <div style={{ flex: 1, padding: "16px 18px 16px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          {!editingName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
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
              {editable && (
                <button
                  onClick={() => {
                    setNameDraft(lead.name);
                    setEditingName(true);
                  }}
                  style={iconBtnGhost}
                  aria-label="Edit name"
                >
                  <Pencil size={12} color="#9A9184" />
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                style={{ ...inlineInput, fontFamily: FONT_DISPLAY, fontSize: 15, flex: 1 }}
              />
              <button onClick={saveName} style={{ ...iconBtn, background: COLORS.accent }} aria-label="Save name">
                <Check size={13} color="#fff" />
              </button>
              <button
                onClick={() => {
                  setNameDraft(lead.name);
                  setEditingName(false);
                }}
                style={{ ...iconBtn, background: "#B8B0A0" }}
                aria-label="Cancel name edit"
              >
                <X size={13} color="#fff" />
              </button>
            </div>
          )}
          {editable && !editingName && (
            !confirmDel ? (
              <button onClick={() => setConfirmDel(true)} style={iconBtnGhost} aria-label="Delete lead">
                <Trash2 size={15} color="#9A9184" />
              </button>
            ) : (
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => onDelete(lead.id)} style={{ ...iconBtn, background: COLORS.rust }} aria-label="Confirm delete">
                  <Check size={13} color="#fff" />
                </button>
                <button onClick={() => setConfirmDel(false)} style={{ ...iconBtn, background: "#B8B0A0" }} aria-label="Cancel delete">
                  <X size={13} color="#fff" />
                </button>
              </div>
            )
          )}
        </div>

        {/* received timestamp */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Received</span>
          {!editingReceived ? (
            <>
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: "#4A463D" }}>{fmtDateOnly(lead.createdAt)}</span>
              {editable && (
                <button onClick={openReceivedEdit} style={iconBtnGhost} aria-label="Edit received date">
                  <Pencil size={12} color="#9A9184" />
                </button>
              )}
            </>
          ) : (
            <>
              <input
                type="date"
                value={receivedDraft}
                onChange={(e) => setReceivedDraft(e.target.value)}
                style={inlineInput}
              />
              <button onClick={saveReceived} style={{ ...iconBtn, background: COLORS.accent }}>
                <Check size={13} color="#fff" />
              </button>
              <button onClick={() => setEditingReceived(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                <X size={13} color="#fff" />
              </button>
            </>
          )}
        </div>

        {lead.source && (
          <div style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478", marginTop: 6 }}>
            Source: {sourceLabel(lead)}
          </div>
        )}

        {/* revenue — can be attached at any stage */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Revenue</span>
          {!editingRevenue ? (
            <>
              <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: lead.revenue != null ? "#4A463D" : "#B8B0A0" }}>
                {lead.revenue != null ? fmtCurrency(lead.revenue) : "not set"}
              </span>
              {editable && (
                <button
                  onClick={() => {
                    setRevenueDraft(lead.revenue != null ? String(lead.revenue) : "");
                    setEditingRevenue(true);
                  }}
                  style={iconBtnGhost}
                  aria-label="Edit revenue"
                >
                  <Pencil size={12} color="#9A9184" />
                </button>
              )}
            </>
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
                <Check size={13} color="#fff" />
              </button>
              <button onClick={() => setEditingRevenue(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                <X size={13} color="#fff" />
              </button>
            </>
          )}
        </div>

        {/* start date, only for won-not-started (and visible afterwards too) */}
        {(lead.stage === "won" || lead.stage === "progress" || lead.stage === "completed" || lead.stage === "paid") && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: FONT_UTIL, fontSize: 13, color: "#8A8478" }}>Start date</span>
            {!editingStart ? (
              <>
                <span style={{ fontFamily: FONT_UTIL, fontSize: 13.5, color: lead.startDate ? "#4A463D" : "#B8482E" }}>
                  {lead.startDate ? fmtDate(lead.startDate) : "not set"}
                </span>
                {editable && (
                  <button
                    onClick={() => {
                      setStartDraft(lead.startDate || "");
                      setEditingStart(true);
                    }}
                    style={iconBtnGhost}
                    aria-label="Edit start date"
                  >
                    <Pencil size={12} color="#9A9184" />
                  </button>
                )}
              </>
            ) : (
              <>
                <input type="date" value={startDraft} onChange={(e) => setStartDraft(e.target.value)} style={inlineInput} />
                <button onClick={saveStart} style={{ ...iconBtn, background: COLORS.accent }}>
                  <Check size={13} color="#fff" />
                </button>
                <button onClick={() => setEditingStart(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                  <X size={13} color="#fff" />
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

        {/* actions */}
        {editable && <ActionRow lead={lead} onMove={onMove} />}
      </div>
    </div>
  );
}

const BACKDATE_THRESHOLD_DAYS = 7;

// "won" and "paid" both stamp a date used for weekly/monthly stats and the
// archive's month grouping — moving a long-backlogged lead into either
// without checking would silently misdate it to today.
function priorDateFor(lead, stage) {
  if (stage === "won") return lead.createdAt;
  if (stage === "paid") return lead.wonAt || lead.createdAt;
  return null;
}

function ActionRow({ lead, onMove }) {
  const [confirmStage, setConfirmStage] = useState(null);

  const handleClick = (target) => {
    const prior = priorDateFor(lead, target);
    if (prior) {
      const days = (Date.now() - new Date(prior).getTime()) / 86400000;
      if (days > BACKDATE_THRESHOLD_DAYS) {
        setConfirmStage(target);
        return;
      }
    }
    onMove(lead.id, target);
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
      actions = [btn("Won", "won"), btn("Lost", "lost", "secondary")];
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

  return (
    <>
      {actions.length > 0 && <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{actions}</div>}
      {confirmStage && (
        <BackdateModal
          stage={confirmStage}
          onConfirm={(date) => {
            onMove(lead.id, confirmStage, date);
            setConfirmStage(null);
          }}
          onCancel={() => setConfirmStage(null)}
        />
      )}
    </>
  );
}

function BackdateModal({ stage, onConfirm, onCancel }) {
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const label = stage === "won" ? "won" : "paid";

  return (
    <div style={modalOverlay} onClick={onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: COLORS.ink, marginBottom: 8 }}>
          Backdate this {label} date?
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.muted }}>
          This lead was received a while ago, so it looks like it might be getting added late. If it was actually{" "}
          {label} earlier, set the real date below — otherwise just confirm today's date.
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

function AddLeadModal({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [sourceOther, setSourceOther] = useState("");

  const canSubmit = name.trim() && source && (source !== "other" || sourceOther.trim());

  const submit = () => {
    if (!canSubmit) return;
    onAdd(name, source, sourceOther);
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
        <label style={modalLabel}>Name / job</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Nguyen — gutters, Lehi"
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
        {source === "other" && (
          <>
            <label style={modalLabel}>Describe the source</label>
            <input
              value={sourceOther}
              onChange={(e) => setSourceOther(e.target.value)}
              placeholder="e.g. Yard sign, past client referral…"
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
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "18px 20px",
  background: COLORS.header,
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
  gap: 8,
  padding: "12px 16px",
  overflowX: "auto",
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
  width: 22,
  height: 22,
  borderRadius: 5,
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const iconBtnGhost = {
  ...iconBtn,
  background: "transparent",
  width: 20,
  height: 20,
};

const headerIconBtn = {
  width: 42,
  height: 42,
  borderRadius: 11,
  border: "none",
  background: "rgba(255,255,255,0.16)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const inlineInput = {
  fontFamily: FONT_UTIL,
  fontSize: 12.5,
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
  boxShadow: "0 -4px 24px rgba(36,41,38,0.12)",
};

const statsRow = {
  display: "flex",
  gap: 12,
  padding: "16px 16px 6px",
};

const statCard = {
  flex: 1,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: "14px 16px",
  boxShadow: "0 1px 3px rgba(36,41,38,0.06)",
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

const modalInput = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.surfaceMuted,
  color: COLORS.ink,
  fontFamily: FONT_BODY,
  fontSize: 15,
};
