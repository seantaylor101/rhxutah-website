import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { C, FONT_BODY, FONT_DISPLAY, btnSecondary } from "./theme.js";
import { fmtFtIn, MATERIAL_LABEL } from "../../../shared/facadeGeometry.js";

// A 3D model of the house drawn the way a measurement report draws one:
// Google's roof planes, every wall from the wall map rising to meet them,
// the brick / stone / stucco areas and the windows and doors the report
// found (tagged W-1, D-1, G-1), and optionally each wall's measurements.
// Tap a wall to see its area. Drag to turn, pinch to zoom.

const FT = 0.3048;
const MATERIAL_COLOR = { siding: 0xf6f6f3, stucco: 0xe9dcc3, brick: 0xc98b74, stone: 0xb9b6ad, other: 0xd6d6e6 };
const WALL_COLOR = 0xf6f6f3;
const OPENING_COLOR = { window: 0x9fbcd6, door: 0x8a6a50, garage_door: 0xd9d9d9 };
const ROOF_COLOR = 0xc4c7cc;
const EDGE_COLOR = 0x2b2f33;
const SELECT_COLOR = 0x7fd3a8;

function wallHeights(w, reportWall, model, pitch12) {
  if (reportWall) {
    return {
      base: reportWall.baseHeight ?? 0,
      eave: reportWall.eaveHeight,
      peak: reportWall.peakHeight != null ? (reportWall.baseHeight ?? 0) + reportWall.peakHeight : null,
      material: reportWall.primaryMaterial,
    };
  }
  const rise = (pitch12 ?? 7) / 12;
  const h1 = 9;
  const h2 = model.hasUpper ? 18 : 9;
  if (w.tier === "upper") {
    const base = h1 + (w.setbackM != null ? (w.setbackM / FT) * rise : 0);
    return { base, eave: h2, peak: w.roofEdge === "gable" ? h2 + ((w.lengthM / FT) / 2) * rise : null };
  }
  const eave = w.stories === 2 ? 18 : w.stories === 1 ? 9 : h2;
  return { base: 0, eave, peak: w.roofEdge === "gable" ? eave + ((w.lengthM / FT) / 2) * rise : null };
}

// three's y is up; the model is x east, y north (meters)
const V = (x, y, hFt) => new THREE.Vector3(x, hFt * FT, -y);

function meshOf(points, color, opts = {}) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts }));
}

function edgesOf(mesh, angle = 20) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), new THREE.LineBasicMaterial({ color: EDGE_COLOR }));
}

function quad(a, b, c, d, color, opts) {
  return meshOf([a, b, c, a, c, d], color, opts);
}

function tri(a, b, c, color) {
  return meshOf([a, b, c], color);
}

