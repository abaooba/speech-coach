/* sw.js: the service worker that keeps the app shell on the device, so Speech Coach opens with
   no network. Pages and shell files come from the network first and the cache when offline;
   any other file is served from the cache once loaded. Requests under /api/ are never touched:
   every analysis goes to the server, and no recording or result is ever cached here. */
"use strict";

// Bump the version whenever SHELL changes; activate then deletes the old cache.
const CACHE_NAME = "speech-coach-shell-v2";

// Paths relative to this file. Every <script src> in index.html must be listed:
// backend/tests/test_pwa_files.py checks the list against the page and the disk.
const SHELL = [
  "index.html",
  "styles.css",
  "manifest.json",
  "app.js",
  "ui.js",
  "store.js",
  "api.js",
  "passages.js",
  "delivery.js",
  "path.js",
  "tips.js",
  "pauses.js",
  "screens/practice.js",
  "screens/results.js",
  "screens/history.js",
  "screens/progress.js",
  "screens/onboarding.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg",
];

const API_PATH_PREFIX = "/api/";
const INDEX_PAGE = "index.html";
const SHELL_URLS = new Set(SHELL.map((path) => new URL(path, self.location.href).href));

// Stores a copy of a good GET response under its request, without holding up the page. Error
// responses are never stored, nor are redirected ones, which browsers refuse as a page load.
function keepCopy(event, response) {
  if (!response.ok || response.redirected) {
    return;
  }
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
}

// The network's answer when there is one; offline, the cached copy of this request, else the
// cached `fallbackUrl` when one is given.
async function networkFirst(event, fallbackUrl) {
  try {
    const response = await fetch(event.request);
    keepCopy(event, response);
    return response;
  } catch (error) {
    const cached =
      (await caches.match(event.request)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (cached) {
      return cached;
    }
    throw error;
  }
}

// The cached copy when there is one; otherwise the network's answer, kept for next time.
async function cacheFirst(event) {
  const cached = await caches.match(event.request);
  if (cached) {
    return cached;
  }
  const response = await fetch(event.request);
  keepCopy(event, response);
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => {
        const oldNames = names.filter((name) => name !== CACHE_NAME);
        return Promise.all(oldNames.map((name) => caches.delete(name)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // No respondWith: the browser sends these as if there were no service worker at all.
  if (url.pathname.startsWith(API_PATH_PREFIX) || request.method !== "GET") {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, INDEX_PAGE));
  } else if (SHELL_URLS.has(url.href)) {
    event.respondWith(networkFirst(event, null));
  } else {
    event.respondWith(cacheFirst(event));
  }
});
