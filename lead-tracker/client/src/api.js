const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// separate from request() because it must NOT set a JSON content-type —
// the browser needs to set its own multipart/form-data boundary
async function requestForm(path, formData) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", body: formData });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// same job as requestForm, but via XMLHttpRequest instead of fetch() — fetch
// has no upload-progress event, so a multi-hundred-MB video would just show
// "Uploading…" with no sense of how far along it is. onProgress gets called
// with { loaded, total } as the browser reports bytes sent.
function requestFormWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    xhr.withCredentials = true;
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress({ loaded: e.loaded, total: e.total });
      };
    }
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON response falls through to the status check below
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error((data && data.error) || `Request failed (${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("Network error — check your connection and try again"));
    xhr.send(formData);
  });
}

export const api = {
  me: () => request("/auth/me"),
  login: (passcode) => request("/auth/login", { method: "POST", body: JSON.stringify({ passcode }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  listLeads: () => request("/leads"),
  addLead: (payload) => request("/leads", { method: "POST", body: JSON.stringify(payload) }),
  moveLead: (id, stage, date, revert, workDays) =>
    request(`/leads/${id}/move`, {
      method: "POST",
      body: JSON.stringify({
        stage,
        ...(date ? { date } : {}),
        ...(revert ? { revert: true } : {}),
        ...(workDays != null ? { workDays } : {}),
      }),
    }),
  editLead: (id, patch) => request(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  editStartDate: (id, startDate, actualWorkDays) =>
    request(`/leads/${id}/start-date`, {
      method: "PATCH",
      body: JSON.stringify(actualWorkDays !== undefined ? { startDate, actualWorkDays } : { startDate }),
    }),
  updateJobDetails: (id, patch) =>
    request(`/leads/${id}/job-details`, { method: "PATCH", body: JSON.stringify(patch) }),
  updateReport: (id, patch) => request(`/leads/${id}/report`, { method: "PATCH", body: JSON.stringify(patch) }),
  logFollowup: (id) => request(`/leads/${id}/followups`, { method: "POST" }),
  removeFollowup: (id, followupId) => request(`/leads/${id}/followups/${followupId}`, { method: "DELETE" }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),
  getSettings: () => request("/settings"),
  updateSettings: (patch) => request("/settings", { method: "PATCH", body: JSON.stringify(patch) }),
  listBackups: () => request("/backups"),
  restoreBackup: (filename) => request(`/backups/${encodeURIComponent(filename)}/restore`, { method: "POST" }),
  vapidPublicKey: () => request("/push/vapid-public-key"),
  pushSubscribe: (subscription) => request("/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
  pushUnsubscribe: (endpoint) => request("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  listNotifications: () => request("/notifications"),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "POST" }),
  listWarrantyRequests: () => request("/warranty"),
  addWarrantyRequest: (payload) => request("/warranty", { method: "POST", body: JSON.stringify(payload) }),
  moveWarrantyRequest: (id, stage, revert, date) =>
    request(`/warranty/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ stage, ...(revert ? { revert: true } : {}), ...(date ? { date } : {}) }),
    }),
  editWarrantyRequest: (id, patch) => request(`/warranty/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteWarrantyRequest: (id) => request(`/warranty/${id}`, { method: "DELETE" }),
  uploadWarrantyPhotos: (id, files, type, onProgress) => {
    const form = new FormData();
    if (type) form.append("type", type);
    for (const file of files) form.append("photos", file);
    return requestFormWithProgress(`/warranty/${id}/photos`, form, onProgress);
  },
  deleteWarrantyPhoto: (id, photoId) => request(`/warranty/${id}/photos/${photoId}`, { method: "DELETE" }),
  addPayee: (id, payee) => request(`/leads/${id}/payees`, { method: "POST", body: JSON.stringify(payee) }),
  editPayee: (id, payeeId, payee) =>
    request(`/leads/${id}/payees/${payeeId}`, { method: "PATCH", body: JSON.stringify(payee) }),
  removePayee: (id, payeeId) => request(`/leads/${id}/payees/${payeeId}`, { method: "DELETE" }),
  recordPayment: (id, payeeId, payment) =>
    request(`/leads/${id}/payees/${payeeId}/payments`, { method: "POST", body: JSON.stringify(payment) }),
  removePayment: (id, payeeId, paymentId) =>
    request(`/leads/${id}/payees/${payeeId}/payments/${paymentId}`, { method: "DELETE" }),
  createLeadShare: (id) => request(`/leads/${id}/share`, { method: "POST" }),
  revokeLeadShare: (id) => request(`/leads/${id}/share`, { method: "DELETE" }),
  getShare: (token) => request(`/share/${token}`),
  uploadLeadMedia: (id, files, onProgress) => {
    const form = new FormData();
    for (const file of files) form.append("media", file);
    return requestFormWithProgress(`/leads/${id}/media`, form, onProgress);
  },
  deleteLeadMedia: (id, mediaId) => request(`/leads/${id}/media/${mediaId}`, { method: "DELETE" }),
  listActivityFeed: () => request("/activity/feed"),
  listContacts: () => request("/contacts"),
  deleteContact: (id) => request(`/contacts/${id}`, { method: "DELETE" }),
};
