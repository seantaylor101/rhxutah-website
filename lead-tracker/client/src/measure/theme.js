// The same tokens App.jsx uses (kept in step by hand — App.jsx imports this
// folder, so importing back from it would be circular), plus the few colors
// the measuring screens add.
export const C = {
  bg: "#F7F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF1EC",
  accent: "#47936B",
  ink: "#242926",
  muted: "#6E7A6F",
  border: "#E1E5DD",
  rust: "#C0483B",
  amber: "#C79A3D",
  // overlay colors drawn over satellite imagery / the camera — bright enough
  // to read on both
  roofLine: "#FFB020",
  wallNone: "#B8C2BB",
  wallPartial: "#FFB020",
  wallDone: "#3DDC84",
  wallLive: "#4FC3F7",
};

export const FONT_DISPLAY = "'Raleway', sans-serif";
export const FONT_BODY = "'Open Sans', sans-serif";

export const btn = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  border: "none",
  borderRadius: 7,
  padding: "9px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  fontFamily: FONT_BODY,
  cursor: "pointer",
};
export const btnPrimary = { ...btn, background: C.accent, color: "#fff" };
export const btnSecondary = { ...btn, background: C.surfaceMuted, color: C.ink };
export const btnDanger = { ...btn, background: "#FBEAE8", color: C.rust };

export const sectionLabel = {
  fontFamily: FONT_BODY,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: C.muted,
};

export function fmtFeetInches(inches) {
  if (!Number.isFinite(inches)) return "—";
  let ft = Math.floor(inches / 12);
  let inch = Math.round(inches - ft * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return `${ft}' ${inch}"`;
}

export function coverageColor(cov) {
  if (!cov || !cov.photos) return C.wallNone;
  return cov.fraction >= 0.9 ? C.wallDone : C.wallPartial;
}
