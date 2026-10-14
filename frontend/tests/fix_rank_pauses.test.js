// Tests for how frontend/rank.js charges pauses (review fix A5). app.delivery counts a 5 s+
// mid-sentence pause in both midSentencePauseCount and longPauseCount, so takeScore charged it
// 1 + 3 = 4 while the same freeze after a period cost 3. Owner decision: each pause is charged
// once. A long pause costs 3 wherever it falls; a mid-sentence pause under 5 s costs 1. The
// report's `pauses` list ({at, length, midSentence, long}) tells the two apart; a report without
// it falls back to the counts, as before.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const RANK_SOURCE = read("rank.js");
const DELIVERY_SOURCE = read("delivery.js");

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

function loadDelivery() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
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

function pause(at, length, midSentence, long) {
  return { at, length, midSentence, long };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// Words 0.3 s long with 0.1 s between them, except that `gapAfter` maps a word's index to the
// silence after it: the pause the take's metrics then report as [that word's end, gap].
function spoken(text, gapAfter) {
  let clock = 0;
  return text.split(" ").map((word, index) => {
    const timed = { text: word, start: round3(clock), end: round3(clock + 0.3) };
    clock = timed.end + (gapAfter[index] || 0.1);
    return timed;
  });
}

test("a 6.1 s mid-sentence pause scores the same as one after a period", () => {
  const rank = load();
  // The counts as app.delivery sets them: a long mid-sentence pause is in both.
  const midSentence = reportWith({
    pauses: [pause(21.3, 6.1, true, true)],
    midSentencePauseCount: 1,
    longPauseCount: 1,
  });
  const afterPeriod = reportWith({
    pauses: [pause(21.3, 6.1, false, true)],
    midSentencePauseCount: 0,
    longPauseCount: 1,
  });
  near(rank.takeScore(midSentence), oneMinuteScore(3), "mid-sentence");
  near(rank.takeScore(afterPeriod), oneMinuteScore(3), "after a period");
});

test("on real app.delivery reports the freeze costs the same either side of a period", () => {
  const rank = load();
  const delivery = loadDelivery();
  // 240 words at 141 wpm with one 6.1 s freeze: after "today" (mid-sentence) or "money.".
  const text = Array(30).fill("The plan works today and it saves money.").join(" ");
  const reportFrozenAfter = (index) => {
    const words = spoken(text, { [index]: 6.1 });
    return delivery.analyze(words, { pauses: [[words[index].end, 6.1]], repeats: [] });
  };
  const midSentence = reportFrozenAfter(3);
  const afterPeriod = reportFrozenAfter(7);
  assert.equal(midSentence.midSentencePauseCount, 1, "the report counts it mid-sentence");
  assert.equal(midSentence.longPauseCount, 1, "and long");
  // Pace is in the band, so the score is the 3 weighted errors over 101.9 s alone.
  near(rank.takeScore(midSentence), 100 * Math.exp((-0.15 * 3) / (101.9 / 60)));
  near(rank.takeScore(midSentence), rank.takeScore(afterPeriod));
});

test("a short mid-sentence pause still costs 1; a short pause after a period costs nothing", () => {
  const rank = load();
  const report = reportWith({
    pauses: [pause(10, 1.2, true, false), pause(30, 2, false, false)],
    midSentencePauseCount: 1,
    longPauseCount: 0,
  });
  near(rank.takeScore(report), oneMinuteScore(1));
});

test("in a take with several pauses each is charged once", () => {
  // 2 short mid-sentence pauses (1 each), 1 long mid-sentence and 1 long after a period (3
  // each), and a short one after a period (nothing): 8, not the 9 the counts add up to.
  const report = reportWith({
    pauses: [
      pause(5, 1.2, true, false),
      pause(12, 2.5, true, false),
      pause(20, 6.1, true, true),
      pause(31, 5.4, false, true),
      pause(40, 1.8, false, false),
    ],
    midSentencePauseCount: 3,
    longPauseCount: 2,
  });
  near(load().takeScore(report), oneMinuteScore(8));
});

test("a report without a pauses list falls back to its counts, as before", () => {
  const report = reportWith({ midSentencePauseCount: 2, longPauseCount: 1 });
  near(load().takeScore(report), oneMinuteScore(5));
});
