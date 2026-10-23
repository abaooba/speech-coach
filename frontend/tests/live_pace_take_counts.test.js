// Tests for app.delivery.countsForPaceFactor (frontend/delivery.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7, Factor): whether a take
// tunes its mode's words-a-peak factor. It counts with 20 s of speech or more, 30 words or more
// without hesitation sounds, and a peak inside the speech (0.25 s either side of it still
// inside), the one rule paceFactorAfter uses. A take that counts can give the factor back as it
// was, to the thousandth, so the caller asks this rather than compare factors. The wordsOf() and
// peaksOver() helpers follow live_pace.test.js.
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

// `count` words, each starting `step` seconds after the one before, from 1 s and 0.3 s long;
// `hesitations` lists the indexes said as "um".
function wordsOf(count, step = 0.4, hesitations = []) {
  return Array.from({ length: count }, (_, i) => ({
    text: hesitations.includes(i) ? "um" : "word",
    start: Math.round((1 + i * step) * 1000) / 1000,
    end: Math.round((1.3 + i * step) * 1000) / 1000,
  }));
}

// `count` peaks spread evenly over the words' span.
function peaksOver(words, count) {
  const first = words[0].start;
  const last = words[words.length - 1].end;
  return Array.from({ length: count }, (_, i) => first + ((i + 0.5) * (last - first)) / count);
}

// The speech of `words`: the first word's start and the last word's end.
function spanOf(words) {
  return [words[0].start, words[words.length - 1].end];
}

test("delivery.js exports countsForPaceFactor beside paceFactorAfter", () => {
  assert.equal(typeof delivery.countsForPaceFactor, "function");
  const keys = Object.keys(delivery);
  assert.equal(keys.indexOf("countsForPaceFactor"), keys.indexOf("paceFactorAfter") + 1);
});

test("a take counts from exactly 20 s of speech and 30 words", () => {
  // 30 words 0.69 s apart: the first starts at 1 s, the last ends at 1.3 + 29 * 0.69 = 21.31 s.
  const twenty = wordsOf(30, 0.69);
  assert.equal(Math.round((twenty[29].end - twenty[0].start) * 1000) / 1000, 20.31);
  assert.equal(delivery.countsForPaceFactor(twenty, peaksOver(twenty, 40)), true);
  const exactly = twenty.map((word, i) => (i === 29 ? { ...word, start: 20.7, end: 21 } : word));
  assert.equal(delivery.countsForPaceFactor(exactly, peaksOver(exactly, 40)), true, "20.0 s");
  const under = twenty.map((word, i) => (i === 29 ? { ...word, start: 20.7, end: 20.99 } : word));
  assert.equal(delivery.countsForPaceFactor(under, peaksOver(under, 40)), false, "19.99 s");
});

test("hesitation sounds are not words: 30 words with one um is 29, and does not count", () => {
  const thirty = wordsOf(31, 0.69, [12]);
  assert.equal(delivery.countsForPaceFactor(thirty, peaksOver(thirty, 40)), true, "30 and an um");
  const twentyNine = wordsOf(30, 0.69, [12]);
  assert.equal(delivery.countsForPaceFactor(twentyNine, peaksOver(twentyNine, 40)), false);
});

test("a take counts only with a peak inside its speech, 0.25 s either side still inside", () => {
  const words = wordsOf(60);
  const [first, last] = spanOf(words);
  assert.equal(delivery.countsForPaceFactor(words, []), false, "no peaks");
  assert.equal(delivery.countsForPaceFactor(words, [first - 0.26, last + 0.26]), false);
  assert.equal(delivery.countsForPaceFactor(words, [first - 0.25]), true, "0.25 s before");
  assert.equal(delivery.countsForPaceFactor(words, [last + 0.25]), true, "0.25 s after");
  assert.equal(delivery.countsForPaceFactor(words, [Number.NaN, "3", null]), false);
});

test("no words, or nothing a list can hold, never counts", () => {
  for (const words of [[], null, undefined, "words", {}]) {
    assert.equal(delivery.countsForPaceFactor(words, [1, 2, 3]), false, String(words));
  }
  assert.equal(delivery.countsForPaceFactor(wordsOf(60), null), false, "no peak list");
});

test("a take that counts can give the factor back as it was: 40 words over 24 s, 58 peaks", () => {
  // Its own words a peak is 40 / 58 = 0.6897, halfway from 0.69 rounds to 0.69 again.
  const words = wordsOf(40, 0.585);
  const [first, last] = spanOf(words);
  assert.ok(last - first >= 20 && last - first < 24);
  const peaks = peaksOver(words, 58);
  assert.equal(delivery.paceFactorAfter(null, words, peaks), 0.69);
  assert.equal(delivery.countsForPaceFactor(words, peaks), true, "it counts");
  // The same words a peak over 17.8 s gives 0.69 back too, and does not count.
  const short = wordsOf(40, 0.449);
  assert.ok(spanOf(short)[1] - spanOf(short)[0] < 20);
  const shortPeaks = peaksOver(short, 58);
  assert.equal(delivery.paceFactorAfter(null, short, shortPeaks), 0.69);
  assert.equal(delivery.countsForPaceFactor(short, shortPeaks), false, "it does not count");
});

test("paceFactorAfter moves the factor exactly when countsForPaceFactor says the take counts", () => {
  const takes = [
    [wordsOf(60), 80],
    [wordsOf(60), 0],
    [wordsOf(50, 0.38), 70],
    [wordsOf(30, 0.69), 40],
    [wordsOf(30, 0.69, [3]), 40],
    [wordsOf(31, 0.69, [3]), 25],
    [wordsOf(90, 0.3), 120],
    [[], 10],
  ];
  for (const [words, count] of takes) {
    const peaks = words.length > 0 ? peaksOver(words, count) : [1, 2];
    for (const kept of [null, 0.5, 0.8, 1.1]) {
      const factor = delivery.paceFactorAfter(kept, words, peaks);
      const label = words.length + " words, " + count + " peaks, kept " + kept;
      if (!delivery.countsForPaceFactor(words, peaks)) {
        assert.equal(factor, kept === null ? delivery.LIVE_PACE_FACTOR : kept, label);
        continue;
      }
      const spoken = words.filter((word) => !delivery.isHesitation(word.text)).length;
      const own = Math.min(1.1, Math.max(0.45, spoken / count));
      const from = kept === null ? delivery.LIVE_PACE_FACTOR : kept;
      assert.equal(factor, Math.round((from + 0.5 * (own - from)) * 1000) / 1000, label);
    }
  }
});

test("countsForPaceFactor is pure: the same answer every time and its inputs untouched", () => {
  const words = wordsOf(60);
  const peaks = peaksOver(words, 80);
  const before = JSON.stringify({ words, peaks });
  const first = delivery.countsForPaceFactor(words, peaks);
  assert.equal(delivery.countsForPaceFactor(words, peaks), first);
  assert.equal(JSON.stringify({ words, peaks }), before);
});
