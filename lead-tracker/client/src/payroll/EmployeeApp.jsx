import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
  C,
  FONT_BODY,
  FONT_DISPLAY,
  btnPrimary,
  btnSecondary,
  btnDanger,
  sectionLabel,
  card,
  input,
  label,
  headerBar,
  sheetOverlay,
  sheet,
  pill,
  errorText,
  fmtTime,
  fmtDay,
  fmtHours,
  fmtDuration,
  toLocalInput,
  fromLocalInput,
  todayAt,
  currentPosition,
} from "./shared.js";

// ── GPS while on the clock ──────────────────────────────────────────────
// A web app can only read the phone's location while it's open on screen —
// iOS and Android both pause it once the phone locks or he switches apps.
// Fixes are queued on the phone (so a dead zone loses nothing) and sent up
// once a minute; the server files each one under the shift it falls in and
// drops anything taken off the clock.
const QUEUE_KEY = "rhxGpsQueue";
const SAVE_EVERY_MS = 2 * 60 * 1000; // at most one fix per 2 min…
const SAVE_IF_MOVED_M = 100; // …unless he's moved 100 m+
const HEARTBEAT_MS = 5 * 60 * 1000; // ask for a fix if none came in 5 min (standing still)

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-2000)));
  } catch {
    // storage full / private mode — the fixes just won't survive a reload
  }
}
function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let flushing = false;
async function flushGps() {
  if (flushing) return;
  const q = readQueue();
  if (!q.length) return;
  flushing = true;
  try {
    await api.sendGps(q.slice(0, 500));
    writeQueue(readQueue().slice(Math.min(q.length, 500)));
  } catch {
    // offline — try again next tick
  } finally {
    flushing = false;
  }
}

function useShiftGps(onShift) {
  const [gps, setGps] = useState({ state: "off", lastAt: null });

  useEffect(() => {
    flushGps();
    if (!onShift) {
      setGps({ state: "off", lastAt: null });
      return;
    }
    if (!("geolocation" in navigator)) {
      setGps({ state: "unavailable", lastAt: null });
      return;
    }
    let last = null;
    const record = (pos) => {
      const p = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        ts: new Date(pos.timestamp || Date.now()).toISOString(),
      };
      const now = Date.now();
      if (!last || now - last.at >= SAVE_EVERY_MS || metersBetween(last.p, p) >= SAVE_IF_MOVED_M) {
        writeQueue([...readQueue(), p]);
        last = { p, at: now };
      }
      setGps({ state: "on", lastAt: p.ts });
    };
    const fail = (err) => setGps((g) => ({ ...g, state: err.code === 1 ? "denied" : g.state === "on" ? "on" : "searching" }));
    setGps({ state: "searching", lastAt: null });
    const watchId = navigator.geolocation.watchPosition(record, fail, {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 60000,
    });
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!last || Date.now() - last.at >= HEARTBEAT_MS) {
        navigator.geolocation.getCurrentPosition(record, fail, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
      }
      flushGps();
    }, 60000);
    const onVisible = () => flushGps();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      flushGps();
    };
  }, [onShift]);

  return gps;
}

