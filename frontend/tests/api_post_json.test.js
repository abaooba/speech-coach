// Tests for app.api.postJson in frontend/api.js: one JSON POST that resolves {status, body} and
// never rejects. api.js runs in a vm context with fake fetch and timers; nothing touches the
// network.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8");
const DEADLINE_MS = 20000;

function load(fetchImpl, globals) {
  const calls = [];
  const context = {
    app: {},
    FormData: class {},
    fetch: (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    ...(globals || {}),
  };
  vm.runInNewContext(API_SOURCE, context, { filename: "api.js" });
  return { api: context.app.api, calls };
}

function reply(status, body) {
  return { status, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) };
}

test("postJson sends the body as JSON and resolves {status, body}", async () => {
  const { api, calls } = load(() => Promise.resolve(reply(200, { ok: true })));
  const result = await api.postJson("/api/advice", { a: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 200, body: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/advice");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
});

test("postJson hands back an error status with its body", async () => {
  const { api } = load(() => Promise.resolve(reply(422, { detail: "bad" })));
  const result = await api.postJson("/x", {});
  assert.equal(result.status, 422);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), { detail: "bad" });
});

test("a network failure resolves {status: 0, body: null}", async () => {
  const { api } = load(() => Promise.reject(new Error("offline")));
  const result = await api.postJson("/x", {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 0, body: null });
});

test("a reply that is not JSON resolves its status with a null body", async () => {
  const { api } = load(() => Promise.resolve(reply(502, new Error("not json"))));
  const result = await api.postJson("/x", {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 502, body: null });
});

test("a request still open after 20 seconds is aborted and gives {status: 0, body: null}", async () => {
  const timers = [];
  const globals = {
    AbortController,
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
  };
  const { api } = load(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    globals,
  );
  const pending = api.postJson("/x", {});
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, DEADLINE_MS);
  timers[0].fn();
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { status: 0, body: null });
});
