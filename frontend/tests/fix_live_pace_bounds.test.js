// Pins the edges of the live pace numbers (spec 2026-10-22 section 7) that live_pace.test.js
// leaves loose: the window is the trailing 15 s, which evenly spaced peaks cannot show, and a
// take counts toward the words-a-peak factor from exactly 20 s of speech and exactly 30 words,
// with peaks up to 0.25 s outside its first and last word still its own. The wordsOf() and
// peaksOver() helpers are copied from live_pace.test.js.
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

// Peaks every `step` seconds from `from` up to `to`, inclusive.
function evenPeaks(from, to, step) {
  const peaks = [];
  for (let i = 0; from + i * step <= to + 1e-9; i += 1) {
    peaks.push(Math.round((from + i * step) * 1000) / 1000);
  }
  return peaks;
}

test("the window is the trailing 15 s, whatever the pace was before it", () => {
  // 4 peaks a second up to 20 s, then 5 a second: at 30 s the last 15 s hold 20 peaks from the
  // slower part and 50 from the faster one. A 10 s window would read only the faster part and a
  // 20 s one more of the slower.
  const peaks = [...evenPeaks(1, 20, 0.25), ...evenPeaks(20.2, 30, 0.2)];
  assert.equal(delivery.livePaceAt(peaks, 30, 0.69).toFixed(3), ((70 * 0.69 * 60) / 15).toFixed(3));
  // At 25 s: 40 peaks in (10, 20] and 25 in (20, 25].
  assert.equal(delivery.livePaceAt(peaks, 25, 0.69).toFixed(3), ((65 * 0.69 * 60) / 15).toFixed(3));
});

// `count` words 0.3 s long with 0.1 s between them from 1 s; `hesitations` lists the indexes
// said as "um".
function wordsOf(count, hesitations = []) {
  return Array.from({ length: count }, (_, i) => ({
    text: hesitations.includes(i) ? "um" : "word",
    start: Math.round((1 + i * 0.4) * 1000) / 1000,
    end: Math.round((1.3 + i * 0.4) * 1000) / 1000,
  }));
}

// `count` peaks spread evenly over the words' span.
function peaksOver(words, count) {
  const first = words[0].start;
  const last = words[words.length - 1].end;
  return Array.from({ length: count }, (_, i) => first + ((i + 0.5) * (last - first)) / count);
}

test("a take counts toward the factor from exactly 20 s of speech", () => {
  // 50 words over 100 peaks: 0.5 words a peak, so a kept 0.8 moves halfway, to 0.65.
  const exactly20 = wordsOf(50);
  exactly20[49] = { ...exactly20[49], end: 21 };
  assert.equal(exactly20[49].end - exactly20[0].start, 20);
  assert.equal(delivery.paceFactorAfter(0.8, exactly20, peaksOver(exactly20, 100)), 0.65);
  // The same words ending at 20.9 s: 19.9 s of speech, too short to count.
  const under20 = wordsOf(50);
  assert.equal(delivery.paceFactorAfter(0.8, under20, peaksOver(under20, 100)), 0.8);
});

test("a take counts toward the factor from exactly 30 words, hesitations left out", () => {
  // 60 words over 23.9 s, every other one "um": 30 words over 50 peaks, 0.6 words a peak.
  const evens = Array.from({ length: 30 }, (_, i) => i * 2);
  const thirty = wordsOf(60, evens);
  assert.equal(delivery.paceFactorAfter(0.8, thirty, peaksOver(thirty, 50)), 0.7);
  // One more "um" leaves 29 words, too few to count.
  const twentyNine = wordsOf(60, [1, ...evens]);
  assert.equal(delivery.paceFactorAfter(0.8, twentyNine, peaksOver(twentyNine, 50)), 0.8);
});

test("a peak up to 0.25 s outside the words is the take's, one 0.3 s outside is not", () => {
  // 60 words from 1 s to 24.9 s over 80 peaks: 0.75 words a peak, 0.69 moves to 0.72.
  const words = wordsOf(60);
  const peaks = peaksOver(words, 80);
  const first = words[0].start;
  const last = words[words.length - 1].end;
  assert.equal(delivery.paceFactorAfter(0.69, words, [first - 0.3, ...peaks, last + 0.3]), 0.72);
  // Two more peaks, each exactly 0.25 s out: 60 words over 82 peaks.
  const edges = [first - 0.25, ...peaks, last + 0.25];
  assert.equal(delivery.paceFactorAfter(0.69, words, edges), 0.711);
});
