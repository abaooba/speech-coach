// Tests the words a benchmark read gets when it strays from its passage (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 5: "A benchmark never clears or locks
// anything"). A level's read that strays is told what reading it through would clear; the
// benchmark read is told that its slips are not counted until it is read through, never that it
// clears a level. passages.js, delivery.js and path.js load into a vm in index.html's order; every
// report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const PATH = APP.path;

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// `count` words read at exactly `wpm` from 1 s, each 80% of its step long.
function wordsAt(count, wpm) {
  const step = ((60 / wpm) * count) / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// 150 words at 150 wpm, sent with no script block: talk, or a read the backend found strayed.
function offThePassage() {
  return APP.delivery.analyze(wordsAt(150, 150), { pauses: [], repeats: [] });
}

// 150 words at 150 wpm that followed the script but left out 9 of its words after word 100.
function nineWordsLeftOut() {
  const transcript = wordsAt(150, 150);
  const skipped = Array.from({ length: 9 }, (_, offset) => ({
    word: "skipped" + offset,
    index: 100 + offset,
    at: transcript[100].end,
  }));
  return APP.delivery.analyze(transcript, {
    pauses: [],
    repeats: [],
    script: { restarts: [], skipped, misread: [] },
  });
}

function benchmarkRead(report) {
  return plain(PATH.evaluate("benchmark", 0, report, {}));
}

test("a benchmark read off its passage says its slips are not counted, not what it clears", () => {
  const result = benchmarkRead(offThePassage());
  assert.deepEqual(
    [result.passed, result.value, result.valueText, result.unitLabel, result.sentence],
    [
      null,
      null,
      "—",
      "slips",
      "This take did not follow the passage. Read it as written so your slips can be counted.",
    ],
  );
});

test("a benchmark read that leaves out 9 words in one place says the same way why", () => {
  assert.equal(
    benchmarkRead(nineWordsLeftOut()).sentence,
    "You left out 9 words of the passage in one place. Read all of it so your slips can be " +
      "counted.",
  );
});

test("a level's read off its passage is still told what reading it through clears", () => {
  const baseline = PATH.measure(APP.delivery.analyze(wordsAt(150, 150), {}), 90);
  const offRead = plain(PATH.evaluate("restarts-1", 2, offThePassage(), { baseline }));
  assert.equal(
    offRead.sentence,
    "This take did not follow the passage. Read it as written to clear this level.",
  );
  const leftOut = plain(PATH.evaluate("restarts-1", 2, nineWordsLeftOut(), { baseline }));
  assert.equal(
    leftOut.sentence,
    "You left out 9 words of the passage in one place. Read all of it to clear this level.",
  );
});