// a text tag that always faces the camera
function label(text, { bg = "rgba(255,255,255,0.92)", fg = "#1d2125", heightM = 0.45, bold = true } = {}) {
  const pad = 10;
  const fontPx = 44;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `${bold ? "700 " : ""}${fontPx}px ${FONT_BODY}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, w, h, 10);
  else ctx.rect(0, 0, w, h);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // hidden behind the house when the wall it's on faces away
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set((heightM * w) / h, heightM, 1);
  return sprite;
}

// hipped roof over a 4-cornered ring (meters), eave at eaveFt
function hipRoof(ring, eaveFt, rise) {
  const group = new THREE.Group();
  const [p0, p1, p2, p3] = ring;
  const l01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const l12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const [a, b, c, d] = l01 >= l12 ? [p0, p1, p2, p3] : [p1, p2, p3, p0];
  const short = Math.min(l01, l12);
  const long = Math.max(l01, l12);
  const ridgeH = eaveFt + (short / 2 / FT) * rise;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m1 = mid(a, d);
  const m2 = mid(b, c);
  const t = Math.min(0.49, short / 2 / long);
  const r1 = [m1[0] + (m2[0] - m1[0]) * t, m1[1] + (m2[1] - m1[1]) * t];
  const r2 = [m2[0] + (m1[0] - m2[0]) * t, m2[1] + (m1[1] - m2[1]) * t];
  for (const m of [
    quad(V(...a, eaveFt), V(...b, eaveFt), V(...r2, ridgeH), V(...r1, ridgeH), ROOF_COLOR),
    quad(V(...c, eaveFt), V(...d, eaveFt), V(...r1, ridgeH), V(...r2, ridgeH), ROOF_COLOR),
    tri(V(...d, eaveFt), V(...a, eaveFt), V(...r1, ridgeH), ROOF_COLOR),
    tri(V(...b, eaveFt), V(...c, eaveFt), V(...r2, ridgeH), ROOF_COLOR),
  ]) {
    group.add(m, edgesOf(m));
  }
  return group;
}

function flatRoof(ring, eaveFt) {
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, eaveFt * FT + 0.02, 0);
  // ShapeGeometry's y becomes -z after the rotation, matching V()
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: ROOF_COLOR, side: THREE.DoubleSide }));
}

// Google's roof surface (model.roofSurface, from the height map): flat
// planes every 50 cm, and how high the roof is over any point
function surfaceOf(rs) {
  const c = Math.cos(rs.theta);
  const sn = Math.sin(rs.theta);
  const inGrid = (i, j) => i >= 0 && j >= 0 && i < rs.nx && j < rs.ny;
  const at = (i, j) => (inGrid(i, j) ? rs.h[j * rs.nx + i] : null);
  const facet = (i, j) => (inGrid(i, j) && rs.facet ? rs.facet[j * rs.nx + i] : -1);
  const point = (i, j) => {
    const fx = rs.x0 + i * rs.step;
    const fy = rs.y0 + j * rs.step;
    return [fx * c - fy * sn, fx * sn + fy * c];
  };
  const heightAt = (x, y) => {
    const fx = x * c + y * sn;
    const fy = -x * sn + y * c;
    return at(Math.round((fx - rs.x0) / rs.step), Math.round((fy - rs.y0) / rs.step));
  };
  return { at, facet, point, heightAt };
}

function surfaceRoof(rs) {
  const s = surfaceOf(rs);
  const pts = [];
  for (let j = 0; j < rs.ny - 1; j++)
    for (let i = 0; i < rs.nx - 1; i++) {
      const hs = [s.at(i, j), s.at(i + 1, j), s.at(i + 1, j + 1), s.at(i, j + 1)];
      if (hs.some((h) => h == null)) continue;
      const [a, b, c, d] = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ].map(([u, v], k) => V(...s.point(u, v), hs[k] / FT));
      // split each square along the crease where two roof planes meet
      // diagonally (a hip or valley), not across it — otherwise every hip
      // comes out as a sawtooth
      const crossAC = s.facet(i, j) !== s.facet(i + 1, j + 1) && s.facet(i + 1, j) === s.facet(i, j + 1);
      if (crossAC) pts.push(a, b, d, b, c, d);
      else pts.push(a, b, c, a, c, d);
    }
  const mesh = meshOf(pts, ROOF_COLOR);
  const group = new THREE.Group();
  group.add(mesh, edgesOf(mesh, 14));
  return group;
}

// a wall from its base up to wherever the roof above it is — eaves, gable
// peaks and all — sampled along its length
function wallToRoof(w, baseFt, fallbackTopFt, surface, color) {
  const n = Math.max(2, Math.ceil(w.lengthM / 0.4) + 1);
  const pts = [];
  const raw = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const p = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
    const h = surface.heightAt(p[0], p[1]);
    raw.push(h != null ? h / FT : null);
    pts.push(p);
  }
  // running median, so a vent or a gap in the map doesn't make a spike;
  // gaps take the report's / typical eave height
  const tops = raw.map((_, k) => {
    const win = raw
      .slice(Math.max(0, k - 1), k + 2)
      .filter((x) => x != null)
      .sort((x, y) => x - y);
    return win.length ? Math.max(baseFt + 1, win[Math.floor(win.length / 2)]) : fallbackTopFt;
  });
  const tris = [];
  for (let k = 0; k < n - 1; k++) {
    const [p, q] = [pts[k], pts[k + 1]];
    const a = V(...p, baseFt);
    const b = V(...q, baseFt);
    const c = V(...q, tops[k + 1]);
    const d = V(...p, tops[k]);
    tris.push(a, b, c, a, c, d);
  }
  return {
    mesh: meshOf(tris, color),
    topAt: (xFt) => tops[Math.max(0, Math.min(n - 1, Math.round(((xFt * FT) / w.lengthM) * (n - 1))))],
  };
}

// a flat shape lying on a wall: points in the wall's own feet (x from its
// left end as seen from outside, y up from its base), just proud of it
function onWall(w, ptsFt, baseFt, color, proud) {
  const u = [(w.b[0] - w.a[0]) / w.lengthM, (w.b[1] - w.a[1]) / w.lengthM];
  const n = [u[1], -u[0]];
  const place = (xFt, yFt, out) => V(w.a[0] + u[0] * xFt * FT + n[0] * out, w.a[1] + u[1] * xFt * FT + n[1] * out, baseFt + yFt);
  if (!ptsFt) return { at: (xFt, yFt, out = proud + 0.05) => place(xFt, yFt, out) };
  const g = new THREE.ShapeGeometry(new THREE.Shape(ptsFt.map(([x, y]) => new THREE.Vector2(x, y))));
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = place(pos.getX(i), pos.getY(i), proud);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ptsFt.map(([x, y]) => place(x, y, proud + 0.005))),
    new THREE.LineBasicMaterial({ color: EDGE_COLOR }),
  );
  return { mesh, outline, at: (xFt, yFt, out = proud + 0.05) => place(xFt, yFt, out) };
}

function buildScene(model, report, pitch12) {
  const group = new THREE.Group();
  const pickables = [];
  const dims = new THREE.Group();
  const tags = new THREE.Group();
  const rw = Object.fromEntries((report?.walls || []).map((w) => [w.id, w]));
  const rise = (pitch12 ?? 7) / 12;
  const surface = model.roofSurface ? surfaceOf(model.roofSurface) : null;
  let topGround = 0;
  let topUpper = 0;

  for (const w of model.walls) {
    const r = rw[w.id];
    // only trust a report's numbers for this wall if it's the same wall
    const same = r && Math.abs(r.widthFt - w.lengthM / FT) < 0.6 ? r : null;
    if (same && same.counted === false) continue;
    const h = wallHeights(w, same, model, pitch12);
    // an upper wall stands on the lower roof in front of it: read where
    // that roof is from the roof surface itself
    if (surface && w.tier === "upper") {
      const u = [(w.b[0] - w.a[0]) / w.lengthM, (w.b[1] - w.a[1]) / w.lengthM];
      const n = [u[1], -u[0]];
      const hs = [0.2, 0.4, 0.6, 0.8]
        .map((t) => surface.heightAt(w.a[0] + (w.b[0] - w.a[0]) * t + n[0] * 0.7, w.a[1] + (w.b[1] - w.a[1]) * t + n[1] * 0.7))
        .filter((x) => x != null)
        .sort((x, y) => x - y);
      if (hs.length) h.base = hs[Math.floor(hs.length / 2)] / FT;
    }
    const color = (h.material && MATERIAL_COLOR[h.material]) || WALL_COLOR;
    const [a, b] = [w.a, w.b];
    let wallMesh;
    let topAt = () => h.eave;
    if (surface) {
      const built = wallToRoof(w, h.base, h.eave, surface, color);
      wallMesh = built.mesh;
      topAt = built.topAt;
    } else {
      wallMesh = quad(V(...a, h.base), V(...b, h.base), V(...b, h.eave), V(...a, h.eave), color);
      if (h.peak && h.peak > h.eave + 0.3) {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const gable = tri(V(...a, h.eave), V(...b, h.eave), V(...m, h.peak), color);
        gable.userData.wallId = w.id;
        pickables.push(gable);
        group.add(gable, edgesOf(gable));
      }
    }
    wallMesh.userData.wallId = w.id;
    pickables.push(wallMesh);
    group.add(wallMesh, edgesOf(wallMesh, 10));
    if (w.tier === "upper" || w.stories === 2) topUpper = Math.max(topUpper, h.eave);
    else topGround = Math.max(topGround, h.eave);

    const widthFt = w.lengthM / FT;
    const spot = onWall(w, null, h.base, 0, 0);
    // brick / stone / stucco areas, then windows and doors with their tags
    if (same) {
      for (const reg of same.regions || []) {
        if (!reg.plane || reg.plane.length < 3) continue;
        const o = onWall(w, reg.plane, h.base, MATERIAL_COLOR[reg.material] ?? 0xdddddd, 0.015);
        group.add(o.mesh, o.outline);
      }
      for (const op of same.openings || []) {
        const o = onWall(w, op.plane, h.base, OPENING_COLOR[op.type] ?? 0x9fbcd6, 0.03);
        group.add(o.mesh, o.outline);
        const cx = op.plane.reduce((t, p) => t + p[0], 0) / op.plane.length;
        const cy = op.plane.reduce((t, p) => t + p[1], 0) / op.plane.length;
        if (op.tag) {
          const t = label(op.tag, { bg: op.type === "window" ? "rgba(29,33,37,0.85)" : "rgba(196,48,43,0.9)", fg: "#fff", heightM: 0.32 });
          t.position.copy(o.at(cx, cy + Math.min(1.2, Math.max(0, op.height / 2 - 0.4))));
          tags.add(t);
        }
        const size = label(`${Math.round(op.width * 12)}" × ${Math.round(op.height * 12)}"`, { heightM: 0.26, bold: false, bg: "rgba(255,255,255,0.85)" });
        size.position.copy(o.at(cx, cy - Math.min(0.9, Math.max(0, op.height / 2 - 0.3))));
        dims.add(size);
      }
    }
    // the wall's own measurements: width along the bottom, height up one
    // side, and its number
    const midTop = topAt(widthFt / 2) - h.base;
    const wl = label(fmtFtIn(widthFt), { fg: "#2747c9", heightM: 0.42 });
    wl.position.copy(spot.at(widthFt / 2, 1, 0.4));
    dims.add(wl);
    if (widthFt > 4) {
      const hx = Math.min(widthFt - 1, Math.max(1, widthFt * 0.15));
      const hl = label(fmtFtIn(same ? same.height : topAt(hx) - h.base), { fg: "#2747c9", heightM: 0.42 });
      hl.position.copy(spot.at(hx, (topAt(hx) - h.base) / 2, 0.4));
      dims.add(hl);
    }
    const idl = label(w.id, { bg: "rgba(39,71,201,0.9)", fg: "#fff", heightM: 0.42 });
    idl.position.copy(spot.at(widthFt / 2, Math.max(2, midTop * 0.62), 0.4));
    dims.add(idl);
  }

  if (surface) group.add(surfaceRoof(model.roofSurface));
  else addGuessedRoofs(group, model, topGround, topUpper, rise);

  const groundGeo = new THREE.CircleGeometry(40, 48);
  groundGeo.rotateX(-Math.PI / 2);
  group.add(new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0xa9c49b })));
  group.add(dims, tags);
  return { group, pickables, dims };
}

// no height map: hipped over a 4-cornered level, flat otherwise
function addGuessedRoofs(group, model, topGround, topUpper, rise) {
  const groundEave = topGround || (model.hasUpper ? 9 : topUpper || 9);
  // (a house that's two stories all the way round has no lower roof)
  if (model.roofLocal && !(model.hasUpper && !topGround))
    group.add(model.roofLocal.length === 4 && !model.hasUpper ? hipRoof(model.roofLocal, groundEave, rise) : flatRoof(model.roofLocal, groundEave));
  if (model.upperRoofLocal) {
    const eave = topUpper || 18;
    group.add(model.upperRoofLocal.length === 4 ? hipRoof(model.upperRoofLocal, eave, rise) : flatRoof(model.upperRoofLocal, eave));
  }
}

const ft2 = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString()} ft²` : "—");

