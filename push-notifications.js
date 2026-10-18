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

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    promptTitle.textContent = "Message alerts aren't supported here";
    promptDescription.textContent = "This browser or device can't show web push notifications. You can still read new messages whenever Love Login is open.";
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
    throw new Error(result.error || `Push service returned HTTP ${response.status}.`);
  }
  return result;
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
