const installDismissedKey = "love-login-install-dismissed";
let deferredInstallPrompt = null;

export function isAppleMobileDevice() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandaloneApp() {
  return navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}

function showInstallCard({ title, message, actionLabel, onAction }) {
  if (sessionStorage.getItem(installDismissedKey) ||
      document.querySelector('[aria-label="Install Love Login"]')) return;

  const card = document.createElement("aside");
  card.setAttribute("aria-label", "Install Love Login");
  card.className = "fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md rounded-2xl border border-pink-400/30 bg-slate-900 p-4 text-white shadow-2xl";

  const heading = document.createElement("h2");
  heading.className = "mb-1 text-sm font-semibold";
  heading.textContent = title;

  const description = document.createElement("p");
  description.className = "text-xs leading-relaxed text-slate-300";
  description.textContent = message;

  const actions = document.createElement("div");
  actions.className = "mt-3 flex items-center justify-end gap-3";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "text-xs text-slate-400 hover:text-white";
  dismiss.textContent = "Not now";
  dismiss.addEventListener("click", () => {
    sessionStorage.setItem(installDismissedKey, "true");
    card.remove();
  });

  actions.append(dismiss);
  if (actionLabel && onAction) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "rounded-lg bg-pink-600 px-4 py-2 text-xs font-semibold text-white hover:bg-pink-500";
    action.textContent = actionLabel;
    action.addEventListener("click", onAction);
    actions.append(action);
  }

  card.append(heading, description, actions);
  document.body.append(card);
}

if (!window.LoveLoginAndroid?.enablePushNotifications) {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./firebase-messaging-sw.js")
        .catch((error) => console.error("Could not register the app service worker:", error));
    }, { once: true });
  }

  if (!isStandaloneApp() && isAppleMobileDevice()) {
    showInstallCard({
      title: "Add Love Login to your Home Screen",
      message: "In Safari, tap Share, then Add to Home Screen. Open the new icon to use the app. Push alerts require iOS or iPadOS 16.4 or later."
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (isStandaloneApp() || isAppleMobileDevice()) return;

    showInstallCard({
      title: "Install Love Login",
      message: "Add the app to your Home Screen for a focused, app-like experience.",
      actionLabel: "Install app",
      onAction: async () => {
        if (!deferredInstallPrompt) return;
        await deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        document.querySelector('[aria-label="Install Love Login"]')?.remove();
      }
    });
  });
}
