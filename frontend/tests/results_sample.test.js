// Tests for the bundled sample on Results (review code-4 and demo-5). Practice's "See a sample
// result" saves sample-session.json as an ordinary session, so History lists it, but it is not
// one of the speaker's takes: app.screens.results.isSample(session) marks it by its "Sample: "
// title, a sample's Results compares it with nothing, and a real take's last take skips it. So
// no delta line, note or fillers-drop headline ever involves a sample. The pure half loads
// results.js with no document; the DOM half adds ui.js, delivery.js and the shared fake DOM.
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
const SAMPLE_FILE = JSON.parse(read("sample-session.json"));

// The sample is an Explain something take (130 to 160 wpm); the real takes are on Gettysburg.
const PASSAGES = [
  { id: "explain-something", targetWpm: [130, 160] },
  { id: "gettysburg", targetWpm: [130, 150] },
];

const OCT_8 = "2026-10-08T15:30:00Z";
const OCT_9 = "2026-10-09T15:30:00Z";
const OCT_10 = "2026-10-10T15:30:00Z";

function loadPure() {
  const context = { app: { screens: {}, passages: [], ui: {}, store: {}, router: {} } };
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app.screens.results;
}

// The bundled file as the store keeps it after a tap: its five fields plus an id and a time.
// It reads 146 wpm and 10.5 fillers a minute.
function sample(id, createdAt) {
  return { ...structuredClone(SAMPLE_FILE), id, createdAt };
}

// A real take saved without words, ten minutes long, so `fillers` ums make fillers / 10 a
// minute.
function take(id, createdAt, { wpm = 140, fillers = 0 } = {}) {
  return {
    id,
    createdAt,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 600,
    metrics: {
      words_per_minute: wpm,
      duration: 600,
      word_count: wpm * 10,
      fillers: { um: fillers },
      pauses: [],
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

// Results against the fake document, with a store that lists `sessions` newest first.
async function showResults(sessions, id) {
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
      store: {
        get: (wanted) => Promise.resolve(byId[wanted]),
        list: () => Promise.resolve([...newestFirst]),
      },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id });
  return body;
}

function deltasOf(body) {
  return byClass(body, "stat-strip")
    .children.map((card) => byClass(card, "stat__delta"))
    .map((delta) => (delta ? delta.textContent : null));
}

function headlineOf(body) {
  const headline = byClass(body, "headline");
  return headline.children.map((line) => line.textContent);
}

test("isSample is true only for the bundled sample's 'Sample: ' title", () => {
  const { isSample } = loadPure();
  assert.equal(typeof isSample, "function");
  assert.equal(isSample(sample("s", OCT_9)), true, "the bundled sample-session.json");
  assert.equal(isSample({ passageTitle: "Sample: Free talk" }), true);
  for (const passageTitle of [
    "Congress speech",
    "Gettysburg Address, opening",
    "Rebuttal: school uniforms",
    "Sample",
    "Sample:Congress speech",
    "sample: Congress speech",
    "My Sample: Congress speech",
    "",
    undefined,
    null,
    42,
  ]) {
    assert.equal(isSample({ passageTitle }), false, String(passageTitle));
  }
  assert.equal(isSample(undefined), false);
  assert.equal(isSample(null), false);
});

test("a sample reads as a first take, even after the speaker's own takes", async () => {
  const alone = await showResults([sample("s", OCT_10)], "s");
  // Against this take the sample's 10.5 fillers a minute would read "Fillers are down from 21.4
  // to 10.5 a minute." and every card would carry a delta line.
  const busy = await showResults([take("t", OCT_9, { fillers: 214 }), sample("s", OCT_10)], "s");
  assert.deepEqual(deltasOf(busy), [null, null, null, null]);
  assert.equal(byClass(busy, "stat-strip__note"), undefined, "no note about arrows");
  assert.deepEqual(headlineOf(busy), headlineOf(alone));
  assert.doesNotMatch(headlineOf(busy)[0], /^Fillers are down/);
});

test("a real take after a sample compares with the real take before the sample", async () => {
  const sessions = [
    take("a", OCT_8, { wpm: 130, fillers: 20 }),
    sample("s", OCT_9),
    take("b", OCT_10, { wpm: 140, fillers: 0 }),
  ];
  const body = await showResults(sessions, "b");
  // Against the sample's 146 wpm and 10.5 fillers this would be "6 slower" and "10.5 fewer".
  assert.deepEqual(deltasOf(body), ["10 faster", "2 fewer", "No change", null]);
  assert.equal(headlineOf(body)[0], "Fillers are down from 2 to 0 a minute.");
});

test("a real take with only samples before it has no last take", async () => {
  const body = await showResults(
    [sample("s1", OCT_8), sample("s2", OCT_9), take("b", OCT_10, { fillers: 0 })],
    "b",
  );
  assert.deepEqual(deltasOf(body), [null, null, null, null]);
  assert.equal(byClass(body, "stat-strip__note"), undefined);
  assert.doesNotMatch(headlineOf(body)[0], /^Fillers are down/, "not from the sample's 10.5");
});
