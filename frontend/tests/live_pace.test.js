// Tests for the live pace estimator in frontend/delivery.js (spec 2026-10-22 section 7). The
// tracker app.delivery.livePace counts syllable peaks in the microphone's samples as they
// arrive, after de Jong and Wempe (2009); livePaceAt turns the peaks into words a minute over
// the trailing window, from the first run of syllables (a lone tap or breath before the speech
// never starts it); nextLiveReading applies the live row's rules (rounded to 5, a 10 wpm
// margin held 3 s, a silence over 1.5 s keeps the last value); paceFactorAfter tunes the
// words-a-peak factor from a finished take. The module is pure, so it loads into a bare vm
// context. The signals are synthetic and seeded: voiced syllables (a harmonic tone under a
// raised-cosine envelope) at a known rate in phrases, unvoiced hiss, hum, silence, and white
// noise at a set signal-to-noise ratio.
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

// Feeds `samples` to a new tracker in blocks of `blockSize`, as a ScriptProcessor hands them.
function trackerFed(samples, sampleRate, blockSize = 1024, options) {
  const tracker = delivery.livePace(sampleRate, options);
  for (let from = 0; from < samples.length; from += blockSize) {
    tracker.push(samples.subarray(from, Math.min(samples.length, from + blockSize)));
  }
  return tracker;
}

function peaksOf(samples, sampleRate, blockSize) {
  return Array.from(trackerFed(samples, sampleRate, blockSize).peaks());
}

// Peaks every `step` seconds from `from` up to `to`, inclusive.
function evenPeaks(from, to, step) {
  const peaks = [];
  for (let i = 0; from + i * step <= to + 1e-9; i += 1) {
    peaks.push(Math.round((from + i * step) * 1000) / 1000);
  }
  return peaks;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("delivery.js adds the live pace helpers to app.delivery and nothing else to app", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  assert.deepEqual(Object.keys(app), ["delivery"]);
  for (const name of ["livePace", "livePaceAt", "nextLiveReading", "paceFactorAfter"]) {
    assert.equal(typeof app.delivery[name], "function", name);
  }
  assert.equal(app.delivery.LIVE_PACE_FACTOR, 0.69);
});

for (const rate of [3, 4, 5, 6]) {
  for (const snrDb of [30, 20, 10, 5]) {
    test(`counts ${rate} syllables a second within 15% at ${snrDb} dB SNR`, () => {
      const signal = speechLike({ rate, snrDb, seed: rate * 100 + snrDb });
      const ratio = peaksOf(signal.samples, 16000).length / signal.syllables.length;
      assert.ok(Math.abs(ratio - 1) <= 0.15, `found ${ratio.toFixed(2)} peaks a syllable`);
    });
  }
}

test("counts the same at a phone's own sample rates, 44.1 and 48 kHz", () => {
  for (const sampleRate of [44100, 48000]) {
    const signal = speechLike({ sampleRate, seconds: 12, rate: 4, snrDb: 20, seed: 7 });
    const ratio = peaksOf(signal.samples, sampleRate).length / signal.syllables.length;
    assert.ok(Math.abs(ratio - 1) <= 0.15, `${sampleRate} Hz: ${ratio.toFixed(2)} a syllable`);
  }
});

test("the size of the blocks the microphone hands over changes nothing", () => {
  const { samples } = speechLike({ seconds: 8, rate: 5, snrDb: 20, seed: 11 });
  const expected = peaksOf(samples, 16000, 1024);
  assert.ok(expected.length > 20);
  for (const blockSize of [1, 333, 4096, samples.length]) {
    assert.deepEqual(peaksOf(samples, 16000, blockSize), expected, `blocks of ${blockSize}`);
  }
});

test("peaks are seconds from the first sample, in order, each inside a syllable", () => {
  const signal = speechLike({ seconds: 10, rate: 4, snrDb: 30, seed: 3, startSeconds: 2 });
  const peaks = peaksOf(signal.samples, 16000);
  assert.ok(peaks.length > 15);
  assert.ok(peaks[0] >= 2, `the first peak ${peaks[0]} s comes after the silence before speech`);
  peaks.forEach((peak, index) => {
    if (index > 0) {
      assert.ok(peak > peaks[index - 1], "in time order");
    }
    const nearest = Math.min(...signal.syllables.map((middle) => Math.abs(middle - peak)));
    assert.ok(nearest <= 0.1, `peak at ${peak} s, ${nearest.toFixed(3)} s from a syllable middle`);
  });
});

