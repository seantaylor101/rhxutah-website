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

export const api = {
  me: () => request("/auth/me"),
  login: (email, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  viewAsStart: (userId) => request(`/auth/view-as/${userId}`, { method: "POST" }),
  viewAsStop: () => request("/auth/view-as/stop", { method: "POST" }),

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
  assignLead: (id, pmId) => request(`/leads/${id}/assign`, { method: "POST", body: JSON.stringify({ pmId }) }),
  editStartDate: (id, startDate, actualWorkDays) =>
    request(`/leads/${id}/start-date`, {
      method: "PATCH",
      body: JSON.stringify(actualWorkDays !== undefined ? { startDate, actualWorkDays } : { startDate }),
    }),
  updateReport: (id, patch) => request(`/leads/${id}/report`, { method: "PATCH", body: JSON.stringify(patch) }),
  getScopeOfWork: (id) => request(`/leads/${id}`).then((l) => l.scopeOfWork),
  replaceScopeOfWork: (id, items) => request(`/leads/${id}/scope-of-work`, { method: "PUT", body: JSON.stringify({ items }) }),
  toggleScopeOfWorkItem: (id, itemId, done) =>
    request(`/leads/${id}/scope-of-work`, { method: "PATCH", body: JSON.stringify({ itemId, done }) }),
  logFollowup: (id) => request(`/leads/${id}/followups`, { method: "POST" }),
  removeFollowup: (id, followupId) => request(`/leads/${id}/followups/${followupId}`, { method: "DELETE" }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),

  getSettings: () => request("/settings"),
  updateSettings: (patch) => request("/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  getMyGoal: () => request("/goals/me"),
  updateMyGoal: (patch) => request("/goals/me", { method: "PATCH", body: JSON.stringify(patch) }),
  listGoals: () => request("/goals"),

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
  uploadWarrantyPhotos: (id, files, type) => {
    const form = new FormData();
    if (type) form.append("type", type);
    for (const file of files) form.append("photos", file);
    return requestForm(`/warranty/${id}/photos`, form);
  },
  deleteWarrantyPhoto: (id, photoId) => request(`/warranty/${id}/photos/${photoId}`, { method: "DELETE" }),

  listActivityFeed: () => request("/activity/feed"),
  listContacts: () => request("/contacts"),
  deleteContact: (id) => request(`/contacts/${id}`, { method: "DELETE" }),

  // Tenant-admin-only account settings: manage PM/tenant_admin users.
  listUsers: () => request("/users"),
  addUser: (payload) => request("/users", { method: "POST", body: JSON.stringify(payload) }),
  disableUser: (id) => request(`/users/${id}/disable`, { method: "POST" }),
  enableUser: (id) => request(`/users/${id}/enable`, { method: "POST" }),
  resetUserPassword: (id, password) => request(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),

  // Platform-admin-only tenant onboarding/management.
  listTenants: () => request("/platform/tenants"),
  createTenant: (payload) => request("/platform/tenants", { method: "POST", body: JSON.stringify(payload) }),
  suspendTenant: (id) => request(`/platform/tenants/${id}/suspend`, { method: "POST" }),
  reactivateTenant: (id) => request(`/platform/tenants/${id}/reactivate`, { method: "POST" }),
};
