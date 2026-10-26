import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measureApi } from "./measureApi.js";
import { offlineStore } from "./offlineStore.js";
import { onQueueChange, kickUploads } from "./uploader.js";
import { buildHouseModel, assignShots, wallCoverage, slotByKey, wallForSlot } from "../../../shared/houseGeometry.js";

// Server state for one lead's measuring project, with an offline fallback:
// the last good payload is cached on the phone, and photos still waiting in
// the upload queue are merged in (auto-assigned locally with the same code
// the server uses) so the coverage map stays honest with no signal.
export function useMeasureData(leadId) {
  const [payload, setPayload] = useState(null);
  const [queued, setQueued] = useState([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [duplicates, setDuplicates] = useState(0); // copies turned away this visit
  const mounted = useRef(true);

  const accept = useCallback(
    (p) => {
      if (!mounted.current || !p) return;
      setPayload(p);
      offlineStore.putProject(leadId, p).catch(() => {});
    },
    [leadId],
  );

  const refreshQueued = useCallback(async () => {
    try {
      const items = await offlineStore.queuedForLead(leadId);
      if (mounted.current) setQueued(items.sort((a, b) => a.createdAt - b.createdAt));
    } catch {
      // IndexedDB unavailable (private mode) — nothing queued to show
    }
  }, [leadId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      accept(await measureApi.get(leadId));
      setOffline(false);
      setError(null);
    } catch (err) {
      const cached = await offlineStore.getProject(leadId).catch(() => null);
      if (cached && mounted.current) setPayload(cached);
      if (!err.status) setOffline(true);
      else setError(err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [leadId, accept]);

  useEffect(() => {
    mounted.current = true;
    reload();
    refreshQueued();
    kickUploads();
    const off = onQueueChange((e) => {
      if (e.leadId && e.leadId !== leadId) return;
      if (e.type === "uploaded" && e.payload) {
        accept(e.payload);
        setOffline(false);
      }
      if (e.type === "error" && e.retryable) setOffline(true);
      if (e.type === "duplicate") setDuplicates((n) => n + 1);
      refreshQueued();
    });
    // the browser's own online/offline flag — the upload queue doesn't even
    // try while it says offline, so no failed request would tell us
    const goOffline = () => setOffline(true);
    const goOnline = () => reload();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (navigator.onLine === false) setOffline(true);
    return () => {
      mounted.current = false;
      off();
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [leadId, reload, refreshQueued, accept]);

  // run the server's own geometry locally for display + offline photos
  const model = useMemo(() => (payload?.project ? buildHouseModel(payload.project) : null), [payload]);

  const derived = useMemo(() => {
    const serverPhotos = payload?.photos || [];
    const serverIds = new Set(serverPhotos.map((p) => p.clientId));
    const pending = queued.filter((q) => !serverIds.has(q.clientId));
    // locally assign queued photos (server re-does this on upload)
    let local = {};
    if (model && pending.length) {
      const shots = [
        ...serverPhotos.map((p) => ({
          key: p.clientId,
          sensors: p.sensors,
          manualWallId: p.wallId && (p.assignMethod === "manual" || !p.needsReview) ? p.wallId : null,
        })),
        ...pending.map((q) => ({ key: q.clientId, sensors: q.sensors, manualWallId: q.wallId || null })),
      ];
      local = assignShots(model, shots);
    }
    const all = [
      ...serverPhotos.map((p) => ({ ...p, key: p.clientId, pending: false })),
      ...pending.map((q) => {
        const a = local[q.clientId] || {};
        const guided = !!slotByKey(q.slot);
        const slotWall = guided && !q.wallId && model ? wallForSlot(model, q.slot, a.wallId) : null;
        return {
          key: q.clientId,
          clientId: q.clientId,
          pending: true,
          failed: q.status === "failed",
          lastError: q.lastError,
          blob: q.blob,
          sensors: q.sensors,
          slot: q.slot || null,
          wallId: q.wallId || slotWall || a.wallId || null,
          assignMethod: q.wallId ? "manual" : guided ? "slot" : "auto",
          assignConfidence: q.wallId || guided ? 1 : a.confidence ?? null,
          needsReview: !q.wallId && !guided && (a.needsReview ?? true),
          capturedAt: q.sensors?.capturedAt,
        };
      }),
    ];
    const assignments = Object.fromEntries(all.map((p) => [p.key, { wallId: p.wallId }]));
    const coverage = model ? wallCoverage(model, all, assignments) : {};
    return { photos: all, coverage };
  }, [payload, queued, model]);

  return {
    payload,
    project: payload?.project || null,
    googleConfigured: !!payload?.googleConfigured,
    model,
    photos: derived.photos,
    coverage: derived.coverage,
    queuedCount: queued.length,
    duplicates,
    offline,
    error,
    loading,
    reload,
    accept,
    refreshQueued,
    setError,
  };
}
