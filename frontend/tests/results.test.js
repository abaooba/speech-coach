// Tests for frontend/screens/results.js (app.screens.results). summarize() runs with no
// `document` at all; mount/show run against the shared fake DOM with the real ui.js loaded into
// the same vm context, a fake app.store that serves sessions from a map, and a fake app.router
// that records where the action buttons send the user.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const RESULTS_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "results.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

// One known passage so the target range is read from app.passages, never hard-coded.
const PASSAGES = [{ id: "gettysburg", targetWpm: [130, 150] }];
const FALLBACK_TARGET = [140, 160];

const METRICS = {
  words_per_minute: 162.4,
  duration: 30,
  word_count: 81,
  fillers: { um: 6, uh: 3 },
  pauses: [
    [9.9, 2.2],
    [20, 1.6],
  ],
  repeats: [],
  pace_windows: [],
};

const CREATED_AT = "2026-10-09T22:21:00.000Z";

const EXPECTED_LABELS = [
  "Words per minute",
  "Fillers per minute",
  "Pauses over 1.5 s",
  "Longest pause",
];

function sessionWith(metricOverrides, sessionOverrides) {
  return {
    id: "s1",
    createdAt: CREATED_AT,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 31.2,
    metrics: { ...METRICS, ...(metricOverrides || {}) },
    transcript: [],
    ...(sessionOverrides || {}),
  };
}

function bareApp() {
  return {
    screens: {},
    passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
    ui: {},
    store: {},
    router: {},
  };
}

// Loads results.js with no document and a stub app.ui, exactly as the brief describes.
function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return { app: context.app, results: context.app.screens.results };
}

// Loads ui.js then results.js against the fake document with a store serving `sessions` by id,
// mounts into a fake section and hands back the body plus the recorded store and router calls.
function mountResults(sessions) {
  const document = fakeDocument();
  const calls = { gets: [], routes: [] };
  const context = { app: bareApp(), document };
  context.app.store.get = (id) => {
    calls.gets.push(id);
    return Promise.resolve(sessions[id]);
  };
  context.app.router.go = (name, params) => {
    calls.routes.push({ name, params });
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });

  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Results";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);

  const results = context.app.screens.results;
  results.mount(root);
  return { app: context.app, results, root, body, calls };
}

// What a browser's textContent would return: the node's own text followed by its children's.
function fullText(node) {
  const own = node.textContent || "";
  const children = node.children || [];
  return own + children.map(fullText).join("");
}

function cardsOf(body) {
  return byClass(body, "metric-grid").children;
}

test("results.js registers app.screens.results and touches no DOM at load time", () => {
  const { app, results } = loadPure();
  assert.deepEqual(Object.keys(app.screens), ["results"]);
  for (const name of ["mount", "show", "hide", "summarize"]) {
    assert.equal(typeof results[name], "function", `results.${name} should be a function`);
  }
});

test("summarize rounds the numbers and says Slow down above the passage target", () => {
  const { results } = loadPure();
  const summary = results.summarize(sessionWith());
  assert.equal(summary.wpm, 162);
  assert.equal(summary.fillersPerMinute, 18);
  assert.equal(summary.pauseCount, 2);
  assert.equal(summary.longestPause, 2.2);
  assert.deepEqual(Array.from(summary.target), [130, 150]);
  assert.equal(summary.paceHint.text, "Slow down");
  assert.equal(summary.paceHint.tone, "warn");
});

test("summarize builds 'Target lo to hi' from the passage when the pace is inside it", () => {
  const { results } = loadPure();
  const summary = results.summarize(sessionWith({ words_per_minute: 140 }));
  assert.equal(summary.wpm, 140);
  assert.equal(summary.paceHint.text, "Target 130 to 150");
  assert.equal(summary.paceHint.tone, "ok");
});

