// Live phone sensors for the capture screen: where the phone is (GPS),
// which way the back camera points (compass), and how it's tilted. A
// snapshot of these is saved with every photo — that's what auto-assigns
// the photo to a wall now, and what lets the measurement engine later work
// out how overlapping shots of one wall fit together.

const DEG = Math.PI / 180;

// Direction the back camera looks, from the W3C device-orientation angles.
// The device→earth rotation is Rz(alpha)·Rx(beta)·Ry(gamma); the back
// camera looks down the device's −z axis. Returns compass azimuth (only
// meaningful when alpha is referenced to north) and pitch (how far above
// level the camera points — always meaningful).
export function cameraDirection(alpha, beta, gamma) {
  const a = (alpha || 0) * DEG;
  const b = (beta || 0) * DEG;
  const g = (gamma || 0) * DEG;
  // third column of Rz·Rx·Ry, negated
  const x = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const y = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
  const z = -(Math.cos(b) * Math.cos(g));
  const azimuth = (((Math.atan2(x, y) / DEG) % 360) + 360) % 360;
  const pitch = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
  return { azimuth, pitch };
}

// iOS only hands out motion/compass data after the user taps something and
// says yes — this has to be called straight from that tap, before any await
export function requestOrientationPermission() {
  const D = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
  if (D && typeof D.requestPermission === "function") {
    return D.requestPermission().catch(() => "denied");
  }
  return Promise.resolve("granted");
}

export function startSensors(onChange) {
  const state = {
    lat: null,
    lng: null,
    gpsAccuracy: null,
    altitude: null,
    gpsAt: null,
    gpsError: null,
    heading: null,
    headingAccuracy: null,
    headingSource: null,
    alpha: null,
    beta: null,
    gamma: null,
    cameraPitch: null,
    orientationAt: null,
  };
  let lastEmit = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now;
    onChange({ ...state });
  };

  const onOrientation = (e, absolute) => {
    if (e.alpha == null && e.beta == null) return;
    state.alpha = e.alpha;
    state.beta = e.beta;
    state.gamma = e.gamma;
    const dir = cameraDirection(e.alpha, e.beta, e.gamma);
    state.cameraPitch = dir.pitch;
    if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) {
      // iOS: tilt-compensated heading of the back camera
      state.heading = e.webkitCompassHeading;
      state.headingAccuracy = typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null;
      state.headingSource = "compass";
    } else if (absolute || e.absolute) {
      // Android: alpha is already relative to north
      state.heading = dir.azimuth;
      state.headingAccuracy = null;
      state.headingSource = "absolute";
    }
    state.orientationAt = Date.now();
    emit(false);
  };
  const onRel = (e) => onOrientation(e, false);
  const onAbs = (e) => onOrientation(e, true);
  window.addEventListener("deviceorientation", onRel);
  window.addEventListener("deviceorientationabsolute", onAbs);

  let watchId = null;
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        state.lat = pos.coords.latitude;
        state.lng = pos.coords.longitude;
        state.gpsAccuracy = pos.coords.accuracy;
        state.altitude = pos.coords.altitude;
        state.gpsAt = pos.timestamp || Date.now();
        state.gpsError = null;
        emit(true);
      },
      (err) => {
        state.gpsError = err.code === 1 ? "denied" : "unavailable";
        emit(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }

  return () => {
    window.removeEventListener("deviceorientation", onRel);
    window.removeEventListener("deviceorientationabsolute", onAbs);
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
  };
}

// the sensor snapshot saved with a photo
export function snapshot(state, extra = {}) {
  const now = Date.now();
  const gpsFresh = state.gpsAt && now - state.gpsAt < 30000;
  const screenAngle =
    (typeof screen !== "undefined" && screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  return {
    capturedAt: new Date(now).toISOString(),
    source: "camera",
    lat: gpsFresh ? state.lat : null,
    lng: gpsFresh ? state.lng : null,
    gpsAccuracy: gpsFresh ? state.gpsAccuracy : null,
    gpsAgeMs: state.gpsAt ? now - state.gpsAt : null,
    altitude: gpsFresh ? state.altitude : null,
    heading: state.heading,
    headingAccuracy: state.headingAccuracy,
    headingSource: state.headingSource,
    alpha: state.alpha,
    beta: state.beta,
    gamma: state.gamma,
    cameraPitch: state.cameraPitch,
    screenAngle,
    ...extra,
  };
}

export function compassLabel(deg) {
  if (!Number.isFinite(deg)) return "";
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(deg / 45) % 8];
}
