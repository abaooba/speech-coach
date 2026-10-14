// Edge tests for two app.path rules (docs/PLAN.md T42, and the Loop Path of
// docs/superpowers/specs/2026-10-14-loop-path.md) that frontend/tests/path.test.js leaves
// unguarded: order() ranks a pace below the band as select.py's pace_slow does, and a clean
// stretch clears its level at exactly the target, to the tenth of a second the Results card
// shows. Every report comes from the real app.delivery.analyze.
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

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// `count` words, one every `step` seconds from 1 s, each 80% of a step long; `say` swaps in
// other text by index.
function words({ count, step = 0.5, say = {} }) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// A stored take as app.store.list() hands it back.
function take(transcript, passageId) {
  return {
    id: "take",
    createdAt: "2026-10-12T10:00:00.000Z",
    passageId,
    passageTitle: "Practice",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [], fillers: {} },
    transcript,
  };
}

// Talk at 0.25 s a word, each word 0.15 s long, from 1 s: 300 words speak for 74.9 s, enough
// for a Long pauses take 2 of 90 s, and a stretch from the first word to a filler at index i
// lasts exactly i / 4 seconds. `say` swaps in other text by index.
function quickTalk(say) {
  return Array.from({ length: 300 }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * 0.25,
    end: 1 + index * 0.25 + 0.15,
  }));
}

// How take 2 of a level went, against the take's own numbers as the usual ones.
function evaluate(levelId, session) {
  const report = APP.delivery.analyze(session.transcript, session.metrics);
  const baseline = APP.path.measure(report, 90);
  return plain(APP.path.evaluate(levelId, 1, report, { baseline }));
}

test("a pace two band widths too slow puts Pace first, ahead of fillers twice their target", () => {
  // One minute on Your day (band 140 to 160): 100 words, 6 of them ums, so 94 wpm, 2.3 band
  // widths under the slow edge; 6 fillers a minute are 1.0 past their target.
  const ums = { 10: "um", 25: "um", 40: "um", 55: "um", 70: "um", 85: "um" };
  const slow = take(words({ count: 100, step: 60 / 99.8, say: ums }), "free-talk");
  const report = APP.delivery.analyze(slow.transcript, slow.metrics);
  assert.equal(report.wordsPerMinute, 94);
  assert.equal(report.fillersPerMinute, 6);

  const order = Array.from(APP.path.order([slow]), (unit) => unit.id);
  assert.deepEqual(order, ["pace", "fillers", "restarts", "long-pauses"]);
});

test("a clean stretch of exactly the target clears the level", () => {
  // An um 15.0 s after the first word, then one every 60 words: the longest clean stretch is the
  // 15.0 s before the first.
  const transcript = quickTalk({ 60: "um", 120: "um", 180: "um", 240: "um" });
  const result = evaluate("long-pauses-1", take(transcript, "impromptu"));
  assert.deepEqual([result.passed, result.sentence], [
    true,
    "15 seconds clean and no long pauses on take 2. The target was 15 seconds clean, with at " +
      "most 1 long pause.",
  ]);
});

test("a clean stretch a tenth of a second short of the target does not", () => {
  // The first word starts 0.1 s later, so the stretch before the um is 14.9 s.
  const transcript = quickTalk({ 60: "um", 120: "um", 180: "um", 240: "um" });
  transcript[0].start += 0.1;
  const result = evaluate("long-pauses-1", take(transcript, "impromptu"));
  assert.deepEqual([result.passed, result.sentence], [
    false,
    "14.9 seconds clean and no long pauses on take 2. The target is 15 seconds clean, with at " +
      "most 1 long pause.",
  ]);
});
