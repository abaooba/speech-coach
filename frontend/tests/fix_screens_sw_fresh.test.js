// Tests that frontend/sw.js never hands the page shell files the browser kept from before a
// deploy. The server sends scripts, styles and icons with "public, max-age=3600", so a fetch in
// the browser's default cache mode can answer from the HTTP cache for up to an hour: a phone
// could run a new index.html with old scripts, and install could pre-cache those old copies.
// Shell files that are not page loads now go out with cache: "no-cache" (the browser revalidates;
// an unchanged file is a cheap 304), and install fetches each SHELL path with cache: "reload".
// sw.js runs in a vm context with a fake `self`, CacheStorage, Request and network, as in
// pwa.test.js; the network records the cache mode of every request it gets.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

const ORIGIN = "https://speech-coach.test";
const SW_URL = ORIGIN + "/sw.js";
const CACHE_NAME = "speech-coach-shell-v3";
const DEFAULT_MODE = "default";

// The SHELL array as written in sw.js, so the test follows the list rather than copying it.
const SHELL = [...SW_SOURCE.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(
  (match) => match[1],
);

function absolute(url) {
  return new URL(url, SW_URL).href;
}

// A Request as the worker sees one: a URL resolved against the worker's own, and a cache mode,
// "default" unless the init gives one. Built from another request it keeps that one's URL.
class FakeRequest {
  constructor(input, init) {
    this.url = typeof input === "string" ? absolute(input) : input.url;
    const inherited = typeof input === "string" ? DEFAULT_MODE : input.cache || DEFAULT_MODE;
    this.cache = init && init.cache ? init.cache : inherited;
  }
}

function fakeResponse(body, { status = 200 } = {}) {
  return {
    body,
    status,
    redirected: false,
    ok: status >= 200 && status < 300,
    clone: () => fakeResponse(body, { status }),
  };
}

// A CacheStorage whose caches map absolute URLs to responses. addAll fetches every request
// through the fake network, as a browser does, and logs what it was given.
function fakeCaches(network, calls) {
  const stores = new Map();
  const keyFor = (request) => absolute(typeof request === "string" ? request : request.url);
  function storeNamed(name) {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }
    const entries = stores.get(name);
    return {
      addAll: async (requests) => {
        calls.push("addAll " + name);
        for (const request of requests) {
          entries.set(keyFor(request), await network.fetch(request));
        }
      },
      put: async (request, response) => {
        entries.set(keyFor(request), response);
      },
      match: async (request) => entries.get(keyFor(request)),
    };
  }
  return {
    stores,
    open: async (name) => storeNamed(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => {
      for (const entries of stores.values()) {
        const hit = entries.get(keyFor(request));
        if (hit) {
          return hit;
        }
      }
      return undefined;
    },
  };
}

// Runs sw.js once. network.requests lists [url, cache mode] for every fetch, the mode taken from
// the init when one is given, else from the request. `network.online` false makes every fetch
// reject as a browser does offline.
function loadWorker() {
  const listeners = {};
  const calls = [];
  const network = { online: true, requests: [] };
  network.fetch = async (request, init) => {
    const url = typeof request === "string" ? absolute(request) : request.url;
    const fromRequest = typeof request === "string" ? DEFAULT_MODE : request.cache || DEFAULT_MODE;
    const mode = init && init.cache ? init.cache : fromRequest;
    network.requests.push([url, mode]);
    if (!network.online) {
      throw new TypeError("Failed to fetch");
    }
    return fakeResponse("network " + url);
  };
  const caches = fakeCaches(network, calls);
  const self = {
    location: new URL(SW_URL),
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => calls.push("skipWaiting"),
    clients: { claim: async () => calls.push("clients.claim") },
  };
  const context = { self, caches, fetch: network.fetch, Request: FakeRequest, URL };
  vm.runInNewContext(SW_SOURCE, context, { filename: "sw.js" });
  return { listeners, calls, caches, network };
}

async function install(worker) {
  let pending = null;
  worker.listeners.install({ waitUntil: (promise) => (pending = promise) });
  await pending;
}

// Fires one fetch event, as the page would, and returns the worker's answer once any cache write
// it started has finished. A request the page makes carries the browser's default cache mode.
async function request(worker, url, { mode = "no-cors" } = {}) {
  let answer = null;
  const lifetime = [];
  const event = {
    request: { url: absolute(url), method: "GET", mode, cache: DEFAULT_MODE },
    respondWith: (promise) => (answer = Promise.resolve(promise)),
    waitUntil: (promise) => lifetime.push(promise),
  };
  worker.listeners.fetch(event);
  const response = answer ? await answer : null;
  await Promise.all(lifetime);
  return response;
}

function cached(worker, url) {
  return worker.caches.stores.get(CACHE_NAME).get(absolute(url));
}

test("install fetches every SHELL file past the HTTP cache, with cache: reload", async () => {
  const worker = loadWorker();
  await install(worker);
  assert.deepEqual(worker.calls, ["addAll " + CACHE_NAME, "skipWaiting"]);
  assert.deepEqual(
    worker.network.requests,
    SHELL.map((shellPath) => [absolute(shellPath), "reload"]),
  );
  assert.deepEqual([...worker.caches.stores.get(CACHE_NAME).keys()], SHELL.map(absolute));
});

test("a shell file the page loads is revalidated with the server: cache: no-cache", async () => {
  const worker = loadWorker();
  await install(worker);
  worker.network.requests.length = 0;
  const response = await request(worker, "app.js");
  assert.equal(response.body, "network " + absolute("app.js"));
  assert.deepEqual(worker.network.requests, [[absolute("app.js"), "no-cache"]]);
  assert.equal(cached(worker, "app.js").body, "network " + absolute("app.js"));
});

test("every SHELL file asked for outside a page load goes out with no-cache", async () => {
  const worker = loadWorker();
  await install(worker);
  for (const shellPath of SHELL) {
    worker.network.requests.length = 0;
    await request(worker, shellPath);
    assert.deepEqual(worker.network.requests, [[absolute(shellPath), "no-cache"]], shellPath);
  }
});

test("offline, a shell file still comes from the cache", async () => {
  const worker = loadWorker();
  await install(worker);
  await request(worker, "screens/results.js");
  worker.network.online = false;
  const response = await request(worker, "screens/results.js");
  assert.equal(response.body, "network " + absolute("screens/results.js"));
});

test("a page load keeps the request's own cache mode", async () => {
  const worker = loadWorker();
  await install(worker);
  worker.network.requests.length = 0;
  await request(worker, "/", { mode: "navigate" });
  await request(worker, "index.html", { mode: "navigate" });
  assert.deepEqual(worker.network.requests, [
    [absolute("/"), DEFAULT_MODE],
    [absolute("index.html"), DEFAULT_MODE],
  ]);
});

test("a file outside SHELL is still fetched once in the default mode, then served cached", async () => {
  const worker = loadWorker();
  await install(worker);
  worker.network.requests.length = 0;
  await request(worker, "sample-session.json");
  await request(worker, "sample-session.json");
  assert.deepEqual(worker.network.requests, [[absolute("sample-session.json"), DEFAULT_MODE]]);
});