// ── screen ─────────────────────────────────────────────────────────────
export default function EmployeeApp({ employee, onLogout }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [locationWarning, setLocationWarning] = useState("");
  const [lateMode, setLateMode] = useState(false); // "I started at…" / "I stopped at…"
  const [lateTime, setLateTime] = useState("");
  const [showMissed, setShowMissed] = useState(false);
  const [now, setNow] = useState(Date.now());

  const open = status?.open || null;
  const gps = useShiftGps(!!open);

  const load = useCallback(async () => {
    try {
      setStatus(await api.clockStatus());
      setLoadError("");
    } catch (e) {
      if (e.status === 401) return onLogout();
      setLoadError("Couldn't load your time clock — check your signal.");
    }
  }, [onLogout]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const punch = async () => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setLocationWarning("");
    try {
      const { point, error } = await currentPosition();
      if (!point) {
        setLocationWarning(
          error === "denied"
            ? "Location is blocked, so this punch has no GPS. Turn on Location for this app in your phone's Settings."
            : "Couldn't get a GPS fix — the punch was saved without a location."
        );
      }
      const body = { location: point };
      if (lateMode && lateTime) {
        if (open) body.stoppedAt = todayAtOrYesterday(lateTime, open.clockIn);
        else body.startedAt = todayAt(lateTime);
      }
      const next = open ? await api.clockOut(body) : await api.clockIn(body);
      setStatus(next);
      setLateMode(false);
      setLateTime("");
    } catch (e) {
      setActionError(e.message || "That didn't go through — try again");
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (id) => {
    try {
      setStatus(await api.cancelMissedShift(id));
    } catch (e) {
      setActionError(e.message);
    }
  };

  const week = status?.week;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT_BODY }}>
      <style>{`* { box-sizing: border-box; } input, button, textarea { font-family: inherit; }`}</style>
      <div style={headerBar}>
        <img src="/logo-mark.png" alt="" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>Time Clock</div>
          <div style={{ fontSize: 12.5, opacity: 0.75 }}>{employee.name}</div>
        </div>
        <button onClick={onLogout} style={{ ...btnSecondary, background: "rgba(255,255,255,0.12)", color: "#fff" }}>
          Sign out
        </button>
      </div>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {loadError && <div style={{ ...card, color: C.rust }}>{loadError}</div>}
        {!status && !loadError && <div style={{ color: C.muted, textAlign: "center", padding: 30 }}>Loading…</div>}

        {status && (
          <div style={{ ...card, textAlign: "center", padding: "22px 16px" }}>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>{open ? "On the clock" : "Off the clock"}</div>
            {open ? (
              <>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 38, color: C.ink }}>
                  {fmtDuration(now - new Date(open.clockIn))}
                </div>
                <div style={{ color: C.muted, fontSize: 14, marginTop: 2 }}>since {fmtTime(open.clockIn)}</div>
              </>
            ) : (
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, margin: "6px 0" }}>
                {new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </div>
            )}

            {lateMode && (
              <div style={{ textAlign: "left", marginTop: 14 }}>
                <label style={label}>{open ? "I actually stopped working at" : "I actually started working at"}</label>
                <input type="time" value={lateTime} onChange={(e) => setLateTime(e.target.value)} style={input} />
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>
                  {open
                    ? "Your shift will end at that time instead of now."
                    : "You'll be clocked in from now, and the earlier time goes to the office to approve."}
                </div>
              </div>
            )}

            <button
              onClick={punch}
              disabled={busy || (lateMode && !lateTime)}
              style={{
                ...(open ? { ...btnPrimary, background: C.rust } : btnPrimary),
                width: "100%",
                marginTop: 18,
                padding: "18px 14px",
                fontSize: 20,
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                borderRadius: 12,
                opacity: busy || (lateMode && !lateTime) ? 0.6 : 1,
              }}
            >
              {busy ? "Getting location…" : open ? "Clock Out" : "Clock In"}
            </button>
            <button
              onClick={() => {
                setLateMode((v) => !v);
                setLateTime("");
              }}
              style={{ background: "none", border: "none", color: C.accent, fontWeight: 600, fontSize: 14, marginTop: 12, cursor: "pointer" }}
            >
              {lateMode ? "Never mind — use the time right now" : open ? "Forgot to clock out earlier?" : "Forgot to clock in? Started earlier?"}
            </button>
            {actionError && <div style={errorText}>{actionError}</div>}
            {locationWarning && <div style={{ ...errorText, color: C.amber }}>{locationWarning}</div>}
            {open && <GpsStatus gps={gps} />}
          </div>
        )}

        {week && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <div style={sectionLabel}>This week</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{week.label}</div>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 28, color: C.ink }}>
                {fmtHours(week.totalHours)}
                <span style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}> hrs</span>
              </div>
            </div>
            <DayBars days={week.days} />
            {week.pendingHours > 0 && (
              <div style={{ fontSize: 13, color: C.amber, marginTop: 10 }}>
                + {fmtHours(week.pendingHours)} hrs waiting on the office to approve
              </div>
            )}
            <EntryList entries={week.entries} onCancelRequest={cancelRequest} />
            <button onClick={() => setShowMissed(true)} style={{ ...btnSecondary, width: "100%", marginTop: 14 }}>
              Add a shift I missed
            </button>
          </div>
        )}

        {status && <History />}

        <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: "0 12px 24px", lineHeight: 1.5 }}>
          Your location is recorded only while you're clocked in and this app is open. Nothing is tracked when you're off
          the clock.
        </div>
      </div>

      {showMissed && (
        <MissedShiftSheet
          onClose={() => setShowMissed(false)}
          onSaved={(next) => {
            setStatus(next);
            setShowMissed(false);
          }}
        />
      )}
    </div>
  );
}

// "I stopped at 4:30" typed the next morning means yesterday 4:30 — pick the
// latest instant at that clock time that's after he clocked in and not in
// the future
function todayAtOrYesterday(hhmm, clockInIso) {
  const today = new Date(todayAt(hhmm));
  if (today <= new Date()) return today.toISOString();
  const yesterday = new Date(today.getTime() - 86400000);
  return (yesterday > new Date(clockInIso) ? yesterday : today).toISOString();
}

function GpsStatus({ gps }) {
  const text =
    gps.state === "on"
      ? `GPS on · last fix ${fmtTime(gps.lastAt)}`
      : gps.state === "searching"
        ? "GPS: looking for a signal…"
        : gps.state === "denied"
          ? "GPS is blocked — turn on Location for this app in Settings"
          : "GPS isn't available on this phone";
  const color = gps.state === "on" ? C.accent : gps.state === "searching" ? C.muted : C.rust;
  return (
    <div style={{ marginTop: 12, fontSize: 12.5, color, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: "inline-block" }} />
      {text}
    </div>
  );
}

