// Review fix for path.test.js's no-speech test (spec docs/superpowers/specs/2026-10-14-loop-path.md
// section 2: a take without speech "fails every rule with 'No speech was found in this take.'";
// section 12: never weaken an assertion about behaviour that still exists). Main pinned a take
// with no report at all whole, {passed: false, detail: NO_SPEECH}. The Loop Path rewrite kept
// that strictness for a silent report ([passed, sentence]) but checked only the sentence for a
// missing one, so a scored take with no report could pass there unseen. These pin the verdict
// and the sentence together for a missing report, on every play path.test.js walks. passages.js,
// delivery.js and path.js load into a vm in index.html's order.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const NO_SPEECH = "No speech was found in this take.";

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

// A speaker's usual numbers from one clean minute at 150 wpm, as path.test.js's STEADY.
const STEADY = PATH.baseline([
  {
    id: "take-usual",
    createdAt: "2026-10-12T10:00:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [], fillers: {} },
    transcript: Array.from({ length: 150 }, (_, index) => ({
      text: "word" + index,
      start: 1 + (index * 60) / 149.8,
      end: 1 + (index * 60) / 149.8 + (0.8 * 60) / 149.8,
    })),
  },
]);

// A take's verdict and its sentence, as path.test.js reads them.
function verdict(playId, takeIndex, report) {
  const result = PATH.evaluate(playId, takeIndex, report, { baseline: STEADY });
  return [result.passed, result.sentence];
}

test("the steady baseline is a real one, so every play judges against it", () => {
  assert.ok(STEADY && STEADY.wpm === 150, JSON.stringify(STEADY));
});

test("a scored take with no report fails with the no-speech sentence, whatever the play", () => {
  PATH.UNITS.forEach((unit) => {
    unit.levels.forEach((entry) => {
      const scoredIndex = entry.takes.length - 1;
      for (const [id, index] of [[entry.id, scoredIndex], [entry.id + "_checkback", 0]]) {
        assert.deepEqual(verdict(id, index, undefined), [false, NO_SPEECH], id);
      }
    });
  });
  for (const id of ["fillers_crown", "pace_crown", "pace_checkpoint", "restarts_checkpoint"]) {
    assert.deepEqual(verdict(id, 0, undefined), [false, NO_SPEECH], id);
  }
});

test("Restarts level 4's scored read with no report fails, as main's restarts-5 did", () => {
  assert.deepEqual(verdict("restarts-4", 1, undefined), [false, NO_SPEECH]);
});

test("a take that is not scored has no verdict with no report, only the sentence", () => {
  assert.deepEqual(verdict("fillers-3", 0, undefined), [null, NO_SPEECH]);
  assert.deepEqual(verdict("restarts-1", 1, undefined), [null, NO_SPEECH], "read 2 of 3");
});
