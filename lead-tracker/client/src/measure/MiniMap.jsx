import { toLocal } from "../../../shared/houseGeometry.js";
import { C, FONT_BODY, coverageColor } from "./theme.js";

// Top-down house outline for the capture screen: where you're standing,
// which way the camera points, which wall the phone thinks it's looking at
// (blue), and which walls are done (green) or partly shot (amber). Tapping a
// wall locks every following shot to it — the one-tap fix for a tight side
// yard where GPS can't tell side from front.
//
// During the guided walk-around it also shows where to stand for the current
// shot (orange target, arrow pointing the way to aim) and lights up the
// side(s) of the house that shot is for.
export default function MiniMap({ model, coverage, sensors, liveWallId, lockedWallId, onTapWall, target, highlightSides, size = 150 }) {
  if (!model) return null;
  const pts = target ? [...model.wallLocal, target.pos] : model.wallLocal;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pad = span * 0.45 + 4;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = span / 2 + pad;
  // north up: flip y for SVG
  const vb = [cx - half, -(cy + half), half * 2, half * 2];
  const u = (half * 2) / size; // one screen pixel in meters

  let cam = null;
  if (sensors && Number.isFinite(sensors.lat) && Number.isFinite(sensors.lng)) {
    const p = toLocal(model.origin, sensors.lat, sensors.lng);
    // keep the dot on the map edge when GPS puts you way off
    cam = [Math.max(vb[0] + 3 * u, Math.min(vb[0] + vb[2] - 3 * u, p[0])), Math.max(-vb[1] - vb[3] + 3 * u, Math.min(-vb[1] - 3 * u, p[1]))];
  }

  return (
    <svg viewBox={vb.join(" ")} width={size} height={size} style={{ display: "block", background: "rgba(0,0,0,0.55)", borderRadius: 10 }}>
      {model.walls.map((w) => {
        const lit = highlightSides && highlightSides.includes(w.side);
        const color =
          w.id === lockedWallId ? C.roofLine : w.id === liveWallId || lit ? C.wallLive : coverage ? coverageColor(coverage[w.id]) : "rgba(255,255,255,0.75)";
        const strong = w.id === lockedWallId || w.id === liveWallId || lit;
        return (
          <g key={w.id} onClick={() => onTapWall?.(w.id)} style={{ cursor: "pointer" }}>
            <line x1={w.a[0]} y1={-w.a[1]} x2={w.b[0]} y2={-w.b[1]} stroke={color} strokeWidth={(strong ? 5 : 3) * u} strokeLinecap="round" />
            <line x1={w.a[0]} y1={-w.a[1]} x2={w.b[0]} y2={-w.b[1]} stroke="transparent" strokeWidth={20 * u} />
          </g>
        );
      })}
      {model.walls.map((w) => {
        const n = [Math.sin((w.normalAz * Math.PI) / 180), Math.cos((w.normalAz * Math.PI) / 180)];
        return (
          <text
            key={`t-${w.id}`}
            x={w.mid[0] + n[0] * 9 * u}
            y={-(w.mid[1] + n[1] * 9 * u) + 3.5 * u}
            textAnchor="middle"
            fontSize={9.5 * u}
            fontFamily={FONT_BODY}
            fontWeight={700}
            fill="#fff"
            style={{ pointerEvents: "none" }}
          >
            {w.id}
          </text>
        );
      })}
      {target && (
        <g style={{ pointerEvents: "none" }}>
          <line
            x1={target.pos[0]}
            y1={-target.pos[1]}
            x2={target.pos[0] + Math.sin((target.aimAz * Math.PI) / 180) * 14 * u}
            y2={-(target.pos[1] + Math.cos((target.aimAz * Math.PI) / 180) * 14 * u)}
            stroke={C.roofLine}
            strokeWidth={2.5 * u}
            strokeLinecap="round"
          />
          <circle cx={target.pos[0]} cy={-target.pos[1]} r={7 * u} fill="none" stroke={C.roofLine} strokeWidth={2.5 * u} />
          <circle cx={target.pos[0]} cy={-target.pos[1]} r={2.5 * u} fill={C.roofLine} />
        </g>
      )}
      {cam && Number.isFinite(sensors.heading) && (
        <path
          d={(() => {
            const r = span * 0.35 + 3;
            const a1 = ((sensors.heading - 28) * Math.PI) / 180;
            const a2 = ((sensors.heading + 28) * Math.PI) / 180;
            const p1 = [cam[0] + Math.sin(a1) * r, -(cam[1] + Math.cos(a1) * r)];
            const p2 = [cam[0] + Math.sin(a2) * r, -(cam[1] + Math.cos(a2) * r)];
            return `M ${cam[0]} ${-cam[1]} L ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} Z`;
          })()}
          fill="rgba(79,195,247,0.28)"
          style={{ pointerEvents: "none" }}
        />
      )}
      {cam && (
        <>
          {Number.isFinite(sensors.gpsAccuracy) && (
            <circle cx={cam[0]} cy={-cam[1]} r={Math.min(sensors.gpsAccuracy, half)} fill="rgba(79,195,247,0.12)" stroke="rgba(79,195,247,0.5)" strokeWidth={u} style={{ pointerEvents: "none" }} />
          )}
          <circle cx={cam[0]} cy={-cam[1]} r={4 * u} fill={C.wallLive} stroke="#fff" strokeWidth={1.5 * u} style={{ pointerEvents: "none" }} />
        </>
      )}
      <text x={vb[0] + 6 * u} y={vb[1] + 13 * u} fontSize={10 * u} fill="rgba(255,255,255,0.8)" fontFamily={FONT_BODY} fontWeight={700} style={{ pointerEvents: "none" }}>
        N↑
      </text>
    </svg>
  );
}
