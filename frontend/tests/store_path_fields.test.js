// Tests for the two session fields the Loop Path adds to frontend/store.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 6): `topic`, the Talk topic on screen
// when the take was recorded (or null), and `path`, a Path take's {play, kind, take, scored,
// passed, stage, inRoom}, absent on a plain take. Both are kept on the device and, for a
// signed-in speaker, in the server's report, so they sync. Audio is still never stored. Each
// device is auth.js then store.js in a fresh vm realm over a fake IndexedDB and one browser of
// the fake account server (fake-account-server.js), as sync.test.js loads them.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeIndexedDB } = require("./fake-indexeddb");
const { FakeAccountServer } = require("./fake-account-server");

const AUTH_SOURCE = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const ANN = "ann@example.com";
const PASSWORD = "correct horse battery staple";
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

function loadDevice(server, options = {}) {
  const indexedDB = options.indexedDB || new FakeIndexedDB();
  const listeners = {};
  const fakeWindow = {
    addEventListener: (type, handler) => {
      listeners[type] = [...(listeners[type] || []), handler];
    },
  };
  const browser = server.browser();
  const context = { app: {}, indexedDB, fetch: browser.fetch, window: fakeWindow };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { app: context.app, store: context.app.store, auth: context.app.auth, indexedDB };
}

// The fakes answer on microtasks only, so one turn of the event loop lets every queued write,
// reply and IndexedDB request run to its end.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
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

async function signedUpDevice(server) {
  const device = loadDevice(server);
  await device.auth.signUp(ANN, PASSWORD);
  await settle();
  return device;
}

test("a take keeps its Talk topic and its Path fields", async () => {
  const device = loadDevice(new FakeAccountServer());
  const saved = session("take-1", T1, { topic: TOPIC, path: LOOP_TAKE });
  await device.store.save({ ...saved });
  assert.deepEqual(plain(await device.store.get("take-1")), saved);
  assert.deepEqual(plain(device.indexedDB.store("sessions").records.get("take-1")), saved);
  assert.deepEqual(plain(await device.store.list()), [saved]);
});

test("a plain take stores no path, and a topic of null stays null", async () => {
  const device = loadDevice(new FakeAccountServer());
  await device.store.save(session("plain", T1, { extra: "nope" }));
  assert.deepEqual(Object.keys(await device.store.get("plain")).sort(), SEVEN_FIELDS);
  await device.store.save(session("no-topic", T2, { topic: null }));
  const stored = await device.store.get("no-topic");
  assert.equal(stored.topic, null);
  assert.ok(!("path" in stored), "no path on a plain take");
  assert.deepEqual(Object.keys(stored).sort(), [...SEVEN_FIELDS, "topic"].sort());
});

test("a Path take carries no audio either", async () => {
  const device = loadDevice(new FakeAccountServer());
  for (const field of ["blob", "audio"]) {
    const take = session("with-" + field, T1, { path: LOOP_TAKE, [field]: { size: 10 } });
    await assert.rejects(device.store.save(take), new RegExp(field));
  }
  assert.deepEqual(plain(await device.store.list()), []);
});

test("signed in, the topic and Path fields go to the server in the take's report", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  const saved = session("take-1", T1, { topic: TOPIC, path: LOOP_TAKE });
  await device.store.save({ ...saved });
  await settle();
  const sent = server.requests.filter(
    (request) => request.method === "POST" && request.path === "/api/sessions",
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.report, {
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 90,
    metrics: saved.metrics,
    topic: TOPIC,
    path: LOOP_TAKE,
  });
});

test("a plain take's report on the server stays as it was: no topic, no path", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("plain", T1));
  await settle();
  const [take] = server.takesOf(ANN);
  assert.deepEqual(Object.keys(take.report).sort(), [
    "durationSeconds",
    "metrics",
    "passageId",
    "passageTitle",
  ]);
});

test("a take saved on one device lists on another with its topic and Path fields", async () => {
  const server = new FakeAccountServer();
  const phone = await signedUpDevice(server);
  const checkback = {
    play: "restarts-2_checkback",
    kind: "checkback",
    take: 1,
    scored: true,
    passed: false,
    stage: 2,
    inRoom: null,
  };
  const first = session("take-1", T1, { topic: TOPIC, path: LOOP_TAKE });
  const second = session("take-2", T2, {
    passageId: "cold-read-zoos",
    topic: null,
    path: checkback,
  });
  await phone.store.save({ ...first });
  await phone.store.save({ ...second });
  await settle();

  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  assert.deepEqual(plain(await laptop.store.list()), [second, first]);
  assert.deepEqual(plain(await laptop.store.get("take-1")), first);
});
