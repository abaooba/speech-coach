// Tests for which guards a Loop Path play checks (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 2 and 3). Where the spec writes out a
// play's guards, that list is all the play checks: Pace levels 1 and 2 are ladder reads checked
// for readThrough alone, so the restarts Pace level 2 allows are never failed as "other slips".
// passages.js, delivery.js and path.js load into a vm in index.html's order; every report comes
// from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const LADDER_PASSAGE_ID = "rebuttal-uniforms";

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

// `count` words spoken over exactly `seconds` from 1 s, each 80% of its step long. `say` swaps in
// other text by index.
function wordsOver(count, seconds, say = {}) {
  const step = seconds / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// `count` words read at exactly `wpm`.
function wordsAt(count, wpm) {
  return wordsOver(count, (count * 60) / wpm);
}

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

// A stored take as app.store.list() hands it back.
function session({ transcript, repeats = [], pauses = [], script, passageId, createdAt }) {
  const metrics = { pauses, repeats, fillers: {} };
  if (script) {
    metrics.script = script;
  }
  return {
    id: "take-" + (createdAt || "now"),
    createdAt: createdAt || "2026-10-14T10:00:00.000Z",
    passageId: passageId || "impromptu",
    passageTitle: "Practice",
    durationSeconds: 90,
    metrics,
    transcript,
  };
}

// The ladder passage (109 words) read at `wpm`, with a script restart at each word index in
// `restartsAt`.
function ladderRead(wpm, restartsAt = []) {
  const transcript = wordsAt(109, wpm);
  const restarts = restartsAt.map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  return session({
    transcript,
    repeats: restarts,
    script: { restarts, skipped: [], misread: [] },
    passageId: LADDER_PASSAGE_ID,
  });
}

function reportOf(saved) {
  return APP.delivery.analyze(saved.transcript, saved.metrics);
}

function judge(playId, takeIndex, saved, context) {
  return plain(PATH.evaluate(playId, takeIndex, reportOf(saved), context));
}

// A steady speaker: five one-minute talks with one um each, so 1.0 slip a minute, every one of
// them an "other" slip for the Pace unit, which trains speed.
const STEADY = PATH.baseline(
  [1, 2, 3, 4, 5].map((day) =>
    session({
      transcript: wordsOver(150, 60, ums(40)),
      createdAt: "2026-10-0" + day + "T10:00:00.000Z",
    }),
  ),
);

// --- Pace levels 1 and 2: ladder reads ---------------------------------------------------------

test("Pace levels 1 and 2 check readThrough alone, as the spec's Pace table lists", () => {
  assert.deepEqual(Array.from(PATH.levelById("pace-1").guards), ["readThrough"]);
  assert.deepEqual(Array.from(PATH.levelById("pace-2").guards), ["readThrough"]);
  const read2 = judge("pace-1", 1, ladderRead(150), { baseline: STEADY });
  assert.deepEqual(
    read2.guards.map((guard) => [guard.id, guard.passed, guard.text]),
    [["readThrough", true, "Read the passage through"]],
  );
});

test("each of Pace level 2's reads may have the 2 restarts its rule allows", () => {
  assert.equal(STEADY.otherPerMinute.pace, 1);
  // 2 restarts in a 47 s read are 3.9 weighted slips a minute, far over the usual 1.0.
  const first = judge("pace-2", 0, ladderRead(140, [20, 60]), { baseline: STEADY });
  assert.equal(first.passed, true);
  assert.equal(
    first.sentence,
    "140 wpm and 2 restarts on read 1. The target was 130 to 150, with at most 2 restarts.",
  );
  const second = judge("pace-2", 1, ladderRead(160, [30, 70]), {
    baseline: STEADY,
    earlier: [first],
  });
  assert.deepEqual([second.passed, second.records], [true, ["pace-2"]]);
  assert.equal(
    second.sentence,
    "160 wpm and 2 restarts on read 2. The target was 150 to 170, with at most 2 restarts. " +
      "Both reads landed.",
  );
});

test("a third restart still misses Pace level 2, on the rule's own limit", () => {
  const result = judge("pace-2", 0, ladderRead(140, [20, 50, 80]), { baseline: STEADY });
  assert.equal(result.passed, false);
  assert.equal(
    result.sentence,
    "140 wpm and 3 restarts on read 1. The target is 130 to 150, with at most 2 restarts.",
  );
  assert.equal(result.fix, "Match the time bar", "no guard failed: the unit's first fix");
});

test("a restart on Pace level 1's read 2 is no reason to miss it", () => {
  const result = judge("pace-1", 1, ladderRead(150, [30]), { baseline: STEADY });
  assert.deepEqual(
    [result.passed, result.sentence],
    [true, "150 wpm on read 2. The target was 140 to 160."],
  );
  assert.deepEqual(result.records, ["pace-1"]);
});
