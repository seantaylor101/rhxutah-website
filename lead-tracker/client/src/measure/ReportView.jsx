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
// openings are ordered in inches, like a window schedule
const inches = (ft) => (Number.isFinite(ft) ? `${Math.round(ft * 12 * 2) / 2}"` : "—");
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

// height of the wall's own rectangle (upper walls: above the lower roof);
// reports saved before levels existed only had eaveHeight
const hOf = (wall) => wall.height ?? wall.eaveHeight;

// elevation drawing of one wall, in feet, like a HOVER wall page
function WallDrawing({ wall }) {
  const top = Math.max(hOf(wall), wall.peakHeight || 0);
  const pad = Math.max(2.5, wall.widthFt * 0.06);
  const vb = [-pad, -top - pad, wall.widthFt + pad * 2, top + pad * 2.5];
  const s = vb[2] / 340; // ≈ one screen px
  const pts = (arr) => arr.map(([x, y]) => `${x},${-y}`).join(" ");
  // edges of every opening across the wall, for the spacing dimensions
  const chain = [
    ...new Set(
      [0, wall.widthFt, ...wall.openings.flatMap((o) => [Math.min(...o.plane.map((q) => q[0])), Math.max(...o.plane.map((q) => q[0]))])]
        .map((x) => Math.round(Math.max(0, Math.min(wall.widthFt, x)) * 12) / 12),
    ),
  ].sort((a, b) => a - b);
  return (
    <svg viewBox={vb.join(" ")} style={{ width: "100%", maxHeight: 300, display: "block", background: "#fff" }}>
      <polygon points={pts(wall.outline)} fill={MATERIAL_FILL[wall.primaryMaterial] || "#eee"} stroke={C.ink} strokeWidth={1.4 * s} />
      {wall.regions.map((r, i) => (
        <polygon key={i} points={pts(r.plane)} fill={MATERIAL_FILL[r.material] || "#eee"} stroke="#9A8A80" strokeWidth={0.6 * s} />
      ))}
      {wall.openings.map((o, i) => {
        const cx = o.plane.reduce((t, p) => t + p[0], 0) / 4;
        const cy = o.plane.reduce((t, p) => t + p[1], 0) / 4;
        // size the labels to fit inside the opening: number, then width × height
        const fs = Math.min(10 * s, o.width / 4.2, o.height / 3.6);
        const sill = o.type === "window" && o.bottom != null && o.bottom > 0.3 ? o.bottom : null;
        return (
          <g key={i}>
            <polygon points={pts(o.plane)} fill="#fff" stroke={C.ink} strokeWidth={1 * s} />
            {o.no != null && (
              <text x={cx} y={-cy - fs * 1.2} textAnchor="middle" fontSize={fs} fontFamily={FONT_BODY} fontWeight={700} fill="#3B5BDB">
                {o.tag || `#${o.no}`}
              </text>
            )}
            <text x={cx} y={-cy - fs * 0.1} textAnchor="middle" fontSize={fs} fontFamily={FONT_BODY} fill={C.ink}>
              {inches(o.width)}
            </text>
            <text x={cx} y={-cy + fs * 1.0} textAnchor="middle" fontSize={fs} fontFamily={FONT_BODY} fill={C.ink}>
              × {inches(o.height)}
            </text>
            {sill != null && (
              <>
                <line x1={cx} y1={-o.bottom} x2={cx} y2={0} stroke="#3B5BDB" strokeWidth={0.6 * s} strokeDasharray={`${2 * s} ${2 * s}`} />
                <text x={cx + 3 * s} y={-o.bottom / 2} fontSize={Math.min(8.5 * s, fs)} fontFamily={FONT_BODY} fill="#3B5BDB">
                  {fmtFtIn(sill)}
                </text>
              </>
            )}
          </g>
        );
      })}
      {(wall.suspectOpenings || []).map((o, i) => (
        <polygon key={`s${i}`} points={pts(o.plane)} fill="none" stroke={C.rust} strokeWidth={1.2 * s} strokeDasharray={`${4 * s} ${3 * s}`} />
      ))}
      {wall.tier === "upper" && (
        <text x={wall.widthFt / 2} y={pad * 0.55 + 24 * s} textAnchor="middle" fontSize={9.5 * s} fill={C.muted} fontFamily={FONT_BODY}>
          bottom edge = where it meets the lower roof
        </text>
      )}
      {/* spacing between openings, then the overall width, along the bottom */}
      {chain.length > 2 && (
        <g>
          <line x1={0} y1={pad * 0.3} x2={wall.widthFt} y2={pad * 0.3} stroke="#7A8A99" strokeWidth={0.6 * s} />
          {chain.map((x, i) => (
            <line key={i} x1={x} y1={pad * 0.3 - 3 * s} x2={x} y2={pad * 0.3 + 3 * s} stroke="#7A8A99" strokeWidth={0.6 * s} />
          ))}
          {chain.slice(1).map((x, i) => {
            const len = x - chain[i];
            if (len < 1.2) return null;
            return (
              <text key={i} x={(x + chain[i]) / 2} y={pad * 0.3 - 2 * s} textAnchor="middle" fontSize={Math.min(7.5 * s, len / 3.2)} fill="#5A6A79" fontFamily={FONT_BODY}>
                {fmtFtIn(len)}
              </text>
            );
          })}
        </g>
      )}
      <line x1={0} y1={pad * 0.7} x2={wall.widthFt} y2={pad * 0.7} stroke="#3B5BDB" strokeWidth={s} />
      <text x={wall.widthFt / 2} y={pad * 0.7 + 12 * s} textAnchor="middle" fontSize={11 * s} fill="#3B5BDB" fontFamily={FONT_BODY} fontWeight={700}>
        {fmtFtIn(wall.widthFt)}
      </text>
      {/* eave height up the left */}
      <line x1={-pad * 0.45} y1={0} x2={-pad * 0.45} y2={-hOf(wall)} stroke="#3B5BDB" strokeWidth={s} />
      <text
        x={-pad * 0.45 - 4 * s}
        y={-hOf(wall) / 2}
        textAnchor="middle"
        fontSize={11 * s}
        fill="#3B5BDB"
        fontFamily={FONT_BODY}
        fontWeight={700}
        transform={`rotate(-90 ${-pad * 0.45 - 4 * s} ${-hOf(wall) / 2})`}
      >
        {fmtFtIn(hOf(wall))}
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
        {wall.openings
          .filter((o) => o.image && o.no != null)
          .map((o) => {
            const cx = o.image.reduce((t, p) => t + p[0], 0) / o.image.length;
            const cy = o.image.reduce((t, p) => t + p[1], 0) / o.image.length;
            return (
              <g key={o.no}>
                <circle cx={cx} cy={cy} r={12 * s} fill="#3B5BDB" />
                <text x={cx} y={cy + 4 * s} textAnchor="middle" fontSize={(o.tag ? 8 : 11) * s} fontWeight={700} fill="#fff" fontFamily={FONT_BODY}>
                  {o.tag || o.no}
                </text>
              </g>
            );
          })}
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
        <div style={{ fontSize: 12.5, color: wall.measured ? C.accent : C.amber, fontWeight: 700 }}>
          {wall.measured ? "Measured" : wall.counted === false ? "Not counted" : "Estimated"}
        </div>
      </div>
      <div style={{ fontSize: 13, color: C.muted, margin: "2px 0 8px" }}>
        {wall.tier === "upper"
          ? `Upper story above the lower roof${wall.setbackFt ? ` (set back ${Math.round(wall.setbackFt)} ft)` : ""} · `
          : wall.stories === 2
            ? "Two stories · "
            : wall.stories === 1
              ? "One story · "
              : ""}
        {fmtFtIn(wall.widthFt)} wide × {fmtFtIn(hOf(wall))} {wall.tier === "upper" ? "visible" : "to eave"}
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
      {wall.counted !== false && wall.grossArea > 0 && (
        <div style={{ marginTop: 10 }}>
          <Table
            head={["Material", "Gross", "Openings", "Net"]}
            rows={[
              ...Object.keys(wall.byGross || {})
                .filter((m) => wall.byGross[m] > 0.5)
                .map((m) => [MATERIAL_LABEL[m] || m, ft2(wall.byGross[m]), ft2((wall.openingsByMaterial || {})[m] || 0), ft2(wall.byMaterial[m] || 0)]),
            ]}
          />
          {wall.openings.length > 0 && (
            <Table
              head={["Tag", "Opening", "W × H", "Sill"]}
              rows={wall.openings.map((o) => [
                o.tag || (o.no != null ? `#${o.no}` : ""),
                `${o.arched ? "Arched " : ""}${OPENING_NAME[o.type] || "opening"} · ${MATERIAL_LABEL[o.material] || o.material}`,
                `${inches(o.width)} × ${inches(o.height)}`,
                o.type === "window" && o.bottom != null ? fmtFtIn(o.bottom) : "—",
              ])}
            />
          )}
          {wall.trim && (
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: -6 }}>
              {[
                wall.trim.starter ? `Starter ${fmtFtIn(wall.trim.starter)}` : null,
                wall.trim.frieze ? `Top of wall ${fmtFtIn(wall.trim.frieze)}` : null,
                wall.trim.rakeEdges ? `Gable edges ${fmtFtIn(wall.trim.rakeEdges)}` : null,
                wall.trim.roofToWall ? `Roof-to-wall ${fmtFtIn(wall.trim.roofToWall)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
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
              Object.assign(["Facades (net of openings)", ft2(t.facades.siding), ft2(t.facades.other)], { bold: true }),
              ["Openings", ft2(o.siding.area), ft2(o.other.area)],
              ["Total wall area", ft2(t.gross ? t.gross.siding : t.facades.siding + o.siding.area), ft2(t.gross ? t.gross.other : t.facades.other + o.other.area)],
            ]}
          />
          <div style={{ fontSize: 12, color: C.muted, margin: "-8px 0 12px" }}>
            Same as HOVER: "Siding" is lap/panel siding; brick, stucco and stone are "Other". Facades are after window and door deductions.
            {t.suspectOpenings ? ` ${t.suspectOpenings} opening(s) looked wrong and weren't deducted — see the walls marked ⚠︎.` : ""}
          </div>
          {r.heights && (
            <Table
              head={["Wall heights used", ""]}
              rows={[
                ["One story (ground to eave)", fmtFtIn(r.heights.h1)],
                ["Two story (ground to eave)", fmtFtIn(r.heights.h2)],
              ]}
            />
          )}
          <Table
            head={["Siding waste totals", "Area", "Squares"]}
            rows={t.squares.map((x) => [x.pct ? `+${x.pct}%` : "Zero waste", ft2(x.area), sq(x.squares)])}
          />
          <Table head={["By material (net)", "Area"]} rows={Object.entries(t.byMaterial).map(([m, a]) => [MATERIAL_LABEL[m] || m, ft2(a)])} />
          {t.bySide && (
            <Table
              head={["By side (net)", "Siding", "Other", "Openings"]}
              rows={["front", "right", "back", "left", "other"]
                .filter((k) => t.bySide[k])
                .map((k) => [SIDE_NAME[k], ft2(t.bySide[k].siding), ft2(t.bySide[k].other), t.bySide[k].openings])}
            />
          )}
          <Table
            head={["Openings trim", "Siding", "Other"]}
            rows={[
              ["Quantity", o.siding.count, o.other.count],
              ["Tops length", fmtLen(o.siding.tops), fmtLen(o.other.tops)],
              ["Sills length", fmtLen(o.siding.sills), fmtLen(o.other.sills)],
              ["Sides length", fmtLen(o.siding.sides), fmtLen(o.other.sides)],
              ...(o.siding.perimeter != null ? [Object.assign(["Total around openings", fmtLen(o.siding.perimeter), fmtLen(o.other.perimeter)], { bold: true })] : []),
            ]}
          />
          {t.trim && (
            <Table
              head={["Wall trim & accessories", "Length"]}
              rows={[
                ["Starter strip (bottom of walls, less doors)", fmtLen(t.trim.starter)],
                ["Top of wall under eaves (frieze)", fmtLen(t.trim.frieze)],
                ["Gable edges on walls (rake trim)", fmtLen(t.trim.rakeEdges)],
                ["Roof-to-wall (upper walls on a lower roof)", fmtLen(t.trim.roofToWall)],
              ]}
            />
          )}
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

        <OpeningSchedule schedule={r.openingSchedule} />

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

const OPENING_NAME = { window: "window", door: "door", garage_door: "garage door" };
const SIDE_NAME = { front: "Front", right: "Right", back: "Back", left: "Left", other: "Other" };

function OpeningSchedule({ schedule }) {
  if (!schedule || !schedule.items.length) return null;
  return (
    <div style={card}>
      <div style={{ ...sectionLabel, marginBottom: 8 }}>Windows & doors ({schedule.items.length})</div>
      <Table
        head={["Size", "Qty", "UI", "Tags"]}
        rows={schedule.sizes.map((g) => [`${g.label} ${g.widthIn}" × ${g.heightIn}"`, g.count, `${g.unitedIn}"`, (g.tags || g.nos.map((n) => `#${n}`)).join(" ")])}
      />
      <div style={{ fontSize: 12, color: C.muted, margin: "-8px 0 10px" }}>
        Sizes are the visible opening (outside of trim) measured from the photos, to the nearest ½". UI = united inches (width + height). Same sizes within 1" are counted
        together.
      </div>
      <Table
        head={["Tag", "Wall", "Type", "W × H", "Sill"]}
        rows={schedule.items.map((it) => [
          it.tag || `#${it.no}`,
          `${it.wallId} ${it.wallLabel}`,
          it.label,
          `${it.widthIn}" × ${it.heightIn}"`,
          it.sillIn != null ? fmtFtIn(it.sillIn / 12) : "—",
        ])}
      />
    </div>
  );
}

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 };
const linkBtn = { background: "none", border: "none", padding: 0, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.accent, cursor: "pointer" };
