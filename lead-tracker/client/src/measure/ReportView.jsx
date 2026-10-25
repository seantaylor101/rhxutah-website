import { useState } from "react";
import { C, FONT_BODY, FONT_DISPLAY, btnSecondary, sectionLabel } from "./theme.js";
import { fmtFtIn, MATERIAL_LABEL } from "../../../shared/facadeGeometry.js";

const MATERIAL_FILL = {
  siding: "#DCE9E1",
  stucco: "#EFE6D5",
  brick: "#E8C9BD",
  stone: "#D8D8D2",
  other: "#E4E4F0",
};
const ft2 = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString()} ft²` : "—");
const sq = (n) => (Number.isFinite(n) ? (Math.round(n * 4) / 4).toFixed(2).replace(/\.00$/, "") : "—");

function Table({ head, rows }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, marginBottom: 14 }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} style={{ textAlign: i ? "right" : "left", padding: "6px 6px", borderBottom: `2px solid ${C.ink}`, fontWeight: 700 }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} style={{ textAlign: j ? "right" : "left", padding: "6px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: r.bold ? 700 : 400 }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// elevation drawing of one wall, in feet, like a HOVER wall page
function WallDrawing({ wall }) {
  const top = Math.max(wall.eaveHeight, wall.peakHeight || 0);
  const pad = Math.max(2.5, wall.widthFt * 0.06);
  const vb = [-pad, -top - pad, wall.widthFt + pad * 2, top + pad * 2.2];
  const s = vb[2] / 340; // ≈ one screen px
  const pts = (arr) => arr.map(([x, y]) => `${x},${-y}`).join(" ");
  return (
    <svg viewBox={vb.join(" ")} style={{ width: "100%", display: "block", background: "#fff" }}>
      <polygon points={pts(wall.outline)} fill={MATERIAL_FILL[wall.primaryMaterial] || "#eee"} stroke={C.ink} strokeWidth={1.4 * s} />
      {wall.regions.map((r, i) => (
        <polygon key={i} points={pts(r.plane)} fill={MATERIAL_FILL[r.material] || "#eee"} stroke="#9A8A80" strokeWidth={0.6 * s} />
      ))}
      {wall.openings.map((o, i) => {
        const cx = o.plane.reduce((t, p) => t + p[0], 0) / 4;
        const cy = o.plane.reduce((t, p) => t + p[1], 0) / 4;
        // size the label to fit inside the opening: width over height
        const fs = Math.min(10 * s, o.width / 4.2, o.height / 2.6);
        return (
          <g key={i}>
            <polygon points={pts(o.plane)} fill="#fff" stroke={C.ink} strokeWidth={1 * s} />
            <text x={cx} y={-cy - fs * 0.2} textAnchor="middle" fontSize={fs} fontFamily={FONT_BODY} fill={C.ink}>
              {fmtFtIn(o.width)}
            </text>
            <text x={cx} y={-cy + fs * 0.95} textAnchor="middle" fontSize={fs} fontFamily={FONT_BODY} fill={C.ink}>
              × {fmtFtIn(o.height)}
            </text>
          </g>
        );
      })}
      {/* width along the bottom */}
      <line x1={0} y1={pad * 0.55} x2={wall.widthFt} y2={pad * 0.55} stroke="#3B5BDB" strokeWidth={s} />
      <text x={wall.widthFt / 2} y={pad * 0.55 + 12 * s} textAnchor="middle" fontSize={11 * s} fill="#3B5BDB" fontFamily={FONT_BODY} fontWeight={700}>
        {fmtFtIn(wall.widthFt)}
      </text>
      {/* eave height up the left */}
      <line x1={-pad * 0.45} y1={0} x2={-pad * 0.45} y2={-wall.eaveHeight} stroke="#3B5BDB" strokeWidth={s} />
      <text
        x={-pad * 0.45 - 4 * s}
        y={-wall.eaveHeight / 2}
        textAnchor="middle"
        fontSize={11 * s}
        fill="#3B5BDB"
        fontFamily={FONT_BODY}
        fontWeight={700}
        transform={`rotate(-90 ${-pad * 0.45 - 4 * s} ${-wall.eaveHeight / 2})`}
      >
        {fmtFtIn(wall.eaveHeight)}
      </text>
      {wall.peakHeight && (
        <text x={wall.widthFt / 2} y={-wall.peakHeight - 5 * s} textAnchor="middle" fontSize={10 * s} fill="#3B5BDB" fontFamily={FONT_BODY}>
          peak {fmtFtIn(wall.peakHeight)}
          {wall.peakSource === "pitch" ? " (from pitch)" : ""}
        </text>
      )}
    </svg>
  );
}

// the photo the wall was measured from, with what Claude marked drawn on it
// — the quickest way to see whether a number can be trusted
function PhotoMarks({ wall, photo }) {
  const m = wall.bestImage;
  if (!m || !photo || !photo.imageWidth) return null;
  const s = photo.imageWidth / 340;
  const poly = (arr) => arr.map((p) => p.join(",")).join(" ");
  const outline = [m.bl, m.br, m.tr, ...(m.peak ? [m.peak] : []), m.tl];
  return (
    <div style={{ position: "relative", marginTop: 8 }}>
      <img src={photo.url} alt="" style={{ width: "100%", display: "block", borderRadius: 6 }} />
      <svg viewBox={`0 0 ${photo.imageWidth} ${photo.imageHeight}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {m.regions.map((r, i) => (
          <polygon key={i} points={poly(r.image)} fill="rgba(255,176,32,0.18)" stroke="#FFB020" strokeWidth={1.5 * s} strokeDasharray={`${4 * s} ${3 * s}`} />
        ))}
        <polygon points={poly(outline)} fill="none" stroke="#3DDC84" strokeWidth={2.5 * s} />
        {m.openings.map((o, i) => (
          <polygon key={i} points={poly(o)} fill="rgba(79,195,247,0.2)" stroke="#4FC3F7" strokeWidth={2 * s} />
        ))}
        {[m.bl, m.br, m.tr, m.tl].map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={5 * s} fill="#3DDC84" stroke="#000" strokeWidth={s} />
        ))}
      </svg>
    </div>
  );
}