// what the selected wall measures: from the report when there is one,
// otherwise just its width
function WallInfo({ wall, reportWall, onClose }) {
  const r = reportWall;
  const widthFt = wall.lengthM / FT;
  const openings = r?.openings || [];
  const openArea = openings.reduce((t, o) => t + o.area, 0);
  const mats = r ? Object.keys(r.byGross || {}).filter((m) => r.byGross[m] > 0.5) : [];
  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        right: 10,
        bottom: "max(10px, env(safe-area-inset-bottom))",
        background: C.surface,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        padding: 12,
        maxHeight: "45%",
        overflowY: "auto",
        boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16, flex: 1 }}>
          {wall.id} · {wall.label}
        </div>
        <button style={{ ...btnSecondary, padding: "4px 10px" }} onClick={onClose}>
          ✕
        </button>
      </div>
      <div style={{ fontSize: 13, color: C.muted, margin: "2px 0 8px" }}>
        {wall.tier === "upper" ? "Upper wall above a lower roof" : wall.stories === 2 ? "Two stories" : wall.stories === 1 ? "One story" : "Wall"} · {fmtFtIn(widthFt)} wide
        {r ? ` × ${fmtFtIn(r.height)}${r.peakHeight ? `, ${fmtFtIn(r.peakHeight)} at peak` : ""}` : ""}
      </div>
      {r ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
            {[
              ["Gross", ft2(r.grossArea)],
              ["Openings", ft2(openArea)],
              ["Net", ft2(r.grossArea - openArea)],
            ].map(([k, v]) => (
              <div key={k} style={{ background: C.surfaceMuted, borderRadius: 8, padding: "6px 8px" }}>
                <div style={{ fontSize: 11.5, color: C.muted }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          {mats.length > 0 && (
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              {mats.map((m) => (
                <div key={m}>
                  {MATERIAL_LABEL[m] || m}: {ft2(r.byGross[m])} gross · {ft2((r.openingsByMaterial || {})[m] || 0)} openings · <b>{ft2((r.byMaterial || {})[m] || 0)} net</b>
                </div>
              ))}
            </div>
          )}
          {openings.length > 0 && (
            <div style={{ fontSize: 13 }}>
              {openings.map((o, i) => (
                <span key={i} style={{ display: "inline-block", marginRight: 10 }}>
                  <b>{o.tag || `#${o.no}`}</b> {Math.round(o.width * 12)}" × {Math.round(o.height * 12)}"
                </span>
              ))}
            </div>
          )}
          {!r.measured && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 6 }}>Not seen in a photo, so its height is estimated.</div>}
        </>
      ) : (
        <div style={{ fontSize: 13, color: C.muted }}>Run Create report to get this wall's height, area, windows and doors from the photos.</div>
      )}
    </div>
  );
}

