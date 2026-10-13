// Tests for the offline shell: frontend/sw.js and the line in frontend/app.js's boot that
// registers it. sw.js runs in a vm context with a fake `self`, a fake CacheStorage keyed by
// absolute URL and a fake network; app.js runs against a fake page as in app_theme_boot.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

const ORIGIN = "https://speech-coach.test";
const SW_URL = ORIGIN + "/sw.js";
const CACHE_NAME = "speech-coach-shell-v3";

// The SHELL array as written in sw.js, so the test follows the list rather than copying it.
const SHELL = [...SW_SOURCE.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(
  (match) => match[1],
);

function absolute(url) {
  return new URL(url, SW_URL).href;
}

// A response whose body is a plain string, so a test can tell where it came from.
function fakeResponse(body, { status = 200, redirected = false } = {}) {
  return {
    body,
    status,
    redirected,
    ok: status >= 200 && status < 300,
    clone: () => fakeResponse(body, { status, redirected }),
  };
}

// A CacheStorage whose caches map absolute URLs to responses. A string key resolves against the
// worker's own URL, as it does in a browser. addAll stores a "precached <url>" body for each.
function fakeCaches(calls) {
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
        requests.forEach((request) => {
          entries.set(keyFor(request), fakeResponse("precached " + keyFor(request)));
        });
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
    delete: async (name) => {
      calls.push("delete " + name);
      return stores.delete(name);
    },
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

// Runs sw.js once. `network.online` false makes every fetch reject as a browser does offline;
// `network.responses` answers chosen URLs, anything else gets a "network <url>" body.
function loadWorker() {
  const listeners = {};
  const calls = [];
  const caches = fakeCaches(calls);
  const network = { online: true, responses: {}, requests: [] };
  const self = {
    location: new URL(SW_URL),
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => calls.push("skipWaiting"),
    clients: { claim: async () => calls.push("clients.claim") },
  };
  const fetch = async (request) => {
    const url = typeof request === "string" ? absolute(request) : request.url;
    network.requests.push(url);
    if (!network.online) {
      throw new TypeError("Failed to fetch");
    }
    return network.responses[url] || fakeResponse("network " + url);
  };
  vm.runInNewContext(SW_SOURCE, { self, caches, fetch, URL }, { filename: "sw.js" });
  return { listeners, calls, caches, network };
}

async function install(worker) {
  let pending = null;
  worker.listeners.install({ waitUntil: (promise) => (pending = promise) });
  await pending;
}

async function activate(worker) {
  let pending = null;
  worker.listeners.activate({ waitUntil: (promise) => (pending = promise) });
  await pending;
}

// Fires one fetch event. Returns the response the worker answered with, or null when it called
// no respondWith and so left the request to the browser. Waits for any cache write it started.
async function request(worker, url, { method = "GET", mode = "no-cors" } = {}) {
  let answer = null;
  const lifetime = [];
  const event = {
    request: { url: absolute(url), method, mode },
    respondWith: (promise) => (answer = Promise.resolve(promise)),
    waitUntil: (promise) => lifetime.push(promise),
  };
  worker.listeners.fetch(event);
  const response = answer ? await answer : null;
  await Promise.all(lifetime);
  return response;
}

function cached(worker, url) {
  const entries = worker.caches.stores.get(CACHE_NAME);
  return entries ? entries.get(absolute(url)) : undefined;
}

test("install pre-caches every SHELL file in speech-coach-shell-v3, then skips waiting", async () => {
  const worker = loadWorker();
  await install(worker);
  assert.deepEqual(worker.calls, ["addAll " + CACHE_NAME, "skipWaiting"]);
  const keys = [...worker.caches.stores.get(CACHE_NAME).keys()];
  assert.deepEqual(keys, SHELL.map(absolute));
  assert.ok(SHELL.includes("index.html"), "the page itself is in SHELL");
});

test("activate deletes every other cache, keeps its own, then claims the open pages", async () => {
  const worker = loadWorker();
  await worker.caches.open("speech-coach-shell-v0");
  await worker.caches.open(CACHE_NAME);
  await worker.caches.open("someone-else");
  await activate(worker);
  assert.deepEqual(await worker.caches.keys(), [CACHE_NAME]);
  assert.deepEqual(worker.calls, [
    "delete speech-coach-shell-v0",
    "delete someone-else",
    "clients.claim",
  ]);
});

test("requests under /api/ are never intercepted, whatever their method", async () => {
  const worker = loadWorker();
  await install(worker);
  for (const [url, method] of [
    ["/api/analyze", "POST"],
    ["/api/health", "GET"],
    ["/api/analyze?retry=1", "GET"],
  ]) {
    assert.equal(await request(worker, url, { method }), null, method + " " + url);
  }
  assert.deepEqual(worker.network.requests, [], "the worker fetched nothing itself");
});

test("other non-GET requests are left to the browser too", async () => {
  const worker = loadWorker();
  assert.equal(await request(worker, "/feedback", { method: "POST" }), null);
});

test("a page load online gets the network's page", async () => {
  const worker = loadWorker();
  await install(worker);
  const response = await request(worker, "/", { mode: "navigate" });
  assert.equal(response.body, "network " + absolute("/"));
});

test("a page load offline falls back to the cached index.html", async () => {
  const worker = loadWorker();
  await install(worker);
  worker.network.online = false;
  for (const url of ["/", "/?source=pwa", "/how.html"]) {
    const response = await request(worker, url, { mode: "navigate" });
    assert.equal(response.body, "precached " + absolute("index.html"), url);
  }
});

test("a page loaded once online opens offline as that same page", async () => {
  const worker = loadWorker();
  await install(worker);
  await request(worker, "/how.html", { mode: "navigate" });
  worker.network.online = false;
  const response = await request(worker, "/how.html", { mode: "navigate" });
  assert.equal(response.body, "network " + absolute("/how.html"));
});

test("shell files come from the network first and refresh their cached copy", async () => {
  const worker = loadWorker();
  await install(worker);
  const online = await request(worker, "app.js");
  assert.equal(online.body, "network " + absolute("app.js"));
  assert.equal(cached(worker, "app.js").body, "network " + absolute("app.js"));
  worker.network.online = false;
  const offline = await request(worker, "app.js");
  assert.equal(offline.body, "network " + absolute("app.js"), "offline, the last good copy");
});

test("any other file is served from the cache once it has been loaded", async () => {
  const worker = loadWorker();
  await install(worker);
  assert.equal(SHELL.includes("sample-session.json"), false, "a file outside SHELL");
  const first = await request(worker, "sample-session.json");
  assert.equal(first.body, "network " + absolute("sample-session.json"));
  const second = await request(worker, "sample-session.json");
  assert.equal(second.body, first.body);
  assert.deepEqual(worker.network.requests, [absolute("sample-session.json")], "fetched once");
});

test("an error response is passed on but never cached", async () => {
  const worker = loadWorker();
  await install(worker);
  worker.network.responses[absolute("later.js")] = fakeResponse("not found", { status: 404 });
  worker.network.responses[absolute("app.js")] = fakeResponse("server error", { status: 500 });
  worker.network.responses[absolute("/")] = fakeResponse("bad gateway", { status: 502 });
  assert.equal((await request(worker, "later.js")).status, 404);
  assert.equal((await request(worker, "app.js")).status, 500);
  assert.equal((await request(worker, "/", { mode: "navigate" })).status, 502);
  assert.equal(cached(worker, "later.js"), undefined);
  assert.equal(cached(worker, "app.js").body, "precached " + absolute("app.js"));
  assert.equal(cached(worker, "/"), undefined);
});

test("a redirected response is never cached", async () => {
  const worker = loadWorker();
  worker.network.responses[absolute("moved.js")] = fakeResponse("moved", { redirected: true });
  assert.equal((await request(worker, "moved.js")).body, "moved");
  assert.equal(cached(worker, "moved.js"), undefined);
});

// Runs app.js against a fake page with one Practice screen. `navigator` is put on the context
// only when given, as an old browser or a test fake may have none.
function loadApp(log, navigator) {
  const handlers = {};
  const sections = { "screen-practice": { hidden: true, classList: { add() {}, remove() {} } } };
  const fakeWindow = { location: { hash: "#/practice" }, addEventListener: () => {} };
  const document = {
    title: "",
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    getElementById: (id) => sections[id] || null,
    querySelectorAll: () => [],
  };
  const context = { window: fakeWindow, document };
  if (navigator !== undefined) {
    context.navigator = navigator;
  }
  vm.runInNewContext(APP_SOURCE, context, { filename: "app.js" });
  fakeWindow.app.screens.practice = {
    mount: () => log.push("mount practice"),
    show: () => log.push("show practice"),
    hide: () => {},
  };
  return handlers.DOMContentLoaded;
}

test("boot registers sw.js once the first screen is shown", async () => {
  const log = [];
  const navigator = {
    serviceWorker: {
      register: (url) => {
        log.push("register " + url);
        return Promise.resolve({});
      },
    },
  };
  await loadApp(log, navigator)();
  assert.deepEqual(log, ["mount practice", "show practice", "register sw.js"]);
});

test("a refused registration is swallowed, so the app runs as before", async () => {
  const unhandled = [];
  const record = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const log = [];
    const navigator = {
      serviceWorker: { register: () => Promise.reject(new Error("The operation is insecure.")) },
    };
    await loadApp(log, navigator)();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(log, ["mount practice", "show practice"]);
    assert.deepEqual(unhandled, [], "the rejection was caught");
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("a browser without service workers, or without navigator, boots as before", async () => {
  for (const navigator of [{}, undefined]) {
    const log = [];
    await loadApp(log, navigator)();
    assert.deepEqual(log, ["mount practice", "show practice"]);
  }
});
