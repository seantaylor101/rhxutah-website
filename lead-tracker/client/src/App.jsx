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
const Ticket = (p) => (
  <Icon {...p}>
    <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4Z" />
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
const Unlock = (p) => (
  <Icon {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Icon>
);
const Archive = (p) => (
  <Icon {...p}>
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <line x1="10" y1="13" x2="14" y2="13" />
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

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

  const moveLead = async (id, stage) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, stage } : l)));
    try {
      const updated = await api.moveLead(id, stage);
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

  const stageIdx = STAGES.findIndex((s) => s.key === activeStage);

  if (!authChecked) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT_UTIL, letterSpacing: "0.08em", fontSize: 13 }}>
          CHECKING SESSION…
        </div>
      </div>
    );
  }

  if (!role) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (leads === null) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT_UTIL, letterSpacing: "0.08em", fontSize: 13 }}>
          LOADING BOARD…
        </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Ticket size={20} color={COLORS.surface} strokeWidth={1.75} />
          <div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 19,
                color: COLORS.surface,
                letterSpacing: "0.01em",
              }}
            >
              RHX Job Board
            </div>
            <div style={{ fontFamily: FONT_UTIL, fontSize: 11, color: COLORS.mutedOnDark, letterSpacing: "0.06em" }}>
              LEAD → BID → WON/LOST → PROGRESS → PAID
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          <button
            onClick={() => setView(view === "board" ? "archive" : "board")}
            style={iconBtnGhost}
            aria-label={view === "board" ? "View archive" : "Back to board"}
          >
            {view === "board" ? (
              <Archive size={15} color={COLORS.mutedOnDark} />
            ) : (
              <Ticket size={15} color={COLORS.mutedOnDark} />
            )}
          </button>
          <button onClick={() => setShowAccountModal(true)} style={iconBtnGhost} aria-label="Account">
            <Unlock size={15} color={COLORS.mutedOnDark} />
          </button>
        </div>
      </header>

      {/* weekly / monthly counters */}
      <div style={statsRow}>
        <div style={statCard}>
          <div style={statLabel}>THIS WEEK</div>
          <div style={statMain}>{stats.leadsWeek} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonWeek)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedWeek)} earned</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>THIS MONTH</div>
          <div style={statMain}>{stats.leadsMonth} <span style={statUnit}>leads</span></div>
          <div style={statSub}>{fmtCurrency(stats.wonMonth)} won</div>
          <div style={statSub}>{fmtCurrency(stats.earnedMonth)} earned</div>
        </div>
      </div>

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
          <Ticket size={22} color={COLORS.accent} strokeWidth={1.75} />
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
                <div style={{ fontFamily: FONT_UTIL, fontSize: 11, color: "#8A8478" }}>
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
                      <div style={{ fontFamily: FONT_UTIL, fontSize: 11, color: "#8A8478" }}>
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
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
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

  const openTimeEdit = () => {
    const d = new Date(lead.createdAt);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    setTimeDraft(local.toISOString().slice(0, 16));
    setEditingTime(true);
  };

  const saveTime = () => {
    if (timeDraft) onEditField(lead.id, "createdAt", new Date(timeDraft).toISOString());
    setEditingTime(false);
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
      <div style={{ flex: 1, padding: "12px 14px 12px 10px" }}>
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
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: FONT_UTIL, fontSize: 10.5, color: "#8A8478", letterSpacing: "0.06em" }}>
            RECEIVED
          </span>
          {!editingTime ? (
            <>
              <span style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: "#4A463D" }}>{fmtDateTime(lead.createdAt)}</span>
              {editable && (
                <button onClick={openTimeEdit} style={iconBtnGhost} aria-label="Edit received time">
                  <Pencil size={12} color="#9A9184" />
                </button>
              )}
            </>
          ) : (
            <>
              <input
                type="datetime-local"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                style={inlineInput}
              />
              <button onClick={saveTime} style={{ ...iconBtn, background: COLORS.accent }}>
                <Check size={13} color="#fff" />
              </button>
              <button onClick={() => setEditingTime(false)} style={{ ...iconBtn, background: "#B8B0A0" }}>
                <X size={13} color="#fff" />
              </button>
            </>
          )}
        </div>

        {lead.source && (
          <div style={{ fontFamily: FONT_UTIL, fontSize: 10.5, color: "#8A8478", letterSpacing: "0.04em", marginTop: 4 }}>
            SOURCE: {sourceLabel(lead)}
          </div>
        )}

        {/* revenue — can be attached at any stage */}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: FONT_UTIL, fontSize: 10.5, color: "#8A8478", letterSpacing: "0.06em" }}>
            REVENUE
          </span>
          {!editingRevenue ? (
            <>
              <span style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: lead.revenue != null ? "#4A463D" : "#B8B0A0" }}>
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
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: FONT_UTIL, fontSize: 10.5, color: "#8A8478", letterSpacing: "0.06em" }}>
              START DATE
            </span>
            {!editingStart ? (
              <>
                <span style={{ fontFamily: FONT_UTIL, fontSize: 12.5, color: lead.startDate ? "#4A463D" : "#B8482E" }}>
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
          <div style={{ marginTop: 6, fontFamily: FONT_UTIL, fontSize: 10.5, color: "#8A8478", letterSpacing: "0.06em" }}>
            PAID {fmtDateTime(lead.paidAt).toUpperCase()} · clears next month
          </div>
        )}

        {/* actions */}
        {editable && <ActionRow lead={lead} onMove={onMove} />}
      </div>
    </div>
  );
}

