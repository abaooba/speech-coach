// Tests for the imaginary 40-point takes in frontend/rank.js rating() (review fix A4). They used
// to fill only the empty slots of the 10 rated takes, so ten takes under 30 s pushed them all
// out and ten clean 6 s takes rated 100, Master. Now they also make up whatever minutes the rated
// takes fall short of 3 (PRIOR_TAKES x PRIOR_TAKE_MINUTES), whichever is more, so quick tries
// cannot crowd them out, while long takes still leave no room for them and Master stays
// reachable.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RANK_SOURCE = fs.readFileSync(path.join(__dirname, "..", "rank.js"), "utf8");

// Scores are compared to a tenth of a point, as a badge would show them.
const TOLERANCE = 0.05;

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

// A local-time ISO string, so day boundaries are the speaker's midnight, not UTC's.
function localTime(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour || 12, minute || 0).toISOString();
}

// One history entry on 2026-10-<day> at noon.
function take(score, seconds, day) {
  return {
    createdAt: localTime(2026, 10, day || 1),
    score,
    speakingSeconds: seconds,
    longPauseCount: 0,
  };
}

// count takes on consecutive days, each the same score and length.
function run(count, score, seconds) {
  return Array.from({ length: count }, (_, i) => take(score, seconds, 1 + i));
}

test("ten clean 6 s takes rate about 45: Contender, not Master", () => {
  const rank = load();
  // Each weighs 0.1 min quartered, 0.025; the 2.75 minutes they lack of 3 are rated 40.
  const history = run(10, 100, 6);
  const rating = rank.rating(history);
  near(rating, 45);
  assert.equal(rank.tier(rating, history), "Contender");
});

test("the prior pulls both ways: ten 6 s takes that each score 0 rate about 36.7, not 0", () => {
  near(load().rating(run(10, 0, 6)), 36.7);
});

test("the prior weighs the larger of the empty slots and the minutes short of 3", () => {
  // 8 clean 6 s takes: 2 empty slots would be 2 minutes, but 2.8 minutes are missing.
  near(load().rating(run(8, 100, 6)), 44);
});

test("takes adding up to 3 minutes or more leave no prior: ten clean 30 s takes rate 100", () => {
  const rank = load();
  const history = run(10, 100, 30);
  assert.equal(rank.rating(history), 100);
  assert.equal(rank.tier(rank.rating(history), history), "Master");
});
