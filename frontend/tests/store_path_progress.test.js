// Tests for the skill path's progress in frontend/store.js (docs/PLAN.md T42).
// markLevelCleared and listClearedLevels keep one {levelId, clearedAt} record per cleared level
// in a "pathProgress" object store that version 2 of the database adds. The upgrade must keep
// every session and flag a speaker already saved. store.js runs in a vm with a fake IndexedDB
// that, like a browser, tells the upgrade which version the database had and refuses to create
// an object store twice.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const DB_NAME = "speech-coach";
const PATH_VERSION = 2;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
}

class FakeObjectStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.indexes = {};
    this.records = new Map();
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
    return this.request(() => Array.from(this.records.values(), (row) => structuredClone(row)));
  }

  delete(key) {
    return this.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }

  request(action) {
    const request = new FakeRequest();
    request.succeedLater(action());
    return request;
  }
}

class FakeDatabase {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
    // The stores each upgrade created, in order, so a test can see what an upgrade touched.
    this.created = [];
    this.closed = false;
    this.onversionchange = null;
  }

  close() {
    this.closed = true;
  }

  // A browser throws a ConstraintError for a store that already exists, which would abort
  // the upgrade and lose nothing but the open; an upgrade must only add what is missing.
  createObjectStore(name, options) {
    if (this.stores.has(name)) {
      throw new Error(`ConstraintError: an object store named ${name} already exists`);
    }
    const store = new FakeObjectStore(name, options.keyPath);
    this.stores.set(name, store);
    this.created.push(name);
    return store;
  }

  transaction(storeNames, mode) {
    return {
      mode,
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
  }

  // The upgrade event carries oldVersion and newVersion, as a browser's does.
  open(name, version) {
    this.openCalls.push({ name, version });
    const request = new FakeRequest();
    let db = this.databases.get(name);
    if (!db) {
      db = new FakeDatabase(name);
      this.databases.set(name, db);
    }
    const oldVersion = db.version;
    queueMicrotask(() => {
      request.result = db;
      if (oldVersion < version) {
        db.version = version;
        request.onupgradeneeded({ target: request, oldVersion, newVersion: version });
      }
      request.onsuccess({ target: request });
    });
    return request;
  }

  // A database as version 1 of store.js left it: sessions (with the createdAt index) and flags,
  // holding `sessions` and `flags`.
  seedVersion1(sessions, flags) {
    const db = new FakeDatabase(DB_NAME);
    db.version = 1;
    const sessionStore = new FakeObjectStore("sessions", "id");
    sessionStore.createIndex("createdAt", "createdAt");
    sessions.forEach((session) => sessionStore.records.set(session.id, structuredClone(session)));
    const flagStore = new FakeObjectStore("flags", "key");
    flags.forEach((flag) => flagStore.records.set(flag.key, structuredClone(flag)));
    db.stores.set("sessions", sessionStore);
    db.stores.set("flags", flagStore);
    this.databases.set(DB_NAME, db);
    return db;
  }

  database() {
    return this.databases.get(DB_NAME);
  }
}

function loadStore(indexedDB = new FakeIndexedDB()) {
  const context = { app: {}, indexedDB };
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { store: context.app.store, indexedDB };
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
    metrics: { words_per_minute: 150, fillers: { um: 2 } },
    transcript: [{ text: "Hello", start: 0.4, end: 0.8 }],
  },
  {
    id: "newer",
    createdAt: "2026-10-11T09:00:00.000Z",
    passageId: "rebuttal-uniforms",
    passageTitle: "Rebuttal: school uniforms",
    durationSeconds: 44,
    metrics: { words_per_minute: 159.5, fillers: { uh: 2 } },
    transcript: [{ text: "My", start: 1.395, end: 1.6 }],
  },
];
const SAVED_FLAGS = [{ key: "onboarded", value: true }];

test("store.js keeps the six session and flag functions and adds the two path ones", () => {
  const { store } = loadStore();
  assert.deepEqual(Object.keys(store).sort(), [
    "get",
    "getFlag",
    "list",
    "listClearedLevels",
    "markLevelCleared",
    "remove",
    "save",
    "setFlag",
  ]);
});

test("a new database opens at version 2 with sessions, flags and pathProgress", async () => {
  const { store, indexedDB } = loadStore();
  assert.deepEqual(plain(await store.listClearedLevels()), []);
  assert.deepEqual(indexedDB.openCalls, [{ name: DB_NAME, version: PATH_VERSION }]);
  const db = indexedDB.database();
  assert.deepEqual(db.created, ["sessions", "flags", "pathProgress"]);
  assert.equal(db.stores.get("pathProgress").keyPath, "levelId");
  assert.deepEqual(db.stores.get("sessions").indexes, { createdAt: "createdAt" });
  assert.equal(db.stores.get("flags").keyPath, "key");
});