test("summarize treats both ends of the target as in range", () => {
  const { results } = loadPure();
  const low = results.summarize(sessionWith({ words_per_minute: 130 }));
  assert.deepEqual({ ...low.paceHint }, { text: "Target 130 to 150", tone: "ok" });
  const high = results.summarize(sessionWith({ words_per_minute: 150.4 }));
  assert.deepEqual({ ...high.paceHint }, { text: "Target 130 to 150", tone: "ok" });
});

test("summarize says Speed up below the target", () => {
  const { results } = loadPure();
  const summary = results.summarize(sessionWith({ words_per_minute: 120 }));
  assert.equal(summary.paceHint.text, "Speed up");
  assert.equal(summary.paceHint.tone, "warn");
});

test("summarize gives 0 fillers per minute when the duration is 0", () => {
  const { results } = loadPure();
  const summary = results.summarize(sessionWith({ duration: 0 }));
  assert.equal(summary.fillersPerMinute, 0);
});

test("summarize rounds fillers per minute and the longest pause to one decimal", () => {
  const { results } = loadPure();
  const summary = results.summarize(
    sessionWith({ duration: 45, fillers: { um: 2, like: 3 }, pauses: [[3, 1.66], [8, 1.51]] }),
  );
  // 5 fillers over 0.75 minutes is 6.666..., shown as 6.7.
  assert.equal(summary.fillersPerMinute, 6.7);
  assert.equal(summary.longestPause, 1.7);
  assert.equal(summary.pauseCount, 2);
});

test("summarize reports 0 pauses and a 0 longest pause when there are none", () => {
  const { results } = loadPure();
  const summary = results.summarize(sessionWith({ pauses: [] }));
  assert.equal(summary.pauseCount, 0);
  assert.equal(summary.longestPause, 0);
});

test("summarize falls back to 140 to 160 for an unknown passage", () => {
  const { results } = loadPure();
  const summary = results.summarize(
    sessionWith({ words_per_minute: 150 }, { passageId: "not-a-passage" }),
  );
  assert.deepEqual(Array.from(summary.target), FALLBACK_TARGET);
  assert.equal(summary.paceHint.text, "Target 140 to 160");
  assert.equal(summary.paceHint.tone, "ok");
});

test("summarize does not change the session it reads", () => {
  const { results } = loadPure();
  const session = sessionWith();
  const before = JSON.stringify(session);
  results.summarize(session);
  assert.equal(JSON.stringify(session), before);
});

test("show({id}) builds the meta line, four metric cards in order and two actions", async () => {
  const session = sessionWith();
  const { app, results, body } = mountResults({ s1: session });
  await results.show({ id: "s1" });

  assert.deepEqual(
    body.children.map((child) => child.className),
    ["results__meta num", "metric-grid", "results__actions"],
  );

  const meta = body.children[0];
  assert.equal(meta.tagName, "p");
  assert.equal(
    meta.textContent,
    "Gettysburg Address, opening · " + app.ui.formatDate(CREATED_AT),
  );

  const cards = cardsOf(body);
  assert.equal(cards.length, 4);
  cards.forEach((card) => {
    assert.equal(card.tagName, "div");
    assert.equal(card.className, "metric-card");
  });
  assert.deepEqual(
    cards.map((card) => byClass(card, "metric-card__label").textContent),
    EXPECTED_LABELS,
  );
  const values = cards.map((card) => byClass(card, "metric-card__value"));
  values.forEach((value) => assert.ok(value.classList.contains("num")));
  assert.deepEqual(values.map(fullText), ["162 wpm", "18 per min", "2", "2.2 s"]);
  assert.deepEqual(
    values.map((value) => {
      const unit = byClass(value, "metric-card__unit");
      return unit ? unit.textContent : null;
    }),
    ["wpm", "per min", null, "s"],
  );

  const hint = byClass(cards[0], "metric-card__hint");
  assert.equal(hint.textContent, "Slow down");
  assert.ok(hint.classList.contains("metric-card__hint--warn"));
  assert.ok(!hint.classList.contains("metric-card__hint--ok"));
  for (const card of cards.slice(1)) {
    assert.equal(byClass(card, "metric-card__hint"), undefined, "only the wpm card has a hint");
  }

  const actions = body.children[2];
  assert.deepEqual(
    actions.children.map((button) => [button.tagName, button.className, button.textContent]),
    [
      ["button", "btn btn--primary btn--block", "Record again"],
      ["button", "btn btn--secondary btn--block", "History"],
    ],
  );
  actions.children.forEach((button) => assert.equal(button.getAttribute("type"), "button"));
});