function ActionRow({ lead, onMove }) {
  const btn = (label, target, kind = "primary") => (
    <button
      key={target}
      onClick={() => onMove(lead.id, target)}
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

  if (actions.length === 0) return null;
  return <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{actions}</div>;
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
        <div style={{ fontFamily: FONT_UTIL, fontSize: 11, color: COLORS.muted, marginTop: 6, marginBottom: 16, letterSpacing: "0.04em" }}>
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
  justifyContent: "space-between",
  padding: "16px 16px 12px",
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
  padding: "4px 14px 32px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
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
  borderRadius: 8,
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
  borderRadius: "14px 14px 0 0",
  padding: "20px 18px 26px",
  width: "100%",
  maxWidth: 480,
  boxShadow: "0 -4px 24px rgba(36,41,38,0.12)",
};

const statsRow = {
  display: "flex",
  gap: 10,
  padding: "12px 16px 4px",
};

const statCard = {
  flex: 1,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 9,
  padding: "10px 12px",
  boxShadow: "0 1px 3px rgba(36,41,38,0.06)",
};

const statLabel = {
  fontFamily: FONT_UTIL,
  fontSize: 10,
  color: COLORS.muted,
  letterSpacing: "0.08em",
};

const statMain = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: 22,
  color: COLORS.ink,
  marginTop: 2,
};

const statUnit = {
  fontFamily: FONT_BODY,
  fontSize: 12,
  color: COLORS.muted,
  fontWeight: 400,
};

const statSub = {
  fontFamily: FONT_UTIL,
  fontSize: 11,
  fontWeight: 600,
  color: COLORS.accent,
  marginTop: 2,
};

const viewBadge = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: FONT_UTIL,
  fontSize: 11.5,
  color: COLORS.mutedOnDark,
  letterSpacing: "0.05em",
  border: `1px solid ${COLORS.headerLine}`,
  borderRadius: 7,
  padding: "7px 11px",
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
  padding: "10px 12px",
  cursor: "pointer",
};

const modalLabel = {
  display: "block",
  fontFamily: FONT_UTIL,
  fontSize: 10.5,
  color: COLORS.muted,
  letterSpacing: "0.06em",
  marginBottom: 5,
  marginTop: 10,
};

const modalInput = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 7,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.surfaceMuted,
  color: COLORS.ink,
  fontFamily: FONT_BODY,
  fontSize: 14,
};
