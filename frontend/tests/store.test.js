// Tests for frontend/store.js (app.store). The module is loaded with vm.runInNewContext so that
// `app`, `indexedDB` and `crypto` are injected fakes. The fake IndexedDB below implements only
// what store.js touches: open with upgrade, object stores with put/get/getAll/delete, and
// requests that fire onsuccess/onerror asynchronously.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const DB_NAME = "speech-coach";
const DB_VERSION = 1;

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }

  succeedLater(result) {
    queueMicrotask(() => {
      this.result = result;
      if (this.onsuccess) {
        this.onsuccess({ target: this });
      }
    });
  }

  failLater(error) {
    queueMicrotask(() => {
      this.error = error;
      if (this.onerror) {
        this.onerror({ target: this });
      }
    });
  }
}

class FakeObjectStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.indexes = {};
    this.records = new Map();
    this.failNextWith = null;
  }

  createIndex(name, keyPath) {
    this.indexes[name] = keyPath;
  }

  put(record) {
    return this.request(() => {
      const key = record[this.keyPath];
      this.records.set(key, structuredClone(record));
      return key;
    });
  }

  get(key) {
    return this.request(() => structuredClone(this.records.get(key)));
  }

  getAll() {
    return this.request(() => Array.from(this.records.values(), (record) => structuredClone(record)));
  }

  delete(key) {
    return this.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }

  request(action) {
    const request = new FakeRequest();
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      request.failLater(error);
      return request;
    }
    request.succeedLater(action());
    return request;
  }
}

class FakeDatabase {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
    this.transactions = [];
  }

  createObjectStore(name, options) {
    const store = new FakeObjectStore(name, options.keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames, mode) {
    this.transactions.push({ storeNames, mode });
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

class FakeIndexedDB {
  constructor() {
    this.databases = new Map();
    this.openCalls = [];
    this.failOpenWith = null;
  }

  open(name, version) {
    this.openCalls.push({ name, version });
    const request = new FakeRequest();
    if (this.failOpenWith) {
      request.failLater(this.failOpenWith);
      return request;
    }
    let db = this.databases.get(name);
    if (!db) {
      db = new FakeDatabase(name);
      this.databases.set(name, db);
    }
    const needsUpgrade = db.version < version;
    queueMicrotask(() => {
      request.result = db;
      if (needsUpgrade) {
        db.version = version;
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: request });
        }
      }
      if (request.onsuccess) {
        request.onsuccess({ target: request });
      }
    });
    return request;
  }

  // Direct access to the records of a store for assertions, bypassing app.store.
  recordsOf(storeName) {
    return this.databases.get(DB_NAME).stores.get(storeName);
  }
}

// Loads store.js into a fresh realm. `cryptoImpl` is omitted to exercise the id fallback.
function loadStore(options = {}) {
  const indexedDB = options.indexedDB || new FakeIndexedDB();
  const context = { app: {}, indexedDB };
  if (options.crypto) {
    context.crypto = options.crypto;
  }
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { store: context.app.store, app: context.app, indexedDB };
}

// The module runs in another realm, so `instanceof Error` cannot be used across the boundary.
function isPlainError(value) {
  return (
    Object.prototype.toString.call(value) === "[object Error]" &&
    value.constructor.name === "Error"
  );
}

const METRICS = {
  words_per_minute: 150,
  duration: 12,
  word_count: 30,
  fillers: { um: 1 },
  pauses: [],
  repeats: [],
  pace_windows: [],
};

function sessionFixture(overrides = {}) {
  return {
    passageId: "free-talk",
    passageTitle: "Free talk",
    durationSeconds: 12,
    metrics: METRICS,
    transcript: [{ text: "hello", start: 0.1, end: 0.5 }],
    ...overrides,
  };
}

test("store.js assigns exactly app.store with the six functions and opens nothing at load", () => {
  const { app, store, indexedDB } = loadStore();
  assert.deepEqual(Object.keys(app), ["store"]);
  assert.deepEqual(
    Object.keys(store).sort(),
    ["get", "getFlag", "list", "remove", "save", "setFlag"],
  );
  Object.values(store).forEach((fn) => assert.equal(typeof fn, "function"));
  assert.equal(indexedDB.openCalls.length, 0);
});

test("first use opens 'speech-coach' v1 and creates the sessions and flags stores", async () => {
  const { store, indexedDB } = loadStore();
  await store.list();
  assert.deepEqual(indexedDB.openCalls, [{ name: DB_NAME, version: DB_VERSION }]);
  const sessions = indexedDB.recordsOf("sessions");
  assert.equal(sessions.keyPath, "id");
  assert.deepEqual(sessions.indexes, { createdAt: "createdAt" });
  assert.equal(indexedDB.recordsOf("flags").keyPath, "key");
});

test("every call shares one open; the database is opened once", async () => {
  const { store, indexedDB } = loadStore();
  await Promise.all([store.list(), store.getFlag("onboarded"), store.get("missing")]);
  await store.list();
  assert.equal(indexedDB.openCalls.length, 1);
});

