// Tests for the "may have been unclear" hint on Results (docs/superpowers/specs/
// 2026-10-17-guided-coach-design.md Phase 5 item 2): a word the transcriber rated a coin flip or
// worse gets .tok--unclear (a dotted box) and ", may have been unclear" in its label, and the
// legend says what the box means. Nothing here is counted. The "Words to check" chips that once
// said each word with the phone's voice are gone (owner's call of 2026-10-18: the voice stayed
// silent on iPhone). ui.js, delivery.js and results.js run for real in a vm against the shared
// fake DOM.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const DELIVERY_SOURCE = read("delivery.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));

const LEGEND_UNCLEAR = " Dotted boxes: may have been unclear — a hint, not counted.";

function words(texts, confidences) {
  return texts.map((text, index) => {
    const word = { text, start: index * 0.5, end: index * 0.5 + 0.4 };
    if (confidences && Object.hasOwn(confidences, index)) {
      word.confidence = confidences[index];
    }
    return word;
  });
}

const SENTENCE =
  "So this morning I went to the market near my house and we talked about the weather.".split(" ");
// market (7) and weather. (16) were a coin flip; "So" is a habit word and never hinted.
const CONFIDENCES = { 0: 0.1, 7: 0.31, 16: 0.42 };

function session(overrides, metrics) {
  return {
    id: "s1",
    createdAt: "2026-10-17T09:12:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 9,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [], ...(metrics || {}) },
    transcript: words(SENTENCE, CONFIDENCES),
    ...(overrides || {}),
  };
}

function mount(sessions) {
  const document = fakeDocument();
  const context = {
    app: {
      screens: {},
      passages: [{ id: "free-talk", kind: "prompt", targetWpm: [140, 160] }],
      ui: {},
      store: { get: (id) => Promise.resolve(sessions[id]) },
      router: { go() {} },
    },
    document,
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  return { results: context.app.screens.results, body, app: context.app };
}

function tokens(body) {
  return byClass(body, "transcript").children.filter((node) => node.tagName === "span");
}

function outline(node) {
  return node.tagName + "." + node.className;
}

// --- the transcript mark ---

test("buildTranscriptPlan marks the unclear words, never a filler or habit", () => {
  const { results } = mount({});
  const plan = results.buildTranscriptPlan(words(SENTENCE, CONFIDENCES), []);
  const marked = Array.from(plan.filter((item) => item.unclear), (item) => item.text);
  assert.deepEqual(marked, ["market", "weather."]);
  assert.equal(plan[0].unclear, undefined, "So is a habit word: never boxed");
  assert.equal(Object.hasOwn(plan[1], "unclear"), false, "a clear word carries no key");
});

test("an unclear word is a dotted box that adds to its label; clear words are unchanged", async () => {
  const { results, body } = mount({ s1: session() });
  await results.show({ id: "s1" });
  const market = tokens(body).find((span) => span.textContent === "market");
  assert.equal(market.className, "tok tok--unclear");
  assert.equal(market.getAttribute("aria-label"), "market, may have been unclear");
  const weather = tokens(body).find((span) => span.textContent === "weather.");
  assert.equal(weather.getAttribute("aria-label"), "weather, may have been unclear");
  const plainWord = tokens(body).find((span) => span.textContent === "house");
  assert.equal(plainWord.className, "tok");
  assert.equal(plainWord.getAttribute("aria-label"), null);
});

test("the box combines with a restart's mark", () => {
  const { results } = mount({});
  const said = words(["I", "wanted", "wanted", "it"], { 2: 0.2 });
  const plan = results.buildTranscriptPlan(said, [], [2]);
  assert.equal(plan[2].restart, true);
  assert.equal(plan[2].unclear, true);
});

test("the legend says what a dotted box means only when the transcript shows one", async () => {
  const boxed = mount({ s1: session() });
  await boxed.results.show({ id: "s1" });
  const legend = byClass(boxed.body, "transcript__legend");
  assert.ok(legend.textContent.includes(LEGEND_UNCLEAR), legend.textContent);
  const clear = mount({ s1: session({ transcript: words(SENTENCE) }) });
  await clear.results.show({ id: "s1" });
  assert.ok(!byClass(clear.body, "transcript__legend").textContent.includes("Dotted boxes"));
});

test("words without confidence change nothing: same plan, same score", () => {
  const { results } = mount({});
  const withHints = results.summarize(session());
  const without = results.summarize(session({ transcript: words(SENTENCE) }));
  for (const key of ["wpm", "fillersPerMinute", "pauseCount", "cleanStretchSeconds"]) {
    assert.equal(withHints[key], without[key], key);
  }
});

// --- the words to check ---
