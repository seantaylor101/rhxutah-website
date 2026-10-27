import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { C, FONT_BODY, FONT_DISPLAY, btnSecondary } from "./theme.js";

// A simple 3D model of the house to check against the real thing: every
// wall from the wall map at its level and height (from the latest report
// when there is one, else typical heights), gables, the windows and doors
// the report found, and the roofs — hipped over a rectangular level, flat
// over anything more complex. Drag to turn it, pinch to zoom.

const FT = 0.3048;
const MATERIAL_COLOR = { siding: 0xd9e4dc, stucco: 0xeadfc8, brick: 0xc98b74, stone: 0xb9b6ad, other: 0xd6d6e6 };
const TIER_COLOR = { one: 0xe8ecef, two: 0xf3e5a6, upper: 0xbfe3f2 };

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
  const eave = w.stories === 2 ? h2 : h1;
  return { base: 0, eave, peak: w.roofEdge === "gable" ? eave + ((w.lengthM / FT) / 2) * rise : null };
}

// three's y is up; the model is x east, y north (meters)
const V = (x, y, hFt) => new THREE.Vector3(x, hFt * FT, -y);

function quad(a, b, c, d, color, opts = {}) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts }));
}

function tri(a, b, c, color) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b, c]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

// hipped roof over a 4-cornered ring (meters), eave at eaveFt
function hipRoof(ring, eaveFt, rise) {
  const group = new THREE.Group();
  const [p0, p1, p2, p3] = ring;
  const l01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const l12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  // ridge runs along the long direction, inset by half the short side
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
  const color = 0x6b6f75;
  group.add(quad(V(...a, eaveFt), V(...b, eaveFt), V(...r2, ridgeH), V(...r1, ridgeH), color));
  group.add(quad(V(...c, eaveFt), V(...d, eaveFt), V(...r1, ridgeH), V(...r2, ridgeH), color));
  group.add(tri(V(...d, eaveFt), V(...a, eaveFt), V(...r1, ridgeH), color));
  group.add(tri(V(...b, eaveFt), V(...c, eaveFt), V(...r2, ridgeH), color));
  return group;
}

function flatRoof(ring, eaveFt) {
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, eaveFt * FT + 0.02, 0);
  // ShapeGeometry's y becomes -z after the rotation, matching V()
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6b6f75, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
}

// Google's roof surface (model.roofSurface, from the height map): the real
// roof, every 50 cm, and how high it is over any point
function surfaceOf(rs) {
  const c = Math.cos(rs.theta);
  const sn = Math.sin(rs.theta);
  const at = (i, j) => (i < 0 || j < 0 || i >= rs.nx || j >= rs.ny ? null : rs.h[j * rs.nx + i]);
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
  return { at, point, heightAt };
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
      pts.push(a, b, c, a, c, d);
    }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6b6f75, side: THREE.DoubleSide }));
}

