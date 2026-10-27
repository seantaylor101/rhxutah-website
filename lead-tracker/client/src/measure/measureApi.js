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
  setPhotoSlot: (photoId, slot) => request(`/photos/${photoId}`, { method: "PATCH", body: JSON.stringify({ slot }) }),
  deletePhoto: (photoId) => request(`/photos/${photoId}`, { method: "DELETE" }),
  upperSuggestion: (leadId) => request(`/lead/${leadId}/upper-suggestion`),
  refreshRoof: (leadId) => request(`/lead/${leadId}/roof`, { method: "POST" }),
  detectLevels: (leadId, reset = false) => request(`/lead/${leadId}/levels`, { method: "POST", body: JSON.stringify({ reset }) }),
  startReport: (leadId) => request(`/lead/${leadId}/report`, { method: "POST" }),
  getReport: (leadId) => request(`/lead/${leadId}/report`),
  async exportZip(leadId) {
    const res = await fetch(`${BASE}/lead/${leadId}/export.zip`, { credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = new Error((data && data.error) || `Export failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "measure.zip";
    return new File([await res.blob()], name, { type: "application/zip" });
  },
  satelliteUrl: (leadId, version) => `${BASE}/lead/${leadId}/satellite.jpg?v=${encodeURIComponent(version || "")}`,
  // multipart — must not set a JSON content-type, the browser sets the
  // boundary itself
  async uploadPhoto(leadId, { blob, clientId, sensors, wallId, slot }) {
    const fd = new FormData();
    fd.append("clientId", clientId);
    fd.append("sensors", JSON.stringify(sensors || {}));
    if (wallId) fd.append("wallId", wallId);
    if (slot) fd.append("slot", slot);
    fd.append("photo", blob, `${clientId}.jpg`);
    const res = await fetch(`${BASE}/lead/${leadId}/photos`, { method: "POST", credentials: "include", body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Upload failed (${res.status})`);
      err.status = res.status;
      err.duplicate = !!(data && data.duplicate);
      throw err;
    }
    return data;
  },
};
