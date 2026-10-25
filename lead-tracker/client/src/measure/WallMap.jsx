import { useEffect, useMemo, useRef, useState } from "react";
import {
  worldPixel,
  latLngFromWorldPixel,
  toLatLng,
  toLocal,
  centroidLatLng,
  cleanOutline,
  buildHouseModel,
  SATELLITE_SIZE,
} from "../../../shared/houseGeometry.js";
import { C, FONT_BODY, btnPrimary, btnSecondary, coverageColor } from "./theme.js";
import { measureApi } from "./measureApi.js";

// Static-map pixel space: the satellite picture is SATELLITE_SIZE "map
// pixels" across (served at 2x for sharpness), centered on project.satellite
function makeProjector(sat) {
  const c = worldPixel(sat.lat, sat.lng, sat.zoom);
  const half = SATELLITE_SIZE / 2;
  return {
    toPx: (lat, lng) => {
      const w = worldPixel(lat, lng, sat.zoom);
      return [w[0] - c[0] + half, w[1] - c[1] + half];
    },
    fromPx: (x, y) => latLngFromWorldPixel(x - half + c[0], y - half + c[1], sat.zoom),
  };
}

function fitView(points, pad) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * pad,
  };
}

// map px across at full zoom-in (~20 ft) — past that the satellite picture
// is just blur, so more zoom would only make it harder to place a corner
const MIN_VIEW = 60;
const MAX_VIEW = SATELLITE_SIZE;
const clampView = (v) => {
  const size = Math.min(MAX_VIEW, Math.max(MIN_VIEW, v.size));
  const clampC = (c) => Math.min(SATELLITE_SIZE, Math.max(0, c));
  return { cx: clampC(v.cx), cy: clampC(v.cy), size };
};

