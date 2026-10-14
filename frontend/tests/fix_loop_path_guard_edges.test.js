// Review fix: two guards were pinned only on their passing edge (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 2). loop_path_rules.test.js judges
// minWpm at 104 wpm (fails) and 120 (passes), and steadyOtherSlips with other slips of 4.1 a
// minute against a usual 2.0 (fails) and 3.1 (passes), so a guard that let 119 wpm through, or
// other slips 1.1 above the usual, passed every test. talkShare is pinned on both edges (72 s
// passes, 71.9 fails); these do the same for the other two: 119 wpm fails minWpm, and 4.1 a
// minute fails steadyOtherSlips against a usual 3.0. passages.js, delivery.js and path.js load
// into a vm in index.html's order; every report comes from the real app.delivery.analyze.
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

// `count` words spoken over exactly `seconds`, from 1 s, each 80% of its step long.
function wordsOver(count, seconds) {
  const step = seconds / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// `count` words spoken at exactly `wpm`.
function wordsAt(count, wpm) {
  return wordsOver(count, (count * 60) / wpm);
}

// A stored take as app.store.list() hands it back.
function session({ transcript, repeats = [], pauses = [] }) {
  return {
    id: "take",
    createdAt: "2026-10-14T10:00:00.000Z",
    passageId: "impromptu",
    passageTitle: "Practice",
    durationSeconds: 90,
    metrics: { pauses, repeats, fillers: {} },
    transcript,
  };
}

function reportOf(saved) {
  return APP.delivery.analyze(saved.transcript, saved.metrics);
}

// A baseline with every number at a steady speaker's, its other slips a minute for the Fillers
// unit at `otherFillers`.
function usual(otherFillers = 0) {
  return {
    takes: 5,
    minutes: 5,
    fillersPerMinute: 0,
    restartsPerMinute: 0,
    shortMidPerMinute: 0,
    longPausesPerMinute: 0,
    wpm: 150,
    cleanStretchSeconds: 20,
    weightedPerMinute: 0,
    otherPerMinute: { restarts: 0, fillers: otherFillers, "long-pauses": 0, pace: 0 },
  };
}

// Fillers level 3's scored take 2, judged against `baseline`.
function judge(saved, baseline = usual()) {
  return plain(PATH.evaluate("fillers-3", 1, reportOf(saved), { baseline }));
}

function guard(result, id) {
  const line = result.guards.find((entry) => entry.id === id);
  assert.ok(line, "the take checks " + id);
  return [line.passed, line.text];
}

test("minWpm: 119 wpm is one short of the floor and fails", () => {
  const take = session({ transcript: wordsAt(178, 119) });
  assert.equal(PATH.measure(reportOf(take), 90).wpm, 119);
  const result = judge(take);
  assert.deepEqual(guard(result, "minWpm"), [false, "119 wpm. Keep a pace of at least 120."]);
  assert.deepEqual(guard(result, "talkShare")[0], true, "only the pace misses");
  assert.equal(result.passed, false);
  assert.equal(result.fix, "Keep a pace of at least 120 wpm", "the first failed guard's fix");
});

test("minWpm: 120 wpm on the same length of talk passes, so the floor is 120 exactly", () => {
  const take = session({ transcript: wordsAt(180, 120) });
  assert.equal(PATH.measure(reportOf(take), 90).wpm, 120);
  assert.deepEqual(guard(judge(take), "minWpm"), [true, "120 wpm"]);
});

// 73.2 s with 2 restarts (1.5 each) and 2 short mid-sentence pauses: 5 slips in 1.22 minutes is
// 4.1 a minute, all of them "other" slips for the Fillers unit (loop_path_rules.test.js's take).
function steadyTake() {
  const transcript = wordsOver(180, 73.2);
  const restarts = [10, 30].map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  return session({
    transcript,
    repeats: restarts,
    pauses: [
      [transcript[100].end, 1],
      [transcript[140].end, 1],
    ],
  });
}

test("steadyOtherSlips: 4.1 a minute against a usual 3.0 is 1.1 over and fails", () => {
  const take = steadyTake();
  assert.equal(PATH.measure(reportOf(take), 90).otherPerMinute.fillers, 4.1);
  const result = judge(take, usual(3));
  assert.deepEqual(guard(result, "steadyOtherSlips"), [
    false,
    "Other slips rose to 4.1 a minute from 3.0. Keep them within 1 of your usual.",
  ]);
  assert.equal(result.passed, false);
});

test("steadyOtherSlips: the same take against a usual 3.1 is exactly 1.0 over and passes", () => {
  const result = judge(steadyTake(), usual(3.1));
  assert.deepEqual(guard(result, "steadyOtherSlips"), [true, "Other slips steady"]);
});
