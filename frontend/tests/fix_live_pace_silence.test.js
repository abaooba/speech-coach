// The live pace leaves a silence out of its window (spec 2026-10-22 section 7: "a silence over
// 1.5 seconds keeps the last value"). A silence counts as speech time only up to 1.5 s, between
// two syllable peaks or after the last one. So the estimate holds still through a pause, the
// number after it carries on from the one shown during it, and a pause at a full stop never
// says Speed up, during it or for the 15 s after. The first number waits for 5 s of speech,
// not 5 s of the clock. Pauses of 1.5 s or less count in full, as before. Its own file:
// live_pace.test.js tests the rest of the estimator; evenPeaks() is copied from it.
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
const BAND = [140, 160];

// Peaks every `step` seconds from `from` up to `to`, inclusive.
function evenPeaks(from, to, step) {
  const peaks = [];
  for (let i = 0; from + i * step <= to + 1e-9; i += 1) {
    peaks.push(Math.round((from + i * step) * 1000) / 1000);
  }
  return peaks;
}

// Peaks every 0.25 s from 1 s to 20 s, a silence of `pause` seconds, then every 0.25 s to 60 s.
function withPause(pause) {
  return [...evenPeaks(1, 20, 0.25), ...evenPeaks(20 + pause, 60, 0.25)];
}

test("a pause's time beyond 1.5 s is left out, so a longer pause reads as one of 1.5 s", () => {
  for (const pause of [1.75, 3, 10]) {
    for (const after of [0, 0.5, 1, 2, 5, 10, 13, 13.5, 14, 20]) {
      assert.equal(
        delivery.livePaceAt(withPause(pause), 20 + pause + after, 0.69),
        delivery.livePaceAt(withPause(1.5), 21.5 + after, 0.69),
        `a ${pause} s pause, ${after} s after it`,
      );
    }
  }
});

test("pauses of 1.5 s or less count in full", () => {
  // At 30 s after a 1.5 s pause: the last 15 s of the clock, 20 peaks before it and 35 after.
  assert.equal(
    delivery.livePaceAt(withPause(1.5), 30, 0.69).toFixed(3),
    ((55 * 0.69 * 60) / 15).toFixed(3),
  );
  // A 1 s pause leaves room for 2 more peaks in the same 15 s.
  assert.equal(
    delivery.livePaceAt(withPause(1), 29.5, 0.69).toFixed(3),
    ((57 * 0.69 * 60) / 15).toFixed(3),
  );
});

test("through a silence the estimate holds still once it passes 1.5 s", () => {
  const before = evenPeaks(1, 20, 0.25);
  // At 21.5 s the silence is 1.5 s and counts in full: 54 peaks after 6.5 s.
  const held = delivery.livePaceAt(before, 21.5, 0.69);
  assert.equal(held.toFixed(3), ((54 * 0.69 * 60) / 15).toFixed(3));
  for (const at of [21.75, 23, 30, 60]) {
    assert.equal(delivery.livePaceAt(before, at, 0.69), held, `at ${at} s`);
  }
  // A second into it the silence still counts, as any shorter pause does.
  assert.equal(
    delivery.livePaceAt(before, 21, 0.69).toFixed(3),
    ((56 * 0.69 * 60) / 15).toFixed(3),
  );
});

test("a 3 s pause at 150 wpm never says Speed up, and the number goes on from the held one", () => {
  // Syllables every 0.25 s at 0.625 words a syllable (150 wpm) with a 3 s pause after 20 s,
  // read once a second as the row reads them.
  const peaks = withPause(3);
  let state = null;
  const shown = [];
  for (let at = 6; at <= 40; at += 1) {
    const heard = peaks.filter((peak) => peak <= at);
    state = delivery.nextLiveReading(state, {
      at,
      estimate: delivery.livePaceAt(heard, at, 0.625),
      quietSeconds: at - heard[heard.length - 1],
      band: BAND,
    });
    shown.push(state);
  }
  // 150 up to 20 s; 140 a second into the pause, held through it and carried on after it until
  // the pause leaves the 15 s window at 37 s; then 150 again.
  const expected = [
    ...Array(15).fill(150),
    ...Array(16).fill(140),
    145,
    ...Array(3).fill(150),
  ];
  assert.deepEqual(shown.map((reading) => reading.wpm), expected);
  assert.deepEqual(
    shown.map((reading) => reading.cue),
    Array(expected.length).fill("on-target"),
  );
});

test("the first number waits for 5 s of speech, not 5 s of the clock", () => {
  // Three syllables start the speech at 1 s, a 4.5 s silence follows, then syllables every
  // 0.25 s from 6 s. Of the silence 1.5 s counts, so 5 s of speech come at 9 s, not 6 s.
  const peaks = [1, 1.25, 1.5, ...evenPeaks(6, 30, 0.25)];
  assert.equal(delivery.livePaceAt(peaks, 6, 0.69), null);
  assert.equal(delivery.livePaceAt(peaks, 8.75, 0.69), null);
  // At 9 s: the 15 peaks after the first, over 5 s of speech.
  assert.equal(delivery.livePaceAt(peaks, 9, 0.69).toFixed(3), ((15 * 0.69 * 60) / 5).toFixed(3));
});
