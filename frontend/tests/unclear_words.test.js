// Tests for app.delivery.findUnclear: the soft "may have been unclear" hint. A word the
// transcriber rated below UNCLEAR_CONFIDENCE is listed (lowest first, at most five) unless it is
// a filler, a habit word, shorter than three letters or a cut-off. Nothing in the delivery
// report, the score or the rank ever reads it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DELIVERY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "delivery.js"), "utf8");

function load() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

const delivery = load();

// Words half a second apart; `confidences` maps an index to its confidence.
function take(texts, confidences) {
  return texts.map((text, index) => {
    const word = { text, start: index * 0.5, end: index * 0.5 + 0.4 };
    if (confidences && Object.hasOwn(confidences, index)) {
      word.confidence = confidences[index];
    }
    return word;
  });
}

const SENTENCE = "The weather this morning was surprisingly pleasant for the whole village".split(" ");

test("UNCLEAR_CONFIDENCE is 0.5 and at most five words are hinted", () => {
  assert.equal(delivery.UNCLEAR_CONFIDENCE, 0.5);
  assert.equal(delivery.MAX_UNCLEAR_WORDS, 5);
});

test("words under the confidence line are listed, the lowest first", () => {
  const words = take(SENTENCE, { 1: 0.4, 3: 0.1, 5: 0.3 });
  assert.deepEqual(Array.from(delivery.findUnclear(words)), [3, 5, 1]);
});

test("a word at the line or above, or with no confidence, is not listed", () => {
  const words = take(SENTENCE, { 1: 0.5, 3: 0.9, 5: 0.49 });
  assert.deepEqual(Array.from(delivery.findUnclear(words)), [5]);
  assert.deepEqual(Array.from(delivery.findUnclear(take(SENTENCE))), []);
});

test("a confidence that is not a number from 0 to 1 is ignored", () => {
  const words = take(SENTENCE, { 1: "0.1", 3: NaN, 5: -0.2, 7: null, 8: 1.5 });
  assert.deepEqual(Array.from(delivery.findUnclear(words)), []);
});

test("fillers, habit words, short words and cut-offs are left out", () => {
  const texts = ["I", "um", "like", "to", "wal—", "basically", "tomorrow", "uh", "morning"];
  const all = Object.fromEntries(texts.map((_, i) => [i, 0.1]));
  const words = take(texts, all);
  const listed = Array.from(delivery.findUnclear(words)).map((i) => texts[i]);
  assert.deepEqual(listed.sort(), ["morning", "tomorrow"]);
});

test("at most five words are listed, the five lowest", () => {
  const texts = "alpha bravo charlie delta echo foxtrot golf hotel".split(" ");
  const words = take(texts, { 0: 0.45, 1: 0.2, 2: 0.3, 3: 0.1, 4: 0.4, 5: 0.35, 6: 0.25 });
  assert.deepEqual(Array.from(delivery.findUnclear(words)), [3, 1, 6, 2, 5]);
});

test("a tie keeps the earlier word first; bad input gives an empty list", () => {
  const words = take(SENTENCE, { 2: 0.3, 4: 0.3 });
  assert.deepEqual(Array.from(delivery.findUnclear(words)), [2, 4]);
  assert.deepEqual(Array.from(delivery.findUnclear(null)), []);
  assert.deepEqual(Array.from(delivery.findUnclear([null, {}, { text: 5 }])), []);
});

test("confidence changes no field of the delivery report", () => {
  const metrics = { pauses: [[1.2, 0.6]], repeats: [] };
  const plain = take(SENTENCE.concat(["um", "tomorrow"]));
  const rated = take(SENTENCE.concat(["um", "tomorrow"]), { 1: 0.1, 3: 0.2, 11: 0.05, 12: 0.3 });
  const without = JSON.stringify(delivery.analyze(plain, metrics));
  const withConfidence = JSON.stringify(delivery.analyze(rated, metrics));
  assert.equal(withConfidence, without);
  assert.deepEqual(Array.from(delivery.findUnclear(rated)), [1, 3, 12]);
});
