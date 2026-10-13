// Tests that the skill path's reading levels (coldRead and speedLadder, docs/PLAN.md T42) clear
// only on a take that followed its passage. The backend drops a take's script block when the
// take does not follow the script it was sent (backend/script_align.py
// MIN_SCRIPT_FOLLOWED_SHARE): free talk, another text, or a few lines read and then ad-libbed.
// Without the block a take has no misreads and no skips, exactly as a flawless read has. So the
// app.delivery report says whether the block was there (followedScript), and app.path fails a
// reading take without it. Talk levels never need a script. Every report comes from the real
// app.delivery.analyze.
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
const READING_LEVELS = ["restarts-1", "restarts-2", "restarts-3", "restarts-4", "restarts-5"]
  .concat(["pace-1", "pace-2", "pace-3", "pace-4", "pace-5"]);
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

function evaluate(levelId, transcript, metrics) {
  const report = APP.delivery.analyze(transcript, metrics);
  return plain(APP.path.evaluate(APP.path.levelById(levelId), report));
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

// --- reading levels ---------------------------------------------------------------------------

test("free talk sent with a cold read clears no cold-read level", () => {
  // 170 words of talk at 150 wpm: no restarts, misreads or skips, because no script block.
  const transcript = wordsAt(170, 150);
  ["restarts-1", "restarts-5"].forEach((levelId) => {
    assert.deepEqual(evaluate(levelId, transcript, { pauses: [], repeats: [] }), {
      passed: false,
      detail: NOT_FOLLOWED,
    });
  });
});

test("talk at the rung's pace clears no speed-ladder rung without the passage", () => {
  assert.deepEqual(evaluate("pace-1", wordsAt(109, 140), {}), {
    passed: false,
    detail: NOT_FOLLOWED,
  });
  ["pace-3", "pace-4", "pace-5"].forEach((levelId) => {
    assert.deepEqual(evaluate(levelId, wordsAt(109, 180), {}), {
      passed: false,
      detail: NOT_FOLLOWED,
    });
  });
});

test("the real nervous take, scored as free talk as it strays, clears no reading level", () => {
  // backend test_a_take_that_does_not_follow_the_script_is_free_talk: the nervous take sent with
  // the uniforms passage comes back as metrics.analyze would score it, no script block.
  const metrics = { pauses: [], repeats: [{ text: "I kinda ner", at: 27.379 }], fillers: {} };
  READING_LEVELS.forEach((levelId) => {
    assert.deepEqual(evaluate(levelId, nervousWords(), metrics), {
      passed: false,
      detail: NOT_FOLLOWED,
    }, levelId);
  });
});

test("a take that followed its passage is still scored on its slips", () => {
  const transcript = wordsAt(170, 150);
  assert.deepEqual(evaluate("restarts-5", transcript, { script: CLEAN_READ }), {
    passed: true,
    detail: "You read it with no restarts or misreads. Level cleared.",
  });
  assert.deepEqual(evaluate("pace-1", wordsAt(109, 140), { script: CLEAN_READ }), {
    passed: true,
    detail: "You read at 140 wpm with no restarts. Level cleared: the target was 130 to 150 wpm.",
  });
});

test("talk levels need no script", () => {
  // 100 words at 120 wpm and no filler: one clean 50 s run from the first word to the last.
  const transcript = wordsAt(100, 120);
  assert.equal(evaluate("fillers-1", transcript, {}).passed, true);
  assert.equal(evaluate("long-pauses-1", transcript, {}).passed, true);
});
