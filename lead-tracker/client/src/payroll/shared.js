import { C, FONT_BODY, FONT_DISPLAY } from "../measure/theme.js";

export { C, FONT_BODY, FONT_DISPLAY };
export { btnPrimary, btnSecondary, btnDanger, sectionLabel } from "../measure/theme.js";

// pay weeks are worked out in Utah time on the server; show times the same way
const TZ = "America/Denver";
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" });

export const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : "");
export const fmtDay = (iso) => (iso ? dayFmt.format(new Date(iso)) : "");
export const fmtHours = (h) => `${(Number(h) || 0).toFixed(2)}`;
export const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// <input type="datetime-local"> works in the phone's own clock, which for
// this crew is Utah time anyway
export function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

// today's date at the given "HH:MM" as an ISO instant (for "I started at 7:30")
export function todayAt(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function mapsLink(p) {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

export function mailtoHref({ to, subject, body }) {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// one-shot position; resolves null instead of failing so clocking in never
// gets stuck on a phone with location turned off
export function currentPosition(timeout = 12000) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ point: null, error: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          point: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            ts: new Date(pos.timestamp || Date.now()).toISOString(),
          },
          error: null,
        }),
      (err) => resolve({ point: null, error: err.code === 1 ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 }
    );
  });
}

export const card = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(36,41,38,0.06)",
};

export const input = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.surfaceMuted,
  color: C.ink,
  fontFamily: FONT_BODY,
  fontSize: 16, // 16px+ stops iOS from zooming in on focus
  boxSizing: "border-box",
};

export const label = {
  display: "block",
  fontFamily: FONT_BODY,
  fontSize: 13,
  color: C.muted,
  margin: "12px 0 6px",
};

export const headerBar = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 16px",
  background: "linear-gradient(135deg, #170a08 0%, #241009 45%, #150a08 100%)",
  color: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 5,
};

export const sheetOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(36,41,38,0.5)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 90,
};

export const sheet = {
  background: C.surface,
  borderRadius: "16px 16px 0 0",
  padding: "22px 18px 28px",
  width: "100%",
  maxWidth: 520,
  maxHeight: "90vh",
  overflowY: "auto",
  boxSizing: "border-box",
};

export const pill = (bg, fg) => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  background: bg,
  color: fg,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: FONT_BODY,
  letterSpacing: 0.2,
});

export const errorText = { color: C.rust, fontFamily: FONT_BODY, fontSize: 13, marginTop: 8 };
