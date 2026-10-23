// Tests for the live row's cue hold against audio time (frontend/delivery.js nextLiveReading;
// spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7, Display: a cue
// changes only once the pace has called for it for 3 seconds). The row reads once a second of
// the clock, but the tracker's `at` is the audio heard by then, which comes in whole blocks of
// 1024 samples (21 ms at 48 kHz, 128 ms at 8 kHz), so 3 s of the clock can measure 2.98 s of
// audio, or less. The new cue still shows on the read 3 clock seconds after the first that
// called for it, and never on the read before.
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

// The cue after reads at the audio times `ats`, each with the next estimate.
function cuesAt(ats, estimates) {
  let state = null;
  return ats.map((at, index) => {
    state = delivery.nextLiveReading(state, {
      at,
      estimate: estimates[index],
      quietSeconds: 0.2,
      band: BAND,
    });
    return state.cue;
  });
}

test("a new cue shows on the read 3 clock seconds on, though the audio there is 2.98 s on", () => {
  // Slow down is first called at 7.003 s of audio; 3 clock seconds later 9.982 s are in.
  assert.deepEqual(
    cuesAt([6.016, 7.003, 7.979, 9.003, 9.982], [150, 180, 180, 180, 180]),
    ["on-target", "on-target", "on-target", "on-target", "slow-down"],
  );
  // At 8 kHz a block is 128 ms: 3 clock seconds can hold 2.88 s of audio.
  assert.deepEqual(
    cuesAt([6.016, 7.04, 7.936, 8.96, 9.92], [150, 120, 120, 120, 120]),
    ["on-target", "on-target", "on-target", "on-target", "speed-up"],
  );
  // A tick that runs late on the first call shortens the hold the same way.
  assert.deepEqual(
    cuesAt([6, 7.12, 8.04, 9.36, 10.04], [150, 180, 180, 180, 180]),
    ["on-target", "on-target", "on-target", "on-target", "slow-down"],
  );
});

test("a new cue never shows on the read 2 clock seconds on, even one that runs late", () => {
  for (const third of [9, 9.25, 9.45]) {
    assert.deepEqual(
      cuesAt([6, 7, 8, third], [150, 180, 180, 180]),
      ["on-target", "on-target", "on-target", "on-target"],
      String(third),
    );
  }
});

// The audio heard at clock time `clock`, in seconds: whole blocks of 1024 samples at
// `sampleRate`, the first in at `firstBlock` seconds.
function audioAt(clock, sampleRate, firstBlock) {
  const block = 1024 / sampleRate;
  return (Math.floor((clock - firstBlock) / block) + 1) * block;
}

test("whatever the blocks' phase, a cue changes on the third read after the first call", () => {
  for (const sampleRate of [48000, 44100, 16000, 8000]) {
    for (let step = 0; step < 200; step += 1) {
      const firstBlock = 0.02 + (step / 200) * (1024 / sampleRate);
      // Reads at whole clock seconds 6 to 12: the first number at 6 s, Slow down called from 7 s.
      const ats = [6, 7, 8, 9, 10, 11, 12].map((clock) => audioAt(clock, sampleRate, firstBlock));
      const cues = cuesAt(ats, [150, 180, 180, 180, 180, 180, 180]);
      assert.equal(cues.indexOf("slow-down"), 4, sampleRate + " Hz, first block " + firstBlock);
    }
  }
});
