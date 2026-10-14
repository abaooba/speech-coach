// Tests for which guards a Loop Path play checks (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 2 and 3). Where the spec writes out a
// play's guards, that list is all the play checks: Pace levels 1 and 2 are ladder reads checked
// for readThrough alone, so the restarts Pace level 2 allows are never failed as "other slips".
// Where it does not, section 2 and the unit's guards apply: the Restarts and Long pauses
// checkpoints keep the other slips steady, so nobody clears them by trading the unit's own slips
// for others ("so freezes are not traded for ums"). passages.js, delivery.js and path.js load
// into a vm in index.html's order; every report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const LADDER_PASSAGE_ID = "explainer-rainbows";

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

// --- checkpoints -------------------------------------------------------------------------------

function guardTexts(result) {
  return result.guards.map((guard) => [guard.id, guard.passed, guard.text]);
}

// A speaker's usual numbers as baseline() gives them, from their usual slips a minute of each
// kind, weighted as rank.js weighs them: a filler 1, a restart 1.5, a short mid-sentence pause 1
// and a long pause 3. Each unit's "other" slips leave its own skill out.
function usualOf({ fillers = 0, restarts = 0, shortMid = 0, longPauses = 0 }) {
  const restartSlips = restarts * 1.5;
  const pauseSlips = shortMid + longPauses * 3;
  return {
    takes: 5,
    minutes: 5,
    fillersPerMinute: fillers,
    restartsPerMinute: restarts,
    shortMidPerMinute: shortMid,
    longPausesPerMinute: longPauses,
    wpm: 150,
    cleanStretchSeconds: 20,
    weightedPerMinute: fillers + restartSlips + pauseSlips,
    otherPerMinute: {
      restarts: fillers + pauseSlips,
      fillers: restartSlips + pauseSlips,
      "long-pauses": fillers + restartSlips,
      pace: fillers + restartSlips + pauseSlips,
    },
  };
}

// Usually 2 fillers, 2 short mid-sentence pauses and 1 long pause a minute: 7.0 slips a minute
// in all, 2.0 of them the fillers and restarts the Long pauses unit keeps steady.
const PAUSER = usualOf({ fillers: 2, shortMid: 2, longPauses: 1 });

// Two minutes at 150 wpm without a pause of any kind, with `perMinute` ums a minute.
function twoMinutesWithUms(perMinute) {
  const count = perMinute * 2;
  const umsAt = Array.from({ length: count }, (_, n) => 10 + n * Math.floor(288 / count));
  return session({ transcript: wordsOver(300 + count, 120, ums(...umsAt)) });
}

// Two minutes at 150 wpm without a restart, with `count` short mid-sentence pauses of 1 s.
function twoMinutesWithPauses(count) {
  const transcript = wordsOver(300, 120);
  const pauses = Array.from({ length: count }, (_, n) => [transcript[40 + n * 40].end, 1]);
  return session({ transcript, pauses });
}

test("the Long pauses checkpoint misses a take that trades its pauses for ums", () => {
  assert.equal(PAUSER.weightedPerMinute, 7);
  const result = judge("long-pauses_checkpoint", 0, twoMinutesWithUms(6), { baseline: PAUSER });
  assert.equal(result.passed, false);
  assert.equal(
    result.sentence,
    "No long pauses and 6.0 slips a minute in all. The target was no long pause, with no more " +
      "than 7.0 slips a minute in all, your usual.",
  );
  assert.deepEqual(guardTexts(result), [
    ["talkShare", true, "Talked 120 s of 120"],
    ["minWpm", true, "150 wpm"],
    [
      "steadyOtherSlips",
      false,
      "Other slips rose to 6.0 a minute from 2.0. Keep them within 1 of your usual.",
    ],
  ]);
  assert.equal(result.fix, "Keep your other slips near your usual");
  assert.deepEqual(result.records, []);
});

test("the Restarts checkpoint misses a take that trades its restarts for pauses", () => {
  // Usually 2 restarts a minute and nothing else: 3.0 slips a minute in all, none of them
  // "other" slips for the Restarts unit.
  const restarter = usualOf({ restarts: 2 });
  const result = judge("restarts_checkpoint", 0, twoMinutesWithPauses(6), {
    baseline: restarter,
  });
  assert.equal(result.passed, false);
  assert.equal(
    result.sentence,
    "0.0 restarts a minute and 3.0 slips a minute in all. The target was 1, with no more than " +
      "3.0 slips a minute in all, your usual.",
  );
  assert.deepEqual(guardTexts(result)[2], [
    "steadyOtherSlips",
    false,
    "Other slips rose to 3.0 a minute from 0.0. Keep them within 1 of your usual.",
  ]);
});

test("a take that keeps its other slips steady still clears either checkpoint", () => {
  const pauses = judge("long-pauses_checkpoint", 0, twoMinutesWithUms(2), { baseline: PAUSER });
  assert.deepEqual([pauses.passed, pauses.records], [true, ["long-pauses_checkpoint"]]);
  assert.deepEqual(guardTexts(pauses)[2], ["steadyOtherSlips", true, "Other slips steady"]);
  const restarts = judge("restarts_checkpoint", 0, twoMinutesWithPauses(2), {
    baseline: usualOf({ restarts: 2 }),
  });
  assert.deepEqual([restarts.passed, restarts.records], [true, ["restarts_checkpoint"]]);
});

test("each checkpoint checks the guards the spec gives it", () => {
  const guards = Object.fromEntries(
    Array.from(PATH.UNITS, (unit) => [unit.id, Array.from(unit.checkpoint.guards)]),
  );
  assert.deepEqual(plain(guards), {
    restarts: ["talkShare", "minWpm", "steadyOtherSlips"],
    // Section 3 lists the Fillers checkpoint's own: "plus talkShare and minWpm".
    fillers: ["talkShare", "minWpm"],
    "long-pauses": ["talkShare", "minWpm", "steadyOtherSlips"],
    // In Pace every slip is an "other" slip, so all of them at or under the usual keeps them
    // steady.
    pace: ["talkShare"],
  });
});
