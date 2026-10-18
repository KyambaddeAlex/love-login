importScripts("https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCmSct3OAz6k6YwVpt6TQxqOJPQfxwVJm8",
  authDomain: "love-login-fc11d.firebaseapp.com",
  projectId: "love-login-fc11d",
  storageBucket: "love-login-fc11d.firebasestorage.app",
  messagingSenderId: "962018867320",
  appId: "1:962018867320:web:ecffa5b52e2d8420c1d58d",
  measurementId: "G-LBE9BJBJW6"
});

const messaging = firebase.messaging();

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    await clients.openWindow(targetUrl);
  })());
});
