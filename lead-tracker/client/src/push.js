import { api } from "./api.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function getPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error("Push notifications aren't supported in this browser.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was denied.");
  }
  const { key } = await api.vapidPublicKey();
  if (!key) throw new Error("Push isn't set up on the server yet.");

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await api.pushSubscribe(subscription.toJSON());
  return subscription;
}

// re-registers an already-existing browser subscription with the server on
// every app open, so the role stamped on it (owner vs viewer — see
// pushService.js) never goes stale. Without this, a subscription created
// before role-tracking existed, or from a device that once signed in under
// a different role, would silently keep missing every role-targeted push
// (e.g. "lead won" for the viewer) forever, with no way to notice or fix it
// short of manually toggling notifications off and back on.
export async function syncPushSubscriptionRole() {
  if (!pushSupported()) return;
  try {
    const sub = await getPushSubscription();
    if (sub) await api.pushSubscribe(sub.toJSON());
  } catch {
    // best-effort — a failed sync just means the role stays whatever it
    // was; nothing to surface to the user over this
  }
}

export async function disablePush() {
  const sub = await getPushSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint);
    await sub.unsubscribe();
  }
}