test("save assigns a UUID and an ISO createdAt when missing, puts the record, resolves the id", async () => {
  const crypto = { randomUUID: () => "11111111-2222-4333-8444-555555555555" };
  const { store, indexedDB } = loadStore({ crypto });
  const session = sessionFixture();
  const before = Date.now();

  const id = await store.save(session);

  assert.equal(id, "11111111-2222-4333-8444-555555555555");
  assert.equal(session.id, id);
  assert.equal(typeof session.createdAt, "string");
  const createdAtMs = Date.parse(session.createdAt);
  assert.ok(createdAtMs >= before - 1000 && createdAtMs <= Date.now() + 1000);
  assert.match(session.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const stored = indexedDB.recordsOf("sessions").records.get(id);
  assert.deepEqual(stored, {
    id,
    createdAt: session.createdAt,
    passageId: "free-talk",
    passageTitle: "Free talk",
    durationSeconds: 12,
    metrics: METRICS,
    transcript: [{ text: "hello", start: 0.1, end: 0.5 }],
  });
  assert.deepEqual(indexedDB.databases.get(DB_NAME).transactions.at(-1), {
    storeNames: "sessions",
    mode: "readwrite",
  });
});

test("save falls back to a non-empty id without crypto and keeps a given id and createdAt", async () => {
  const { store } = loadStore();
  const generated = await store.save(sessionFixture());
  assert.equal(typeof generated, "string");
  assert.ok(generated.length >= 8, `fallback id too short: ${generated}`);

  const given = sessionFixture({ id: "fixed-id", createdAt: "2026-10-09T22:21:00.000Z" });
  const id = await store.save(given);
  assert.equal(id, "fixed-id");
  assert.equal((await store.get("fixed-id")).createdAt, "2026-10-09T22:21:00.000Z");
});

test("save stores only the seven session fields and drops anything else", async () => {
  const { store } = loadStore();
  const id = await store.save(sessionFixture({ extra: "nope", wpm: 150 }));
  const stored = await store.get(id);
  assert.deepEqual(
    Object.keys(stored).sort(),
    ["createdAt", "durationSeconds", "id", "metrics", "passageId", "passageTitle", "transcript"],
  );
});

test("save rejects with a plain Error when the session carries audio and stores nothing", async () => {
  const { store, indexedDB } = loadStore();
  for (const field of ["blob", "audio"]) {
    const error = await store.save(sessionFixture({ [field]: { size: 10 } })).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.ok(isPlainError(error), `expected a plain Error for ${field}`);
    assert.match(error.message, new RegExp(field));
  }
  assert.equal(indexedDB.openCalls.length, 0, "nothing should be opened for a rejected save");
});

test("save rejects with a plain Error when given something that is not an object", async () => {
  const { store } = loadStore();
  for (const bad of [undefined, null, "session", 42]) {
    const error = await store.save(bad).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.ok(isPlainError(error), `expected a plain Error for ${String(bad)}`);
  }
});

test("list returns every session newest first regardless of insertion order", async () => {
  const { store } = loadStore();
  await store.save(sessionFixture({ id: "middle", createdAt: "2026-10-09T12:00:00.000Z" }));
  await store.save(sessionFixture({ id: "oldest", createdAt: "2026-10-08T12:00:00.000Z" }));
  await store.save(sessionFixture({ id: "newest", createdAt: "2026-10-10T12:00:00.000Z" }));

  const sessions = await store.list();

  assert.deepEqual(
    sessions.map((session) => session.id),
    ["newest", "middle", "oldest"],
  );
});

test("list resolves to an empty array when nothing is stored", async () => {
  const { store } = loadStore();
  assert.deepEqual(await store.list(), []);
});

test("get returns the stored session or undefined", async () => {
  const { store } = loadStore();
  const id = await store.save(sessionFixture());
  const found = await store.get(id);
  assert.equal(found.id, id);
  assert.deepEqual(found.metrics, METRICS);
  assert.equal(await store.get("no-such-id"), undefined);
});

test("remove deletes the session; list is empty afterwards", async () => {
  const { store } = loadStore();
  const id = await store.save(sessionFixture());
  await store.remove(id);
  assert.equal(await store.get(id), undefined);
  assert.deepEqual(await store.list(), []);
  await store.remove("already-gone");
});

test("setFlag and getFlag round-trip; unknown flags are undefined; setFlag overwrites", async () => {
  const { store, indexedDB } = loadStore();
  assert.equal(await store.getFlag("onboarded"), undefined);

  await store.setFlag("onboarded", true);
  assert.equal(await store.getFlag("onboarded"), true);
  assert.deepEqual(indexedDB.recordsOf("flags").records.get("onboarded"), {
    key: "onboarded",
    value: true,
  });

  await store.setFlag("onboarded", false);
  assert.equal(await store.getFlag("onboarded"), false);
});

test("a failing request rejects with the request error instead of hanging", async () => {
  const { store, indexedDB } = loadStore();
  await store.list();
  const failure = new Error("QuotaExceededError");
  indexedDB.recordsOf("sessions").failNextWith = failure;

  await assert.rejects(store.save(sessionFixture()), { message: "QuotaExceededError" });
  await assert.doesNotReject(store.list());
});

test("a failed open rejects every waiting call and the next call opens again", async () => {
  const indexedDB = new FakeIndexedDB();
  indexedDB.failOpenWith = new Error("VersionError");
  const { store } = loadStore({ indexedDB });

  const results = await Promise.allSettled([store.list(), store.getFlag("onboarded")]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(results[0].reason.message, "VersionError");
  assert.equal(indexedDB.openCalls.length, 1);

  indexedDB.failOpenWith = null;
  assert.deepEqual(await store.list(), []);
  assert.equal(indexedDB.openCalls.length, 2);
});
