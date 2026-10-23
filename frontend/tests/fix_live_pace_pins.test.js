// Pins four rules of the live pace estimator in frontend/delivery.js (spec 2026-10-22 section 7)
// that no other test held: each one could be changed with the rest of the suite still passing.
// At 8 kHz the band's top is kept under the Nyquist limit; a cue that turns into another while
// it waits starts the new cue's own 3 s hold; the pitch range stops at 400 Hz; and read(at)
// judges a silence from the peaks heard by `at` only, even when the whole take was pushed
// first. Each test passes on the code and fails on that change. The speech-like signal is
// live_pace.test.js's own (voiced syllables at a known rate in phrases, an "s" after every 4th,
// white noise at a set signal-to-noise ratio), copied here since that file exports nothing.
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

// --- live_pace.test.js's signal, unchanged ---

// A small seeded generator, so every signal is the same on every run.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Adds one voiced syllable: 12 harmonics of f0 under a raised-cosine envelope. sin(h x) comes
// from the recurrence sin(h x) = 2 cos(x) sin((h - 1) x) - sin((h - 2) x).
function addSyllable(out, sampleRate, startSeconds, seconds, peak, f0) {
  const from = Math.round(startSeconds * sampleRate);
  const length = Math.round(seconds * sampleRate);
  for (let k = 0; k < length && from + k < out.length; k += 1) {
    const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / length);
    const x = (2 * Math.PI * f0 * (from + k)) / sampleRate;
    const twoCos = 2 * Math.cos(x);
    let before = 0;
    let current = Math.sin(x);
    let tone = current;
    for (let h = 2; h <= 12; h += 1) {
      const next = twoCos * current - before;
      before = current;
      current = next;
      tone += current / h;
    }
    out[from + k] += peak * envelope * tone * 0.5;
  }
}

// An unvoiced "s": high-passed noise (each value minus the one before) for `seconds`.
function addHiss(out, sampleRate, startSeconds, seconds, level, random) {
  const from = Math.round(startSeconds * sampleRate);
  const length = Math.round(seconds * sampleRate);
  let previous = 0;
  for (let k = 0; k < length && from + k < out.length; k += 1) {
    const value = random() * 2 - 1;
    out[from + k] += level * (value - previous);
    previous = value;
  }
}

// White noise at `snrDb` below the signal's own RMS.
function addNoise(out, snrDb, random) {
  let sum = 0;
  for (const value of out) {
    sum += value * value;
  }
  const noiseRms = Math.sqrt(sum / out.length) / 10 ** (snrDb / 20);
  for (let i = 0; i < out.length; i += 1) {
    out[i] += noiseRms * Math.sqrt(3) * (random() * 2 - 1);
  }
}

// Speech-like signal: phrases of `perPhrase` syllables at about `rate` a second with
// `pauseSeconds` between phrases, an "s" after every 4th syllable, and noise at `snrDb`.
// Returns {samples, syllables} with each syllable's middle in seconds.
function speechLike(options) {
  const {
    sampleRate = 16000,
    seconds = 20,
    rate = 4,
    perPhrase = 8,
    pauseSeconds = 0.8,
    snrDb = 20,
    seed = 1,
    startSeconds = 0.5,
  } = options;
  const random = seeded(seed);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const syllables = [];
  let t = startSeconds;
  while (t < seconds - 1) {
    for (let i = 0; i < perPhrase && t < seconds - 1; i += 1) {
      const period = (1 / rate) * (0.8 + 0.4 * random());
      const length = period * 0.75;
      const peak = 0.3 * (0.6 + 0.4 * random());
      addSyllable(samples, sampleRate, t, length, peak, 110 + 30 * random());
      syllables.push(t + length / 2);
      if (syllables.length % 4 === 0) {
        addHiss(samples, sampleRate, t + length, 0.08, 0.12, random);
      }
      t += period;
    }
    t += pauseSeconds;
  }
  if (snrDb !== null) {
    addNoise(samples, snrDb, random);
  }
  return { samples, syllables };
}

// --- end of the copy ---

// Feeds `samples` to a new tracker in blocks of 1024, as a ScriptProcessor hands them.
function trackerFed(samples, sampleRate, options) {
  const tracker = delivery.livePace(sampleRate, options);
  for (let from = 0; from < samples.length; from += 1024) {
    tracker.push(samples.subarray(from, Math.min(samples.length, from + 1024)));
  }
  return tracker;
}

test("at 8 kHz syllables still count: the band's top stays under the Nyquist limit", () => {
  // 8 kHz audio holds nothing over 4000 Hz, so the 5000 Hz top of the band is cut to 45% of
  // the rate, 3600 Hz. A low-pass set over the limit finds no peak at all.
  const sampleRate = 8000;
  const signal = speechLike({ sampleRate, seconds: 12, rate: 4, snrDb: 20, seed: 7 });
  const tracker = trackerFed(signal.samples, sampleRate, { band: BAND });
  const ratio = tracker.peaks().length / signal.syllables.length;
  assert.ok(Math.abs(ratio - 1) <= 0.15, `found ${ratio.toFixed(2)} peaks a syllable`);
  assert.equal(typeof tracker.read(11).wpm, "number");
});