test("an in-range pace gets the ok hint built from the passage target", async () => {
  const session = sessionWith({ words_per_minute: 140 });
  const { results, body } = mountResults({ s1: session });
  await results.show({ id: "s1" });
  const hint = byClass(cardsOf(body)[0], "metric-card__hint");
  assert.equal(hint.textContent, "Target 130 to 150");
  assert.ok(hint.classList.contains("metric-card__hint--ok"));
  assert.ok(!hint.classList.contains("metric-card__hint--warn"));
});

test("Record again goes to practice and History goes to history", async () => {
  const { results, body, calls } = mountResults({ s1: sessionWith() });
  await results.show({ id: "s1" });
  const [recordAgain, history] = body.children[2].children;
  recordAgain.click();
  history.click();
  assert.deepEqual(
    calls.routes.map((route) => route.name),
    ["practice", "history"],
  );
});

test("show with an unknown id renders the Session not found state with a History action", async () => {
  const { results, body, calls } = mountResults({});
  await results.show({ id: "nope" });
  assert.deepEqual(calls.gets, ["nope"]);
  assert.equal(body.children.length, 1);
  const block = body.children[0];
  assert.equal(block.className, "state state--empty");
  assert.equal(block.getAttribute("role"), null);
  const [icon, title, text, action] = block.children;
  assert.equal(icon.tagName, "svg");
  assert.equal(title.textContent, "Session not found");
  assert.equal(text.textContent, "It may have been deleted.");
  assert.equal(action.className, "state__action btn btn--secondary");
  assert.equal(fullText(action), "History");
  action.click();
  assert.deepEqual(calls.routes, [{ name: "history", params: undefined }]);
});

test("show without an id renders Session not found and never asks the store", async () => {
  const { results, body, calls } = mountResults({ s1: sessionWith() });
  await results.show({});
  assert.deepEqual(calls.gets, []);
  assert.equal(body.children[0].className, "state state--empty");
  assert.equal(body.children[0].children[1].textContent, "Session not found");
});

test("a store failure also reads as Session not found instead of throwing", async () => {
  const { app, results, body } = mountResults({});
  app.store.get = () => Promise.reject(new Error("IndexedDB is unavailable"));
  await assert.doesNotReject(() => results.show({ id: "s1" }));
  assert.equal(body.children[0].className, "state state--empty");
});

test("show rebuilds the body each time and hide leaves it alone", async () => {
  const { results, body } = mountResults({ s1: sessionWith(), s2: sessionWith() });
  await results.show({ id: "nope" });
  assert.equal(body.children.length, 1);
  await results.show({ id: "s1" });
  assert.equal(body.children.length, 3);
  await results.show({ id: "s2" });
  assert.equal(body.children.length, 3, "a second session replaces the first, never stacks");
  assert.doesNotThrow(() => results.hide());
  assert.equal(body.children.length, 3);
});

test("when two loads overlap, the later show wins", async () => {
  const { app, results, body } = mountResults({});
  let releaseFirst = null;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const slowSession = sessionWith({ words_per_minute: 100 }, { id: "slow" });
  const fastSession = sessionWith({ words_per_minute: 140 }, { id: "fast" });
  app.store.get = (id) => (id === "slow" ? first : Promise.resolve(fastSession));

  const pendingSlow = results.show({ id: "slow" });
  await results.show({ id: "fast" });
  releaseFirst(slowSession);
  await pendingSlow;

  const wpmValue = byClass(cardsOf(body)[0], "metric-card__value");
  assert.equal(fullText(wpmValue), "140 wpm", "the slow earlier load must not paint over");
});
