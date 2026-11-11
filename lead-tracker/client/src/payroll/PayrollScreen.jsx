import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { DayBars } from "./EmployeeApp.jsx";
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
  fmtMoney,
  toLocalInput,
  fromLocalInput,
  mapsLink,
  mailtoHref,
} from "./shared.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function PayrollScreen({ onClose }) {
  const [employees, setEmployees] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");

  const loadEmployees = useCallback(async () => {
    try {
      const res = await api.listEmployees();
      setEmployees(res.employees);
      setSelectedId((id) => (id && res.employees.some((e) => e.id === id) ? id : res.employees.find((e) => e.active)?.id || res.employees[0]?.id || null));
    } catch (e) {
      setError(e.message);
      setEmployees([]);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
    api.payrollSettings().then(setSettings).catch(() => {});
  }, [loadEmployees]);

  // lock the board underneath while this is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const selected = employees?.find((e) => e.id === selectedId) || null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: C.bg, overflowY: "auto", fontFamily: FONT_BODY }}>
      <div style={headerBar}>
        <button onClick={onClose} style={{ ...btnSecondary, background: "rgba(255,255,255,0.12)", color: "#fff" }}>
          ‹ Back
        </button>
        <div style={{ flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>Employees & Payroll</div>
        <button onClick={() => setShowSettings(true)} style={{ ...btnSecondary, background: "rgba(255,255,255,0.12)", color: "#fff" }}>
          Settings
        </button>
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div style={{ ...card, color: C.rust }}>{error}</div>}
        {settings && !settings.payrollEmail && (
          <button onClick={() => setShowSettings(true)} style={{ ...card, textAlign: "left", cursor: "pointer", borderColor: C.amber }}>
            <div style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>Add your payroll person's email</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>So "Submit payroll" can address the email for you.</div>
          </button>
        )}

        {employees && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {employees.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                style={{
                  ...btnSecondary,
                  background: e.id === selectedId ? C.ink : C.surface,
                  color: e.id === selectedId ? "#fff" : e.active ? C.ink : C.muted,
                  border: `1px solid ${C.border}`,
                  borderRadius: 999,
                }}
              >
                {e.clockedIn && <span style={{ width: 8, height: 8, borderRadius: 4, background: "#3DDC84", display: "inline-block" }} />}
                {e.name}
                {!e.active && " (off)"}
                {e.pendingRequests > 0 && <span style={pill("#FBF1DF", C.amber)}>{e.pendingRequests}</span>}
              </button>
            ))}
            <button onClick={() => setShowAdd(true)} style={{ ...btnPrimary, borderRadius: 999 }}>
              + Add employee
            </button>
          </div>
        )}

        {employees && !employees.length && (
          <div style={{ ...card, textAlign: "center", padding: 28 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>No employees yet</div>
            <div style={{ fontSize: 13.5, color: C.muted, margin: "6px 0 14px" }}>
              Add one and give him his own passcode — he signs in on his phone at the same address you use, and only sees
              his time clock.
            </div>
            <button onClick={() => setShowAdd(true)} style={btnPrimary}>
              Add employee
            </button>
          </div>
        )}

        {selected && (
          <EmployeePayroll
            key={selected.id}
            employee={selected}
            settings={settings}
            onEmployeeChanged={loadEmployees}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      </div>

      {showAdd && (
        <EmployeeSheet
          onClose={() => setShowAdd(false)}
          onSaved={async (emp) => {
            setShowAdd(false);
            await loadEmployees();
            setSelectedId(emp.id);
          }}
        />
      )}
      {showSettings && settings && (
        <SettingsSheet
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

function EmployeePayroll({ employee, settings, onEmployeeChanged, onOpenSettings }) {
  const [periodStart, setPeriodStart] = useState(null);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");
  const [shift, setShift] = useState(null); // entry being viewed, or { new: true }
  const [showSubmit, setShowSubmit] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showWeeks, setShowWeeks] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.payrollReport(employee.id, periodStart);
      setReport(r);
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, [employee.id, periodStart]);

  useEffect(() => {
    load();
  }, [load]);

  // any edit returns the fresh report for the week it touched
  const applyReport = (r) => {
    if (r.periodStart === (report?.periodStart || periodStart)) setReport(r);
    else load();
    onEmployeeChanged();
  };

  if (!report) return err ? <div style={{ ...card, color: C.rust }}>{err}</div> : <div style={{ color: C.muted, padding: 20 }}>Loading…</div>;

  const p = report.pay;
  const isCurrent = report.periodStart === report.currentPeriodStart;
  const latestSubmission = report.submissions[0];
  const pending = report.entries.filter((e) => e.status === "pending");

  return (
    <>
      {/* week picker */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 8, padding: 10 }}>
        <button onClick={() => setPeriodStart(report.prevPeriodStart)} style={{ ...btnSecondary, padding: "8px 12px" }} aria-label="Previous week">
          ‹
        </button>
        <button onClick={() => setShowWeeks(true)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>{report.label}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{isCurrent ? "This pay week" : "Tap to pick a week"}</div>
        </button>
        <button
          onClick={() => setPeriodStart(report.nextPeriodStart)}
          disabled={report.periodStart >= report.currentPeriodStart}
          style={{ ...btnSecondary, padding: "8px 12px", opacity: report.periodStart >= report.currentPeriodStart ? 0.4 : 1 }}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {latestSubmission && (
        <div style={{ ...card, background: "#EAF4EE", borderColor: "#BFDCCB", fontSize: 13.5, color: C.ink }}>
          ✓ Submitted {fmtDay(latestSubmission.submittedAt)} at {fmtTime(latestSubmission.submittedAt)} to {latestSubmission.sentTo} —{" "}
          {fmtMoney(latestSubmission.grossPay)}
          {latestSubmission.grossPay !== p.grossPay && (
            <div style={{ color: C.amber, marginTop: 4 }}>Numbers have changed since then ({fmtMoney(p.grossPay)} now). Submit again to send the update.</div>
          )}
        </div>
      )}

      {report.warnings.length > 0 && (
        <div style={{ ...card, background: "#FBF6EC", borderColor: "#EBD9B4" }}>
          {report.warnings.map((w) => (
            <div key={w} style={{ fontSize: 13, color: "#7A5A1C", padding: "2px 0" }}>
              • {w}
            </div>
          ))}
        </div>
      )}

      {/* missed-punch requests */}
      {pending.length > 0 && (
        <div style={{ ...card, borderColor: C.amber }}>
          <div style={sectionLabel}>Needs your OK</div>
          {pending.map((e) => (
            <PendingRow key={e.id} entry={e} onOpen={() => setShift(e)} onChanged={applyReport} />
          ))}
        </div>
      )}

      {/* hours */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={sectionLabel}>Hours</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 26, color: C.ink }}>
            {fmtHours(p.totalHours)} <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>hrs</span>
          </div>
        </div>
        {p.overtimeHours > 0 && (
          <div style={{ fontSize: 13, color: C.muted, textAlign: "right" }}>
            {fmtHours(p.regularHours)} regular + <strong style={{ color: C.rust }}>{fmtHours(p.overtimeHours)} overtime at 1.5×</strong>
            <div style={{ fontSize: 12 }}>
              {[
                p.dailyOvertimeHours > 0 && `${fmtHours(p.dailyOvertimeHours)} over 8 hrs in a day`,
                p.weeklyOvertimeHours > 0 && `${fmtHours(p.weeklyOvertimeHours)} over 40 hrs in the week`,
              ]
                .filter(Boolean)
                .join(" + ")}
            </div>
          </div>
        )}
        <DayBars days={report.days} showOvertime />
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}` }}>
          {report.entries.filter((e) => e.status === "approved").map((e) => (
            <button
              key={e.id}
              onClick={() => setShift(e)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 0", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>{fmtDay(e.clockIn)}</div>
                <div style={{ fontSize: 13, color: C.muted, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {fmtTime(e.clockIn)} – {e.clockOut ? fmtTime(e.clockOut) : <strong style={{ color: C.accent }}>on the clock</strong>}
                  {e.source === "manual" && <span style={pill(C.surfaceMuted, C.muted)}>EDITED</span>}
                  {e.source === "request" && <span style={pill(C.surfaceMuted, C.muted)}>AFTER THE FACT</span>}
                  {e.gps.points > 0 ? (
                    <span style={pill("#EAF4EE", C.accent)}>📍 {e.gps.points}</span>
                  ) : (
                    <span style={pill("#FBEAE8", C.rust)}>NO GPS</span>
                  )}
                </div>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>{fmtHours(e.hours)}</div>
              <span style={{ color: C.muted }}>›</span>
            </button>
          ))}
        </div>
        <button onClick={() => setShift({ new: true })} style={{ ...btnSecondary, width: "100%", marginTop: 12 }}>
          + Add a shift
        </button>
      </div>

      {/* piece rate */}
      <PieceRateCard employee={employee} report={report} onChanged={applyReport} />

      {/* pay */}
      <div style={card}>
        <div style={sectionLabel}>Pay for this week</div>
        <PayRow label={`Regular (${fmtHours(p.regularHours)} hrs × ${fmtMoney(p.hourlyRate)})`} value={fmtMoney(p.regularPay)} />
        {p.overtimeHours > 0 && (
          <PayRow label={`Overtime (${fmtHours(p.overtimeHours)} hrs × ${fmtMoney(p.hourlyRate * 1.5)})`} value={fmtMoney(p.overtimePay)} />
        )}
        <PayRow label="Hourly wages" value={fmtMoney(p.hourlyPay)} strong />
        <PayRow label="Piece rate earned" value={fmtMoney(p.pieceTotal)} />
        <PayRow
          label={p.bonus > 0 ? "Bonus (piece rate over hourly)" : "Bonus — piece rate didn't beat hourly"}
          value={fmtMoney(p.bonus)}
          strong={p.bonus > 0}
        />
        {p.bonusOvertimeAdjustment > 0 && <PayRow label="Overtime on the bonus" value={fmtMoney(p.bonusOvertimeAdjustment)} />}
        <div style={{ borderTop: `2px solid ${C.ink}`, marginTop: 8, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>Total gross pay</span>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 24, color: C.ink }}>{fmtMoney(p.grossPay)}</span>
        </div>
      </div>

      <button
        onClick={() => (settings?.payrollEmail ? setShowSubmit(true) : onOpenSettings())}
        style={{ ...btnPrimary, width: "100%", padding: "18px 14px", fontSize: 18, fontFamily: FONT_DISPLAY, fontWeight: 800, borderRadius: 12 }}
      >
        {latestSubmission ? "Submit payroll again" : "Submit payroll"}
      </button>

      <button onClick={() => setShowEdit(true)} style={{ ...btnSecondary, width: "100%", marginBottom: 24 }}>
        {employee.name}'s login & hourly rate
      </button>

      {shift && (
        <ShiftSheet
          employee={employee}
          entry={shift.new ? null : shift}
          mapsEnabled={settings?.mapsEnabled}
          onClose={() => setShift(null)}
          onChanged={(r) => {
            setShift(null);
            applyReport(r);
          }}
        />
      )}
      {showSubmit && (
        <SubmitSheet
          employee={employee}
          report={report}
          payrollEmail={settings?.payrollEmail}
          onClose={() => setShowSubmit(false)}
          onSubmitted={(r) => setReport(r)}
        />
      )}
      {showEdit && (
        <EmployeeSheet
          employee={employee}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            onEmployeeChanged();
            load();
          }}
        />
      )}
      {showWeeks && (
        <WeeksSheet
          employee={employee}
          onClose={() => setShowWeeks(false)}
          onPick={(ps) => {
            setShowWeeks(false);
            setPeriodStart(ps);
          }}
        />
      )}
    </>
  );
}

function PayRow({ label: text, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: C.muted }}>{text}</span>
      <span style={{ color: C.ink, fontWeight: strong ? 700 : 600, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function PendingRow({ entry, onOpen, onChanged }) {
  const [busy, setBusy] = useState(false);
  const act = async (fn) => {
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <button onClick={onOpen} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", width: "100%" }}>
        <div style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>
          {fmtDay(entry.clockIn)} · {fmtTime(entry.clockIn)} – {fmtTime(entry.clockOut)} ({fmtHours(entry.hours)} hrs)
        </div>
        {entry.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>"{entry.note}"</div>}
        <div style={{ fontSize: 12, color: C.accent, marginTop: 2 }}>Tap to see where his phone was before/after ›</div>
      </button>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={busy} onClick={() => act(() => api.editTimeEntry(entry.id, { status: "approved" }))} style={{ ...btnPrimary, flex: 1 }}>
          Approve
        </button>
        <button disabled={busy} onClick={onOpen} style={{ ...btnSecondary, flex: 1 }}>
          Adjust
        </button>
        <button
          disabled={busy}
          onClick={() => confirm("Turn down this request? It will be removed.") && act(() => api.deleteTimeEntry(entry.id))}
          style={{ ...btnDanger, flex: 1 }}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function PieceRateCard({ employee, report, onChanged }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async () => {
    setBusy(true);
    setErr("");
    try {
      onChanged(await api.addPieceWork(employee.id, { periodStart: report.periodStart, description: desc, amount: Number(amount) }));
      setDesc("");
      setAmount("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    try {
      onChanged(await api.removePieceWork(id));
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={sectionLabel}>Piece rate</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, color: C.ink }}>{fmtMoney(report.pay.pieceTotal)}</div>
      </div>
      {report.piece.map((item) => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, fontSize: 14, color: C.ink }}>{item.description || "Piece work"}</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{fmtMoney(item.amount)}</div>
          <button onClick={() => remove(item.id)} style={{ ...btnDanger, padding: "4px 9px", fontSize: 12 }} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Job / what (optional)" style={{ ...input, flex: 2 }} />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="$"
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          style={{ ...input, flex: 1 }}
        />
      </div>
      {err && <div style={errorText}>{err}</div>}
      <button onClick={add} disabled={busy || !(Number(amount) > 0)} style={{ ...btnPrimary, width: "100%", marginTop: 10, opacity: busy || !(Number(amount) > 0) ? 0.6 : 1 }}>
        Add piece rate
      </button>
    </div>
  );
}

function ShiftSheet({ employee, entry, mapsEnabled, onClose, onChanged }) {
  const isNew = !entry;
  const [clockIn, setClockIn] = useState(toLocalInput(entry?.clockIn || defaultStart()));
  const [clockOut, setClockOut] = useState(entry ? (entry.clockOut ? toLocalInput(entry.clockOut) : "") : toLocalInput(new Date(new Date(defaultStart()).getTime() + 8.5 * 3600000).toISOString()));
  const [note, setNote] = useState(entry?.note || "");
  const [gps, setGps] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (entry) api.timeEntryGps(entry.id).then(setGps).catch(() => setGps({ points: [] }));
  }, [entry]);

  const run = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      onChanged(await fn());
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const save = (extra = {}) =>
    run(() => {
      const body = { clockIn: fromLocalInput(clockIn), clockOut: clockOut ? fromLocalInput(clockOut) : null, note, ...extra };
      return isNew ? api.addTimeEntry(employee.id, body) : api.editTimeEntry(entry.id, body);
    });

  const pts = gps?.points || [];
  const inPt = pts.find((x) => x.kind === "in");
  const outPt = pts.findLast ? pts.findLast((x) => x.kind === "out") : [...pts].reverse().find((x) => x.kind === "out");

  return (
    <div style={sheetOverlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
          {isNew ? "Add a shift" : entry.status === "pending" ? "Missed-punch request" : `${fmtDay(entry.clockIn)} shift`}
        </div>
        {entry?.status === "pending" && entry.note && <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4 }}>"{entry.note}"</div>}

        {entry && (
          <div style={{ marginTop: 14 }}>
            <div style={sectionLabel}>Where his phone was</div>
            {!gps && <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Loading GPS…</div>}
            {gps && pts.length > 0 && mapsEnabled && !mapFailed && (
              <img
                src={`/api/payroll/entries/${entry.id}/map.png?n=${pts.length}`}
                alt="GPS trail for this shift"
                onError={() => setMapFailed(true)}
                style={{ width: "100%", borderRadius: 10, marginTop: 8, display: "block", background: C.surfaceMuted, aspectRatio: "600 / 360" }}
              />
            )}
            {gps && pts.length > 0 && (
              <div style={{ fontSize: 13, color: C.ink, marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {inPt && <GpsLine label="Clock-in" p={inPt} />}
                {outPt && <GpsLine label="Clock-out" p={outPt} />}
                <div style={{ color: C.muted }}>
                  {pts.length} location fix{pts.length === 1 ? "" : "es"} during this shift
                  {!inPt && " · no location at clock-in"}
                  {entry.clockOut && !outPt && " · no location at clock-out"}
                </div>
              </div>
            )}
            {gps && !pts.length && (
              <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                {entry.status === "pending"
                  ? "No GPS inside this time — he wasn't clocked in, so his phone wasn't being tracked."
                  : "No GPS for this shift (location was off, or the app wasn't opened during it)."}
                {(gps.nearestBefore || gps.nearestAfter) && " Closest fixes on record:"}
              </div>
            )}
            {gps && !pts.length && (
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {gps.nearestBefore && <GpsLine label="Last fix before" p={gps.nearestBefore} withDay />}
                {gps.nearestAfter && <GpsLine label="First fix after" p={gps.nearestAfter} withDay />}
              </div>
            )}
          </div>
        )}

        <label style={label}>Clock in</label>
        <input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} style={input} />
        <label style={label}>Clock out{entry && !entry.clockOut ? " (leave blank — still on the clock)" : ""}</label>
        <input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} style={input} />
        <label style={label}>Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={input} placeholder="Why it was added or changed" />
        {err && <div style={errorText}>{err}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
          {entry?.status === "pending" ? (
            <button disabled={busy} onClick={() => save({ status: "approved" })} style={btnPrimary}>
              Approve with these times
            </button>
          ) : (
            <button disabled={busy} onClick={() => save()} style={btnPrimary}>
              {isNew ? "Add shift" : "Save changes"}
            </button>
          )}
          {entry && (
            <button
              disabled={busy}
              onClick={() =>
                confirm(entry.status === "pending" ? "Deny this request?" : "Delete this shift and its GPS trail?") &&
                run(() => api.deleteTimeEntry(entry.id))
              }
              style={btnDanger}
            >
              {entry.status === "pending" ? "Deny request" : "Delete shift"}
            </button>
          )}
          <button onClick={onClose} style={btnSecondary}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultStart() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  if (d > new Date()) d.setDate(d.getDate() - 1);
  return d.toISOString();
}

function GpsLine({ label: text, p, withDay }) {
  return (
    <div>
      <span style={{ color: C.muted }}>{text}: </span>
      {withDay ? `${fmtDay(p.ts)} ` : ""}
      {fmtTime(p.ts)} ·{" "}
      <a href={mapsLink(p)} target="_blank" rel="noreferrer" style={{ color: C.accent, fontWeight: 600 }}>
        open in Maps
      </a>
      {p.accuracy ? <span style={{ color: C.muted }}> (±{Math.round(p.accuracy)} m)</span> : null}
    </div>
  );
}

function SubmitSheet({ employee, report, payrollEmail, onClose, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState(null);
  const p = report.pay;

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await api.submitPayroll(employee.id, report.periodStart);
      setEmail(res.email);
      onSubmitted(res.report);
      // hand off to the phone's mail app with everything filled in
      window.location.href = mailtoHref(res.email);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`);
      alert("Report copied");
    } catch {
      // clipboard blocked — the email link is still there
    }
  };

  return (
    <div style={sheetOverlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
          {email ? "Payroll recorded" : "Submit payroll"}
        </div>
        <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4 }}>
          {employee.name} · {report.label}
        </div>
        <div style={{ ...card, marginTop: 14, background: C.surfaceMuted, border: "none" }}>
          <PayRow label="Hours" value={`${fmtHours(p.totalHours)}${p.overtimeHours > 0 ? ` (${fmtHours(p.overtimeHours)} OT)` : ""}`} />
          <PayRow label="Hourly wages" value={fmtMoney(p.hourlyPay)} />
          <PayRow label="Bonus" value={fmtMoney(p.bonus + p.bonusOvertimeAdjustment)} />
          <PayRow label="Total gross" value={fmtMoney(p.grossPay)} strong />
        </div>
        {report.warnings.filter((w) => !w.startsWith("This pay week")).length > 0 && !email && (
          <div style={{ fontSize: 13, color: "#7A5A1C", marginTop: 10 }}>
            {report.warnings.map((w) => (
              <div key={w}>• {w}</div>
            ))}
          </div>
        )}
        {err && <div style={errorText}>{err}</div>}
        {!email ? (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>
              This saves a copy and opens an email to <strong style={{ color: C.ink }}>{payrollEmail}</strong> with the report filled
              in — just hit send.
            </div>
            <button disabled={busy} onClick={submit} style={{ ...btnPrimary, width: "100%", marginTop: 16, padding: "16px 14px", fontSize: 17 }}>
              {busy ? "Submitting…" : "Submit & open email"}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>If your mail app didn't open, tap below.</div>
            <a href={mailtoHref(email)} style={{ ...btnPrimary, width: "100%", marginTop: 12, padding: "16px 14px", fontSize: 17, textDecoration: "none", boxSizing: "border-box" }}>
              Open email to {email.to}
            </a>
            <button onClick={copy} style={{ ...btnSecondary, width: "100%", marginTop: 8 }}>
              Copy report text
            </button>
          </>
        )}
        <button onClick={onClose} style={{ ...btnSecondary, width: "100%", marginTop: 8 }}>
          {email ? "Done" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function EmployeeSheet({ employee, onClose, onSaved }) {
  const [name, setName] = useState(employee?.name || "");
  const [rate, setRate] = useState(employee ? String(employee.hourlyRate) : "");
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (extra = {}) => {
    setBusy(true);
    setErr("");
    try {
      const body = { name, hourlyRate: Number(rate), ...(passcode ? { passcode } : {}), ...extra };
      onSaved(employee ? await api.editEmployee(employee.id, body) : await api.addEmployee(body));
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div style={sheetOverlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>{employee ? "Employee" : "Add employee"}</div>
        <label style={label}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder="First and last name" />
        <label style={label}>Hourly rate ($)</label>
        <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" inputMode="decimal" min="0" step="0.01" style={input} />
        <label style={label}>{employee ? "New passcode (leave blank to keep his current one)" : "His passcode (6+ characters)"}</label>
        <input value={passcode} onChange={(e) => setPasscode(e.target.value)} style={input} autoComplete="off" placeholder={employee ? "••••••" : "e.g. mike2026"} />
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          He signs in at the same Lead Hammer address with this passcode and only sees his time clock — never leads, jobs, or
          pay. Passcodes are stored scrambled, so write it down before you save.
        </div>
        {err && <div style={errorText}>{err}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
          <button
            disabled={busy || !name.trim() || rate === "" || (!employee && passcode.length < 6)}
            onClick={() => save()}
            style={{ ...btnPrimary, opacity: busy || !name.trim() || rate === "" || (!employee && passcode.length < 6) ? 0.6 : 1 }}
          >
            {employee ? "Save" : "Add employee"}
          </button>
          {employee && (
            <button
              disabled={busy}
              onClick={() =>
                employee.active
                  ? confirm(`Turn off ${employee.name}'s login? His hours history is kept.`) && save({ active: false })
                  : save({ active: true })
              }
              style={employee.active ? btnDanger : btnSecondary}
            >
              {employee.active ? "Turn off login" : "Turn login back on"}
            </button>
          )}
          <button onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsSheet({ settings, onClose, onSaved }) {
  const [email, setEmail] = useState(settings.payrollEmail || "");
  const [weekStartDay, setWeekStartDay] = useState(settings.weekStartDay);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      onSaved(await api.savePayrollSettings({ payrollEmail: email, weekStartDay: Number(weekStartDay) }));
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div style={sheetOverlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>Payroll settings</div>
        <label style={label}>Payroll person's email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} placeholder="payroll@…" />
        <label style={label}>Pay week starts on</label>
        <select value={weekStartDay} onChange={(e) => setWeekStartDay(e.target.value)} style={input}>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>Weeks run 7 days from this day, midnight to midnight Utah time.</div>
        {!settings.mapsEnabled && (
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 10 }}>
            GPS maps need the Google Maps key (GOOGLE_MAPS_API_KEY) — without it you still get "open in Maps" links for each
            punch.
          </div>
        )}
        {err && <div style={errorText}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...btnSecondary, flex: 1 }}>
            Cancel
          </button>
          <button disabled={busy} onClick={save} style={{ ...btnPrimary, flex: 2 }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function WeeksSheet({ employee, onClose, onPick }) {
  const [weeks, setWeeks] = useState(null);
  useEffect(() => {
    api.payrollWeeks(employee.id).then((r) => setWeeks(r.weeks)).catch(() => setWeeks([]));
  }, [employee.id]);
  return (
    <div style={sheetOverlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, marginBottom: 8 }}>Pay weeks</div>
        {!weeks && <div style={{ color: C.muted }}>Loading…</div>}
        {weeks?.map((w) => (
          <button
            key={w.periodStart}
            onClick={() => onPick(w.periodStart)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 0", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>{w.label}</div>
              <div style={{ fontSize: 12.5, color: C.muted }}>
                {fmtHours(w.totalHours)} hrs · {fmtMoney(w.grossPay)}
                {w.bonus > 0 ? ` (incl. ${fmtMoney(w.bonus)} bonus)` : ""}
              </div>
            </div>
            {w.submittedAt ? <span style={pill("#EAF4EE", C.accent)}>SUBMITTED</span> : w.totalHours > 0 ? <span style={pill("#FBF1DF", C.amber)}>NOT SENT</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