test("unvoiced hiss is not counted, however loud", () => {
  const random = seeded(5);
  const samples = new Float32Array(16000 * 10);
  for (let t = 0.5; t < 9.5; t += 0.25) {
    addHiss(samples, 16000, t, 0.12, 0.3, random);
  }
  assert.deepEqual(peaksOf(samples, 16000), []);
});

test("silence, a steady hum and a steady voiced buzz count nothing", () => {
  assert.deepEqual(peaksOf(new Float32Array(16000 * 5), 16000), []);
  const hum = new Float32Array(16000 * 5);
  const buzz = new Float32Array(16000 * 5);
  for (let i = 0; i < hum.length; i += 1) {
    hum[i] = 0.1 * Math.sin((2 * Math.PI * 60 * i) / 16000);
  }
  for (let i = 0; i < buzz.length; i += 1) {
    let tone = 0;
    for (let h = 1; h <= 8; h += 1) {
      tone += Math.sin((2 * Math.PI * 120 * h * i) / 16000) / h;
    }
    buzz[i] = 0.1 * tone;
  }
  assert.deepEqual(peaksOf(hum, 16000), [], "60 Hz hum");
  assert.deepEqual(peaksOf(buzz, 16000), [], "a level 120 Hz buzz is voiced but never rises");
});

test("livePaceAt gives nothing until 5 s have passed since the first peak", () => {
  const peaks = evenPeaks(1, 30, 0.25);
  assert.equal(delivery.livePaceAt(peaks, 5.99, 0.69), null);
  assert.equal(typeof delivery.livePaceAt(peaks, 6, 0.69), "number");
  assert.equal(delivery.livePaceAt([], 20, 0.69), null);
});

test("near the start the window is the time since the first peak, that peak left out", () => {
  // Peaks every 0.25 s from 1 s: at 7 s, 24 peaks after the first in 6 s.
  const peaks = evenPeaks(1, 30, 0.25);
  assert.equal(delivery.livePaceAt(peaks, 7, 0.69).toFixed(3), ((24 * 0.69 * 60) / 6).toFixed(3));
  // Peaks after the asked time are left out.
  assert.equal(
    delivery.livePaceAt(peaks, 7, 0.69).toFixed(3),
    delivery.livePaceAt(evenPeaks(1, 7, 0.25), 7, 0.69).toFixed(3),
  );
});

test("after 15 s only the trailing 15 s count", () => {
  // 60 peaks in (15, 30]: 60 x 0.69 words over a quarter of a minute.
  const expected = ((60 * 0.69 * 60) / 15).toFixed(3);
  assert.equal(delivery.livePaceAt(evenPeaks(1, 30, 0.25), 30, 0.69).toFixed(3), expected);
  // A burst of extra peaks before 15 s changes nothing at 30 s.
  const burst = [...evenPeaks(1, 14.9, 0.1), ...evenPeaks(15.25, 30, 0.25)];
  assert.equal(delivery.livePaceAt(burst, 30, 0.69).toFixed(3), expected);
});

test("a lone sound before the speech does not start the clock", () => {
  // A tap and a breath at 0.2 and 0.45 s, then syllables every 0.25 s from 2 s: speech starts
  // at 2 s, so the number waits until 7 s and counts as if the sounds were not there.
  const speech = evenPeaks(2, 30, 0.25);
  const withSounds = [0.2, 0.45, ...speech];
  assert.equal(delivery.livePaceAt(withSounds, 6.9, 0.69), null);
  const expected = ((20 * 0.69 * 60) / 5).toFixed(3);
  assert.equal(delivery.livePaceAt(withSounds, 7, 0.69).toFixed(3), expected);
  for (const at of [7, 12, 20]) {
    assert.equal(
      delivery.livePaceAt(withSounds, at, 0.69).toFixed(3),
      delivery.livePaceAt(speech, at, 0.69).toFixed(3),
      `at ${at} s`,
    );
  }
});

