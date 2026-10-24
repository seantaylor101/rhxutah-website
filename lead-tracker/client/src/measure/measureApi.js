const BASE = "/api/measure";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const measureApi = {
  get: (leadId) => request(`/lead/${leadId}`),
  lookup: (leadId, address) => request(`/lead/${leadId}/lookup`, { method: "POST", body: JSON.stringify({ address }) }),
  saveOutline: (leadId, patch) => request(`/lead/${leadId}/outline`, { method: "PUT", body: JSON.stringify(patch) }),
  assignPhoto: (photoId, wallId) => request(`/photos/${photoId}`, { method: "PATCH", body: JSON.stringify({ wallId }) }),
  deletePhoto: (photoId) => request(`/photos/${photoId}`, { method: "DELETE" }),
  satelliteUrl: (leadId, version) => `${BASE}/lead/${leadId}/satellite.jpg?v=${encodeURIComponent(version || "")}`,
  // multipart — must not set a JSON content-type, the browser sets the
  // boundary itself
  async uploadPhoto(leadId, { blob, clientId, sensors, wallId }) {
    const fd = new FormData();
    fd.append("clientId", clientId);
    fd.append("sensors", JSON.stringify(sensors || {}));
    if (wallId) fd.append("wallId", wallId);
    fd.append("photo", blob, `${clientId}.jpg`);
    const res = await fetch(`${BASE}/lead/${leadId}/photos`, { method: "POST", credentials: "include", body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Upload failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
};
