// iOS has no Contact Picker API, so there's no way to open a "pick a
// contact" dialog from inside the app the way Android's does. Instead, the
// app registers as a Web Share Target (see manifest.webmanifest): sharing a
// contact card from the iOS Contacts app straight to this installed PWA
// POSTs the vCard to /share-target, which sw.js intercepts and stashes in
// Cache Storage before redirecting back into the app. This module reads
// that stashed vCard back out and parses it.
const CACHE_NAME = "shared-contact";
const CACHE_KEY = "/shared-contact-data";

export function wasSharedContactLaunch() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sharedContact") === "1";
}

export function clearSharedContactParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("sharedContact");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

// vCard lines can be "folded" (continued on the next line with a leading
// space/tab) — unfold before splitting so a wrapped value doesn't get cut
// off mid-field
function unfoldVCard(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

export function parseVCard(text) {
  const result = { name: "", phone: "", email: "" };
  if (!text) return result;
  const lines = unfoldVCard(text).split("\n");
  let structuredName = "";
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(";")[0].trim().toUpperCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "FN") {
      result.name = value;
    } else if (key === "N" && !structuredName) {
      // N is "Family;Given;Middle;Prefix;Suffix" — build a normal display order
      const parts = value.split(";");
      structuredName = [parts[1], parts[2], parts[0]].filter(Boolean).join(" ").trim();
    } else if (key === "TEL" && !result.phone) {
      result.phone = value;
    } else if (key === "EMAIL" && !result.email) {
      result.email = value;
    }
  }
  if (!result.name) result.name = structuredName;
  return result;
}

// reads the vCard sw.js stashed for this launch, parses it, and clears the
// cache entry so a later reload of the same URL doesn't reapply it
export async function readSharedContact() {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(CACHE_KEY);
    if (!res) return null;
    const text = await res.text();
    await cache.delete(CACHE_KEY);
    const parsed = parseVCard(text);
    if (!parsed.name && !parsed.phone && !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}
