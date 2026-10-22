// Tests for summary.slipsPerMinute in frontend/screens/results.js: a take's read slips a minute,
// the number the Progress Read charts follow in place of fillers. A read slip is a restart or a
// misread word, as path.js counts readSlips for the benchmark; a skipped word is not one, since a
// transcript can drop a short word the speaker did say. passages.js, delivery.js and results.js
// run for real.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

function summarize(session) {
  const context = { app: { screens: {}, ui: {} } };
  for (const file of ["passages.js", "delivery.js", path.join("screens", "results.js")]) {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  }
  return context.app.screens.results.summarize(session);
}

// 120 words half a second apart: 59.95 seconds from the first word's start to the last's end.
const WORDS = Array.from({ length: 120 }, (_, index) => ({
  text: "word",
  start: index * 0.5,
  end: index * 0.5 + 0.45,
}));

function sessionOf(passageId, metrics) {
  return {
    id: "take",
    createdAt: "2026-10-20T12:00:00Z",
    passageId,
    passageTitle: passageId,
    durationSeconds: 60,
    metrics: { pauses: [], fillers: {}, pace_windows: [], ...metrics },
    transcript: WORDS,
  };
}

const RESTARTS = [
  { text: "word word", at: 10 },
  { text: "word word", at: 30 },
];

test("a read take's slips are its restarts and misreads a minute; a skip is not a slip", () => {
  const summary = summarize(
    sessionOf("explainer-rainbows", {
      repeats: RESTARTS,
      script: {
        restarts: RESTARTS,
        skipped: [{ word: "the", index: 5, at: 2.95 }],
        misread: [{ word: "rain", index: 40, at: 20, said: "word" }],
      },
    }),
  );
  assert.equal(summary.slipsPerMinute, 3);
});

test("a talk take has no misreads, so its slips are its restarts a minute", () => {
  assert.equal(summarize(sessionOf("free-talk", { repeats: [RESTARTS[0]] })).slipsPerMinute, 1);
});

test("a take with no speaking time has no slips a minute", () => {
  const silent = { ...sessionOf("free-talk", { repeats: [] }), transcript: [] };
  assert.equal(summarize(silent).slipsPerMinute, 0);
});