test("speech starts at the first peak two more follow within 1.5 s, and only then", () => {
  // Never three peaks within 1.5 s: no speech, no number.
  assert.equal(delivery.livePaceAt([1, 2, 3.2, 4.5, 6, 8, 9.6], 20, 0.69), null);
  // Three within exactly 1.5 s from 10 s start it: at 15 s the window is 5 s with 2 peaks.
  const peaks = [1, 2, 3.2, 10, 10.75, 11.5];
  assert.equal(delivery.livePaceAt(peaks, 14.9, 0.69), null);
  assert.equal(delivery.livePaceAt(peaks, 15, 0.69).toFixed(3), ((2 * 0.69 * 60) / 5).toFixed(3));
  // A peak after `at` cannot start the speech early.
  assert.equal(delivery.livePaceAt([1, 1.5, 9], 8, 0.69), null);
});

test("livePaceAt scales with the factor, and reads a missing or wild factor safely", () => {
  const peaks = evenPeaks(1, 30, 0.25);
  assert.equal(delivery.livePaceAt(peaks, 30, 1).toFixed(3), "240.000");
  assert.equal(delivery.livePaceAt(peaks, 30, 0.5).toFixed(3), "120.000");
  const usual = delivery.livePaceAt(peaks, 30, 0.69);
  for (const factor of [undefined, null, "0.9", Number.NaN]) {
    assert.equal(delivery.livePaceAt(peaks, 30, factor), usual, String(factor));
  }
  assert.equal(delivery.livePaceAt(peaks, 30, 3), delivery.livePaceAt(peaks, 30, 1.1));
  assert.equal(delivery.livePaceAt(peaks, 30, 0.1), delivery.livePaceAt(peaks, 30, 0.45));
});

// One read of the live row: `at` seconds, the estimate, seconds since the latest peak.
function readAt(previous, at, estimate, quietSeconds = 0.2, band = BAND) {
  return delivery.nextLiveReading(previous, { at, estimate, quietSeconds, band });
}

// Reads once a second from `from`, each with the next estimate; returns every state.
function readsFrom(from, estimates, start = null) {
  const states = [];
  let state = start;
  estimates.forEach((estimate, index) => {
    state = readAt(state, from + index, estimate);
    states.push(state);
  });
  return states;
}

function shown(state) {
  return { wpm: state.wpm, cue: state.cue };
}

test("until there is enough speech the row has no number and no cue", () => {
  assert.deepEqual(shown(readAt(null, 3, null)), { wpm: null, cue: null });
  assert.deepEqual(shown(readAt(readAt(null, 3, null), 4, null)), { wpm: null, cue: null });
});

test("the number is rounded to 5", () => {
  const cases = [
    [152.4, 150],
    [152.5, 155],
    [147.6, 150],
    [163.9, 165],
    [97.4, 95],
  ];
  for (const [estimate, wpm] of cases) {
    assert.equal(readAt(null, 6, estimate).wpm, wpm, String(estimate));
  }
});

test("the first number starts On target, even far outside the band", () => {
  assert.equal(readAt(null, 6, 150).cue, "on-target");
  assert.equal(readAt(null, 6, 200).cue, "on-target");
  assert.equal(readAt(null, 6, 90).cue, "on-target");
});

test("Slow down shows once the number has been more than 10 over the band for 3 s", () => {
  // 170 is exactly 10 over 160: still On target, nothing pending.
  const atTen = readsFrom(6, [150, 170, 170, 170, 170, 170]);
  assert.deepEqual(atTen.map((state) => state.cue), Array(6).fill("on-target"));
  // 175 from 7 s: held at 7, 8 and 9 s, shown at 10 s.
  const over = readsFrom(6, [150, 175, 175, 175, 175, 175]);
  assert.deepEqual(
    over.map((state) => state.cue),
    ["on-target", "on-target", "on-target", "on-target", "slow-down", "slow-down"],
  );
  assert.equal(over[4].wpm, 175);
});

