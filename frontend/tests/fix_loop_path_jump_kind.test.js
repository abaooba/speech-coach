// Tests that the Loop Path's jump test stops at a level of the other kind (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 4: a later level M is cleared too only
// while "M's kind (talk or read) matches N's"). Restarts level 4 is a read and level 5 a talk, so
// a read that passes level 4 never clears level 5, even one long, quick and clean enough to meet
// level 5's own rule and guards: the kind alone stops the jump. passages.js, delivery.js and
// path.js load into a vm in index.html's order; every report comes from the real
// app.delivery.analyze.
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
const PATH = APP.path;

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

// A speaker with no slips of any kind, at 150 wpm.
const CLEAN = {
  takes: 5,
  minutes: 5,
  fillersPerMinute: 0,
  restartsPerMinute: 0,
  shortMidPerMinute: 0,
  longPausesPerMinute: 0,
  wpm: 150,
  cleanStretchSeconds: 20,
  weightedPerMinute: 0,
  otherPerMinute: { restarts: 0, fillers: 0, "long-pauses": 0, pace: 0 },
};

// A cold read of 190 words at 140 wpm, scored against its script with no slips: it speaks for
// 81.4 s, past the 72 s that Restarts level 5's 90 s talk asks for.
const LONG_CLEAN_READ = APP.delivery.analyze(wordsAt(190, 140), {
  pauses: [],
  repeats: [],
  script: { restarts: [], skipped: [], misread: [] },
});

test("the long clean read would meet Restarts level 5's rule and guards as a talk", () => {
  const asTalk = plain(PATH.evaluate("restarts-5_checkback", 0, LONG_CLEAN_READ, {
    baseline: CLEAN,
  }));
  assert.equal(asTalk.passed, true);
  assert.deepEqual(
    asTalk.guards.map((guard) => [guard.id, guard.passed, guard.text]),
    [
      ["talkShare", true, "Talked 81.4 s of 90"],
      ["minWpm", true, "140 wpm"],
      ["steadyOtherSlips", true, "Other slips steady"],
    ],
  );
});

test("a read that clears Restarts level 4 never jumps level 5, a talk", () => {
  const result = plain(PATH.evaluate("restarts-4", 1, LONG_CLEAN_READ, { baseline: CLEAN }));
  assert.equal(result.passed, true);
  assert.deepEqual(result.jumped, []);
  assert.deepEqual(result.records, ["restarts-4"]);
});
