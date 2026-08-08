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

export const api = {
  me: () => request("/auth/me"),
  login: (passcode) => request("/auth/login", { method: "POST", body: JSON.stringify({ passcode }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  listLeads: () => request("/leads"),
  addLead: (payload) => request("/leads", { method: "POST", body: JSON.stringify(payload) }),
  moveLead: (id, stage) => request(`/leads/${id}/move`, { method: "POST", body: JSON.stringify({ stage }) }),
  editLead: (id, patch) => request(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),
};
