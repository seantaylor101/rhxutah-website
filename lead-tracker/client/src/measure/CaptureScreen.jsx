import { useEffect, useMemo, useRef, useState } from "react";
import { assignShotProbabilities, REVIEW_BELOW, GUIDED_SLOTS, slotByKey, slotTargets, toLocal } from "../../../shared/houseGeometry.js";
import { FONT_BODY, FONT_DISPLAY, btnPrimary } from "./theme.js";
import { requestOrientationPermission, startSensors, snapshot, compassLabel } from "./sensors.js";
import { enqueuePhoto } from "./uploader.js";
import { requestPersistentStorage } from "./offlineStore.js";
import MiniMap from "./MiniMap.jsx";

const SWEEP_GAP_MS = 45 * 1000;
const LENS_PREF_KEY = "lh-measure-lens";

function newId() {
  return window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// friendly names for the iPhone's back cameras. The "Dual"/"Triple" virtual
// cameras switch lenses on their own mid-sweep, which changes the field of
// view between overlapping shots — left out on purpose.
function lensOptions(devices) {
  const out = [];
  for (const d of devices) {
    if (d.kind !== "videoinput" || !d.label) continue;
    const l = d.label;
    if (/front/i.test(l) || /dual|triple/i.test(l)) continue;
    if (/ultra ?wide/i.test(l)) out.push({ id: d.deviceId, label: "0.5×", name: l, order: 0 });
    else if (/telephoto/i.test(l)) out.push({ id: d.deviceId, label: "Tele", name: l, order: 2 });
    else if (/back|rear|environment/i.test(l)) out.push({ id: d.deviceId, label: "1×", name: l, order: 1 });
  }
  return out.sort((a, b) => a.order - b.order);
}

function readPref() {
  try {
    return localStorage.getItem(LENS_PREF_KEY);
  } catch {
    return null;
  }
}
function writePref(v) {
  try {
    localStorage.setItem(LENS_PREF_KEY, v);
  } catch {
    // storage blocked — just won't remember the lens
  }
}

const SIDE_WORD = { front: "front", right: "right side", back: "back", left: "left side" };

function slotInstructions(slot) {
  if (!slot) return "Close-ups, a tight side yard, a gable, anything blocked. Tap a wall on the map to tag it, or let the phone work it out.";
  if (slot.kind === "side")
    return `Step back until the whole ${SIDE_WORD[slot.sides[0]]} fits, roof to ground, aimed at the middle. Can't back up that far? Take it from an angle and add extras.`;
  return `Stand off the corner so both the ${SIDE_WORD[slot.sides[0]]} and the ${SIDE_WORD[slot.sides[1]]} show, corner in the middle of the frame.`;
}

// photos: everything already on this lead (server + queued) so the
// walk-around picks up where it left off. startSlot: open on that shot.
export default function CaptureScreen({ leadId, model, photos = [], startSlot, queuedCount, offline, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopSensorsRef = useRef(null);
  const sensorsRef = useRef({});
  const sweepRef = useRef({ id: null, at: 0, wall: null });
  const [phase, setPhase] = useState("intro"); // intro | starting | live | error
  const [error, setError] = useState(null);
  const [sensors, setSensors] = useState({});
  const [lenses, setLenses] = useState([]);
  const [lensId, setLensId] = useState(null);
  const [lockedWallId, setLockedWallId] = useState(null);
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orientationDenied, setOrientationDenied] = useState(false);

  // ---- guided walk-around ----
  const takenBefore = useMemo(() => {
    const m = {};
    for (const p of photos) if (p.slot) m[p.slot] = (m[p.slot] || 0) + 1;
    return m;
  }, [photos]);
  const [shotNow, setShotNow] = useState({}); // slot → count taken this visit (queue refresh lags a beat)
  const [skipped, setSkipped] = useState(() => new Set());
  const isDone = (key) => (takenBefore[key] || 0) + (shotNow[key] || 0) > 0;
  const [mode, setMode] = useState(() => {
    if (startSlot) return startSlot;
    const firstOpen = GUIDED_SLOTS.find((g) => !photos.some((p) => p.slot === g.key));
    return firstOpen ? firstOpen.key : "extra";
  });
  const slot = slotByKey(mode);
  const targets = useMemo(() => slotTargets(model), [model]);
  const target = slot && targets ? targets[slot.key] : null;
  const doneCount = GUIDED_SLOTS.filter((g) => isDone(g.key)).length;

  // next shot that's neither done nor skipped, going on around the house
  const advanceFrom = (key, justDone) => {
    const i = GUIDED_SLOTS.findIndex((g) => g.key === key);
    for (let k = 1; k <= GUIDED_SLOTS.length; k++) {
      const g = GUIDED_SLOTS[(i + k) % GUIDED_SLOTS.length];
      if (g.key === justDone) continue;
      if (!isDone(g.key) && !skipped.has(g.key)) return g.key;
    }
    return "extra";
  };
  const skip = () => {
    if (!slot) return;
    setSkipped((s0) => new Set(s0).add(slot.key));
    setMode(advanceFrom(slot.key, slot.key));
  };

  const stopCamera = () => {
    if (streamRef.current) for (const t of streamRef.current.getTracks()) t.stop();
    streamRef.current = null;
  };

  useEffect(
    () => () => {
      stopCamera();
      stopSensorsRef.current?.();
    },
    [],
  );

  const openCamera = async (deviceId) => {
    stopCamera();
    const video = {
      width: { ideal: 4032 },
      height: { ideal: 3024 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    streamRef.current = stream;
    const v = videoRef.current;
    if (v) {
      v.srcObject = stream;
      await v.play().catch(() => {});
    }
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    setLensId(settings.deviceId || deviceId || null);
    return settings;
  };

  // has to run straight from the tap: iOS only shows the motion/compass
  // permission prompt from inside a user gesture
  const start = async () => {
    const orientationPermission = requestOrientationPermission();
    setPhase("starting");
    requestPersistentStorage();
    try {
      if ((await orientationPermission) !== "granted") setOrientationDenied(true);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't open the camera here");
      await openCamera(null);
      const opts = lensOptions(await navigator.mediaDevices.enumerateDevices());
      setLenses(opts);
      const pref = readPref();
      const preferred = opts.find((o) => o.label === pref);
      if (preferred) await openCamera(preferred.id);
      stopSensorsRef.current = startSensors((s) => {
        sensorsRef.current = s;
        setSensors(s);
      });
      setPhase("live");
    } catch (err) {
      stopCamera();
      setError(
        err && err.name === "NotAllowedError"
          ? "Camera access was blocked. Allow it for this app in Settings → Safari → Camera, then try again."
          : err?.message || "Couldn't start the camera",
      );
      setPhase("error");
    }
  };

  const switchLens = async (opt) => {
    if (opt.id === lensId) return;
    try {
      await openCamera(opt.id);
      writePref(opt.label);
    } catch {
      setError("Couldn't switch to that lens");
    }
  };

  const currentLens = lenses.find((l) => l.id === lensId);

  // which wall the phone is pointed at right now
  const live = useMemo(() => {
    if (!model || !Number.isFinite(sensors.heading)) return null;
    const probs = assignShotProbabilities(model, sensors, "live");
    if (!probs) return null;
    const [wallId, p] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0] || [];
    return wallId ? { wallId, p } : null;
  }, [model, sensors]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d").drawImage(v, 0, 0);
      // sensors read at the shutter tap, not after the encode
      const now = Date.now();
      // consecutive shots of the same wall a few seconds apart are one sweep
      // (tilting up a two-story side, stepping along it) — the engine stitches
      // a sweep together using the rotation recorded between its shots
      const wallNow = slot ? `slot:${slot.key}` : lockedWallId || live?.wallId || null;
      const sw = sweepRef.current;
      if (!sw.id || now - sw.at > SWEEP_GAP_MS || sw.wall !== wallNow) sweepRef.current = { id: newId(), at: now, wall: wallNow };
      sweepRef.current.at = now;
      const sensorSnap = snapshot(sensorsRef.current, {
        lens: currentLens?.name || null,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        sweepId: sweepRef.current.id,
      });
      setFlash(true);
      setTimeout(() => setFlash(false), 120);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("Couldn't save that photo");
      await enqueuePhoto({
        clientId: newId(),
        leadId,
        blob,
        sensors: sensorSnap,
        slot: slot ? slot.key : "extra",
        wallId: slot ? null : lockedWallId,
      });
      setShots((n) => n + 1);
      if (slot) {
        setShotNow((m) => ({ ...m, [slot.key]: (m[slot.key] || 0) + 1 }));
        setMode(advanceFrom(slot.key, slot.key));
      }
    } catch (err) {
      setError(err.message || "Couldn't save that photo");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    stopCamera();
    stopSensorsRef.current?.();
    onClose();
  };

  const gpsAcc = sensors.gpsAccuracy;
  const unsure = !lockedWallId && (!live || live.p < REVIEW_BELOW);
  let hint = null;
  let distFt = null;
  if (target && Number.isFinite(sensors.lat) && model) {
    const p = toLocal(model.origin, sensors.lat, sensors.lng);
    distFt = Math.round(Math.hypot(p[0] - target.pos[0], p[1] - target.pos[1]) * 3.28);
  }
  if (phase === "live" && slot) {
    hint = null; // the shot card says what to do
  } else if (phase === "live") {
    if (orientationDenied && !Number.isFinite(sensors.heading)) hint = "Compass is off, so walls can't be auto-detected. Tap the wall you're shooting on the map.";
    else if (!model) hint = "No wall map yet. Photos are saved and get sorted onto walls once the map is set up.";
    else if (lockedWallId) hint = `Locked to ${lockedWallId}. Tap it again to unlock.`;
    else if (Number.isFinite(gpsAcc) && gpsAcc > 8 && unsure) hint = `GPS is rough here (±${Math.round(gpsAcc * 3.28)} ft). Tap the wall you're shooting to lock it.`;
    else if (unsure) hint = "Not sure which wall this is. Tap it on the map to lock it.";
    else if (Number.isFinite(sensors.cameraPitch) && sensors.cameraPitch > 30) hint = "Shooting up is fine. Keep about ⅓ overlap with the last shot.";
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "#000", color: "#fff", fontFamily: FONT_BODY }}>
      <video ref={videoRef} playsInline muted autoPlay style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.6 }} />}

      {/* top bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "max(12px, env(safe-area-inset-top)) 12px 8px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "linear-gradient(rgba(0,0,0,0.7), transparent)" }}>
        <button onClick={close} style={{ ...chip, fontSize: 14, padding: "7px 12px" }}>
          Done
        </button>
        {phase === "live" && (
          <>
            <span style={chip}>{Number.isFinite(gpsAcc) ? `GPS ±${Math.round(gpsAcc * 3.28)} ft` : sensors.gpsError === "denied" ? "GPS off" : "GPS…"}</span>
            <span style={chip}>{Number.isFinite(sensors.heading) ? `Facing ${compassLabel(sensors.heading)} ${Math.round(sensors.heading)}°` : "Compass…"}</span>
            {Number.isFinite(sensors.cameraPitch) && <span style={chip}>Tilt {Math.round(sensors.cameraPitch)}°</span>}
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ ...chip, background: offline ? "rgba(192,72,59,0.85)" : chip.background }}>
          {queuedCount ? `${queuedCount} waiting to upload${offline ? " (no signal)" : ""}` : offline ? "No signal, photos save on phone" : "All uploaded"}
        </span>
      </div>

      {phase !== "live" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ maxWidth: 420, background: "rgba(20,20,20,0.92)", borderRadius: 14, padding: 20 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, marginBottom: 10 }}>Walk around the house</div>
            <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.88)" }}>
              <li>
                <b>8 shots</b>: the middle of each side (front, right, back, left) and each outside corner. The app tells you which one is next and
                where to stand.
              </li>
              <li>Can't get one (fence, dog, neighbor's yard)? Tap <b>Skip</b>. Can't back up far enough? Shoot it from an angle, then add extras.</li>
              <li>
                <b>Extras</b> are optional: close-ups, a tight side yard (0.5× helps), gables, anything blocked.
              </li>
              <li>No signal? Keep shooting. Photos save on the phone and upload later.</li>
            </ul>
            {phase === "error" && <div style={{ color: "#FF8A80", fontSize: 13.5, marginBottom: 12 }}>{error}</div>}
            <button style={{ ...btnPrimary, width: "100%", padding: "12px 14px", fontSize: 15 }} onClick={start} disabled={phase === "starting"}>
              {phase === "starting" ? "Starting…" : phase === "error" ? "Try again" : "Start camera"}
            </button>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 10 }}>
              The phone will ask for camera, location and motion access. Location and compass are what sort photos onto walls automatically.
            </div>
          </div>
        </div>
      )}

      {phase === "live" && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px max(14px, env(safe-area-inset-bottom))", background: "linear-gradient(transparent, rgba(0,0,0,0.8) 30%)" }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 2 }}>
            {GUIDED_SLOTS.map((g, i) => {
              const done = isDone(g.key);
              const cur = mode === g.key;
              return (
                <button
                  key={g.key}
                  onClick={() => setMode(g.key)}
                  style={{
                    ...chip,
                    flex: "0 0 auto",
                    border: cur ? "2px solid #FFB020" : "2px solid transparent",
                    background: done ? "rgba(61,220,132,0.85)" : chip.background,
                    color: done ? "#002611" : skipped.has(g.key) ? "rgba(255,255,255,0.45)" : "#fff",
                  }}
                >
                  {done ? "✓ " : skipped.has(g.key) ? "– " : `${i + 1} `}
                  {g.label.replace(" corner", "").replace(" side", "")}
                </button>
              );
            })}
            <button
              onClick={() => setMode("extra")}
              style={{ ...chip, flex: "0 0 auto", border: mode === "extra" ? "2px solid #FFB020" : "2px solid transparent" }}
            >
              + Extras
            </button>
          </div>
          <div style={{ background: "rgba(0,0,0,0.6)", borderRadius: 10, padding: "8px 10px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>
                {slot ? `${GUIDED_SLOTS.indexOf(slot) + 1} of 8 · ${slot.label}` : doneCount === 8 ? "All 8 shots done ✓ · Extras" : `Extras · ${doneCount} of 8 shots done`}
              </div>
              {slot && (
                <button onClick={skip} style={{ ...chip, background: "rgba(255,255,255,0.15)" }}>
                  Skip
                </button>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.85)", marginTop: 3, lineHeight: 1.4 }}>
              {slotInstructions(slot)}
              {target &&
                (distFt == null
                  ? " Stand about where the orange spot is on the map."
                  : distFt < 15
                    ? " You're about at the orange spot."
                    : ` The orange spot on the map is about ${distFt} ft from you.`)}
            </div>
          </div>
          {hint && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, textShadow: "0 1px 2px #000" }}>{hint}</div>}
          {error && (
            <div style={{ fontSize: 13, color: "#FF8A80", marginBottom: 8 }} onClick={() => setError(null)}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div>
              <MiniMap
                model={model}
                sensors={sensors}
                liveWallId={!slot && !lockedWallId ? live?.wallId : null}
                lockedWallId={slot ? null : lockedWallId}
                onTapWall={slot ? undefined : (id) => setLockedWallId((cur) => (cur === id ? null : id))}
                target={target}
                highlightSides={slot ? slot.sides : null}
                size={132}
              />
              {model && !slot && (
                <div style={{ fontSize: 12, marginTop: 4, color: "rgba(255,255,255,0.85)" }}>
                  {lockedWallId
                    ? `🔒 ${model.walls.find((w) => w.id === lockedWallId)?.label || lockedWallId}`
                    : live
                      ? `${model.walls.find((w) => w.id === live.wallId)?.label || live.wallId} (${Math.round(live.p * 100)}%)`
                      : "Point at a wall"}
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              {lenses.length > 1 && (
                <div style={{ display: "flex", gap: 6 }}>
                  {lenses.map((l) => (
                    <button key={l.id} onClick={() => switchLens(l)} style={{ ...chip, fontWeight: 700, background: l.id === lensId ? "rgba(255,176,32,0.9)" : chip.background, color: l.id === lensId ? "#000" : "#fff" }}>
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={shoot}
                disabled={busy}
                aria-label="Take photo"
                style={{ width: 72, height: 72, borderRadius: "50%", border: "4px solid #fff", background: busy ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.92)", cursor: "pointer" }}
              />
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{shots ? `${shots} this visit` : " "}</div>
            </div>
            <div style={{ width: 132 }} />
          </div>
        </div>
      )}
    </div>
  );
}

const chip = {
  border: "none",
  borderRadius: 999,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: FONT_BODY,
  background: "rgba(0,0,0,0.55)",
  color: "#fff",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
