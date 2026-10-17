// Tests that Results keeps no dead headline helper (guided coach, final review finding 3): the
// Coach card took the old headline band's place (owner decision 2026-10-17), so headlineFor, its
// copy and its thresholds are gone from results.js. The two checks of the old headline tests that
// pin live behaviour stay here: the Fillers card's delta against a last take without words, and
// the clean tip's wording just outside the pace band. delivery.js, tips.js and results.js load
// with no document and a stub app.ui.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const DELIVERY_SOURCE = read("delivery.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const TIPS_SOURCE = read("tips.js");

// Gettysburg is 130 to 150 wpm; the drill band 100 to 130 suits the generated takes below.
const PASSAGES = [
  { id: "gettysburg", targetWpm: [130, 150] },
  { id: "drill", targetWpm: [100, 130] },
];

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
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app.screens.results;
}

// A take saved without words: the backend tallies decide every number. `fillers` is per
// minute over a one-minute take, `pauses` is how many pauses the backend found.
function tallies({ wpm = 140, fillers = 0, pauses = 0, passageId = "gettysburg" } = {}) {
  return {
    id: "t",
    createdAt: "2026-10-09T10:00:00.000Z",
    passageId,
    passageTitle: "Tallies",
    durationSeconds: 60,
    metrics: {
      words_per_minute: wpm,
      duration: 60,
      word_count: wpm,
      fillers: { um: fillers },
      pauses: Array.from({ length: pauses }, (_, k) => [10 + 10 * k, 2]),
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

// A take with words: `count` back-to-back half-second words, "um" at the indexes in `umAt`,
// so it lasts count / 2 seconds and its fillers per minute are ums over that time.
function spoken(count, umAt, passageId = "drill") {
  const ums = new Set(umAt);
  return {
    id: "w",
    createdAt: "2026-10-09T11:00:00.000Z",
    passageId,
    passageTitle: "Spoken",
    durationSeconds: count / 2,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: ums.has(index) ? "um" : "word",
      start: index * 0.5,
      end: (index + 1) * 0.5,
    })),
  };
}

function spread(count, every) {
  return Array.from({ length: count }, (_, k) => k * every + 1);
}

test("results.js exports no headlineFor and keeps none of its copy", () => {
  const results = loadPure();
  assert.equal(results.headlineFor, undefined);
  assert.equal(typeof results.summarize, "function", "the live pure helpers stay");
  assert.equal(typeof results.compareWithPrevious, "function");
  assert.doesNotMatch(RESULTS_SOURCE, /headlineFor|\bHEADLINE\b|MIN_FILLER_DROP|strengthFor|focusFor/);
});

test("the Fillers card's delta counts a last take without words from its tallies", () => {
  const results = loadPure();
  const current = results.summarize(spoken(600, spread(9, 60)));
  const previous = results.summarize(tallies({ wpm: 120, fillers: 6, passageId: "drill" }));
  const fillersDelta = results.compareWithPrevious(current, previous)[1];
  assert.deepEqual({ ...fillersDelta }, { direction: "down", text: "4.2 fewer" });
});

test("just outside the pace band a clean take's only tip is the clean tip, with no pace advice", () => {
  // The pace tips wait until 15 wpm past the band (review code-5).
  const context = { app: bareApp() };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(TIPS_SOURCE, context, { filename: "tips.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const { results } = context.app.screens;
  for (const wpm of [120, 140, 160]) {
    const summary = results.summarize(tallies({ wpm }));
    const tips = context.app.tips.select(summary.report, { targetWpm: summary.target });
    assert.deepEqual(
      Array.from(tips, (tip) => tip.id),
      ["clean"],
      String(wpm),
    );
    assert.doesNotMatch(tips[0].text, /\bnext\b|pace|faster|slower|speed|push/i, String(wpm));
  }
});