test("the upgrade from version 1 adds pathProgress and keeps every session and flag", async () => {
  const indexedDB = new FakeIndexedDB();
  const db = indexedDB.seedVersion1(SAVED_SESSIONS, SAVED_FLAGS);
  const { store } = loadStore(indexedDB);

  const sessions = await store.list();

  assert.deepEqual(db.created, ["pathProgress"], "only the new store is created");
  assert.equal(db.version, PATH_VERSION);
  assert.deepEqual(plain(sessions), [SAVED_SESSIONS[1], SAVED_SESSIONS[0]]);
  assert.deepEqual(plain(await store.get("older")), SAVED_SESSIONS[0]);
  assert.equal(await store.getFlag("onboarded"), true);
  assert.deepEqual(plain(await store.listClearedLevels()), []);
});

test("after the upgrade, sessions still save and path progress is kept beside them", async () => {
  const indexedDB = new FakeIndexedDB();
  indexedDB.seedVersion1(SAVED_SESSIONS, SAVED_FLAGS);
  const { store } = loadStore(indexedDB);

  await store.markLevelCleared("fillers-1", "2026-10-12T18:00:00.000Z");
  const id = await store.save({ ...SAVED_SESSIONS[0], id: "after-upgrade" });

  assert.equal(id, "after-upgrade");
  assert.deepEqual(
    (await store.list()).map((session) => session.id).sort(),
    ["after-upgrade", "newer", "older"],
  );
  assert.deepEqual(plain(await store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: "2026-10-12T18:00:00.000Z" },
  ]);
});

test("markLevelCleared stamps the time now and resolves the record it stored", async () => {
  const { store, indexedDB } = loadStore();
  const before = Date.now();

  const record = await store.markLevelCleared("fillers-1");

  assert.equal(record.levelId, "fillers-1");
  assert.match(record.clearedAt, ISO_TIME);
  const at = Date.parse(record.clearedAt);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, record.clearedAt);
  const stored = indexedDB.database().stores.get("pathProgress").records.get("fillers-1");
  assert.deepEqual(stored, { levelId: "fillers-1", clearedAt: record.clearedAt });
});

test("markLevelCleared keeps a clearedAt it is given", async () => {
  const { store } = loadStore();
  const record = await store.markLevelCleared("pace-2", "2026-10-11T22:21:00.000Z");
  assert.deepEqual(plain(record), { levelId: "pace-2", clearedAt: "2026-10-11T22:21:00.000Z" });
});

test("clearing a level again keeps the day it was first cleared", async () => {
  const { store } = loadStore();
  await store.markLevelCleared("restarts-1", "2026-10-11T08:00:00.000Z");

  const again = await store.markLevelCleared("restarts-1", "2026-10-12T08:00:00.000Z");

  assert.deepEqual(plain(again), { levelId: "restarts-1", clearedAt: "2026-10-11T08:00:00.000Z" });
  assert.deepEqual(plain(await store.listClearedLevels()), [
    { levelId: "restarts-1", clearedAt: "2026-10-11T08:00:00.000Z" },
  ]);
});

test("listClearedLevels lists every cleared level in the order it was cleared", async () => {
  const { store } = loadStore();
  await store.markLevelCleared("pace-1", "2026-10-12T09:00:00.000Z");
  await store.markLevelCleared("fillers-1", "2026-10-10T09:00:00.000Z");
  await store.markLevelCleared("fillers-2", "2026-10-11T09:00:00.000Z");

  assert.deepEqual(plain(await store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: "2026-10-10T09:00:00.000Z" },
    { levelId: "fillers-2", clearedAt: "2026-10-11T09:00:00.000Z" },
    { levelId: "pace-1", clearedAt: "2026-10-12T09:00:00.000Z" },
  ]);
});

test("markLevelCleared rejects a missing level id or a clearedAt that is not text", async () => {
  const { store, indexedDB } = loadStore();
  for (const bad of [undefined, null, "", 3, { id: "fillers-1" }]) {
    await assert.rejects(store.markLevelCleared(bad), /level id/, String(bad));
  }
  await assert.rejects(store.markLevelCleared("fillers-1", 1760000000000), /clearedAt/);
  assert.equal(indexedDB.openCalls.length, 0, "nothing is opened for a rejected call");
});

test("a newer version opening in another tab closes this connection; calls reopen", async () => {
  const { store, indexedDB } = loadStore();
  await store.markLevelCleared("fillers-1", "2026-10-12T09:00:00.000Z");
  const db = indexedDB.database();
  assert.equal(typeof db.onversionchange, "function");

  db.onversionchange({ oldVersion: PATH_VERSION, newVersion: PATH_VERSION + 1 });

  assert.equal(db.closed, true);
  assert.deepEqual(plain(await store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: "2026-10-12T09:00:00.000Z" },
  ]);
  assert.equal(indexedDB.openCalls.length, 2);
});

test("path progress never touches the sessions or the flags", async () => {
  const indexedDB = new FakeIndexedDB();
  indexedDB.seedVersion1(SAVED_SESSIONS, SAVED_FLAGS);
  const { store } = loadStore(indexedDB);

  await store.markLevelCleared("long-pauses-1", "2026-10-12T09:00:00.000Z");

  const db = indexedDB.database();
  assert.deepEqual([...db.stores.get("sessions").records.keys()].sort(), ["newer", "older"]);
  assert.deepEqual([...db.stores.get("flags").records.keys()], ["onboarded"]);
});
