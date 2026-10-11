// Tests for the upload deadline in frontend/api.js: a request still open after three minutes is
// aborted and rejects as kind "network", like a server that cannot be reached. api.js runs in a
// vm context with a fake clock, Node's AbortController and a fetch that never answers on its own
// but, like a real fetch, rejects when its signal aborts.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8");

const DEADLINE_MS = 180000;
const MESSAGES = {
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
};
const BLOB = { size: 1234, type: "audio/webm" };
// Without a deadline in api.js the stalled requests below would never settle: each test fails
// after two real seconds instead of hanging the run.
const FAIL_FAST = { timeout: 2000 };

class FakeFormData {
  append() {}
}

// setTimeout and clearTimeout on a clock that moves only when a test calls advance(ms).
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (callback, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, at: now + ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    pending: () => timers.size,
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

// Settles with an AbortError once `signal` aborts, and never otherwise.
function untilAborted(signal) {
  return new Promise((resolve, reject) => {
    if (signal) {
      signal.addEventListener("abort", () => reject(abortError()));
    }
  });
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  };
}

// Runs api.js with the given fetch and globals; `globals` may leave out AbortController or the
// timers. Returns app.api and a log of every fetch call.
function loadApi(fetchImpl, globals) {
  const calls = [];
  const context = {
    app: {},
    FormData: FakeFormData,
    fetch: (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    ...globals,
  };
  vm.runInNewContext(API_SOURCE, context, { filename: "api.js" });
  return { api: context.app.api, calls };
}

function withClock(clock) {
  return { AbortController, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
}

// Lets every pending promise callback run.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Starts analyze() and records how it ends: "pending" until it settles, then "resolved" or the
// rejection itself.
function track(api) {
  const tracked = { outcome: "pending" };
  tracked.done = api.analyze(BLOB, "audio/webm").then(
    () => {
      tracked.outcome = "resolved";
    },
    (error) => {
      tracked.outcome = error;
    },
  );
  return tracked;
}

test("an upload open past three minutes rejects as kind 'network'", FAIL_FAST, async () => {
  const clock = fakeClock();
  const { api, calls } = loadApi((url, init) => untilAborted(init.signal), withClock(clock));
  const upload = track(api);
  await settle();
  assert.equal(calls.length, 1);
  const signal = calls[0].init.signal;
  assert.ok(signal, "the request carries an abort signal");
  assert.equal(signal.aborted, false);

  clock.advance(DEADLINE_MS - 1);
  await settle();
  assert.equal(upload.outcome, "pending", "a millisecond before the deadline it is still open");
  assert.equal(signal.aborted, false);

  clock.advance(1);
  await upload.done;
  assert.equal(signal.aborted, true);
  assert.equal(upload.outcome.kind, "network");
  assert.equal(upload.outcome.message, MESSAGES.network);
  assert.equal(clock.pending(), 0);
});

test("a reply stalled after its headers rejects as 'network' too", FAIL_FAST, async () => {
  const clock = fakeClock();
  const stalledReply = (url, init) =>
    Promise.resolve({ ok: true, status: 200, json: () => untilAborted(init.signal) });
  const { api } = loadApi(stalledReply, withClock(clock));
  const upload = track(api);
  await settle();
  assert.equal(upload.outcome, "pending");

  clock.advance(DEADLINE_MS);
  await upload.done;
  assert.equal(upload.outcome.kind, "network");
  assert.equal(upload.outcome.message, MESSAGES.network);
});

test("a reply in time resolves as before and clears the deadline", FAIL_FAST, async () => {
  const clock = fakeClock();
  const payload = { transcript: [{ text: "hello", start: 0.1, end: 0.5 }], metrics: {} };
  const { api } = loadApi(() => Promise.resolve(fakeResponse(200, payload)), withClock(clock));
  const result = await api.analyze(BLOB, "audio/webm");
  assert.deepEqual(result, payload);
  assert.equal(clock.pending(), 0, "no deadline is left running");
});

test("every failure keeps its kind and clears the deadline", FAIL_FAST, async () => {
  const cases = [
    ["a rejected fetch", () => Promise.reject(new TypeError("Failed to fetch")), "network"],
    ["status 400", () => Promise.resolve(fakeResponse(400, { detail: "x" })), "too_short"],
    ["status 502", () => Promise.resolve(fakeResponse(502, { detail: "x" })), "provider"],
    ["status 500", () => Promise.resolve(fakeResponse(500, { detail: "x" })), "unknown"],
    ["a body that is not JSON", () => Promise.resolve(fakeResponse(200, new SyntaxError("<"))),
      "unknown"],
  ];
  for (const [what, fetchImpl, kind] of cases) {
    const clock = fakeClock();
    const { api } = loadApi(fetchImpl, withClock(clock));
    await assert.rejects(api.analyze(BLOB, "audio/webm"), { kind }, what);
    assert.equal(clock.pending(), 0, what + " leaves no deadline running");
  }
});

test("without AbortController or timers there is no deadline", FAIL_FAST, async () => {
  const clock = fakeClock();
  const partial = {
    "no AbortController": { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    "no setTimeout": { AbortController, clearTimeout: clock.clearTimeout },
    "no clearTimeout": { AbortController, setTimeout: clock.setTimeout },
  };
  for (const [what, globals] of Object.entries(partial)) {
    const { api, calls } = loadApi(() => Promise.resolve(fakeResponse(200, {})), globals);
    await api.analyze(BLOB, "audio/webm");
    assert.equal(calls.length, 1, what);
    assert.equal(calls[0].init.signal, undefined, what);
    assert.equal(clock.pending(), 0, what + " starts no timer");
  }
});
