// Tests for the two session fields the Loop Path adds to frontend/store.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 6): `topic`, the Talk topic on screen
// when the take was recorded (or null), and `path`, a Path take's {play, kind, take, scored,
// passed, stage, inRoom}, absent on a plain take. Both are kept on the device. Audio is still
// never stored. Each device is store.js in a fresh vm realm over a fake IndexedDB.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeIndexedDB } = require("./fake-indexeddb");

const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const T1 = "2026-10-14T08:00:00.123Z";
const T2 = "2026-10-14T09:30:00.000Z";
const TOPIC = "Argue for or against school uniforms, with two clear reasons.";
const LOOP_TAKE = {
  play: "fillers-3",
  kind: "loop",
  take: 2,
  scored: true,
  passed: true,
  stage: null,
  inRoom: null,
};
const SEVEN_FIELDS = [
  "createdAt",
  "durationSeconds",
  "id",
  "metrics",
  "passageId",
  "passageTitle",
  "transcript",
];

function loadDevice(options = {}) {
  const indexedDB = options.indexedDB || new FakeIndexedDB();
  const context = { app: {}, indexedDB, window: { addEventListener: () => {} } };
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { app: context.app, store: context.app.store, indexedDB };
}

// Objects built inside a vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function session(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 90,
    metrics: { words_per_minute: 150, fillers: { um: 3 }, pauses: [] },
    transcript: [{ text: "Uniforms", start: 0.4, end: 0.9 }],
    ...overrides,
  };
}

test("a take keeps its Talk topic and its Path fields", async () => {
  const device = loadDevice();
  const saved = session("take-1", T1, { topic: TOPIC, path: LOOP_TAKE });
  await device.store.save({ ...saved });
  assert.deepEqual(plain(await device.store.get("take-1")), saved);
  assert.deepEqual(plain(device.indexedDB.store("sessions").records.get("take-1")), saved);
  assert.deepEqual(plain(await device.store.list()), [saved]);
});

test("a plain take stores no path, and a topic of null stays null", async () => {
  const device = loadDevice();
  await device.store.save(session("plain", T1, { extra: "nope" }));
  assert.deepEqual(Object.keys(await device.store.get("plain")).sort(), SEVEN_FIELDS);
  await device.store.save(session("no-topic", T2, { topic: null }));
  const stored = await device.store.get("no-topic");
  assert.equal(stored.topic, null);
  assert.ok(!("path" in stored), "no path on a plain take");
  assert.deepEqual(Object.keys(stored).sort(), [...SEVEN_FIELDS, "topic"].sort());
});

test("a Path take carries no audio either", async () => {
  const device = loadDevice();
  for (const field of ["blob", "audio"]) {
    const take = session("with-" + field, T1, { path: LOOP_TAKE, [field]: { size: 10 } });
    await assert.rejects(device.store.save(take), new RegExp(field));
  }
  assert.deepEqual(plain(await device.store.list()), []);
});
