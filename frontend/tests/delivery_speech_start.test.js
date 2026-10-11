// app.delivery's report carries speechStart, the first word's start in recording time, so the
// Results timeline can draw its axis in the same time base as the tips (DESIGN.md section 2).
// Its own file: delivery.test.js predates the revamp and stays as it was. The fixtures and the
// timed() helper are copied from it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DELIVERY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "delivery.js"), "utf8");

// The real Oct 8 AssemblyAI clip; its first word starts at 1.287 s.
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};

function load() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

// Words 0.3 s long with 0.1 s between them.
function timed(sentence) {
  let clock = 0;
  return sentence.split(" ").map((text) => {
    const word = { text, start: round(clock), end: round(clock + 0.3) };
    clock += 0.4;
    return word;
  });
}

function round(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

test("speechStart is the first word's start in recording time, null without words", () => {
  const delivery = load();
  assert.equal(delivery.analyze(CLIP_WORDS, CLIP_METRICS).speechStart, 1.287);
  const words = timed("We win today.");
  assert.equal(delivery.analyze(words, { pauses: [], repeats: [] }).speechStart, 0);
  assert.equal(delivery.analyze([], CLIP_METRICS).speechStart, null);
  assert.equal(delivery.analyze(undefined, undefined).speechStart, null);
  const late = [{ text: "um", start: 4.5, end: 4.9 }, { text: "hi", start: 5, end: 5.2 }];
  assert.equal(delivery.analyze(late, {}).speechStart, 4.5, "a hesitation still starts the take");
});
