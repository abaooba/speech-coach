// Tests for the transcript and tips half of frontend/screens/results.js: the pure helpers
// isFiller and buildTranscriptPlan, and what show() draws between the metric grid and the
// actions. Same stub context as results.test.js (bare app, fake store and router, the real
// ui.js against the fake DOM) plus an app.tips that records what select() is asked.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const RESULTS_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "screens", "results.js"), "utf8");
const UI_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "ui.js"), "utf8");
const TIPS_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "tips.js"), "utf8");

// The real AssemblyAI word list for samples/test-clip.m4a. Its fourth word "basically," ends
// at 3.692 and the fifth starts at 5.0, so the backend reports the pause [3.692, 1.308].
const FIXTURE_PATH = path.join(
  FRONTEND_DIR,
  "..",
  "backend",
  "tests",
  "fixtures",
  "test_clip_assemblyai.json",
);
const FIXTURE_WORDS = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")).words;
const FIRST_SIX = FIXTURE_WORDS.slice(0, 6);
const FIXTURE_PAUSE = [3.692, 1.308];

const FILLER_WORDS = ["um", "uh", "hmm", "like", "so", "basically", "actually"];

const PASSAGES = [{ id: "gettysburg", targetWpm: [130, 150] }];
const FALLBACK_TARGET = [140, 160];

const FAKE_TIPS = [
  { id: "fillers-high", text: "First fake tip." },
  { id: "pause-long", text: "Second fake tip." },
];

const METRICS = {
  words_per_minute: 162.4,
  duration: 30,
  word_count: 81,
  fillers: { um: 6, uh: 3 },
  pauses: [FIXTURE_PAUSE],
  repeats: [],
  pace_windows: [],
};

function words(...texts) {
  return texts.map((text, index) => ({ text, start: index, end: index + 0.5 }));
}

function sessionWith(metricOverrides, sessionOverrides) {
  return {
    id: "s1",
    createdAt: "2026-10-09T22:21:00.000Z",
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 31.2,
    metrics: { ...METRICS, ...(metricOverrides || {}) },
    transcript: FIRST_SIX.map((word) => ({ ...word })),
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

function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app.screens.results;
}

// tips: "fake" records every select() call and returns FAKE_TIPS, "real" loads tips.js,
// "none" leaves app.tips undefined, as results.test.js does.
function mountResults(sessions, tips) {
  const document = fakeDocument();
  const calls = { tips: [] };
  const context = { app: bareApp(), document };
  context.app.store.get = (id) => Promise.resolve(sessions[id]);
  context.app.router.go = () => {};
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  if (tips === "fake") {
    context.app.tips = {
      select: (metrics, options) => {
        calls.tips.push({ metrics, options });
        return FAKE_TIPS.map((tip) => ({ ...tip }));
      },
    };
  } else if (tips === "real") {
    vm.runInNewContext(TIPS_SOURCE, context, { filename: "tips.js" });
  }
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });

  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body, calls };
}

function outline(node) {
  return node.nodeType === 3 ? "#text" : `${node.tagName}.${node.className}`;
}

function planShape(plan) {
  return Array.from(plan, (item) =>
    item.type === "pause" ? ["pause", item.length] : [item.text, item.filler],
  );
}

test("results.js exposes isFiller and buildTranscriptPlan beside mount, show, hide, summarize", () => {
  const results = loadPure();
  for (const name of ["isFiller", "buildTranscriptPlan"]) {
    assert.equal(typeof results[name], "function", `results.${name} should be a function`);
  }
});

test("isFiller ignores case and edge punctuation: 'Um,' yes, 'umbrella' no", () => {
  const { isFiller } = loadPure();
  assert.equal(isFiller("Um,"), true);
  assert.equal(isFiller("umbrella"), false);
  for (const word of FILLER_WORDS) {
    assert.equal(isFiller(word), true, word);
    assert.equal(isFiller(word.toUpperCase() + "."), true, word.toUpperCase() + ".");
    assert.equal(isFiller('"' + word + '?"'), true, '"' + word + '?"');
  }
  for (const word of ["you", "know", "", "so-called", "likely", "hmmm", "day's"]) {
    assert.equal(isFiller(word), false, word);
  }
  assert.doesNotThrow(() => isFiller(undefined));
  assert.equal(isFiller(undefined), false);
});