export default function House3D({ model, report, pitch12, onClose }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [error, setError] = useState(null);
  const [showDims, setShowDims] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el || !model) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("3D isn't available in this browser.");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f6);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa892, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-20, 40, 25);
    scene.add(sun);
    const built = buildScene(model, report, pitch12);
    scene.add(built.group);
    built.dims.visible = false;
    sceneRef.current = built;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    // start from the street, off to the right and above, far enough back
    // that the whole house fits even on a tall, narrow phone screen
    const az = ((model.frontAz ?? 180) - 35) * (Math.PI / 180);
    const dir = new THREE.Vector3(Math.sin(az), 0.55, -Math.cos(az)).normalize();
    const xs = model.roofLocal.map((p) => p[0]);
    const ys = model.roofLocal.map((p) => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 3, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 4;
    controls.maxDistance = 120;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    camera.position.copy(dir.multiplyScalar((span * 1.35) / Math.min(1, camera.aspect) + 4)).add(new THREE.Vector3(0, 3, 0));
    window.addEventListener("resize", resize);

    // a tap (not a drag) on a wall selects it; a tap off the house clears it
    const ray = new THREE.Raycaster();
    let down = null;
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(built.pickables, false)[0];
      setSelected(hit ? hit.object.userData.wallId : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [model, report, pitch12]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.dims.visible = showDims;
  }, [showDims]);

  // tint the selected wall
  useEffect(() => {
    const built = sceneRef.current;
    if (!built) return;
    for (const m of built.pickables) {
      if (m.userData.baseColor == null) m.userData.baseColor = m.material.color.getHex();
      m.material.color.setHex(m.userData.wallId === selected ? SELECT_COLOR : m.userData.baseColor);
    }
  }, [selected]);

  const selWall = selected ? model.walls.find((w) => w.id === selected) : null;
  const selReport = selWall ? (report?.walls || []).find((w) => w.id === selWall.id && Math.abs(w.widthFt - selWall.lengthM / FT) < 0.6) : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 78, background: C.bg, display: "flex", flexDirection: "column", fontFamily: FONT_BODY }}>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "max(12px, env(safe-area-inset-top)) 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18 }}>3D model</div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {model.roofSurface ? "Roof from Google's height map" : "Roof shape estimated"}
            {report ? "; materials, windows and doors from the latest report." : "."} Tap a wall for its area.
          </div>
        </div>
        <button style={btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={mountRef} style={{ flex: 1, touchAction: "none", position: "relative" }}>
        {error && <div style={{ padding: 20, color: C.rust }}>{error}</div>}
        <button
          style={{ ...btnSecondary, position: "absolute", top: 10, right: 10, padding: "7px 10px", background: showDims ? C.roofLine : C.surface }}
          onClick={() => setShowDims((v) => !v)}
        >
          📏 {showDims ? "Hide" : "Show"} measurements
        </button>
        {selWall && <WallInfo wall={selWall} reportWall={selReport} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
