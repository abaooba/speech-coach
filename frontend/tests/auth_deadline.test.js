// Tests for how long app.auth.request() and logOut() wait (frontend/auth.js, docs/PLAN.md T49).
// A request gives up as "no reply" when the server says nothing for 20 seconds, but a reply whose
// body keeps arriving is read whole however long it takes (a signed-in list carries every take),
// and a request that sends a big body (an import is up to 2 MB) gets time to send it on a slow
// uplink. Log out sends the queue first but waits for it 10 seconds at most. The realm gets a
// fake clock, Node's AbortController and streams, and a fetch whose replies a test writes part by
// part, as a slow network delivers them.
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

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
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

// A fetch whose every call waits for the test: respond(status) sends the headers, then write(text)
// and end() send the body. Aborting the call's signal fails it, before or after the headers, as
// a browser's fetch does.
function slowNetwork() {
  const calls = [];
  const encoder = new TextEncoder();
  const fetch = (url, init = {}) =>
    new Promise((resolve, reject) => {
      const call = { url, init, body: null };
      calls.push(call);
      const abort = () => {
        const error = new DOMException("The operation was aborted.", "AbortError");
        reject(error);
        if (call.body !== null) {
          call.body.error(error);
        }
      };
      if (init.signal) {
        init.signal.addEventListener("abort", abort);
      }
      call.respond = (status) => {
        const stream = new ReadableStream({
          start(controller) {
            call.body = controller;
          },
        });
        resolve(new Response(stream, { status, headers: { "Content-Type": "application/json" } }));
      };
      call.write = (text) => call.body.enqueue(encoder.encode(text));
      call.end = () => call.body.close();
    });
  return { fetch, calls };
}

function loadAuth(fetch, clock) {
  const context = {
    app: {},
    fetch,
    AbortController,
    TextDecoder,
    TextEncoder,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  return context.app.auth;
}

// Records the answer of `promise` once it settles, so a test can look before then.
async function watch(promise) {
  const watched = { done: false, value: undefined };
  promise.then((value) => {
    watched.done = true;
    watched.value = value;
  });
  await settle();
  return watched;
}

test("a reply whose body keeps arriving is read whole, however long it takes", async () => {
  const clock = fakeClock();
  const network = slowNetwork();
  const auth = loadAuth(network.fetch, clock);
  const reply = await watch(auth.request("GET", "/api/sessions"));
  const [call] = network.calls;
  call.respond(200);
  await settle();

  for (const part of ['[{"id":"a"}', ',{"id":"b"}', ',{"id":"c"}', "]"]) {
    await clock.advance(15000);
    call.write(part);
    await settle();
  }
  assert.equal(reply.done, false, "a minute in, the body is still arriving");
  call.end();
  await settle();

  assert.deepEqual(plain(reply.value), { status: 200, body: [{ id: "a" }, { id: "b" }, { id: "c" }] });
});

test("a reply that stops arriving for 20 seconds is cut short", async () => {
  const clock = fakeClock();
  const network = slowNetwork();
  const auth = loadAuth(network.fetch, clock);
  const reply = await watch(auth.request("GET", "/api/sessions"));
  const [call] = network.calls;
  await clock.advance(5000);
  call.respond(200);
  call.write('[{"id":"a"}');
  await settle();

  await clock.advance(19999);
  assert.equal(reply.done, false);
  await clock.advance(1);

  assert.deepEqual(plain(reply.value), { status: 200, body: null });
});

test("a server that sends nothing for 20 seconds reads as no reply", async () => {
  const clock = fakeClock();
  const network = slowNetwork();
  const auth = loadAuth(network.fetch, clock);
  const reply = await watch(auth.request("GET", "/api/me"));

  await clock.advance(19999);
  assert.equal(reply.done, false);
  await clock.advance(1);

  assert.deepEqual(plain(reply.value), { status: 0, body: null });
});

test("a request that sends a big body gets time to send it on a slow uplink", async () => {
  const clock = fakeClock();
  const network = slowNetwork();
  const auth = loadAuth(network.fetch, clock);
  // An import batch near its 1.9 MB cap: at 64 kbit/s it takes about four minutes to send.
  const batch = { sessions: [{ id: "big", transcript: "x".repeat(1900000) }] };
  const reply = await watch(auth.request("POST", "/api/sessions/import", batch));

  await clock.advance(20000);
  assert.equal(reply.done, false, "not cut off at 20 seconds");
  await clock.advance(200000);
  assert.equal(reply.done, false, "still sending at 220 seconds");
  await clock.advance(60000);

  assert.deepEqual(plain(reply.value), { status: 0, body: null });
});

test("log out waits for the queue 10 seconds at most, and the rest waits for the next sign in", async () => {
  const clock = fakeClock();
  const server = new FakeAccountServer();
  const context = {
    app: {},
    indexedDB: new FakeIndexedDB(),
    fetch: server.browser().fetch,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  const { auth, store } = context.app;
  await auth.signUp(ANN, PASSWORD);
  await settle();
  // The take's upload hangs, as on a weak connection.
  let releaseUpload;
  const upload = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  server.beforeAnswer = (sent) => (sent.path === "/api/sessions" ? upload : null);
  await store.save({
    id: "take-1",
    createdAt: "2026-10-12T09:30:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [],
  });

  const loggingOut = await watch(auth.logOut());
  await clock.advance(9999);
  assert.equal(loggingOut.done, false, "it gives the queue a chance first");
  await clock.advance(1);
  await settle();

  assert.equal(loggingOut.done, true);
  assert.equal(await auth.account(), null);
  assert.ok(server.requests.some((sent) => sent.path === "/api/auth/logout"));
  // The upload's answer comes after the log out (a 401 here) and changes nothing on the device:
  // the take waits in the account's queue and goes up when it signs in again.
  server.beforeAnswer = null;
  releaseUpload();
  await settle();
  assert.equal(await auth.account(), null);
  assert.deepEqual(server.takesOf(ANN), []);
  await auth.logIn(ANN, PASSWORD);
  await settle();
  assert.deepEqual(
    server.takesOf(ANN).map((take) => take.id),
    ["take-1"],
  );
});