function WallCard({ wall, photo }) {
  const [showPhoto, setShowPhoto] = useState(false);
  const mats = Object.entries(wall.byMaterial).filter(([, a]) => a > 0.5);
  const openArea = wall.openings.reduce((t, o) => t + o.area, 0);
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16 }}>
          {wall.id} · {wall.label}
        </div>
        <div style={{ fontSize: 12.5, color: wall.measured ? C.accent : C.amber, fontWeight: 700 }}>{wall.measured ? "Measured" : "Estimated"}</div>
      </div>
      <div style={{ fontSize: 13, color: C.muted, margin: "2px 0 8px" }}>
        {fmtFtIn(wall.widthFt)} wide × {fmtFtIn(wall.eaveHeight)} to eave
        {wall.peakHeight ? `, ${fmtFtIn(wall.peakHeight)} at peak` : ""} · {ft2(wall.grossArea)}
        {wall.openings.length ? ` · ${wall.openings.length} opening${wall.openings.length === 1 ? "" : "s"} (${ft2(openArea)})` : ""}
      </div>
      <WallDrawing wall={wall} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12.5, marginTop: 6 }}>
        {mats.map(([m, a]) => (
          <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, background: MATERIAL_FILL[m], border: "1px solid #999" }} />
            {MATERIAL_LABEL[m] || m} {ft2(a)}
          </span>
        ))}
      </div>
      {wall.notes.map((n, i) => (
        <div key={i} style={{ fontSize: 12.5, color: C.amber, marginTop: 6 }}>
          ⚠︎ {n}
        </div>
      ))}
      {wall.bestImage && photo && (
        <>
          <button style={{ ...linkBtn, marginTop: 8 }} onClick={() => setShowPhoto((v) => !v)}>
            {showPhoto ? "Hide photo" : "Show what was marked on the photo"}
          </button>
          {showPhoto && <PhotoMarks wall={wall} photo={photo} />}
        </>
      )}
    </div>
  );
}

