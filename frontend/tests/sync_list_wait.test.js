// Tests for how long a signed-in list waits for the server (frontend/store.js, docs/PLAN.md T49).
// History, Progress and Results draw from app.store.list() and show what they had before until it
// resolves, so a list on a slow network answers with this device's copy after LIST_WAIT_MS (one
// second) while the server's list still comes in behind it. A device that has never listed the
// account has no copy to show and waits up to 20 seconds. Lists asked for meanwhile share one
// request. The realm gets a fake clock (setTimeout and clearTimeout) moved on by hand.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeIndexedDB } = require("./fake-indexeddb");
const { FakeAccountServer, serverMoment } = require("./fake-account-server");

const AUTH_SOURCE = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const ANN = "ann@example.com";
const PASSWORD = "correct horse battery staple";
const T1 = "2026-10-11T08:00:00.123Z";
const T2 = "2026-10-12T09:30:00.000Z";

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// setTimeout and clearTimeout for the realm, on a clock that moves only when advance() is called.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + (ms || 0), callback });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    // Moves the clock on by `ms`, firing each timer that falls due on the way, in order.
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) {
          break;
        }
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        await settle();
      }
      now = until;
      await settle();
    },
  };
}

function loadDevice(server, clock) {
  const indexedDB = new FakeIndexedDB();
  const browser = server.browser();
  const context = {
    app: {},
    indexedDB,
    fetch: browser.fetch,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { store: context.app.store, auth: context.app.auth, indexedDB };
}

function session(id, createdAt) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [{ text: "Hello", start: 0.4, end: 0.8 }],
  };
}

function wireTake(saved) {
  return {
    id: saved.id,
    created_at: serverMoment(saved.createdAt),
    report: {
      passageId: saved.passageId,
      passageTitle: saved.passageTitle,
      durationSeconds: saved.durationSeconds,
      metrics: saved.metrics,
    },
    transcript: saved.transcript,
  };
}

function idsOf(sessions) {
  return Array.from(sessions, (saved) => saved.id);
}

function storedIds(device) {
  return [...device.indexedDB.store("sessions").records.keys()].sort();
}

// A promise held open until release() is called, to hold a reply back.
function held() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function holdListReplies(server) {
  const reply = held();
  server.beforeReply = (sent) => (sent.method === "GET" ? reply.promise : null);
  return () => {
    server.beforeReply = null;
    reply.release();
  };
}

// Records the answer of `promise` once it settles, so a test can look before then. Resolves
// once the list has read IndexedDB and is waiting on the server, its timer set, so the clock
// moves from there.
async function watch(promise) {
  const watched = { done: false, value: undefined };
  promise.then((value) => {
    watched.done = true;
    watched.value = value;
  });
  await settle();
  return watched;
}

test("a slow list shows this device's copy after a second, and the server's lands behind it", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const phone = loadDevice(server, clock);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await settle();
  assert.deepEqual(idsOf(await phone.store.list()), ["take-1"]);
  server.keep(ANN, wireTake(session("from-laptop", T2)));
  const release = holdListReplies(server);

  const listing = await watch(phone.store.list());
  await clock.advance(999);
  assert.equal(listing.done, false, "it waits for the server up to a second");
  await clock.advance(1);

  assert.equal(listing.done, true);
  assert.deepEqual(idsOf(listing.value), ["take-1"]);
  release();
  await settle();
  assert.deepEqual(storedIds(phone), ["from-laptop", "take-1"], "the server's list lands");
  assert.deepEqual(idsOf(await phone.store.list()), ["from-laptop", "take-1"]);
});

test("get finds a take kept here at once, whatever the server is doing", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const phone = loadDevice(server, clock);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await settle();
  await phone.store.list();
  holdListReplies(server);

  assert.equal((await phone.store.get("take-1")).id, "take-1");
});

test("a device that has never listed the account waits for the server's list", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const phone = loadDevice(server, clock);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await settle();
  const laptop = loadDevice(server, clock);
  await laptop.auth.logIn(ANN, PASSWORD);
  const release = holdListReplies(server);

  const listing = await watch(laptop.store.list());
  await clock.advance(19999);
  assert.equal(listing.done, false, "a new device has no copy to show yet");
  release();
  await settle();

  assert.deepEqual(idsOf(listing.value), ["take-1"]);
});

test("a first list that gets no answer in 20 seconds shows what the device has", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const laptop = loadDevice(server, clock);
  server.addUser(ANN, PASSWORD);
  await laptop.auth.logIn(ANN, PASSWORD);
  holdListReplies(server);

  const listing = await watch(laptop.store.list());
  await clock.advance(20000);

  assert.equal(listing.done, true);
  assert.deepEqual(idsOf(listing.value), []);
});

test("lists asked for while one is on its way share its request", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const phone = loadDevice(server, clock);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await settle();
  const release = holdListReplies(server);
  const before = server.requests.filter((sent) => sent.method === "GET").length;

  const first = phone.store.list();
  const second = phone.store.list();
  const third = phone.store.get("not-here");
  await settle();
  release();

  assert.deepEqual(idsOf(await first), ["take-1"]);
  assert.deepEqual(idsOf(await second), ["take-1"]);
  assert.equal(await third, undefined);
  const gets = server.requests.filter((sent) => sent.method === "GET").length - before;
  assert.equal(gets, 1);
});

test("a 401 that arrives after the wait still signs the device out", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const phone = loadDevice(server, clock);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await settle();
  await phone.store.list();
  // The list waits before the server reads it, so the server answers after the session ends.
  const answer = held();
  server.beforeAnswer = (sent) => (sent.method === "GET" ? answer.promise : null);
  const listing = await watch(phone.store.list());
  await clock.advance(1000);
  assert.deepEqual(idsOf(listing.value), ["take-1"]);

  server.endSessions(ANN);
  server.beforeAnswer = null;
  answer.release();
  await settle();

  assert.equal(await phone.auth.account(), null);
  assert.deepEqual(idsOf(await phone.store.list()), ["take-1"]);
});
