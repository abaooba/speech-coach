// Tests for the "See a sample result" button on the Practice screen (frontend/screens/practice.js).
// practice.js and the real ui.js run in a vm context with the shared fake DOM, a fake fetch,
// a fake store that records save calls and a router that records go calls.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { FakeElement, fakeDocument, byClass } = require("./fake-dom.js");

const PRACTICE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "practice.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

const PASSAGES = [{ id: "a", kind: "passage", title: "A", text: "x", targetWpm: [140, 160] }];
const GOOD_FILE = {
  passageId: "free-talk",
  passageTitle: "Sample: Free talk",
  durationSeconds: 48.2,
  metrics: { pauses: [] },
  transcript: [{ text: "We", start: 0.4, end: 0.6 }],
};
const ERROR_TITLE = "Sample unavailable";
const ERROR_BODY = "Could not load the sample. Try again.";

function okResponse(file) {
  return { ok: true, json: () => file };
}

// Mounts Practice with a fake fetch. `fetchImpl` receives the URL and returns a promise.
function mountWithFetch(fetchImpl) {
  const saves = [];
  const routes = [];
  const fetchCalls = [];
  const context = {
    app: {
      screens: {},
      ui: {},
      api: { messages: {} },
      passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
      store: {
        save: async (session) => {
          saves.push(session);
          return "sample-1";
        },
      },
      router: { go: (name, params) => routes.push({ name, params }) },
    },
    document: fakeDocument(),
    fetch: (url) => {
      fetchCalls.push(url);
      return fetchImpl(url);
    },
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = new FakeElement("section");
  root.dataset.state = "idle";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.practice.mount(root);

  const hint = byClass(body, "practice__hint");
  return {
    practice: context.app.screens.practice,
    root,
    hint,
    button: byClass(hint, "practice__sample"),
    stateEl: byClass(body, "practice__state"),
    saves,
    routes,
    fetchCalls,
  };
}

// Lets every pending promise callback run.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function assertSampleError(parts) {
  assert.equal(parts.root.dataset.state, "error");
  const block = byClass(parts.stateEl, "state--error");
  assert.ok(block, "the error block is shown");
  const [, title, body, action] = block.children;
  assert.equal(title.textContent, ERROR_TITLE);
  assert.equal(body.textContent, ERROR_BODY);
  assert.equal(action.children[0].textContent, "Try again");
  return action;
}

test("the sample button sits inside the hint, is a ghost button and is labeled", () => {
  const parts = mountWithFetch(() => new Promise(() => {}));
  assert.ok(parts.button, "button exists inside .practice__hint");
  assert.equal(parts.button.tagName, "button");
  assert.equal(parts.button.getAttribute("type"), "button");
  assert.ok(parts.button.classList.contains("btn"));
  assert.ok(parts.button.classList.contains("btn--ghost"));
  assert.equal(parts.button.textContent, "See a sample result");
});

test("a good file saves exactly the five fields once and routes to results", async () => {
  const parts = mountWithFetch(async () => okResponse({ ...GOOD_FILE, extra: "dropped" }));
  parts.button.click();
  await flush();
  assert.deepEqual(parts.fetchCalls, ["sample-session.json"]);
  assert.equal(parts.saves.length, 1);
  assert.deepEqual(Object.keys(parts.saves[0]).sort(), Object.keys(GOOD_FILE).sort());
  assert.equal(parts.saves[0].passageId, "free-talk");
  assert.equal(parts.saves[0].passageTitle, "Sample: Free talk");
  assert.equal(parts.saves[0].durationSeconds, 48.2);
  assert.equal(parts.saves[0].transcript[0].text, "We");
  assert.equal(parts.routes.length, 1);
  assert.equal(parts.routes[0].name, "results");
  assert.equal(parts.routes[0].params.id, "sample-1");
});

test("a missing file (not ok) shows the error block", async () => {
  const parts = mountWithFetch(async () => ({ ok: false }));
  parts.button.click();
  await flush();
  assertSampleError(parts);
  assert.equal(parts.routes.length, 0);
});

test("a network failure shows the error block", async () => {
  const parts = mountWithFetch(() => Promise.reject(new Error("offline")));
  parts.button.click();
  await flush();
  assertSampleError(parts);
  assert.equal(parts.routes.length, 0);
});

test("a file without a transcript array shows the error block and saves nothing", async () => {
  const parts = mountWithFetch(async () => okResponse({ metrics: {} }));
  parts.button.click();
  await flush();
  assertSampleError(parts);
  assert.equal(parts.saves.length, 0);
});

test("a double tap while loading fetches once", async () => {
  const parts = mountWithFetch(() => new Promise(() => {}));
  parts.button.click();
  parts.button.click();
  await flush();
  assert.equal(parts.fetchCalls.length, 1);
});

test("Try again returns to idle, and a second tap fetches again", async () => {
  const parts = mountWithFetch(async () => ({ ok: false }));
  parts.button.click();
  await flush();
  const action = assertSampleError(parts);
  action.click();
  assert.equal(parts.root.dataset.state, "idle");
  assert.equal(parts.practice.state, "idle");
  parts.button.click();
  await flush();
  assert.equal(parts.fetchCalls.length, 2);
});

test("a failure that lands after Record was tapped leaves the recording alone", async () => {
  let rejectFetch = null;
  const parts = mountWithFetch(
    () =>
      new Promise((resolve, reject) => {
        rejectFetch = reject;
      }),
  );
  parts.button.click();
  parts.practice.render("recording");
  rejectFetch(new Error("offline"));
  await flush();
  assert.equal(parts.root.dataset.state, "recording");
  assert.equal(parts.practice.state, "recording");
  assert.equal(parts.routes.length, 0);
});
