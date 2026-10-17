// Tests that frontend/store.js is local-only: accounts are gone, so no call reaches a server, a
// phone that was once signed in still lists every take in its store, and the first load after
// the update moves the levels the old account sync kept into pathProgress and deletes the
// `signedInAccount` and `accountSync` flags (the stored email goes with them).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeIndexedDB } = require("./fake-indexeddb");

const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const EMAIL = "ann@example.com";
const EIGHT = [
  "get",
  "getFlag",
  "list",
  "listClearedLevels",
  "markLevelCleared",
  "remove",
  "save",
  "setFlag",
];

// A device: store.js in a fresh vm realm over `indexedDB`, with a fetch that fails the test if
// anything calls it, and the window listeners store.js may register.
function loadDevice(indexedDB = new FakeIndexedDB()) {
  const fetchCalls = [];
  const listeners = {};
  const context = {
    app: {},
    indexedDB,
    fetch: (...args) => {
      fetchCalls.push(args);
      throw new Error("store.js must not call fetch");
    },
    window: {
      addEventListener: (type, handler) => {
        listeners[type] = [...(listeners[type] || []), handler];
      },
    },
  };
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { store: context.app.store, indexedDB, fetchCalls, listeners };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function session(id, createdAt) {
  return {
    id,
    createdAt,
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 60,
    metrics: { words_per_minute: 140 },
    transcript: [{ text: "Hello", start: 0, end: 0.5 }],
  };
}

// What an older version of the app left behind for a signed-in speaker.
async function leaveOldAccount(indexedDB, levels, pendingLevels = {}) {
  const old = loadDevice(indexedDB);
  await old.store.setFlag("signedInAccount", { email: EMAIL });
  await old.store.setFlag("accountSync", {
    [EMAIL]: { takeIds: ["mine"], levels, pendingLevels },
  });
  await old.store.setFlag("onboarded", true);
}

test("app.store has exactly its eight functions", () => {
  const { store } = loadDevice();
  assert.deepEqual(Object.keys(store).sort(), EIGHT);
});

test("no call reaches fetch, and no online or load listener is added", async () => {
  const device = loadDevice();
  const { store } = device;
  await store.save(session("a", "2026-10-01T10:00:00.000Z"));
  await store.list();
  await store.get("a");
  await store.setFlag("x", 1);
  await store.getFlag("x");
  await store.markLevelCleared("fillers-1");
  await store.listClearedLevels();
  await store.remove("a");
  assert.equal(device.fetchCalls.length, 0);
  assert.deepEqual(Object.keys(device.listeners), []);
});

test("a phone that was signed in still lists every take in its store", async () => {
  const indexedDB = new FakeIndexedDB();
  await leaveOldAccount(indexedDB, {});
  const phone = loadDevice(indexedDB);
  await phone.store.save(session("mine", "2026-10-01T10:00:00.000Z"));
  await phone.store.save(session("other", "2026-10-02T10:00:00.000Z"));
  await phone.store.save(session("guest", "2026-10-03T10:00:00.000Z"));
  const again = loadDevice(indexedDB);
  assert.deepEqual(
    plain(await again.store.list()).map((take) => take.id),
    ["guest", "other", "mine"],
  );
  assert.equal((await again.store.get("mine")).id, "mine");
  await again.store.remove("other");
  assert.deepEqual(
    plain(await again.store.list()).map((take) => take.id),
    ["guest", "mine"],
  );
  assert.equal(again.fetchCalls.length, 0);
});

test("migration moves the account's cleared levels into pathProgress and drops both flags", async () => {
  const indexedDB = new FakeIndexedDB();
  await loadDevice(indexedDB).store.markLevelCleared("pace-1", "2026-10-02T08:00:00.000Z");
  await leaveOldAccount(
    indexedDB,
    { "fillers-1": "2026-10-01T08:00:00.000Z", "pace-1": "2026-10-03T08:00:00.000Z" },
    { "restarts-1": "2026-10-04T08:00:00.000Z" },
  );
  const phone = loadDevice(indexedDB);
  assert.equal(await phone.store.getFlag("signedInAccount"), undefined);
  assert.equal(await phone.store.getFlag("accountSync"), undefined);
  assert.equal(await phone.store.getFlag("onboarded"), true);
  assert.deepEqual(plain(await phone.store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: "2026-10-01T08:00:00.000Z" },
    { levelId: "pace-1", clearedAt: "2026-10-02T08:00:00.000Z" },
    { levelId: "restarts-1", clearedAt: "2026-10-04T08:00:00.000Z" },
  ]);
  assert.ok(!JSON.stringify([...indexedDB.store("flags").records.values()]).includes(EMAIL));
});

test("migration keeps a level's earliest clearing and runs again harmlessly", async () => {
  const indexedDB = new FakeIndexedDB();
  const device = loadDevice(indexedDB);
  await device.store.markLevelCleared("pace-1", "2026-10-05T08:00:00.000Z");
  await leaveOldAccount(indexedDB, { "pace-1": "2026-10-01T08:00:00.000Z" });
  const phone = loadDevice(indexedDB);
  const expected = [{ levelId: "pace-1", clearedAt: "2026-10-01T08:00:00.000Z" }];
  assert.deepEqual(plain(await phone.store.listClearedLevels()), expected);
  const later = loadDevice(indexedDB);
  assert.deepEqual(plain(await later.store.listClearedLevels()), expected);
});