test("Speed up shows once the number has been more than 10 under the band for 3 s", () => {
  const atTen = readsFrom(6, [150, 130, 130, 130, 130]);
  assert.deepEqual(atTen.map((state) => state.cue), Array(5).fill("on-target"));
  const under = readsFrom(6, [150, 125, 125, 125, 125]);
  assert.deepEqual(
    under.map((state) => state.cue),
    ["on-target", "on-target", "on-target", "on-target", "speed-up"],
  );
});

test("a read back inside the margin starts the 3 s hold again", () => {
  const states = readsFrom(6, [150, 175, 175, 165, 175, 175, 175, 175]);
  assert.deepEqual(
    states.map((state) => state.cue),
    [
      "on-target",
      "on-target",
      "on-target",
      "on-target",
      "on-target",
      "on-target",
      "on-target",
      "slow-down",
    ],
  );
});

test("a cue goes straight from Slow down to Speed up only after its own 3 s", () => {
  const slow = readsFrom(6, [150, 180, 180, 180, 180]);
  assert.equal(slow[4].cue, "slow-down");
  const states = readsFrom(11, [120, 120, 120, 120], slow[4]);
  assert.deepEqual(
    states.map((state) => state.cue),
    ["slow-down", "slow-down", "slow-down", "speed-up"],
  );
});

test("back to On target only after 3 s within the margin", () => {
  const slow = readsFrom(6, [150, 180, 180, 180, 180]);
  const states = readsFrom(11, [165, 165, 165, 165], slow[4]);
  assert.deepEqual(
    states.map((state) => state.cue),
    ["slow-down", "slow-down", "slow-down", "on-target"],
  );
  assert.deepEqual(states.map((state) => state.wpm), [165, 165, 165, 165]);
});

test("a silence over 1.5 s keeps the number and the cue as they were", () => {
  const before = readAt(null, 6, 150);
  const quiet = readAt(before, 7, 100, 1.6);
  assert.deepEqual(shown(quiet), { wpm: 150, cue: "on-target" });
  // At exactly 1.5 s it is not yet a silence: the number moves.
  assert.equal(readAt(before, 7, 100, 1.5).wpm, 100);
  // A cue held before the silence stays through it.
  const slow = readsFrom(6, [150, 180, 180, 180, 180]);
  assert.deepEqual(shown(readAt(slow[4], 11, 150, 4)), { wpm: 180, cue: "slow-down" });
});

test("a silence before the first number keeps the placeholder", () => {
  assert.deepEqual(shown(readAt(null, 6, 150, 2)), { wpm: null, cue: null });
});

test("without a band the number shows with no cue", () => {
  for (const band of [null, undefined, [150], [160, "x"], [160, 140], "140-160"]) {
    const state = delivery.nextLiveReading(null, { at: 6, estimate: 152, quietSeconds: 0.2, band });
    assert.deepEqual(shown(state), { wpm: 150, cue: null }, String(band));
  }
});

test("a tracker shows nothing until 5 s of speech, then the syllables' pace rounded to 5", () => {
  const sampleRate = 48000;
  const signal = speechLike({ sampleRate, seconds: 22, snrDb: 20, seed: 21, startSeconds: 1 });
  const tracker = delivery.livePace(sampleRate, { band: BAND });
  const readings = [];
  for (let from = 0, second = 1; from < signal.samples.length; from += 1024) {
    tracker.push(signal.samples.subarray(from, Math.min(signal.samples.length, from + 1024)));
    if (tracker.seconds() >= second) {
      readings.push({ at: second, ...tracker.read(second) });
      second += 1;
    }
  }
  const firstPeak = tracker.peaks()[0];
  const early = readings.filter((reading) => reading.at < firstPeak + 5);
  const later = readings.filter((reading) => reading.at >= firstPeak + 5);
  assert.ok(early.length >= 5);
  assert.ok(early.every((reading) => reading.wpm === null && reading.cue === null));
  assert.ok(later.length >= 10);
  assert.ok(later.every((reading) => reading.wpm % 5 === 0 && reading.cue !== null));
  // At 20 s: the syllables of the trailing 15 s at 0.69 words a syllable, within 15%.
  const at20 = readings.find((reading) => reading.at === 20);
  const truth = (signal.syllables.filter((t) => t > 5 && t <= 20).length * 0.69 * 60) / 15;
  assert.ok(Math.abs(at20.wpm / truth - 1) <= 0.15, `read ${at20.wpm}, truth ${truth.toFixed(1)}`);
});

