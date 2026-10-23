// Tests for what a take's live pace capture hands its tuning (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7, Factor and Capture).
// The tracker counts its peaks from its first sample, the transcript its words from the
// recorder's start, so every peak moves by the time between the two: the first block's arrival
// less the block's own length, whatever the rate, set by the first block alone. In level mode
// the capture only collects peaks for the tuning: the tracker is never read.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { flush, levelRequest } = require("./practice-harness");
const { SECOND, block, lastTracker, paceRow, setup } = require("./live-pace-harness");

// The peaks the take handed its tuning, to the millisecond.
function tunedPeaks(t) {
  const [tuning] = t.app.delivery.tunings;
  return tuning.peaks.map((peak) => Math.round(peak * 1000) / 1000);
}

// A 25 s take whose first block of 1024 samples arrives `firstBlockMs` after the recorder
// starts, then more blocks at the times in `laterBlocksMs`; the tracker reports peaks at 0.5, 1
// and 1.5 s and the analysis comes back.
async function tuneOneTake(t, firstBlockMs, laterBlocksMs = []) {
  await t.show();
  await t.startRecording();
  t.clock.advance(firstBlockMs);
  block(t);
  let at = firstBlockMs;
  for (const blockMs of laterBlocksMs) {
    t.clock.advance(blockMs - at);
    block(t);
    at = blockMs;
  }
  lastTracker(t).peakTimes = [0.5, 1, 1.5];
  t.clock.advance(25 * SECOND - at);
  await t.stopRecording();
  t.resolveUpload();
  await flush();
}

test("the peaks move by the first block's arrival less its own 1024 samples, at any rate", async () => {
  // 1024 samples are 21.3 ms at 48 kHz, 64 ms at 16 kHz and 128 ms at 8 kHz.
  for (const [sampleRate, firstBlockMs, expected] of [
    [48000, 120, [0.599, 1.099, 1.599]],
    [16000, 200, [0.636, 1.136, 1.636]],
    [8000, 200, [0.572, 1.072, 1.572]],
  ]) {
    const t = setup({ audio: { sampleRate } });
    await tuneOneTake(t, firstBlockMs);
    assert.deepEqual(tunedPeaks(t), expected, sampleRate + " Hz");
  }
});

test("only the first block sets the move: blocks after it leave the peaks where they were", async () => {
  const t = setup();
  await tuneOneTake(t, 120, [141, 1000, 2000, 24000]);
  assert.equal(lastTracker(t).blocks.length, 5);
  assert.deepEqual(tunedPeaks(t), [0.599, 1.099, 1.599]);
});

test("in level mode the capture collects peaks for the tuning, but the tracker is never read", async () => {
  const { request } = levelRequest();
  const t = setup();
  t.startLevel(request);
  await t.startRecording();
  for (let second = 0; second < 12; second += 1) {
    block(t);
    t.clock.advance(SECOND);
  }
  const tracker = lastTracker(t);
  assert.equal(tracker.blocks.length, 12, "every block reaches the tracker");
  assert.equal(tracker.reads, 0, "nothing reads it");
  assert.equal(paceRow(t).hidden, true);
});
