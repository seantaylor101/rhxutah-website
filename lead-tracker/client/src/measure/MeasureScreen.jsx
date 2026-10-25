import { useEffect, useMemo, useRef, useState } from "react";
import { C, FONT_BODY, FONT_DISPLAY, btnPrimary, btnSecondary, btnDanger, sectionLabel, fmtFeetInches, coverageColor } from "./theme.js";
import { useMeasureData } from "./useMeasureData.js";
import { measureApi } from "./measureApi.js";
import { offlineStore } from "./offlineStore.js";
import { retryFailed, discardQueued, kickUploads, enqueuePhoto } from "./uploader.js";
import WallMap from "./WallMap.jsx";
import CaptureScreen from "./CaptureScreen.jsx";

function useObjectUrl(blob) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  return url;
}

function Thumb({ photo, size = 64, onClick }) {
  const blobUrl = useObjectUrl(photo.pending ? photo.blob : null);
  const src = photo.pending ? blobUrl : photo.url;
  const badge = photo.failed ? "!" : photo.pending ? "⇡" : photo.assignMethod === "manual" ? "✓" : photo.needsReview ? "?" : null;
  return (
    <button onClick={onClick} style={{ position: "relative", width: size, height: size, padding: 0, border: "none", borderRadius: 8, overflow: "hidden", background: C.surfaceMuted, cursor: "pointer", flex: "0 0 auto" }}>
      {src && <img src={src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            fontSize: 11,
            fontWeight: 700,
            lineHeight: "18px",
            textAlign: "center",
            color: "#fff",
            background: photo.failed ? C.rust : photo.pending ? "rgba(0,0,0,0.6)" : photo.needsReview && photo.assignMethod !== "manual" ? C.amber : C.accent,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function PhotoSheet({ photo, model, canDelete, onAssign, onDelete, onRetry, onClose }) {
  const blobUrl = useObjectUrl(photo.pending ? photo.blob : null);
  const src = photo.pending ? blobUrl : photo.url;
  const s = photo.sensors || {};
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", padding: 16 }} onClick={(e) => e.stopPropagation()}>
        {src && <img src={src} alt="" style={{ width: "100%", maxHeight: "50vh", objectFit: "contain", background: "#000", borderRadius: 8 }} />}
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.muted, margin: "8px 0 12px" }}>
          {photo.failed
            ? `Upload refused: ${photo.lastError || "unknown error"}`
            : photo.pending
              ? "Saved on this phone, waiting to upload."
              : photo.assignMethod === "manual"
                ? "Wall picked by hand."
                : photo.wallId
                  ? `Auto-matched from location + compass (${Math.round((photo.assignConfidence || 0) * 100)}% sure).`
                  : "Couldn't tell which wall this is."}
          {Number.isFinite(s.gpsAccuracy) && ` GPS ±${Math.round(s.gpsAccuracy * 3.28)} ft.`}
          {s.lens && ` ${s.lens}.`}
        </div>
        {model && (
          <>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>Which wall is this?</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {model.walls.map((w) => {
                const on = photo.wallId === w.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => onAssign(w.id)}
                    style={{ ...btnSecondary, padding: "7px 10px", background: on ? C.accent : C.surfaceMuted, color: on ? "#fff" : C.ink }}
                  >
                    {w.id} · {w.label}
                  </button>
                );
              })}
              {photo.assignMethod === "manual" && (
                <button onClick={() => onAssign(null)} style={{ ...btnSecondary, padding: "7px 10px" }}>
                  Back to auto
                </button>
              )}
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {photo.failed && (
            <button style={btnSecondary} onClick={onRetry}>
              Retry upload
            </button>
          )}
          {(photo.pending || canDelete) && (
            <button style={btnDanger} onClick={onDelete}>
              {photo.pending ? "Discard" : "Delete photo"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={btnPrimary} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Full-screen house measuring for one lead: find the house from the
// address, check/adjust the outline, shoot photos, and see which walls are
// covered. Measuring itself (wall heights, openings) is the next step.
export default function MeasureScreen({ lead, editable, onClose }) {
  const data = useMeasureData(lead.id);
  const { project, model, photos, coverage, googleConfigured } = data;
  const [address, setAddress] = useState(lead.address || "");
  const [busy, setBusy] = useState(null); // "lookup" | "save" | null
  const [capturing, setCapturing] = useState(false);
  const [pickingFront, setPickingFront] = useState(false);
  const [selectedWallId, setSelectedWallId] = useState(null);
  const [openPhotoKey, setOpenPhotoKey] = useState(null);
  const [actionError, setActionError] = useState(null);
  const fileInputRef = useRef(null);
  const uploadWallRef = useRef(null); // wall the next picked photos are pinned to, if any
  const [adding, setAdding] = useState(0);

  // photos already on the phone (taken with the regular camera, or someone
  // else's): queued exactly like in-app shots, so they survive a dead zone
  // too. No live sensor readings — the server fills location/heading from
  // the photo's own EXIF when the camera recorded it; otherwise they land in
  // "Check these" unless added to a specific wall.
  const pickPhotos = (wallId) => {
    uploadWallRef.current = wallId || null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };
  const onPickedFiles = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setAdding(files.length);
    setActionError(null);
    try {
      for (const file of files) {
        // copy into memory — a File handed over by the iOS photo picker can
        // stop being readable later, and this one has to sit in the queue
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || "image/jpeg" });
        await enqueuePhoto({
          clientId: window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
          leadId: lead.id,
          blob,
          sensors: { source: "library" },
          wallId: uploadWallRef.current,
        });
      }
      await data.refreshQueued();
    } catch (err) {
      setActionError(err.message || "Couldn't add those photos");
    } finally {
      setAdding(0);
    }
  };

  const run = async (kind, fn) => {
    setBusy(kind);
    setActionError(null);
    try {
      data.accept(await fn());
    } catch (err) {
      setActionError(!err.status ? "No signal. Try that again once you're back online." : err.message);
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const lookup = () => run("lookup", () => measureApi.lookup(lead.id, address)).catch(() => {});
  const saveOutline = (patch) => run("save", () => measureApi.saveOutline(lead.id, patch));

  const openPhoto = photos.find((p) => p.key === openPhotoKey) || null;
  const review = photos.filter((p) => !p.pending && p.needsReview && p.assignMethod !== "manual");
  const failed = photos.filter((p) => p.failed);
  const unassignedPending = photos.filter((p) => p.pending && !p.wallId);

  const assign = async (photo, wallId) => {
    if (photo.pending) {
      const item = await offlineStore.getQueued(photo.clientId);
      if (item) await offlineStore.putQueued({ ...item, wallId });
      await data.refreshQueued();
      return;
    }
    await run("save", () => measureApi.assignPhoto(photo.id, wallId)).catch(() => {});
  };

  const removePhoto = async (photo) => {
    if (photo.pending) {
      await discardQueued(photo.clientId);
      await data.refreshQueued();
    } else {
      await run("save", () => measureApi.deletePhoto(photo.id)).catch(() => {});
    }
    setOpenPhotoKey(null);
  };

  const frontWall = model?.walls.find((w) => w.side === "front");
  const lookedUp = !!project?.roofOutline;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: C.bg, overflowY: "auto", fontFamily: FONT_BODY, color: C.ink }}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18 }}>Measure house</div>
          <div style={{ fontSize: 12.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {lead.name}
            {project?.address ? ` · ${project.address}` : ""}
          </div>
        </div>
        <button style={btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "14px 16px 40px" }}>
        {data.offline && (
          <div style={{ ...note, background: "#FFF6E0", borderColor: "#F0DCA8" }}>
            No signal. Showing the last saved map. Photos you take are kept on this phone and upload when you're back online.
          </div>
        )}
        {(actionError || data.error) && <div style={{ ...note, background: "#FBEAE8", borderColor: "#F2C9C4", color: C.rust }}>{actionError || data.error}</div>}

        {/* 1. find the house */}
        {data.loading && !data.payload ? (
          <div style={{ color: C.muted, fontSize: 14, padding: "20px 0" }}>Loading…</div>
        ) : !lookedUp ? (
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 8 }}>Find the house</div>
            {googleConfigured ? (
              <>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address, city"
                  style={input}
                />
                <button style={{ ...btnPrimary, marginTop: 10, width: "100%" }} disabled={!address.trim() || busy === "lookup"} onClick={lookup}>
                  {busy === "lookup" ? "Looking up…" : "Find house from satellite"}
                </button>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
                  Pulls the roof outline, roof pitch and front door side from Google. You can adjust it after.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
                The satellite lookup needs a Google Maps key (<code>GOOGLE_MAPS_API_KEY</code> in Render) with the Geocoding, Solar, and Maps
                Static APIs turned on. You can still shoot photos now; they'll be sorted onto walls once the map is set up.
              </div>
            )}
          </div>
        ) : (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={sectionLabel}>Wall map</div>
              {googleConfigured && (
                <button
                  style={linkBtn}
                  disabled={busy === "lookup"}
                  onClick={() => {
                    if (window.confirm("Look the house up again? This replaces the outline, including any adjustments.")) lookup();
                  }}
                >
                  {busy === "lookup" ? "Looking up…" : "Look up again"}
                </button>
              )}
            </div>
            {project.source === "placeholder" && (
              <div style={{ ...note, background: "#FFF6E0", borderColor: "#F0DCA8" }}>
                Google has no building outline for this address. Tap <b>Adjust outline</b> and drag the box's corners onto the roof.
              </div>
            )}
            <WallMap
              leadId={lead.id}
              project={project}
              model={model}
              coverage={coverage}
              editable={!data.offline}
              onSaveOutline={saveOutline}
              pickingFront={pickingFront}
              onPickFront={(w) => {
                setPickingFront(false);
                saveOutline({ frontAz: w.normalAz }).catch(() => {});
              }}
              selectedWallId={selectedWallId}
              onSelectWall={setSelectedWallId}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13 }}>Overhang</span>
                <button style={stepBtn} disabled={busy || data.offline} onClick={() => saveOutline({ overhangIn: Math.max(0, (model?.overhangIn ?? 16) - 2) }).catch(() => {})}>
                  −
                </button>
                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 32, textAlign: "center" }}>{Math.round(model?.overhangIn ?? 16)}"</span>
                <button style={stepBtn} disabled={busy || data.offline} onClick={() => saveOutline({ overhangIn: Math.min(48, (model?.overhangIn ?? 16) + 2) }).catch(() => {})}>
                  +
                </button>
              </div>
              <button style={{ ...btnSecondary, padding: "7px 10px", background: pickingFront ? C.roofLine : C.surfaceMuted }} disabled={data.offline} onClick={() => setPickingFront((v) => !v)}>
                {frontWall ? `Front: ${frontWall.id}` : "Set front of house"}
              </button>
              {model?.pitch12 != null && <span style={{ fontSize: 13, color: C.muted }}>Roof ≈ {model.pitch12}/12 (Google)</span>}
            </div>
            {model && (
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
                Footprint {Math.round(model.footprintAreaFt2)} ft² · perimeter {fmtFeetInches(model.perimeterFt * 12)}
              </div>
            )}
          </div>
        )}

        {/* 2. shoot */}
        <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
          <button style={{ ...btnPrimary, flex: 2, padding: "14px 12px", fontSize: 16 }} onClick={() => setCapturing(true)}>
            📷 Shoot photos
          </button>
          <button style={{ ...btnSecondary, flex: 1, padding: "14px 10px", fontSize: 14.5 }} disabled={!!adding} onClick={() => pickPhotos(null)}>
            {adding ? `Adding ${adding}…` : "⬆︎ Upload"}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPickedFiles} />

        {failed.length > 0 && (
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 6, color: C.rust }}>Didn't upload ({failed.length})</div>
            <div style={thumbRow}>
              {failed.map((p) => (
                <Thumb key={p.key} photo={p} onClick={() => setOpenPhotoKey(p.key)} />
              ))}
            </div>
          </div>
        )}

        {review.length + unassignedPending.length > 0 && model && (
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 4 }}>Check these ({review.length + unassignedPending.length})</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>Couldn't be sure which wall these show. Tap one to pick the wall.</div>
            <div style={thumbRow}>
              {[...review, ...unassignedPending].map((p) => (
                <Thumb key={p.key} photo={p} onClick={() => setOpenPhotoKey(p.key)} />
              ))}
            </div>
          </div>
        )}

        {/* 3. walls + coverage */}
        {model && (
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 8 }}>Walls</div>
            {model.walls.map((w) => {
              const cov = coverage[w.id] || { photos: 0, fraction: 0 };
              const wallPhotos = photos.filter((p) => p.wallId === w.id);
              const open = selectedWallId === w.id;
              return (
                <div key={w.id} style={{ borderTop: `1px solid ${C.border}`, padding: "10px 0" }}>
                  <button
                    onClick={() => setSelectedWallId(open ? null : w.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY, color: C.ink }}
                  >
                    <span style={{ width: 12, height: 12, borderRadius: 6, background: coverageColor(cov), flex: "0 0 auto", border: "1px solid rgba(0,0,0,0.15)" }} />
                    <span style={{ fontWeight: 700, minWidth: 34 }}>{w.id}</span>
                    <span style={{ flex: 1 }}>
                      {w.label}
                      {w.roofEdge && <span style={{ color: C.muted, fontSize: 12.5 }}> · {w.roofEdge === "gable" ? "gable end" : "eave side"}</span>}
                    </span>
                    <span style={{ fontWeight: 600 }}>{fmtFeetInches(w.lengthIn)}</span>
                  </button>
                  <div style={{ fontSize: 12, color: C.muted, margin: "3px 0 0 22px" }}>
                    {cov.photos ? `${cov.photos} photo${cov.photos === 1 ? "" : "s"} · ~${Math.round(cov.fraction * 100)}% of its length in view` : "No photos yet"}
                  </div>
                  {open && (
                    <div style={{ ...thumbRow, marginTop: 8, alignItems: "center" }}>
                      {wallPhotos.map((p) => (
                        <Thumb key={p.key} photo={p} onClick={() => setOpenPhotoKey(p.key)} />
                      ))}
                      <button
                        onClick={() => pickPhotos(w.id)}
                        disabled={!!adding}
                        style={{ ...btnSecondary, flex: "0 0 auto", width: 64, height: 64, padding: 4, fontSize: 11.5, flexDirection: "column", gap: 2 }}
                      >
                        <span style={{ fontSize: 18 }}>+</span>
                        Add to {w.id}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              Wall lengths come from the satellite outline minus the overhang. Heights, gables and window/door deductions are measured
              from the photos in the next step.
            </div>
          </div>
        )}

        {!model && photos.length > 0 && (
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom: 8 }}>Photos ({photos.length})</div>
            <div style={thumbRow}>
              {photos.map((p) => (
                <Thumb key={p.key} photo={p} onClick={() => setOpenPhotoKey(p.key)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {openPhoto && (
        <PhotoSheet
          photo={openPhoto}
          model={model}
          canDelete={editable}
          onAssign={(wallId) => assign(openPhoto, wallId)}
          onDelete={() => removePhoto(openPhoto)}
          onRetry={() => retryFailed(openPhoto.clientId).then(() => data.refreshQueued())}
          onClose={() => setOpenPhotoKey(null)}
        />
      )}

      {capturing && (
        <CaptureScreen
          leadId={lead.id}
          model={model}
          coverage={coverage}
          queuedCount={data.queuedCount}
          offline={data.offline}
          onClose={() => {
            setCapturing(false);
            kickUploads();
          }}
        />
      )}
    </div>
  );
}

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 };
const note = { border: "1px solid", borderRadius: 8, padding: "9px 11px", fontSize: 13, marginBottom: 12, lineHeight: 1.45 };
const input = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  fontFamily: FONT_BODY,
  fontSize: 15,
};
const thumbRow = { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 };
const stepBtn = { ...btnSecondary, width: 32, height: 32, padding: 0, fontSize: 18 };
const linkBtn = { background: "none", border: "none", padding: 0, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.accent, cursor: "pointer" };