// One read of the live row against the band: `at` seconds and the estimate, mid-speech.
function readAt(previous, at, estimate) {
  return delivery.nextLiveReading(previous, { at, estimate, quietSeconds: 0.2, band: BAND });
}

test("a waiting Slow down that turns into Speed up waits Speed up's own 3 s", () => {
  // 150 at 6 s is On target. 175 at 7 s calls for Slow down, which waits; 125 from 8 s calls
  // for Speed up instead, so its hold starts at 8 s, not at 7 s, and with the half second of
  // slack it shows from 10.5 s: at 11 s on reads once a second.
  const waiting = readAt(readAt(null, 6, 150), 7, 175);
  assert.deepEqual(
    [waiting.cue, waiting.pendingCue, waiting.pendingSince],
    ["on-target", "slow-down", 7],
  );
  const turned = readAt(waiting, 8, 125);
  assert.deepEqual(
    [turned.cue, turned.pendingCue, turned.pendingSince],
    ["on-target", "speed-up", 8],
  );
  let state = waiting;
  const cues = [8, 9, 10, 11].map((at) => {
    state = readAt(state, at, 125);
    return state.cue;
  });
  assert.deepEqual(cues, ["on-target", "on-target", "on-target", "speed-up"]);
  // Read every tenth of a second from 8 s, Speed up first shows at exactly 10.5 s.
  state = waiting;
  let shownAt = null;
  for (let tenths = 80; tenths <= 140 && shownAt === null; tenths += 1) {
    state = readAt(state, tenths / 10, 125);
    if (state.cue === "speed-up") {
      shownAt = tenths / 10;
    }
  }
  assert.equal(shownAt, 10.5);
});

// 40 bursts of noise 180 ms long, 4 a second, at 16 kHz, each rung through a two-pole
// resonator at `hz` that is `width` Hz wide: a buzz that repeats closely over one period of
// `hz`, and less closely over each period after it.
function resonatorBursts(hz, width, seed) {
  const sampleRate = 16000;
  const random = seeded(seed);
  const samples = new Float32Array(sampleRate * 10);
  const radius = Math.exp((-Math.PI * width) / sampleRate);
  const a1 = -2 * radius * Math.cos((2 * Math.PI * hz) / sampleRate);
  const a2 = radius * radius;
  const burst = Math.round(0.18 * sampleRate);
  const period = Math.round(0.25 * sampleRate);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const y = random() * 2 - 1 - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    const k = i % period;
    const envelope = k < burst ? 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / burst) : 0;
    samples[i] = 0.02 * y * envelope;
  }
  return samples;
}

test("the pitch range stops at 400 Hz: a buzz ringing at 460 Hz is voiced in under 40%", () => {
  // At 460 Hz a burst repeats every 35 samples. The voicing check's shortest lag is 40 samples,
  // a 400 Hz period, so that repeat is never checked. Some bursts still pass at a longer lag
  // (146 of 480); a range up to 500 Hz checks the 35-sample lag and passes 286.
  const bursts = 12 * 40;
  let counted = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    counted += trackerFed(resonatorBursts(460, 130, seed), 16000).peaks().length;
  }
  assert.ok(counted < 0.4 * bursts, `${counted} of ${bursts} bursts counted`);
});

test("read(at) holds through a pause when the whole take was pushed first", () => {
  // Two 10 s stretches of speech with 4 s of silence between, every block pushed before the
  // first read, then read once a second in time order. The first stretch's last peak comes
  // before 9.5 s, so from 11 s the quiet before `at` is over 1.5 s and the number holds. The
  // second stretch's peaks, all after 14 s, must not count as sound heard by then.
  const sampleRate = 16000;
  const first = speechLike({ sampleRate, seconds: 10, rate: 4, snrDb: 30, seed: 3 }).samples;
  const second = speechLike({ sampleRate, seconds: 10, rate: 4, snrDb: 30, seed: 4 }).samples;
  const samples = new Float32Array(first.length + 4 * sampleRate + second.length);
  samples.set(first, 0);
  samples.set(second, first.length + 4 * sampleRate);
  const tracker = trackerFed(samples, sampleRate, { band: BAND });
  const peaks = tracker.peaks();
  assert.ok(peaks.every((peak) => peak < 9.5 || peak > 14), "no peak from 9.5 s to 14 s");
  assert.ok(peaks.some((peak) => peak > 14), "the second stretch has peaks");
  const wpm = {};
  for (let at = 6; at <= 14; at += 1) {
    wpm[at] = tracker.read(at).wpm;
  }
  assert.equal(typeof wpm[10], "number");
  assert.deepEqual([wpm[11], wpm[12], wpm[13], wpm[14]], [wpm[10], wpm[10], wpm[10], wpm[10]]);
});