test("a faint voiced sound before the take begins is a peak, but no start of speech", () => {
  const sampleRate = 16000;
  const signal = speechLike({ sampleRate, seconds: 14, snrDb: 30, seed: 23, startSeconds: 2.5 });
  addSyllable(signal.samples, sampleRate, 0.3, 0.06, 0.05, 120);
  const tracker = trackerFed(signal.samples, sampleRate, 1024, { band: BAND });
  const peaks = tracker.peaks();
  assert.ok(peaks[0] < 0.5, `the sound at 0.3 s is a peak (first peak ${peaks[0]} s)`);
  const firstSyllable = peaks.find((peak) => peak > 2);
  assert.deepEqual(plain(tracker.read(firstSyllable + 4.9)), { wpm: null, cue: null });
  assert.equal(typeof tracker.read(firstSyllable + 5.5).wpm, "number");
});

test("after the speech stops the tracker keeps its last reading", () => {
  const sampleRate = 16000;
  const signal = speechLike({ sampleRate, seconds: 14, rate: 4, snrDb: 30, seed: 9 });
  const tracker = trackerFed(signal.samples, sampleRate, 1024, { band: BAND });
  const last = tracker.read(12);
  assert.equal(typeof last.wpm, "number");
  tracker.push(new Float32Array(sampleRate * 4));
  assert.deepEqual(plain(tracker.read()), plain(last));
});

test("read() with no time reads at the audio heard so far", () => {
  const sampleRate = 16000;
  const { samples } = speechLike({ sampleRate, seconds: 12, rate: 5, snrDb: 20, seed: 13 });
  const plainRead = trackerFed(samples, sampleRate, 1024, { band: BAND });
  const timedRead = trackerFed(samples, sampleRate, 1024, { band: BAND });
  assert.equal(plainRead.seconds(), samples.length / sampleRate);
  assert.deepEqual(plain(plainRead.read()), plain(timedRead.read(samples.length / sampleRate)));
});

test("peaks() hands back a copy", () => {
  const { samples } = speechLike({ seconds: 6, rate: 4, snrDb: 30, seed: 17 });
  const tracker = trackerFed(samples, 16000);
  const peaks = tracker.peaks();
  const count = peaks.length;
  peaks.push(99);
  peaks[0] = -1;
  assert.equal(tracker.peaks().length, count);
  assert.notEqual(tracker.peaks()[0], -1);
});

test("the tracker's factor scales the number, and a band gives it a cue", () => {
  const { samples } = speechLike({ seconds: 20, rate: 4, snrDb: 30, seed: 19 });
  const usual = trackerFed(samples, 16000, 1024, { band: BAND }).read(15);
  const missing = trackerFed(samples, 16000, 1024, { band: BAND, factor: "high" }).read(15);
  const higher = trackerFed(samples, 16000, 1024, { band: BAND, factor: 0.9 }).read(15);
  const peaks = trackerFed(samples, 16000).peaks();
  const round5 = (value) => Math.round(value / 5) * 5;
  assert.equal(usual.wpm, round5(delivery.livePaceAt(peaks, 15, 0.69)));
  assert.deepEqual(plain(missing), plain(usual));
  assert.equal(higher.wpm, round5(delivery.livePaceAt(peaks, 15, 0.9)));
  assert.equal(usual.cue, "on-target");
  assert.equal(trackerFed(samples, 16000).read(15).cue, null, "no band, no cue");
});

