// Tests for frontend/store.js when an older version of the app, open in another tab, holds the
// database at version 1. store.js before version 2 keeps its connection for the life of the page
// and never closes it on versionchange, so a browser fires "blocked" at the version 2 open and
// holds it, and any open made after it, until that tab closes. app.js boot awaits
// getFlag("onboarded") before it routes, so an open that waits leaves the page blank and a take
// never saves. Every call must fail at once with what to do instead, and once the older tab
// closes the held open finishes the upgrade with every session and flag kept.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const DB_NAME = "speech-coach";
const BLOCKED_MESSAGE = "Close other Speech Coach tabs to finish updating, then try again.";
// Long enough for any number of the fake's microtasks; a call still waiting after it hangs.
const SETTLE_MS = 100;

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
    this.onblocked = null;
  }

  succeedLater(result) {
    queueMicrotask(() => {
      this.result = result;
      if (this.onsuccess) {
        this.onsuccess({ target: this });
      }
    });
  }
}

class FakeObjectStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.records = new Map();
  }

  createIndex() {}

  put(record) {
    return this.request(() => {
      this.records.set(record[this.keyPath], structuredClone(record));
      return record[this.keyPath];
    });
  }

  get(key) {
    return this.request(() => structuredClone(this.records.get(key)));
  }

  getAll() {
    return this.request(() => Array.from(this.records.values(), (row) => structuredClone(row)));
  }

  request(action) {
    const request = new FakeRequest();
    request.succeedLater(action());
    return request;
  }
}

class FakeDatabase {
  constructor() {
    this.version = 1;
    this.stores = new Map();
    this.created = [];
    this.closed = false;
    this.onversionchange = null;
  }

  close() {
    this.closed = true;
  }

  createObjectStore(name, options) {
    if (this.stores.has(name)) {
      throw new Error(`ConstraintError: an object store named ${name} already exists`);
    }
    const store = new FakeObjectStore(name, options.keyPath);
    this.stores.set(name, store);
    this.created.push(name);
    return store;
  }

  transaction() {
    return {
      objectStore: (name) => {
        if (!this.stores.has(name)) {
          throw new Error(`NotFoundError: no object store named ${name}`);
        }
        return this.stores.get(name);
      },
    };
  }
}

// A version 1 database, as store.js before version 2 left it, that an older tab holds open.
// Like a browser: an open asking for a higher version while that tab is open gets "blocked"
// and waits; an open made after it waits in line behind it and hears nothing; when the tab
// closes, the first open upgrades the database and the ones behind it simply open.
class HeldIndexedDB {
  constructor({ sessions = [], flags = [] } = {}) {
    this.db = new FakeDatabase();
    const sessionStore = new FakeObjectStore("sessions", "id");
    sessions.forEach((session) => sessionStore.records.set(session.id, structuredClone(session)));
    const flagStore = new FakeObjectStore("flags", "key");
    flags.forEach((flag) => flagStore.records.set(flag.key, structuredClone(flag)));
    this.db.stores.set("sessions", sessionStore);
    this.db.stores.set("flags", flagStore);
    this.olderTabOpen = true;
    this.waiting = [];
    this.openCalls = [];
  }

  open(name, version) {
    this.openCalls.push({ name, version });
    const request = new FakeRequest();
    const open = { request, version };
    if (this.waiting.length > 0) {
      this.waiting.push(open);
    } else if (this.olderTabOpen && this.db.version < version) {
      this.waiting.push(open);
      const oldVersion = this.db.version;
      queueMicrotask(() => {
        if (request.onblocked) {
          request.onblocked({ target: request, oldVersion, newVersion: version });
        }
      });
    } else {
      queueMicrotask(() => this.finish(open));
    }
    return request;
  }

  finish({ request, version }) {
    request.result = this.db;
    if (this.db.version < version) {
      const oldVersion = this.db.version;
      this.db.version = version;
      request.onupgradeneeded({ target: request, oldVersion, newVersion: version });
    }
    request.onsuccess({ target: request });
  }

  closeOlderTab() {
    this.olderTabOpen = false;
    const waiting = this.waiting;
    this.waiting = [];
    waiting.forEach((open) => queueMicrotask(() => this.finish(open)));
  }