test("buildTranscriptPlan marks both halves of 'you know' and nothing around them", () => {
  const { buildTranscriptPlan } = loadPure();
  const plan = buildTranscriptPlan(words("You", "know,", "the", "drill"), []);
  assert.deepEqual(planShape(plan), [
    ["You", true],
    ["know,", true],
    ["the", false],
    ["drill", false],
  ]);
  const apart = buildTranscriptPlan(words("you", "see,", "I", "know"), []);
  assert.deepEqual(planShape(apart), [
    ["you", false],
    ["see,", false],
    ["I", false],
    ["know", false],
  ]);
});

test("buildTranscriptPlan puts the fixture pause right after 'basically,' (end 3.692)", () => {
  const { buildTranscriptPlan } = loadPure();
  const plan = buildTranscriptPlan(FIRST_SIX, [FIXTURE_PAUSE]);
  assert.deepEqual(planShape(plan), [
    ["Hey,", false],
    ["so,", true],
    ["um,", true],
    ["basically,", true],
    ["pause", 1.308],
    ["um,", true],
    ["m", false],
  ]);
  assert.deepEqual({ ...plan[4] }, { type: "pause", length: 1.308 });
  assert.deepEqual({ ...plan[3] }, { type: "word", text: "basically,", filler: true });
});

test("a pause before the first word goes first and one after the last word goes last", () => {
  const { buildTranscriptPlan } = loadPure();
  // "Hey," ends at 1.497, so nothing has ended by 1.0.
  const early = buildTranscriptPlan(FIRST_SIX, [[1.0, 2]]);
  assert.deepEqual(planShape(early)[0], ["pause", 2]);
  assert.equal(early.length, 7);
  const late = buildTranscriptPlan(FIRST_SIX, [[9, 1.5]]);
  assert.deepEqual(planShape(late)[6], ["pause", 1.5]);
  assert.equal(late.length, 7);
});

test("pauses land by their own at, in any input order; a word ending exactly at `at` counts", () => {
  const { buildTranscriptPlan } = loadPure();
  // 5.436 is the end of the fifth word "um,", 1.497 the end of "Hey,".
  const plan = buildTranscriptPlan(FIRST_SIX, [[5.436, 2], [1.497, 1.6]]);
  assert.deepEqual(planShape(plan), [
    ["Hey,", false],
    ["pause", 1.6],
    ["so,", true],
    ["um,", true],
    ["basically,", true],
    ["um,", true],
    ["pause", 2],
    ["m", false],
  ]);
});

test("buildTranscriptPlan returns [] for nothing, copes with missing input, changes nothing", () => {
  const { buildTranscriptPlan } = loadPure();
  assert.equal(buildTranscriptPlan([], []).length, 0);
  assert.equal(buildTranscriptPlan(undefined, undefined).length, 0);
  assert.equal(buildTranscriptPlan(null, "pauses").length, 0);
  const transcript = FIRST_SIX.map((word) => ({ ...word }));
  const pauses = [[...FIXTURE_PAUSE]];
  const before = JSON.stringify({ transcript, pauses });
  buildTranscriptPlan(transcript, pauses);
  assert.equal(JSON.stringify({ transcript, pauses }), before);
});

test("show draws Transcript and Tips between the metric grid and the actions", async () => {
  const { results, body } = mountResults({ s1: sessionWith() }, "fake");
  await results.show({ id: "s1" });
  assert.deepEqual(body.children.map(outline), [
    "p.results__meta num",
    "div.metric-grid",
    "h2.results__heading",
    "p.transcript",
    "h2.results__heading",
    "div.tip-card",
    "div.tip-card",
    "div.results__actions",
  ]);
  assert.equal(body.children[2].textContent, "Transcript");
  assert.equal(body.children[4].textContent, "Tips");
  assert.deepEqual(
    [body.children[5], body.children[6]].map((card) => card.textContent),
    ["First fake tip.", "Second fake tip."],
  );
  assert.equal(byClass(body, "metric-grid").children.length, 4, "the cards are untouched");
});

