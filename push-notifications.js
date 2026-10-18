import { auth, db, PUSH_CONFIG } from "./firebase-config.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js";

export async function enablePushNotifications(userId) {
  if (!PUSH_CONFIG.vapidKey || PUSH_CONFIG.vapidKey.startsWith("SET_")) {
    throw new Error("Add the Firebase Web Push certificate key to firebase-config.js first.");
  }
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    throw new Error("This browser does not support web push notifications.");
  }
  if (!(await isSupported())) {
    throw new Error("This browser does not support Firebase web messaging.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked in browser settings."
      : "Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const messaging = getMessaging();
  const token = await getToken(messaging, {
    vapidKey: PUSH_CONFIG.vapidKey,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error("Firebase did not return a notification token.");

  const tokenHash = await hashToken(token);
  await setDoc(doc(db, "pushTokens", userId, "devices", tokenHash), {
    token,
    updatedAt: serverTimestamp()
  });
}

export async function sendPushNotification(messageId) {
  if (!PUSH_CONFIG.workerUrl || PUSH_CONFIG.workerUrl.startsWith("SET_")) {
    throw new Error("Deploy the Cloudflare Worker and add its URL to firebase-config.js first.");
  }
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to send a push notification.");

  const response = await fetch(PUSH_CONFIG.workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ messageId })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Push service returned HTTP ${response.status}.`);
  }
  return result;
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
