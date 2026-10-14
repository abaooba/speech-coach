// Tests for how frontend/rank.js charges skipped script words (review fix A3). A take that stops
// partway, or starts partway in, leaves the script's unread tail or head as skips that all share
// one `at` (backend/script_align.py lists every one). That is script the take never reached, not
// a slip, so a run of more than 8 skips in one place costs nothing, the same line path.js
// MAX_SKIPPED_IN_ONE_PLACE draws for "did not read it through". A skip anywhere else still costs
// half an error.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RANK_SOURCE = fs.readFileSync(path.join(__dirname, "..", "rank.js"), "utf8");

// Scores are compared to a tenth of a point, as a badge would show them.
const TOLERANCE = 0.05;

// No errors, in-target pace, one minute.
const CLEAN = {
  speakingSeconds: 60,
  fillerCount: 0,
  repeatCount: 0,
  midSentencePauseCount: 0,
  longPauseCount: 0,
  misreads: [],
  skips: [],
  wordsPerMinute: 150,
};

function load() {
  const app = {};
  vm.runInNewContext(RANK_SOURCE, { app }, { filename: "rank.js" });
  return app.rank;
}

function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < TOLERANCE,
    (message || "") + " expected about " + expected + ", got " + actual,
  );
}

function reportWith(overrides) {
  return { ...CLEAN, ...overrides };
}

// In a one-minute take, weighted errors w score 100 * exp(-0.15 * w).
function oneMinuteScore(weighted) {
  return 100 * Math.exp(-0.15 * weighted);
}

// `count` script words from index `first` on, each skipped at `at`, as delivery.js reports them.
function skippedRun(count, first, at) {
  return Array.from({ length: count }, (_, i) => ({ at, word: "word" + (first + i) }));
}

test("a flawless 40 s read of the first 100 words of a 300-word script scores 100", () => {
  // 100 words in 40 s is 150 wpm. The speaker stopped there, so script words 100 to 299 were
  // never reached: 200 skips, all at 39.8, the end of the last word said.
  const report = reportWith({
    speakingSeconds: 40,
    wordsPerMinute: 150,
    skips: skippedRun(200, 100, 39.8),
  });
  assert.equal(load().takeScore(report), 100);
});

test("a flawless read that starts partway in is not charged for the unread head", () => {
  // The first 40 script words were never read; their skips sit at the start of the take.
  assert.equal(load().takeScore(reportWith({ skips: skippedRun(40, 0, 0.52) })), 100);
});

test("a few scattered skips still cost half an error each", () => {
  const skips = [
    { at: 4.2, word: "the" },
    { at: 17.9, word: "still" },
    { at: 41.06, word: "not" },
  ];
  near(load().takeScore(reportWith({ skips })), oneMinuteScore(1.5));
});

test("without a speechStart, a 9th word makes the only run unread script", () => {
  // A report saved without words cannot place a run, so its first and last big runs are
  // treated as never reached.
  const rank = load();
  near(rank.takeScore(reportWith({ skips: skippedRun(8, 30, 21.4) })), oneMinuteScore(4), "8");
  assert.equal(rank.takeScore(reportWith({ skips: skippedRun(9, 30, 21.4) })), 100, "9");
});

// The same one-minute take, placed in time: its first word starts at 0.4 s, its last ends at 60.4.
function placed(overrides) {
  return reportWith({ speechStart: 0.4, speakingSeconds: 60, ...overrides });
}

test("9 or more words skipped mid-take are a skipped line: half an error each", () => {
  const rank = load();
  near(rank.takeScore(placed({ skips: skippedRun(9, 30, 21.4) })), oneMinuteScore(4.5), "9");
  near(rank.takeScore(placed({ skips: skippedRun(40, 30, 21.4) })), oneMinuteScore(20), "40");
});

test("a mid-take run that is also the last run is still charged", () => {
  const skips = [{ at: 4.2, word: "the" }, ...skippedRun(9, 30, 21.4)];
  near(load().takeScore(placed({ skips })), oneMinuteScore(5));
});

test("the unread tail at the take's last word costs nothing, even after a closing um", () => {
  const rank = load();
  assert.equal(rank.takeScore(placed({ skips: skippedRun(200, 100, 60.4) })), 100, "at the end");
  assert.equal(rank.takeScore(placed({ skips: skippedRun(200, 100, 59.2) })), 100, "then um");
});

test("the unread head at the take's first word costs nothing, even after an opening um", () => {
  const rank = load();
  assert.equal(rank.takeScore(placed({ skips: skippedRun(40, 0, 0.4) })), 100, "at the start");
  assert.equal(rank.takeScore(placed({ skips: skippedRun(40, 0, 1.3) })), 100, "after um");
});

test("a head and a tail both unread cost nothing, and slips between them still count", () => {
  const skips = [
    ...skippedRun(20, 0, 0.4),
    { at: 30.1, word: "word45" },
    ...skippedRun(30, 90, 60.4),
  ];
  near(load().takeScore(placed({ skips })), oneMinuteScore(0.5));
});

test("an unread tail does not hide the skips before it", () => {
  const skips = [
    { at: 4.2, word: "the" },
    { at: 17.9, word: "still" },
    ...skippedRun(50, 59, 23.317),
  ];
  near(load().takeScore(reportWith({ skips })), oneMinuteScore(1));
});

test("skips under a millisecond apart are one place, so float error cannot split a tail", () => {
  const skips = skippedRun(20, 59, 23.317).map((skip, i) => ({
    ...skip,
    at: skip.at + (i % 2) * 0.0004,
  }));
  assert.equal(load().takeScore(reportWith({ skips })), 100);
});
