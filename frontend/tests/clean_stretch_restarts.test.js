// Tests that a restart cuts the clean stretch up to where the speaker starts the phrase over
// (Phase 1 loose end after T29). app.delivery cuts from the restart's `at` (the first copy) to
// the first word of its second copy, found by the same matcher Results uses to underline that
// copy (restartOf). So the abandoned words between the copies ("day—" in "the few decisions a
// day— uh, the few decisions a student") are never part of a clean stretch, however many
// there are. A repeat whose second copy cannot be found keeps the old cut: as many words as
// the phrase has, after its start.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures");
const DELIVERY_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "delivery.js"), "utf8");

// The owner's real 2026-10-11 uniforms take, in clip seconds.
const UNIFORMS_WORDS = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "take_2026_10_11_uniforms.json"), "utf8"),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));

function analyze(words, repeats) {
  const context = { app: {} };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  return JSON.parse(JSON.stringify(context.app.delivery.analyze(words, { pauses: [], repeats })));
}

// Words every half second, a quarter second long.
function spoken(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: index * 0.5,
    end: index * 0.5 + 0.25,
  }));
}

test("two abandoned words before the restart are not clean", () => {
  // the few decisions a | busy day— | the few decisions a student makes
  // backend find_repeats gives "the few decisions a" at 0 for this take.
  const words = spoken("the few decisions a busy day— the few decisions a student makes");
  const report = analyze(words, [{ text: "the few decisions a", at: 0 }]);
  assert.deepEqual(report.restarts[0].secondCopy, [6, 7, 8, 9]);
  assert.deepEqual(report.cleanStretch, { start: 3, end: 5.75, seconds: 2.8 });
});

test("the real uniforms take: the clean run after the restart starts at its second copy", () => {
  // "the few decisions a day— uh, the few decisions a student makes every day."
  const first = UNIFORMS_WORDS.findIndex((word) => word.start === 33.41);
  const sentence = UNIFORMS_WORDS.slice(first, first + 14);
  assert.equal(sentence[4].text, "day—");
  assert.equal(sentence[13].text, "day.");
  const report = analyze(sentence, [{ text: "the few decisions a", at: 33.41 }]);
  const secondCopyStart = sentence[report.restarts[0].secondCopy[0]].start;
  assert.equal(secondCopyStart, 35.722, "the second 'the'");
  assert.deepEqual(report.cleanStretch, { start: 35.722, end: 38.354, seconds: 2.6 });
});

test("the abandoned 'day—' never starts a clean stretch, even when it is the longest gap", () => {
  // A take that stops right after the restart: before, "day—" up to "uh," read as clean.
  const first = UNIFORMS_WORDS.findIndex((word) => word.start === 33.41);
  const take = UNIFORMS_WORDS.slice(first, first + 8);
  assert.deepEqual(
    take.map((word) => word.text),
    ["the", "few", "decisions", "a", "day—", "uh,", "the", "few"],
  );
  const report = analyze(take, [{ text: "the few decisions a", at: 33.41 }]);
  assert.ok(
    report.cleanStretch.start >= 35.722 || report.cleanStretch.seconds === 0,
    JSON.stringify(report.cleanStretch),
  );
});

test("a cut-off restart cuts up to the word it starts again on", () => {
  // I kinda ner— | so I | I'm kinda nervous today: backend gives "I kinda ner" at 0.
  const words = spoken("I kinda ner— so I I'm kinda nervous today about it");
  const report = analyze(words, [{ text: "I kinda ner", at: 0 }]);
  assert.deepEqual(report.restarts[0].secondCopy, [5, 6, 7]);
  assert.equal(report.cleanStretch.start, 2.5, "from \"I'm\"");
});

test("a repeat whose second copy is not found keeps the old cut", () => {
  // Nothing after "plan works" says it again: the cut covers the phrase's two words only.
  const words = spoken("plan works because the cost is low");
  const report = analyze(words, [{ text: "plan works", at: 0 }]);
  assert.deepEqual(report.restarts[0].secondCopy, []);
  assert.deepEqual(report.cleanStretch, { start: 1, end: 3.25, seconds: 2.3 });
});
