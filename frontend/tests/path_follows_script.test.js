// Tests that the skill path's reading plays (the Restarts cold reads, the Pace ladder reads and
// the speed ladder crown of docs/superpowers/specs/2026-10-14-loop-path.md, which replaced
// docs/PLAN.md T42's coldRead and speedLadder levels) clear only on a take that followed its
// passage. The backend drops a take's script block when the take does not follow the script it
// was sent (backend/script_align.py MIN_SCRIPT_FOLLOWED_SHARE): free talk, another text, or a
// few lines read and then ad-libbed. Without the block a take has no misreads and no skips,
// exactly as a flawless read has. So the app.delivery report says whether the block was there
// (followedScript), and app.path fails a reading take without it. Talk levels never need a
// script. Every report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures");

const NOT_FOLLOWED =
  "This take did not follow the passage. Read it as written to clear this level.";
// Every reading play with the index of a take it scores: the loops' scored reads (Pace level
// 2's first read is scored too), the cold-read check-backs and the speed ladder crown.
const READING_PLAYS = [
  ["restarts-1", 2],
  ["restarts-2", 2],
  ["restarts-3", 1],
  ["restarts-4", 1],
  ["restarts-1_checkback", 0],
  ["restarts-2_checkback", 0],
  ["restarts-3_checkback", 0],
  ["restarts-4_checkback", 0],
  ["pace-1", 1],
  ["pace-2", 0],
  ["pace_crown", 0],
];
// A script block as backend/script_align.py analyze_reading returns it for a clean read.
const CLEAN_READ = { restarts: [], skipped: [], misread: [] };

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

// `count` words read at exactly `wpm` from 1 s, each 80% of its step long.
function wordsAt(count, wpm) {
  const step = ((60 / wpm) * count) / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// The real 2026-10-11 nervous take, in clip seconds.
function nervousWords() {
  const file = path.join(FIXTURES_DIR, "take_2026_10_11_nervous.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).words.map((word) => ({
    text: word.text,
    start: word.start / 1000,
    end: word.end / 1000,
  }));
}

// A speaker's usual numbers from one clean minute at 150 wpm: no slips of any kind.
const STEADY = APP.path.baseline([
  {
    createdAt: "2026-10-12T10:00:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    metrics: {},
    transcript: wordsAt(150, 150),
  },
]);

// How take `takeIndex` of a play went, as {passed, detail}: its verdict and the sentence that
// says why, against the steady baseline.
function evaluate(playId, takeIndex, transcript, metrics) {
  const report = APP.delivery.analyze(transcript, metrics);
  const result = plain(APP.path.evaluate(playId, takeIndex, report, { baseline: STEADY }));
  return { passed: result.passed, detail: result.sentence };
}

// --- the delivery report ----------------------------------------------------------------------

test("the delivery report says whether the take was scored against a script it followed", () => {
  const transcript = wordsAt(20, 150);
  assert.equal(APP.delivery.analyze(transcript, { script: CLEAN_READ }).followedScript, true);
  assert.equal(APP.delivery.analyze(transcript, {}).followedScript, false);
  assert.equal(APP.delivery.analyze(transcript, undefined).followedScript, false);
  for (const odd of [null, [], "We affirm", 3, true]) {
    assert.equal(
      APP.delivery.analyze(transcript, { script: odd }).followedScript,
      false,
      JSON.stringify(odd),
    );
  }
});

test("a take saved without words still says whether it had a script block", () => {
  assert.equal(APP.delivery.analyze([], { script: CLEAN_READ }).followedScript, true);
  assert.equal(APP.delivery.analyze([], { duration: 30 }).followedScript, false);
});

// --- reading plays ----------------------------------------------------------------------------

test("free talk sent with a cold read clears no cold-read level", () => {
  // 170 words of talk at 150 wpm: no restarts, misreads or skips, because no script block.
  const transcript = wordsAt(170, 150);
  [
    ["restarts-1", 2],
    ["restarts-4", 1],
    ["restarts-4_checkback", 0],
  ].forEach(([playId, takeIndex]) => {
    assert.deepEqual(evaluate(playId, takeIndex, transcript, { pauses: [], repeats: [] }), {
      passed: false,
      detail: NOT_FOLLOWED,
    });
  });
});

test("talk at the read's pace clears no ladder read without the passage", () => {
  assert.deepEqual(evaluate("pace-1", 1, wordsAt(109, 150), {}), {
    passed: false,
    detail: NOT_FOLLOWED,
  });
  assert.deepEqual(evaluate("pace-2", 0, wordsAt(109, 140), {}), {
    passed: false,
    detail: NOT_FOLLOWED,
  });
  assert.deepEqual(evaluate("pace_crown", 0, wordsAt(109, 180), {}), {
    passed: false,
    detail: NOT_FOLLOWED,
  });
});

test("the real nervous take, scored as free talk as it strays, clears no reading play", () => {
  // backend test_a_take_that_does_not_follow_the_script_is_free_talk: the nervous take sent with
  // the uniforms passage comes back as metrics.analyze would score it, no script block.
  const metrics = { pauses: [], repeats: [{ text: "I kinda ner", at: 27.379 }], fillers: {} };
  READING_PLAYS.forEach(([playId, takeIndex]) => {
    assert.deepEqual(evaluate(playId, takeIndex, nervousWords(), metrics), {
      passed: false,
      detail: NOT_FOLLOWED,
    }, playId);
  });
});

test("a take that followed its passage is still scored on its slips", () => {
  const transcript = wordsAt(170, 150);
  assert.deepEqual(evaluate("restarts-4", 1, transcript, { script: CLEAN_READ }), {
    passed: true,
    detail: "No slips on read 2. The target was 1.",
  });
  assert.deepEqual(evaluate("pace-1", 1, wordsAt(109, 140), { script: CLEAN_READ }), {
    passed: true,
    detail: "140 wpm on read 2. The target was 140 to 160.",
  });
});

test("talk levels need no script", () => {
  // 180 words at 120 wpm and no filler: one clean 90 s run from the first word to the last.
  const transcript = wordsAt(180, 120);
  assert.equal(evaluate("fillers-1", 1, transcript, {}).passed, true);
  assert.equal(evaluate("long-pauses-1", 1, transcript, {}).passed, true);
});