// a wall from its base up to wherever the roof above it is — eaves, gable
// peaks and all — sampled along its length
function wallToRoof(w, baseFt, fallbackTopFt, surface, color) {
  const n = Math.max(2, Math.ceil(w.lengthM / 0.4) + 1);
  const pts = [];
  const tops = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const p = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
    const h = surface.heightAt(p[0], p[1]);
    tops.push(h != null ? h / FT : null);
    pts.push(p);
  }
  // running median over ~1.2 m, so a vent or a gap in the map doesn't make
  // a spike; gaps take the report's / typical eave height
  const smooth = tops.map((_, k) => {
    const win = tops.slice(Math.max(0, k - 1), k + 2).filter((x) => x != null).sort((x, y) => x - y);
    return win.length ? Math.max(baseFt + 1, win[Math.floor(win.length / 2)]) : fallbackTopFt;
  });
  tops.splice(0, tops.length, ...smooth);
  const tri = [];
  for (let k = 0; k < n - 1; k++) {
    const [p, q] = [pts[k], pts[k + 1]];
    const a = V(...p, baseFt);
    const b = V(...q, baseFt);
    const c = V(...q, tops[k + 1]);
    const d = V(...p, tops[k]);
    tri.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

function buildScene(model, report, pitch12) {
  const group = new THREE.Group();
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
    const kind = w.tier === "upper" ? "upper" : w.stories === 2 ? "two" : "one";
    const color = h.material ? MATERIAL_COLOR[h.material] ?? TIER_COLOR[kind] : TIER_COLOR[kind];
    const [a, b] = [w.a, w.b];
    if (surface) group.add(wallToRoof(w, h.base, h.eave, surface, color));
    else group.add(quad(V(...a, h.base), V(...b, h.base), V(...b, h.eave), V(...a, h.eave), color));
    if (!surface && h.peak && h.peak > h.eave + 0.3) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      group.add(tri(V(...a, h.eave), V(...b, h.eave), V(...m, h.peak), color));
    }
    if (w.tier === "upper") topUpper = Math.max(topUpper, h.eave);
    else if (w.stories === 2) topUpper = Math.max(topUpper, h.eave);
    else topGround = Math.max(topGround, h.eave);

    // windows and doors from the report, just proud of the wall
    if (same) {
      const u = [(b[0] - a[0]) / w.lengthM, (b[1] - a[1]) / w.lengthM];
      const n = [u[1], -u[0]];
      for (const o of same.openings || []) {
        const pt = ([x, y]) => {
          const along = x * FT;
          return V(a[0] + u[0] * along + n[0] * 0.03, a[1] + u[1] * along + n[1] * 0.03, h.base + y);
        };
        const [tl, tr, br, bl] = o.plane;
        group.add(quad(pt(bl), pt(br), pt(tr), pt(tl), o.type === "garage_door" ? 0x3a3f45 : o.type === "door" ? 0x5a4636 : 0x2f4f6f));
      }
    }
  }

  if (surface) {
    group.add(surfaceRoof(model.roofSurface));
  } else {
    addGuessedRoofs(group, model, topGround, topUpper, rise);
  }

  // ground
  const groundGeo = new THREE.CircleGeometry(40, 48);
  groundGeo.rotateX(-Math.PI / 2);
  group.add(new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x9fbf8f })));
  return group;
}

// no height map: hipped over a 4-cornered level, flat otherwise
function addGuessedRoofs(group, model, topGround, topUpper, rise) {
  const groundEave = topGround || (model.hasUpper ? 9 : topUpper || 9);
  // (a house that's two stories all the way round has no lower roof)
  if (model.roofLocal && !(model.hasUpper && !topGround)) group.add(model.roofLocal.length === 4 && !model.hasUpper ? hipRoof(model.roofLocal, groundEave, rise) : flatRoof(model.roofLocal, groundEave));
  if (model.upperRoofLocal) {
    const eave = topUpper || 18;
    group.add(model.upperRoofLocal.length === 4 ? hipRoof(model.upperRoofLocal, eave, rise) : flatRoof(model.upperRoofLocal, eave));
  }
}

export default function House3D({ model, report, pitch12, onClose }) {
  const mountRef = useRef(null);
  const [error, setError] = useState(null);

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
    scene.background = new THREE.Color(0xdfe9f2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa883, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-20, 40, 25);
    scene.add(sun);
    scene.add(buildScene(model, report, pitch12));

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
    controls.minDistance = 6;
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
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [model, report, pitch12]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 78, background: C.bg, display: "flex", flexDirection: "column", fontFamily: FONT_BODY }}>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "max(12px, env(safe-area-inset-top)) 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18 }}>3D model</div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {model.roofSurface ? "Roof from Google's height map" : "Roof shape estimated"}
            {report ? "; windows and doors from the latest report." : "."} Drag to turn, pinch to zoom.
          </div>
        </div>
        <button style={btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={mountRef} style={{ flex: 1, touchAction: "none", position: "relative" }}>
        {error && <div style={{ padding: 20, color: C.rust }}>{error}</div>}
      </div>
      <div style={{ padding: "8px 16px max(10px, env(safe-area-inset-bottom))", fontSize: 12, color: C.muted, background: C.surface, borderTop: `1px solid ${C.border}` }}>
        Compare it to the house. If a wall or the roof is off, adjust the outline on the wall map or tap Redo automatically.
      </div>
    </div>
  );
}