export function DayBars({ days }) {
  const max = Math.max(10, ...days.map((d) => d.hours));
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 14, alignItems: "flex-end" }}>
      {days.map((d) => (
        <div key={d.date} style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.ink, fontWeight: 600, marginBottom: 4 }}>{d.hours ? d.hours.toFixed(1) : ""}</div>
          <div style={{ height: 64, display: "flex", alignItems: "flex-end", background: C.surfaceMuted, borderRadius: 5 }}>
            <div style={{ width: "100%", height: `${(d.hours / max) * 100}%`, background: C.accent, borderRadius: 5 }} />
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{d.label.split(" ")[0]}</div>
        </div>
      ))}
    </div>
  );
}

function EntryList({ entries, onCancelRequest }) {
  if (!entries.length) return <div style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>No shifts yet this week.</div>;
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}` }}>
      {entries.map((e) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>{fmtDay(e.clockIn)}</div>
            <div style={{ fontSize: 13, color: C.muted }}>
              {fmtTime(e.clockIn)} – {e.clockOut ? fmtTime(e.clockOut) : "now"}
              {e.status === "pending" && (
                <>
                  {" "}
                  <span style={pill("#FBF1DF", C.amber)}>WAITING FOR APPROVAL</span>
                </>
              )}
              {e.status === "approved" && e.source !== "app" && (
                <>
                  {" "}
                  <span style={pill(C.surfaceMuted, C.muted)}>ADJUSTED</span>
                </>
              )}
            </div>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: e.status === "pending" ? C.muted : C.ink }}>
            {fmtHours(e.hours)}
          </div>
          {e.status === "pending" && onCancelRequest && (
            <button onClick={() => onCancelRequest(e.id)} style={{ ...btnDanger, padding: "6px 10px", fontSize: 12 }}>
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function History() {
  const [weeks, setWeeks] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api
      .clockHistory()
      .then((h) => {
        // the first week is this week, already shown above
        setWeeks(h.weeks.slice(1));
        setNextBefore(h.nextBefore);
      })
      .catch(() => setWeeks([]));
  }, []);

  const more = async () => {
    setLoadingMore(true);
    try {
      const h = await api.clockHistory(nextBefore);
      setWeeks((w) => [...w, ...h.weeks]);
      setNextBefore(h.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!weeks) return null;
  const withHours = weeks.filter((w) => w.entries.length);
  return (
    <div style={card}>
      <div style={sectionLabel}>Past weeks</div>
      {!withHours.length && <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>Nothing yet.</div>}
      {withHours.map((w) => (
        <div key={w.periodStart} style={{ borderBottom: `1px solid ${C.border}` }}>
          <button
            onClick={() => setOpenKey(openKey === w.periodStart ? null : w.periodStart)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "none",
              border: "none",
              padding: "12px 0",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 14, color: C.ink }}>{w.label}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>{fmtHours(w.totalHours)} hrs</span>
          </button>
          {openKey === w.periodStart && (
            <div style={{ paddingBottom: 10 }}>
              <DayBars days={w.days} />
              <EntryList entries={w.entries} />
            </div>
          )}
        </div>
      ))}
      {nextBefore && (
        <button onClick={more} disabled={loadingMore} style={{ ...btnSecondary, width: "100%", marginTop: 12 }}>
          {loadingMore ? "Loading…" : "Show older weeks"}
        </button>
      )}
    </div>
  );
}

function MissedShiftSheet({ onClose, onSaved }) {
  const yesterday8 = new Date();
  yesterday8.setDate(yesterday8.getDate() - 1);
  yesterday8.setHours(8, 0, 0, 0);
  const [start, setStart] = useState(toLocalInput(yesterday8.toISOString()));
  const [end, setEnd] = useState(toLocalInput(new Date(yesterday8.getTime() + 8.5 * 3600000).toISOString()));
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      onSaved(await api.requestMissedShift({ clockIn: fromLocalInput(start), clockOut: fromLocalInput(end), note }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={sheetOverlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>Add a shift I missed</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          The office will approve it before it counts toward your hours.
        </div>
        <label style={label}>Started</label>
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={input} />
        <label style={label}>Finished</label>
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={input} />
        <label style={label}>Which job / what happened</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ ...input, minHeight: 70, resize: "vertical" }}
          placeholder="e.g. Smith job — phone was dead"
        />
        {err && <div style={errorText}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...btnSecondary, flex: 1 }}>
            Cancel
          </button>
          <button onClick={save} disabled={busy || !note.trim()} style={{ ...btnPrimary, flex: 2, opacity: busy || !note.trim() ? 0.6 : 1 }}>
            {busy ? "Sending…" : "Send to office"}
          </button>
        </div>
      </div>
    </div>
  );
}
