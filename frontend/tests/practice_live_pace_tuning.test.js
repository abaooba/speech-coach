// Tests for what a take's live pace capture hands its tuning, and what the tuning keeps
// (frontend/screens/practice.js; spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md
// section 7, Factor and Capture). The tracker counts its peaks from its first sample, the
// transcript its words from the recorder's start, so every peak moves by the time between the
// two: the first block's arrival less the block's own length, whatever the rate, set by the
// first block alone. In level mode the capture only collects peaks for the tuning: the tracker
// is never read. A take that counts (app.delivery.countsForPaceFactor) keeps its mode's factor
// even when paceFactorAfter gives it back unmoved, so the next take of that mode shows the
// number; a take that does not count keeps nothing.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { flush, levelRequest, plain } = require("./practice-harness");
const {
  ANALYSIS,
  CUE,
  DELIVERY_SOURCE,
  SECOND,
  TALK_FLAG,
  WORDS,
  block,
  fakeDelivery,
  lastTracker,
  paceRow,
  readNext,
  rowView,
  setup,
} = require("./live-pace-harness");

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
  // Tuned too: an untuned take is never read anyway, while a tuned one is read once a second
  // in normal mode, so only level mode keeps it unread.
  for (const tuned of [false, true]) {
    const label = tuned ? "tuned" : "untuned";
    const { request } = levelRequest();
    const t = setup({ flags: tuned ? { [TALK_FLAG]: 0.8 } : {} });
    t.startLevel(request);
    await flush();
    await t.startRecording();
    const tracker = lastTracker(t);
    assert.equal(tracker.options.factor, tuned ? 0.8 : null, label + ": Talk's kept factor");
    for (let second = 0; second < 12; second += 1) {
      block(t);
      t.clock.advance(SECOND);
    }
    assert.equal(tracker.blocks.length, 12, label + ": every block reaches the tracker");
    assert.equal(tracker.reads, 0, label + ": nothing reads it");
    assert.equal(paceRow(t).hidden, true, label);
  }
});

// --- what a take keeps ---

test("a take that counts keeps its mode's factor even when it did not move", async () => {
  const t = setup();
  await t.show();
  // The fake counts a take it hands a factor of its own: here 0.69, where nothing kept starts.
  t.app.delivery.nextFactor = 0.69;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.69]]);
  assert.equal(t.flags.get(TALK_FLAG), 0.69);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.69);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 150 wpm On target", "the number from the next take on");
});

// Practice with delivery.js's own paceFactorAfter and countsForPaceFactor beside the fake
// tracker, whose peaks each test sets.
function withRealTuning() {
  const real = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app: real }, { filename: "delivery.js" });
  const delivery = fakeDelivery();
  delivery.paceFactorAfter = real.delivery.paceFactorAfter;
  delivery.countsForPaceFactor = real.delivery.countsForPaceFactor;
  return setup({ delivery });
}

// `count` peaks `step` seconds apart from 0.9 s.
function peaksFrom(count, step) {
  return Array.from({ length: count }, (_, i) => Math.round((0.9 + i * step) * 1000) / 1000);
}

test("with delivery.js's tuning, 40 words over 24 s and 58 peaks keep 0.69 for Talk", async () => {
  // 40 / 58 words a peak is 0.6897: halfway from 0.69 it rounds to 0.69 again.
  const t = withRealTuning();
  await t.show();
  await t.recordTake(25 * SECOND, { peaks: peaksFrom(58, 0.4) });
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.69]]);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.69);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 150 wpm On target");
});

test("with delivery.js's tuning, the same words a peak over 17.8 s keeps nothing", async () => {
  const short = WORDS.map((word, i) => ({
    text: word.text,
    start: Math.round((1 + i * 0.445) * 1000) / 1000,
    end: Math.round((1.4 + i * 0.445) * 1000) / 1000,
  }));
  const t = withRealTuning();
  await t.show();
  await t.recordTake(25 * SECOND, { peaks: peaksFrom(58, 0.3) });
  t.resolveUpload({ ...ANALYSIS, transcript: short });
  await flush();
  assert.deepEqual(t.calls.setFlag, []);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "still none");
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 150 wpm Rough until tuned", "still untuned");
});