export default function ReportView({ report, leadName, onClose, onRerun, rerunning }) {
  const r = report.result;
  const t = r.totals;
  const o = t.openings;
  const fmtLen = (n) => fmtFtIn(n);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 75, background: C.bg, overflowY: "auto", fontFamily: FONT_BODY, color: C.ink }}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18 }}>Measurement report</div>
          <div style={{ fontSize: 12.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {leadName}
            {r.meta.address ? ` · ${r.meta.address}` : ""}
          </div>
        </div>
        <button style={btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "14px 16px 48px" }}>
        <div style={{ ...card, background: "#FFF9EC", borderColor: "#F0DCA8", fontSize: 13, lineHeight: 1.5 }}>
          <b>First version, still being checked against HOVER.</b> Wall widths come from the satellite outline; heights, gables, openings and
          materials come from the photos. Use waste factors, and spot-check anything marked ⚠︎.
          <div style={{ color: C.muted, marginTop: 4 }}>
            {t.measuredWalls} of {t.totalWalls} walls measured from photos · {r.meta.photosUsed} of {r.meta.photosTotal} photos used ·{" "}
            {new Date(report.finishedAt || report.createdAt).toLocaleString()} ·{" "}
            {report.costUsd >= 0.005 ? `cost about $${report.costUsd.toFixed(2)}` : "no new cost (photos already read)"}
          </div>
        </div>

        <div style={card}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Summary</div>
          <Table
            head={["Areas", "Siding", "Other"]}
            rows={[
              ["Facades", ft2(t.facades.siding), ft2(t.facades.other)],
              ["Openings", ft2(o.siding.area), ft2(o.other.area)],
              Object.assign(["Net (facades − openings)", ft2(t.sidingNet), ft2(t.otherNet)], { bold: true }),
            ]}
          />
          <Table
            head={["Siding waste totals", "Area", "Squares"]}
            rows={t.squares.map((x) => [x.pct ? `+${x.pct}%` : "Zero waste", ft2(x.area), sq(x.squares)])}
          />
          <Table head={["By material", "Area"]} rows={Object.entries(t.byMaterial).map(([m, a]) => [MATERIAL_LABEL[m] || m, ft2(a)])} />
          <Table
            head={["Openings", "Siding", "Other"]}
            rows={[
              ["Quantity", o.siding.count, o.other.count],
              ["Tops length", fmtLen(o.siding.tops), fmtLen(o.other.tops)],
              ["Sills length", fmtLen(o.siding.sills), fmtLen(o.other.sills)],
              ["Sides length", fmtLen(o.siding.sides), fmtLen(o.other.sides)],
            ]}
          />
          <Table
            head={["Corners", "Qty", "Length"]}
            rows={[
              ["Outside", t.corners.outside.count, fmtLen(t.corners.outside.length)],
              ["Inside", t.corners.inside.count, fmtLen(t.corners.inside.length)],
            ]}
          />
          <Table
            head={["Roofline (estimated)", "Length / area"]}
            rows={[
              ["Eaves fascia (gutters)", fmtLen(t.roofline.eaves)],
              ["Rakes fascia", fmtLen(t.roofline.rakes)],
              [`Soffit (${t.roofline.overhangIn}" overhang)`, ft2(t.roofline.soffitArea)],
            ]}
          />
          {t.roof.areaFt2 && (
            <Table
              head={["Roof (Google)", ""]}
              rows={[
                ["Area", ft2(t.roof.areaFt2)],
                ["Squares", sq(t.roof.areaFt2 / 100)],
                ["Main pitch", t.roof.pitch12 ? `${t.roof.pitch12}/12` : "—"],
              ]}
            />
          )}
        </div>

        <div style={{ ...sectionLabel, margin: "6px 0 8px" }}>Walls</div>
        {r.walls.map((w) => (
          <WallCard key={w.id} wall={w} photo={w.bestPhotoId ? r.photos[w.bestPhotoId] : null} />
        ))}

        {r.failures.length > 0 && (
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>Photos that couldn't be used ({r.failures.length})</div>
            {r.failures.map((f, i) => (
              <div key={i} style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
                {r.photos[f.photoId]?.slot || "photo"}: {f.reason}
              </div>
            ))}
          </div>
        )}

        <button style={{ ...btnSecondary, width: "100%", padding: 12 }} disabled={rerunning} onClick={onRerun}>
          {rerunning ? "Running…" : "Run again (after adding or retaking photos)"}
        </button>
      </div>
    </div>
  );
}

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 };
const linkBtn = { background: "none", border: "none", padding: 0, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.accent, cursor: "pointer" };