  // The held open fails instead, as one whose upgrade aborts does.
  failHeldOpen(error) {
    const [held, ...behind] = this.waiting;
    this.waiting = behind;
    queueMicrotask(() => {
      held.request.error = error;
      held.request.onerror({ target: held.request });
    });
  }
}

function loadStore(indexedDB) {
  const context = { app: {}, indexedDB };
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return context.app.store;
}

// The call's own outcome, or a rejection saying it still waits after SETTLE_MS.
function withinMoments(promise) {
  let timer;
  const waiting = new Promise((_, reject) => {
    const stillWaiting = new Error("still waiting after " + SETTLE_MS + " ms");
    timer = setTimeout(() => reject(stillWaiting), SETTLE_MS);
  });
  return Promise.race([promise, waiting]).finally(() => clearTimeout(timer));
}

// Lets every queued microtask run, as the moments after a tab closes do.
function nextTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const SAVED_SESSIONS = [
  {
    id: "older",
    createdAt: "2026-10-10T09:00:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [{ text: "Hello", start: 0.4, end: 0.8 }],
  },
  {
    id: "newer",
    createdAt: "2026-10-11T09:00:00.000Z",
    passageId: "rebuttal-uniforms",
    passageTitle: "Rebuttal: school uniforms",
    durationSeconds: 44,
    metrics: { words_per_minute: 159.5 },
    transcript: [{ text: "My", start: 1.395, end: 1.6 }],
  },
];
const SAVED_FLAGS = [{ key: "onboarded", value: true }];

test("an open an older tab holds up fails with what to do instead of waiting", async () => {
  const store = loadStore(new HeldIndexedDB({ flags: SAVED_FLAGS }));
  await assert.rejects(withinMoments(store.getFlag("onboarded")), { message: BLOCKED_MESSAGE });
});

test("while the older tab stays open every call fails at once and opens nothing more", async () => {
  const indexedDB = new HeldIndexedDB({ sessions: SAVED_SESSIONS, flags: SAVED_FLAGS });
  const store = loadStore(indexedDB);
  await assert.rejects(withinMoments(store.getFlag("onboarded")), { message: BLOCKED_MESSAGE });

  const calls = {
    list: () => store.list(),
    save: () => store.save({ ...SAVED_SESSIONS[0], id: "new-take" }),
    markLevelCleared: () => store.markLevelCleared("fillers-1"),
    listClearedLevels: () => store.listClearedLevels(),
  };
  for (const [name, call] of Object.entries(calls)) {
    await assert.rejects(withinMoments(call()), { message: BLOCKED_MESSAGE }, name);
  }
  assert.equal(indexedDB.openCalls.length, 1, "an open behind the held one would wait unheard");
});

test("once the older tab closes the held open upgrades and later calls use it", async () => {
  const indexedDB = new HeldIndexedDB({ sessions: SAVED_SESSIONS, flags: SAVED_FLAGS });
  const store = loadStore(indexedDB);
  await assert.rejects(withinMoments(store.getFlag("onboarded")), { message: BLOCKED_MESSAGE });

  indexedDB.closeOlderTab();
  await nextTask();

  assert.deepEqual(indexedDB.db.created, ["pathProgress"], "only the new store is created");
  assert.equal(indexedDB.db.version, 2);
  assert.equal(await withinMoments(store.getFlag("onboarded")), true);
  assert.deepEqual(plain(await store.list()), [SAVED_SESSIONS[1], SAVED_SESSIONS[0]]);
  await store.markLevelCleared("fillers-1", "2026-10-12T18:00:00.000Z");
  assert.deepEqual(plain(await store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: "2026-10-12T18:00:00.000Z" },
  ]);
  assert.equal(indexedDB.openCalls.length, 1, "the held open's connection serves every call");
  assert.equal(typeof indexedDB.db.onversionchange, "function", "it still yields to newer tabs");
});

test("a held open that fails in the end lets the next call open again", async () => {
  const indexedDB = new HeldIndexedDB({ flags: SAVED_FLAGS });
  const store = loadStore(indexedDB);
  await assert.rejects(withinMoments(store.getFlag("onboarded")), { message: BLOCKED_MESSAGE });

  indexedDB.failHeldOpen(new Error("AbortError"));
  await nextTask();
  indexedDB.closeOlderTab();

  assert.equal(await withinMoments(store.getFlag("onboarded")), true);
  assert.equal(indexedDB.openCalls.length, 2);
});
