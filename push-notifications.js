import { auth, db, PUSH_CONFIG } from "./firebase-config.js";
import { isAppleMobileDevice, isStandaloneApp } from "./pwa-install.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js";

const nativePushRequests = new Map();

window.__loveLoginPushResult = (requestId, result) => {
  const request = nativePushRequests.get(requestId);
  if (!request) return;
  clearTimeout(request.timeout);
  nativePushRequests.delete(requestId);
  if (result?.success) request.resolve();
  else request.reject(new Error(result?.message || "Could not enable Android notifications."));
};

export async function enablePushNotifications(userId) {
  if (window.LoveLoginAndroid?.enablePushNotifications) {
    const user = auth.currentUser;
    if (!user || user.uid !== userId) throw new Error("Sign in again to enable notifications.");
    const idToken = await user.getIdToken();
    const requestId = `push-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        nativePushRequests.delete(requestId);
        reject(new Error("Timed out while enabling Android notifications."));
      }, 60000);
      nativePushRequests.set(requestId, { resolve, reject, timeout });
      try {
        window.LoveLoginAndroid.enablePushNotifications(userId, idToken, requestId);
      } catch (error) {
        clearTimeout(timeout);
        nativePushRequests.delete(requestId);
        reject(error);
      }
    });
    return;
  }

  if (isAppleMobileDevice() && !isStandaloneApp()) {
    throw new Error("On iPhone or iPad, first use Safari's Share menu to add Love Login to your Home Screen. Open it from that icon, then enable alerts.");
  }

  if (!PUSH_CONFIG.vapidKey || PUSH_CONFIG.vapidKey.startsWith("SET_")) {
    throw new Error("Add the Firebase Web Push certificate key to firebase-config.js first.");
  }
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    if (isAppleMobileDevice()) {
      throw new Error("Web push notifications on iPhone and iPad require iOS or iPadOS 16.4 or later. Update your device and open Love Login from its Home Screen icon.");
    }
    throw new Error("This browser does not support web push notifications.");
  }
  if (!(await isSupported())) {
    if (isAppleMobileDevice()) {
      throw new Error("Web push notifications on iPhone and iPad require iOS or iPadOS 16.4 or later. Update your device and open Love Login from its Home Screen icon.");
    }
    throw new Error("This browser does not support Firebase web messaging.");
  }

  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
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

export function initializePushPrompt(userId, { enableButton, statusElement }) {
  const prompt = document.getElementById("notification-prompt");
  const promptTitle = document.getElementById("notification-prompt-title");
  const promptDescription = document.getElementById("notification-prompt-description");
  const promptEnableButton = document.getElementById("notification-prompt-enable");
  const promptDismissButton = document.getElementById("notification-prompt-dismiss");

  const closePrompt = () => prompt.classList.add("hidden");
  const showPrompt = () => prompt.classList.remove("hidden");
  closePrompt();

  if (window.LoveLoginAndroid?.enablePushNotifications) {
    promptTitle.textContent = "Stay close, even when the app is closed";
    promptDescription.textContent = "Enable Android notifications to see new messages above your other apps.";
    promptEnableButton.classList.remove("hidden");
    promptEnableButton.textContent = "Enable Android alerts";
    showPrompt();
  }

  const requestEnablement = async () => {
    enableButton.disabled = true;
    promptEnableButton.disabled = true;
    statusElement.textContent = "Enabling message alerts...";
    statusElement.className = "text-xs text-slate-500";

    try {
      await enablePushNotifications(userId);
      statusElement.textContent = "Message alerts enabled on this device.";
      statusElement.className = "text-xs text-green-400";
      closePrompt();
    } catch (error) {
      console.error("Could not enable message alerts:", error);
      statusElement.textContent = error.message;
      statusElement.className = "text-xs text-red-400";

      if ("Notification" in window && Notification.permission === "denied") {
        promptTitle.textContent = "Allow alerts in your browser";
        promptDescription.textContent = "Notifications are currently blocked for this site. Open your browser's site settings, change Notifications to Allow, then reload Love Login.";
        promptEnableButton.classList.add("hidden");
        showPrompt();
      } else if ("Notification" in window && Notification.permission === "granted") {
        promptTitle.textContent = "Finish enabling message alerts";
        promptDescription.textContent = `Your browser allows notifications, but setup could not be completed: ${error.message}`;
        promptEnableButton.textContent = "Retry setup";
        promptEnableButton.classList.remove("hidden");
        showPrompt();
      }
    } finally {
      enableButton.disabled = false;
      promptEnableButton.disabled = false;
    }
  };

  enableButton.onclick = requestEnablement;
  promptEnableButton.onclick = requestEnablement;
  promptDismissButton.onclick = closePrompt;
  prompt.onclick = (event) => {
    if (event.target === prompt) closePrompt();
  };

  if (window.LoveLoginAndroid?.enablePushNotifications) return;

  if (isAppleMobileDevice() && !isStandaloneApp()) {
    promptTitle.textContent = "Add Love Login to your Home Screen";
    promptDescription.textContent = "On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. Open the new icon to use the app; alerts require iOS or iPadOS 16.4 or later.";
    promptEnableButton.classList.add("hidden");
    showPrompt();
    return;
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    promptTitle.textContent = isAppleMobileDevice()
      ? "Update iPhone or iPad to enable alerts"
      : "Message alerts aren't supported here";
    promptDescription.textContent = isAppleMobileDevice()
      ? "Web push notifications require iOS or iPadOS 16.4 or later. Update your device, then reopen Love Login from its Home Screen icon."
      : "This browser or device can't show web push notifications. You can still read new messages whenever Love Login is open.";
    promptEnableButton.classList.add("hidden");
    showPrompt();
    return;
  }

  promptEnableButton.classList.remove("hidden");
  promptEnableButton.textContent = "Enable alerts";
  if (Notification.permission === "granted") {
    void requestEnablement();
    return;
  }
  if (isAppleMobileDevice() && !("PushManager" in window)) {
    promptTitle.textContent = "Update iPhone or iPad to enable alerts";
    promptDescription.textContent = "Web push notifications require iOS or iPadOS 16.4 or later. Update your device, then reopen Love Login from its Home Screen icon.";
    promptEnableButton.classList.add("hidden");
    showPrompt();
    return;
  }

  if (Notification.permission === "denied") {
    promptTitle.textContent = "Allow alerts in your browser";
    promptDescription.textContent = "Notifications are currently blocked for this site. Open your browser's site settings, change Notifications to Allow, then reload Love Login.";
    promptEnableButton.classList.add("hidden");
  } else {
    promptTitle.textContent = "Stay in the loop";
    promptDescription.textContent = "Get a notification when a new message arrives in your conversation. Choose Enable alerts to allow notifications on this device.";
  }
  showPrompt();
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
    const reasons = Array.isArray(result.reasons) ? result.reasons.join("; ") : "";
    const message = result.error || `Push service returned HTTP ${response.status}.`;
    throw new Error(reasons ? `${message} ${reasons}` : message);
  }
  return result;
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
