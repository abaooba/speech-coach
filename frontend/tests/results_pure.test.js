// Tests for the contract DESIGN.md section 2 sets on the helpers app.screens.results exports:
// summarize, buildTranscriptPlan, headlineFor, compareWithPrevious and timelineSegments touch
// no DOM and no app.ui. They load here with app.delivery and no `document` at all, beside an
// app.ui that throws the moment anything reads it, and run on timed and untimed takes, with
// and without words. summarize hands the time used on a timed preset back as seconds; the
// meta line prints it as "0:30 of 3:00".
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

const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};

const TIMED = "congress-speech";
const UNTIMED = "gettysburg-opening";
const PASSAGES = [
  { id: UNTIMED, targetWpm: [130, 150] },
  { id: TIMED, targetWpm: [130, 160], timeLimitSeconds: 180 },
];

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// results.js and app.delivery with no document and an app.ui that throws when read.
function loadStrict() {
  const app = {
    screens: {},
    passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
    store: {},
    router: {},
  };
  Object.defineProperty(app, "ui", {
    get() {
      throw new Error("a pure helper read app.ui");
    },
  });
  const context = { app };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app.screens.results;
}

function clip(passageId, createdAt = "2026-10-10T15:30:00Z") {
  return {
    id: "clip",
    createdAt,
    passageId,
    passageTitle: "Clip",
    durationSeconds: 33.1,
    metrics: CLIP_METRICS,
    transcript: CLIP_WORDS,
  };
}

// A take saved without words, so the backend tallies decide every number.
function tallies(passageId, createdAt = "2026-10-09T15:30:00Z") {
  return {
    id: "tallies",
    createdAt,
    passageId,
    passageTitle: "Tallies",
    durationSeconds: 31.2,
    metrics: {
      words_per_minute: 140,
      duration: 30,
      word_count: 70,
      fillers: { um: 2 },
      pauses: [[12, 2]],
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

test("the strict context really throws when app.ui is read", () => {
  const context = { app: {} };
  Object.defineProperty(context.app, "ui", {
    get() {
      throw new Error("read");
    },
  });
  assert.throws(() => vm.runInNewContext("app.ui.formatClock(1)", context), /read/);
});

test("summarize runs without app.ui on timed and untimed takes, with and without words", () => {
  const results = loadStrict();
  for (const session of [clip(TIMED), clip(UNTIMED), tallies(TIMED), tallies(UNTIMED)]) {
    assert.doesNotThrow(() => results.summarize(session), session.passageId);
  }
});

test("a timed preset's time used comes back as seconds against the limit", () => {
  const results = loadStrict();
  const spoken = results.summarize(clip(TIMED));
  assert.deepEqual(plain(spoken.timeUsed), {
    seconds: spoken.report.speakingSeconds,
    limitSeconds: 180,
  });
  assert.ok(spoken.report.speakingSeconds > 30, "the clip speaks for about 31 seconds");
  assert.deepEqual(plain(results.summarize(tallies(TIMED)).timeUsed), {
    seconds: 30,
    limitSeconds: 180,
  });
});

test("an untimed preset, or a passage no longer listed, has no time used", () => {
  const results = loadStrict();
  assert.equal(results.summarize(clip(UNTIMED)).timeUsed, null);
  assert.equal(results.summarize(tallies("retired-passage")).timeUsed, null);
});

test("the other pure helpers also run without app.ui or a document", () => {
  const results = loadStrict();
  const current = results.summarize(clip(TIMED));
  const previous = results.summarize(tallies(TIMED));
  assert.doesNotThrow(() => results.headlineFor(current, previous));
  assert.doesNotThrow(() => results.headlineFor(previous, null));
  assert.doesNotThrow(() => results.compareWithPrevious(current, previous));
  assert.doesNotThrow(() => results.timelineSegments(current.report));
  assert.doesNotThrow(() => results.timelineSegments(previous.report));
  assert.doesNotThrow(() => results.buildTranscriptPlan(CLIP_WORDS, CLIP_METRICS.pauses));
});
