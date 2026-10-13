// Edge tests for two app.path rules (docs/PLAN.md T42) that frontend/tests/path.test.js leaves
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

function evaluate(levelId, session) {
  const report = APP.delivery.analyze(session.transcript, session.metrics);
  return plain(APP.path.evaluate(APP.path.levelById(levelId), report));
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
  // An um 15.0 s after the first word: the longest clean stretch is the 15.0 s before it.
  const transcript = words({ count: 40, say: { 30: "um" } });
  assert.deepEqual(evaluate("long-pauses-1", take(transcript, "impromptu")), {
    passed: true,
    detail: "Your longest clean stretch was 15 seconds. Level cleared: the target was 15 seconds.",
  });
});

test("a clean stretch a tenth of a second short of the target does not", () => {
  // The first word starts 0.1 s later, so the stretch before the um is 14.9 s.
  const transcript = words({ count: 40, say: { 30: "um" } });
  transcript[0].start += 0.1;
  assert.deepEqual(evaluate("long-pauses-1", take(transcript, "impromptu")), {
    passed: false,
    detail: "Your longest clean stretch was 14.9 seconds. Hold one for 15 seconds to clear " +
      "this level.",
  });
});
