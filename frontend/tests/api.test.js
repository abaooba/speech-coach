// Tests for frontend/api.js (app.api). The module is loaded with vm.runInNewContext so that
// `app`, `fetch` and `FormData` are injected fakes; nothing touches the network.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8");

const MESSAGES = {
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
};

class FakeFormData {
  constructor() {
    this.entries = [];
  }

  append(name, value, filename) {
    this.entries.push({ name, value, filename });
  }
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  };
}

// Returns app.api plus a log of every fetch call the module made.
function loadApi(fetchImpl) {
  const calls = [];
  const context = {
    app: {},
    FormData: FakeFormData,
    fetch: (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
  };
  vm.runInNewContext(API_SOURCE, context, { filename: "api.js" });
  return { api: context.app.api, app: context.app, calls };
}

// The module runs in another realm, so `instanceof Error` cannot be used across the boundary.
function isErrorObject(value) {
  return Object.prototype.toString.call(value) === "[object Error]";
}

const BLOB = { size: 1234, type: "audio/webm" };

test("api.js assigns exactly app.api with analyze and messages", () => {
  const { app, api } = loadApi(() => Promise.reject(new Error("unused")));
  assert.deepEqual(Object.keys(app), ["api"]);
  assert.deepEqual(Object.keys(api).sort(), ["analyze", "messages"]);
  assert.equal(typeof api.analyze, "function");
});

test("messages holds exactly the three fixed sentences and is frozen", () => {
  const { api } = loadApi(() => Promise.reject(new Error("unused")));
  assert.deepEqual(Object.keys(api.messages).sort(), ["network", "provider", "too_short"]);
  assert.equal(api.messages.network, MESSAGES.network);
  assert.equal(api.messages.too_short, MESSAGES.too_short);
  assert.equal(api.messages.provider, MESSAGES.provider);
  assert.ok(Object.isFrozen(api.messages));
});

test("analyze posts the blob as multipart field 'audio' and returns the parsed JSON", async () => {
  const payload = {
    transcript: [{ text: "hello", start: 0.1, end: 0.5 }],
    metrics: { words_per_minute: 150 },
  };
  const { api, calls } = loadApi(() => Promise.resolve(fakeResponse(200, payload)));

  const result = await api.analyze(BLOB, "audio/webm;codecs=opus");

  assert.deepEqual(result, payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/analyze");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.body instanceof FakeFormData);
  assert.deepEqual(calls[0].init.body.entries, [
    { name: "audio", value: BLOB, filename: "recording.webm" },
  ]);
});

test("analyze picks the filename extension from the content type", async () => {
  const cases = [
    ["audio/webm;codecs=opus", "recording.webm"],
    ["audio/mp4", "recording.mp4"],
    ["audio/ogg;codecs=opus", "recording.ogg"],
    ["audio/x-unknown", "recording.webm"],
    [undefined, "recording.webm"],
    ["", "recording.webm"],
  ];
  for (const [contentType, filename] of cases) {
    const { api, calls } = loadApi(() => Promise.resolve(fakeResponse(200, {})));
    await api.analyze(BLOB, contentType);
    assert.equal(calls[0].init.body.entries[0].filename, filename, `for ${contentType}`);
  }
});

test("a rejected fetch becomes kind 'network'", async () => {
  const { api } = loadApi(() => Promise.reject(new TypeError("Failed to fetch")));
  const error = await api.analyze(BLOB, "audio/webm").then(
    () => assert.fail("expected rejection"),
    (rejection) => rejection,
  );
  assert.ok(isErrorObject(error));
  assert.equal(error.kind, "network");
  assert.equal(error.message, MESSAGES.network);
});

test("status 400 becomes kind 'too_short'", async () => {
  const { api } = loadApi(() => Promise.resolve(fakeResponse(400, { detail: "too short" })));
  await assert.rejects(api.analyze(BLOB, "audio/webm"), {
    kind: "too_short",
    message: MESSAGES.too_short,
  });
});

test("status 502 becomes kind 'provider'", async () => {
  const { api } = loadApi(() => Promise.resolve(fakeResponse(502, { detail: "provider down" })));
  await assert.rejects(api.analyze(BLOB, "audio/webm"), {
    kind: "provider",
    message: MESSAGES.provider,
  });
});

test("any other failing status becomes kind 'unknown' with the provider message", async () => {
  for (const status of [422, 500, 503]) {
    const { api } = loadApi(() => Promise.resolve(fakeResponse(status, { detail: "x" })));
    await assert.rejects(api.analyze(BLOB, "audio/webm"), {
      kind: "unknown",
      message: MESSAGES.provider,
    });
  }
});

test("a 200 whose body is not JSON becomes kind 'unknown' with the provider message", async () => {
  const { api } = loadApi(() =>
    Promise.resolve(fakeResponse(200, new SyntaxError("Unexpected token <"))),
  );
  const error = await api.analyze(BLOB, "audio/webm").then(
    () => assert.fail("expected rejection"),
    (rejection) => rejection,
  );
  assert.ok(isErrorObject(error));
  assert.equal(error.kind, "unknown");
  assert.equal(error.message, MESSAGES.provider);
});