test("a tracker needs a sample rate of 8 kHz or more", () => {
  // The vm context has its own RangeError class, so the error is checked by name.
  for (const sampleRate of [undefined, 0, 4000, Number.NaN, "48000"]) {
    assert.throws(
      () => delivery.livePace(sampleRate),
      (error) => error.name === "RangeError",
      String(sampleRate),
    );
  }
  assert.doesNotThrow(() => delivery.livePace(8000));
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

test("a take moves the factor halfway to its own words a peak, from 0.69 at first", () => {
  const words = wordsOf(60); // 60 words over 23.9 s
  const peaks = peaksOver(words, 80); // 0.75 words a peak
  assert.equal(delivery.paceFactorAfter(0.69, words, peaks), 0.72);
  for (const kept of [undefined, null, "0.8", Number.NaN]) {
    assert.equal(delivery.paceFactorAfter(kept, words, peaks), 0.72, String(kept));
  }
  assert.equal(delivery.paceFactorAfter(0.8, words, peaks), 0.775);
});

test("hesitation sounds are not words, and peaks outside the speech do not count", () => {
  const words = wordsOf(60, [3, 10, 20, 30, 40, 50]); // 54 words
  const peaks = peaksOver(words, 90); // 0.6 words a peak
  assert.equal(delivery.paceFactorAfter(0.69, words, peaks), 0.645);
  const last = words[words.length - 1].end;
  const outside = [0.2, ...peaks, last + 0.6, last + 3];
  assert.equal(delivery.paceFactorAfter(0.69, words, outside), 0.645);
  // A peak just outside the first word or the last still counts: the recorder and the
  // tracker start a moment apart.
  const edges = [0.8, ...peaks.slice(1, -1), last + 0.2];
  assert.equal(delivery.paceFactorAfter(0.69, words, edges), 0.645);
});

test("a take under 20 s of speech or 30 words, or with no peaks, leaves the factor alone", () => {
  const short = wordsOf(50).map((word, i) => ({ ...word, start: i * 0.38, end: i * 0.38 + 0.3 }));
  assert.ok(short[short.length - 1].end - short[0].start < 20);
  assert.equal(delivery.paceFactorAfter(0.8, short, peaksOver(short, 70)), 0.8);
  const fewWords = wordsOf(60, [1, ...Array.from({ length: 30 }, (_, i) => i * 2)]); // 29 words
  assert.equal(delivery.paceFactorAfter(0.8, fewWords, peaksOver(fewWords, 40)), 0.8);
  assert.equal(delivery.paceFactorAfter(0.8, wordsOf(60), []), 0.8);
  assert.equal(delivery.paceFactorAfter(0.8, [], [1, 2, 3]), 0.8);
  assert.equal(delivery.paceFactorAfter(undefined, null, null), 0.69);
});

test("the factor stays within 0.45 and 1.1, whatever a take or the kept value says", () => {
  const words = wordsOf(60);
  const tooFewPeaks = peaksOver(words, 20); // 3 words a peak
  const tooManyPeaks = peaksOver(words, 300); // 0.2 words a peak
  assert.equal(delivery.paceFactorAfter(0.69, words, tooFewPeaks), 0.895);
  assert.equal(delivery.paceFactorAfter(1.1, words, tooFewPeaks), 1.1);
  assert.equal(delivery.paceFactorAfter(0.69, words, tooManyPeaks), 0.57);
  assert.equal(delivery.paceFactorAfter(0.45, words, tooManyPeaks), 0.45);
  let factor = 0.69;
  for (let take = 0; take < 10; take += 1) {
    factor = delivery.paceFactorAfter(factor, words, tooFewPeaks);
    assert.ok(factor <= 1.1, `take ${take + 1}: ${factor}`);
  }
  assert.ok(factor >= 1.09, `ten takes reach the ceiling: ${factor}`);
  assert.equal(delivery.paceFactorAfter(3, words, peaksOver(words, 80)), 0.925);
  assert.equal(delivery.paceFactorAfter(-1, words, peaksOver(words, 80)), 0.6);
});

test("paceFactorAfter is pure: the same answer every time and its inputs untouched", () => {
  const words = wordsOf(60);
  const peaks = peaksOver(words, 80);
  const before = JSON.stringify({ words, peaks });
  const first = delivery.paceFactorAfter(0.7, words, peaks);
  assert.equal(delivery.paceFactorAfter(0.7, words, peaks), first);
  assert.equal(JSON.stringify({ words, peaks }), before);
});
