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
const APP_CACHE = "love-login-app-v1";
const APP_SHELL = [
  "./index.html",
  "./user-dashboard.html",
  "./love-login.css",
  "./manifest.webmanifest",
  "./icons/love-login.svg",
  "./icons/apple-touch-icon.png",
  "./icons/love-login-192.png",
  "./icons/love-login-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("love-login-app-") && name !== APP_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  const shellUrl = APP_SHELL
    .map((path) => new URL(path, self.registration.scope))
    .find((candidate) => candidate.pathname === url.pathname);
  if (!shellUrl) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(APP_CACHE);
        await cache.put(shellUrl, response.clone());
      }
      return response;
    } catch (error) {
      const cachedResponse = await caches.match(shellUrl);
      if (cachedResponse) return cachedResponse;
      throw error;
    }
  })());
});

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