// The wall map: satellite picture with the roof outline (orange, what the
// aerial data sees) and the wall line inside it (inset by the overhang),
// each wall numbered and colored by how well it's been photographed.
// In edit mode the roof corners drag; "+" handles add a corner.
export default function WallMap({
  leadId,
  project,
  model,
  coverage,
  editable,
  onSaveOutline,
  pickingFront,
  onPickFront,
  selectedWallId,
  onSelectWall,
}) {
  const svgRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // [[lat, lng], ...] while editing
  const [selIdx, setSelIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  // what part of the satellite picture is showing — held in state on
  // purpose so it does NOT re-center on the outline while a corner is being
  // dragged (that made the picture slide under the finger and the corner run)
  const [viewState, setViewState] = useState(null);
  const gesture = useRef({ pointers: new Map(), mode: null });

  const sat = project?.satellite;
  const satKey = sat ? `${sat.lat},${sat.lng},${sat.zoom}` : "";
  const proj = useMemo(() => (sat ? makeProjector(sat) : null), [satKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const outline = editing && draft ? draft : project?.roofOutline || [];
  const shownModel = useMemo(
    () => (editing && draft ? buildHouseModel({ ...project, roofOutline: draft }) : model),
    [editing, draft, project, model],
  );
  useEffect(() => setViewState(null), [satKey, leadId]);

  if (!proj || outline.length < 3) return null;

  const roofPx = outline.map(([lat, lng]) => proj.toPx(lat, lng));
  const localToPx = (x, y) => {
    const ll = toLatLng(shownModel.origin, x, y);
    return proj.toPx(ll.lat, ll.lng);
  };
  // frame the saved house (not the whole 640px picture) until the user
  // zooms/pans themselves
  const homeView = fitView((project.roofOutline || outline).map(([lat, lng]) => proj.toPx(lat, lng)), 1.9);
  const view = viewState || homeView;
  const vb = [view.cx - view.size / 2, view.cy - view.size / 2, view.size, view.size];
  const unit = view.size / 320; // ≈ one screen pixel at phone width, so handles stay finger-sized at any zoom
  const zoomedIn = view.size < homeView.size * 0.95;

  const clientToMap = (x, y, v = view) => {
    const r = svgRef.current.getBoundingClientRect();
    return [v.cx - v.size / 2 + ((x - r.left) / r.width) * v.size, v.cy - v.size / 2 + ((y - r.top) / r.height) * v.size];
  };

  const zoomBy = (factor) => setViewState(clampView({ ...view, size: view.size * factor }));

  const startEdit = () => {
    setDraft(project.roofOutline.map((p) => p.slice()));
    setSelIdx(null);
    setEditing(true);
  };

  // One handler set for every touch on the map:
  //   one finger on a corner (editing)  → drag that corner, keeping the
  //                                       finger's offset so it doesn't jump
  //   one finger elsewhere              → pan (once it actually moves, so
  //                                       taps on walls / "+" still work)
  //   two fingers                       → pinch zoom around the fingers
  const onPointerDown = (e) => {
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      g.mode = "pinch";
      g.startView = view;
      g.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.anchor = clientToMap(mid[0], mid[1]);
      return;
    }
    if (g.pointers.size > 2) return;
    const vIdx = e.target.dataset ? e.target.dataset.vertex : undefined;
    if (editing && vIdx != null) {
      const idx = Number(vIdx);
      const at = clientToMap(e.clientX, e.clientY);
      g.mode = "vertex";
      g.idx = idx;
      g.offset = [roofPx[idx][0] - at[0], roofPx[idx][1] - at[1]];
      setSelIdx(idx);
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    g.mode = "pan-pending";
    g.start = { x: e.clientX, y: e.clientY };
    g.startView = view;
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.mode === "vertex") {
      const at = clientToMap(e.clientX, e.clientY);
      const ll = proj.fromPx(at[0] + g.offset[0], at[1] + g.offset[1]);
      setDraft((d) => d.map((p, i) => (i === g.idx ? [ll.lat, ll.lng] : p)));
    } else if (g.mode === "pinch" && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const size = Math.min(MAX_VIEW, Math.max(MIN_VIEW, (g.startView.size * g.startDist) / dist));
      const r = svgRef.current.getBoundingClientRect();
      const fx = ((a.x + b.x) / 2 - r.left) / r.width;
      const fy = ((a.y + b.y) / 2 - r.top) / r.height;
      // keep the spot that was under the fingers under the fingers
      setViewState(clampView({ cx: g.anchor[0] - (fx - 0.5) * size, cy: g.anchor[1] - (fy - 0.5) * size, size }));
    } else if (g.mode === "pan-pending" || g.mode === "pan") {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (g.mode === "pan-pending") {
        if (Math.hypot(dx, dy) < 6) return;
        g.mode = "pan";
        svgRef.current.setPointerCapture?.(e.pointerId);
      }
      const r = svgRef.current.getBoundingClientRect();
      const k = g.startView.size / r.width;
      setViewState(clampView({ ...g.startView, cx: g.startView.cx - dx * k, cy: g.startView.cy - dy * k }));
    }
  };

  const onPointerEnd = (e) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 1 && g.mode === "pinch") {
      // one finger lifted mid-pinch — carry on panning with the other
      const [p] = [...g.pointers.values()];
      g.mode = "pan";
      g.start = { x: p.x, y: p.y };
      g.startView = viewState || view;
    } else if (!g.pointers.size) g.mode = null;
  };

  const squareUp = () => {
    const origin = centroidLatLng(draft);
    const cleaned = cleanOutline(draft.map(([lat, lng]) => toLocal(origin, lat, lng)), { regularize: true });
    setDraft(
      cleaned.map(([x, y]) => {
        const ll = toLatLng(origin, x, y);
        return [ll.lat, ll.lng];
      }),
    );
    setSelIdx(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaveOutline({ roofOutline: draft });
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const walls = shownModel ? shownModel.walls : [];

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 10,
          overflow: "hidden",
          background: "#2b2f2c",
          // map owns every gesture while editing or zoomed in; otherwise a
          // vertical swipe over it still scrolls the page (pinch still zooms)
          touchAction: editing || zoomedIn ? "none" : "pan-y",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={vb.join(" ")}
          style={{ width: "100%", height: "100%", display: "block" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {!imgFailed && (
            <image
              href={measureApi.satelliteUrl(leadId, `${sat.lat},${sat.lng},${sat.zoom}`)}
              x={0}
              y={0}
              width={SATELLITE_SIZE}
              height={SATELLITE_SIZE}
              onError={() => setImgFailed(true)}
            />
          )}
          <polygon
            points={roofPx.map((p) => p.join(",")).join(" ")}
            fill="rgba(255,176,32,0.12)"
            stroke={C.roofLine}
            strokeWidth={1.4 * unit}
            strokeDasharray={editing ? "none" : `${3 * unit} ${2 * unit}`}
          />
          {walls.map((w) => {
            const a = localToPx(w.a[0], w.a[1]);
            const b = localToPx(w.b[0], w.b[1]);
            const color = editing || !coverage ? "#fff" : coverageColor(coverage[w.id]);
            const selected = selectedWallId === w.id;
            return (
              <g key={w.id}>
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgba(0,0,0,0.55)" strokeWidth={(selected ? 6 : 4.5) * unit} strokeLinecap="round" />
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={(selected ? 4 : 2.6) * unit} strokeLinecap="round" />
                {!editing && (
                  <line
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke="transparent"
                    strokeWidth={22 * unit}
                    style={{ cursor: "pointer" }}
                    onClick={() => (pickingFront ? onPickFront(w) : onSelectWall?.(w.id === selectedWallId ? null : w.id))}
                  />
                )}
              </g>
            );
          })}
          {!editing &&
            walls.map((w) => {
              // label just outside the wall, along its outward normal
              const n = [Math.sin((w.normalAz * Math.PI) / 180), Math.cos((w.normalAz * Math.PI) / 180)];
              const p = localToPx(w.mid[0] + n[0] * 1.6, w.mid[1] + n[1] * 1.6);
              return (
                <g key={`l-${w.id}`} style={{ pointerEvents: "none" }}>
                  <rect x={p[0] - 11 * unit} y={p[1] - 6.5 * unit} width={22 * unit} height={13 * unit} rx={3 * unit} fill="rgba(0,0,0,0.72)" />
                  <text
                    x={p[0]}
                    y={p[1] + 3.6 * unit}
                    textAnchor="middle"
                    fontSize={10 * unit}
                    fontFamily={FONT_BODY}
                    fontWeight={700}
                    fill={w.side === "front" ? C.roofLine : "#fff"}
                  >
                    {w.id}
                  </text>
                </g>
              );
            })}
          {editing &&
            roofPx.map((p, i) => {
              const q = roofPx[(i + 1) % roofPx.length];
              const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
              return (
                <g key={`mid-${i}`}>
                  <circle
                    cx={m[0]}
                    cy={m[1]}
                    r={5 * unit}
                    fill="rgba(0,0,0,0.6)"
                    stroke="#fff"
                    strokeWidth={unit}
                    onClick={() => {
                      const ll = proj.fromPx(m[0], m[1]);
                      setDraft((d) => [...d.slice(0, i + 1), [ll.lat, ll.lng], ...d.slice(i + 1)]);
                      setSelIdx(i + 1);
                    }}
                  />
                  <text x={m[0]} y={m[1] + 3 * unit} textAnchor="middle" fontSize={9 * unit} fill="#fff" style={{ pointerEvents: "none" }}>
                    +
                  </text>
                </g>
              );
            })}
          {editing &&
            roofPx.map((p, i) => (
              <g key={`v-${i}`}>
                <circle cx={p[0]} cy={p[1]} r={6 * unit} fill={i === selIdx ? C.roofLine : "#fff"} stroke="#000" strokeWidth={1.2 * unit} />
                {/* bigger invisible target than the dot — fingers aren't precise */}
                <circle cx={p[0]} cy={p[1]} r={16 * unit} fill="transparent" data-vertex={i} />
              </g>
            ))}
        </svg>
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <button style={zoomBtn} onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom in">
            +
          </button>
          <button style={zoomBtn} onClick={() => zoomBy(1.6)} aria-label="Zoom out">
            −
          </button>
          {viewState && (
            <button style={{ ...zoomBtn, fontSize: 12 }} onClick={() => setViewState(null)} aria-label="Fit house">
              Fit
            </button>
          )}
        </div>
        {imgFailed && (
          <div style={{ position: "absolute", top: 8, left: 8, right: 8, fontFamily: FONT_BODY, fontSize: 12, color: "#fff" }}>
            Satellite picture didn't load (no signal?). The outline still works.
          </div>
        )}
        {pickingFront && (
          <div style={banner}>Tap the wall with the front door</div>
        )}
      </div>

      {editable && !editing && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button style={btnSecondary} onClick={startEdit}>
            Adjust outline
          </button>
        </div>
      )}
      {editing && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
            Drag the corners onto the roof edge (the outside of the gutters). Pinch or use + / − to zoom in for
            accuracy, drag the picture to move around. Tap a small + on an edge to add a corner.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btnSecondary} onClick={squareUp}>
              Square up corners
            </button>
            <button
              style={{ ...btnSecondary, opacity: selIdx == null || draft.length <= 3 ? 0.5 : 1 }}
              disabled={selIdx == null || draft.length <= 3}
              onClick={() => {
                setDraft((d) => d.filter((_, i) => i !== selIdx));
                setSelIdx(null);
              }}
            >
              Delete corner
            </button>
            <div style={{ flex: 1 }} />
            <button
              style={btnSecondary}
              onClick={() => {
                setEditing(false);
                setDraft(null);
              }}
            >
              Cancel
            </button>
            <button style={btnPrimary} disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save outline"}
            </button>
          </div>
        </div>
      )}
      {!editing && shownModel && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.muted, marginTop: 6 }}>
          Orange dashes = roof edge from above. Solid = walls ({Math.round(shownModel.overhangIn)}" overhang in).
        </div>
      )}
    </div>
  );
}

const zoomBtn = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: "none",
  background: "rgba(0,0,0,0.65)",
  color: "#fff",
  fontFamily: FONT_BODY,
  fontSize: 20,
  fontWeight: 700,
  cursor: "pointer",
};

const banner = {
  position: "absolute",
  left: 8,
  right: 8,
  bottom: 8,
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(0,0,0,0.75)",
  color: "#fff",
  fontFamily: FONT_BODY,
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center",
};
