// Scores a measurement against a reference (a HOVER report for the same
// house) metric by metric. A yardstick for tuning the engine — never fed
// back into a measurement.

const pct = (ours, ref) => (Number.isFinite(ours) && Number.isFinite(ref) && ref !== 0 ? ((ours - ref) / ref) * 100 : null);

function row(metric, ours, ref, unit) {
  return { metric, ours, ref, unit, diffPct: pct(ours, ref) };
}

// how well the wall map's outline matches the reference footprint
export function scoreOutline(model, ref) {
  return [
    row("Footprint area", model.footprintAreaFt2, ref.footprint.areaFt2, "ft²"),
    row("Footprint perimeter", model.perimeterFt, ref.footprint.perimeterFt, "ft"),
  ];
}

// a finished report against the reference
export function scoreReport(result, ref) {
  const t = result.totals;
  const facades = t.facades || { siding: t.sidingNet, other: t.otherNet };
  const bySide = {};
  for (const w of result.walls) {
    if (!w.side) continue;
    bySide[w.side] = (bySide[w.side] || 0) + (w.byMaterial?.siding || 0);
  }
  const rows = [
    row("Siding facades (net)", facades.siding, ref.facades.sidingFt2, "ft²"),
    row("Other facades (brick/stucco/stone)", facades.other, ref.facades.otherFt2, "ft²"),
    row("Siding openings count", t.openings.siding.count, ref.openings.siding.count, ""),
    row("Siding openings area", t.openings.siding.area, ref.openings.siding.areaFt2, "ft²"),
    row("Other openings count", t.openings.other.count, ref.openings.other.count, ""),
    row("Squares, zero waste", t.squares[0].squares, ref.squares.zero, "sq"),
  ];
  for (const side of ["front", "right", "back", "left"]) rows.push(row(`Siding, ${side}`, bySide[side] || 0, ref.facades.bySide[side], "ft²"));
  if (result.heights) {
    rows.push(row("One-story eave height", result.heights.h1, ref.heights.oneStoryFt, "ft"));
    rows.push(row("Two-story eave height", result.heights.h2, ref.heights.twoStoryFt, "ft"));
  }
  return rows;
}

export function formatScore(rows) {
  return rows
    .map((r) => {
      const f = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1)) : "—");
      const d = r.diffPct == null ? "" : `${r.diffPct >= 0 ? "+" : ""}${r.diffPct.toFixed(0)}%`;
      return `${r.metric.padEnd(36)} ${f(r.ours).padStart(8)} vs ${f(r.ref).padStart(8)} ${r.unit.padEnd(3)} ${d}`;
    })
    .join("\n");
}
