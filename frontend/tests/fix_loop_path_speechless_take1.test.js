// Tests that a take without speech never becomes a Loop Path baseline (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 2). A baseline comes from takes with
// speech. A brand-new speaker's play takes its baseline from its first recorded take, and when
// that take 1 said nothing, measure() of it has every rate at 0: as a baseline it would hold take 2
// to "other slips" of 0.0 and shorten Pace level 3's take 2 as if the speaker's pace were 0 wpm.
// So a measure() without speech is no baseline, and until a take with speech sets one, the take
// being judged stands in for it, as take 1 does. passages.js, delivery.js and path.js load into a
// vm in index.html's order; every report comes from the real app.delivery.analyze.
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

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

function reportOf(transcript, pauses = []) {
  return APP.delivery.analyze(transcript, { pauses, repeats: [], fillers: {} });
}

function judge(playId, takeIndex, report, context) {
  return plain(PATH.evaluate(playId, takeIndex, report, context));
}

function guardTexts(result) {
  return result.guards.map((guard) => [guard.id, guard.passed, guard.text]);
}

// measure() of a take 1 that said nothing, as the Level screen would freeze it.
const SILENT_TAKE_1 = PATH.measure(reportOf([]), 60);

// A minute of talk at 147 wpm with 3 ums and 2 short mid-sentence pauses: 2.0 "other" slips a
// minute for the Fillers unit.
function minuteWithTwoPauses() {
  const transcript = wordsOver(150, 60, ums(20, 60, 100));
  return reportOf(transcript, [
    [transcript[40].end, 1],
    [transcript[80].end, 1],
  ]);
}

test("measure() of a take without speech is no baseline for a play's goal or takes", () => {
  assert.equal(SILENT_TAKE_1.spoke, false);
  const pace3 = plain(PATH.playById("pace-3", { baseline: SILENT_TAKE_1 }));
  assert.equal(pace3.takes[1].seconds, null, "take 2's length waits for a take with speech");
  assert.equal(pace3.goal.length, "90 s, then 70 or 90 s");
  assert.equal(PATH.takeAt("pace-3", 1, { baseline: SILENT_TAKE_1 }).seconds, null);
  assert.deepEqual(plain(PATH.playById("fillers-1", { baseline: SILENT_TAKE_1 }).goal), {
    headline: "8 or fewer",
    unitLabel: "fillers a minute, or halfway there from take 1",
    length: "60 s, two takes",
    short: "Halfway to 8 /min",
  });
});

test("measure() of a take with speech is still a baseline", () => {
  // 130 wpm, under Pace level 3's band of 140 to 160: take 2 is the shorter 70 s.
  const slow = PATH.measure(reportOf(wordsOver(130, 60)), 90);
  assert.equal(slow.spoke, true);
  assert.equal(PATH.playById("pace-3", { baseline: slow }).takes[1].seconds, 70);
  assert.equal(PATH.takeAt("pace-3", 1, { baseline: slow }).seconds, 70);
});

test("after a take 1 without speech, take 2 is judged against itself, not against zeros", () => {
  const result = judge("fillers-1", 1, minuteWithTwoPauses(), { baseline: SILENT_TAKE_1 });
  assert.equal(result.passed, true);
  assert.deepEqual(guardTexts(result), [
    ["talkShare", true, "Talked 60 s of 60"],
    ["minWpm", true, "147 wpm"],
    ["steadyOtherSlips", true, "Other slips steady"],
  ]);
  // 3.0 fillers a minute in 60 s also meets level 2's 8 in 60 s, so the take jumps it.
  assert.deepEqual(result.records, ["fillers-1", "fillers-2"]);
});

test("take 2 standing in sets Fillers level 1's halfway target from its own rate", () => {
  // 12 ums in a minute: halfway from 12 to 8 is 10, as it would be from a take 1 at 12.
  const twelve = reportOf(wordsOver(150, 60, ums(5, 17, 29, 41, 53, 65, 77, 89, 101, 113, 125,
    137)));
  const result = judge("fillers-1", 1, twelve, { baseline: SILENT_TAKE_1 });
  assert.deepEqual(
    [result.passed, result.targetText, result.sentence],
    [false, "target 10", "12.0 fillers a minute on take 2. The target is 10."],
  );
});

test("a take 1 without speech never shortens Pace level 3's take 2", () => {
  // 80 s at 150 wpm: in the band, so take 2 keeps its 90 s.
  const result = judge("pace-3", 1, reportOf(wordsOver(200, 80)), { baseline: SILENT_TAKE_1 });
  assert.equal(result.passed, true);
  assert.deepEqual(guardTexts(result)[0], ["talkShare", true, "Talked 80 s of 90"]);
});

test("a take 2 without speech after a silent take 1 fails as any take without speech", () => {
  const result = judge("fillers-1", 1, reportOf([]), { baseline: SILENT_TAKE_1 });
  assert.deepEqual([result.passed, result.sentence], [false, NO_SPEECH]);
});

test("after take 1, anything but a baseline or a measure() is still refused", () => {
  for (const baseline of [undefined, null, { wpm: 150 }]) {
    assert.throws(
      () => PATH.evaluate("fillers-1", 1, minuteWithTwoPauses(), { baseline }),
      /context\.baseline after take 1/,
      String(baseline),
    );
  }
});