test("the transcript alternates tokens and spaces, marking fillers and the pause", async () => {
  const { results, body } = mountResults({ s1: sessionWith() }, "fake");
  await results.show({ id: "s1" });
  const transcript = byClass(body, "transcript");
  const nodes = transcript.children;
  assert.equal(nodes.length, 14, "seven items, each followed by a space");
  nodes.forEach((node, index) => {
    if (index % 2 === 1) {
      assert.equal(node.nodeType, 3);
      assert.equal(node.textContent, " ");
    } else {
      assert.equal(node.tagName, "span");
    }
  });
  const items = nodes.filter((node, index) => index % 2 === 0);
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Hey,", "so,", "um,", "basically,", "1.3 s pause", "um,", "m"],
  );
  assert.deepEqual(
    items.map((item) => item.className),
    [
      "tok",
      "tok tok--filler",
      "tok tok--filler",
      "tok tok--filler",
      "tok--pause num",
      "tok tok--filler",
      "tok",
    ],
  );
  assert.deepEqual(
    items.map((item) => item.getAttribute("aria-label")),
    [
      null,
      "so, filler word",
      "um, filler word",
      "basically, filler word",
      "pause, 1.3 seconds",
      "um, filler word",
      null,
    ],
  );
});

test("pause chips always show one decimal", async () => {
  const session = sessionWith({ pauses: [[1.497, 2], [3.692, 2.14]] });
  const { results, body } = mountResults({ s1: session }, "fake");
  await results.show({ id: "s1" });
  const chips = byClass(body, "transcript").children.filter(
    (node) => node.classList && node.classList.contains("tok--pause"),
  );
  assert.deepEqual(
    chips.map((chip) => [chip.textContent, chip.getAttribute("aria-label")]),
    [
      ["2.0 s pause", "pause, 2.0 seconds"],
      ["2.1 s pause", "pause, 2.1 seconds"],
    ],
  );
});

test("tips come from app.tips.select with the session metrics and the passage target", async () => {
  const known = sessionWith();
  const unknown = sessionWith({}, { id: "s2", passageId: "not-a-passage" });
  const { results, calls } = mountResults({ s1: known, s2: unknown }, "fake");
  await results.show({ id: "s1" });
  await results.show({ id: "s2" });
  assert.equal(calls.tips.length, 2);
  assert.equal(calls.tips[0].metrics, known.metrics);
  assert.deepEqual(Array.from(calls.tips[0].options.targetWpm), [130, 150]);
  assert.equal(calls.tips[1].metrics, unknown.metrics);
  assert.deepEqual(Array.from(calls.tips[1].options.targetWpm), FALLBACK_TARGET);
});

test("with the real tips.js, nine fillers in 30 seconds show exactly the filler tip", async () => {
  const { results, body } = mountResults({ s1: sessionWith() }, "real");
  await results.show({ id: "s1" });
  const cards = body.children.filter((node) => node.className === "tip-card");
  assert.deepEqual(
    cards.map((card) => card.textContent),
    ["Replace um with a silent beat. Judges hear silence as confidence."],
  );
});

test("no words means no Transcript section, even with pauses; a clean take still gets a tip", async () => {
  // A session saved without words (the README store check) still carries metrics.pauses.
  const session = sessionWith({ fillers: { um: 0 } }, { transcript: [] });
  const { results, body } = mountResults({ s1: session }, "real");
  await results.show({ id: "s1" });
  assert.deepEqual(body.children.map(outline), [
    "p.results__meta num",
    "div.metric-grid",
    "h2.results__heading",
    "div.tip-card",
    "div.results__actions",
  ]);
  assert.equal(body.children[3].textContent, "Clean run. Push the pace a little next time.");
});

test("without app.tips the screen still renders, just with no Tips section", async () => {
  const { results, body } = mountResults({ s1: sessionWith() }, "none");
  await assert.doesNotReject(() => results.show({ id: "s1" }));
  assert.deepEqual(body.children.map(outline), [
    "p.results__meta num",
    "div.metric-grid",
    "h2.results__heading",
    "p.transcript",
    "div.results__actions",
  ]);
});
