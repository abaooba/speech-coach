// Pins the live pace detector's rules (spec 2026-10-22 section 7) one at a time, so that
// changing any of them fails a test: loudness read in the 100 to 5000 Hz band over 32 ms
// windows every 8 ms; a peak 2 dB over the running median, with a dip of 1.5 dB since the last
// peak, the loudest window within 3 hops either side; voiced at a normalized autocorrelation of
// 0.45 or more for a pitch of 75 Hz or more; the median kept in 0.05 dB bins; a sample that is
// not a finite number read as silence. live_pace.test.js checks that speech-like signals count
// right; the signals here sit just either side of one rule each: a steady 1 kHz tone that swells
// by set amounts or grows louder for whole 8 ms hops, bursts at set frequencies, pulse trains at
// set pitches, and a voice mixed with noise. Every signal is built from exact numbers or a
// seeded generator, so each run is the same.
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
const RATE = 16000;
// The detector's hop at 16 kHz: 8 ms, counted from the first sample.
const HOP = 128;

// A small seeded generator, so every signal is the same on every run.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// The tracker's peaks for `samples`, fed in blocks of 1024 as a ScriptProcessor hands them.
function peaksOf(samples, sampleRate = RATE) {
  const tracker = delivery.livePace(sampleRate);
  for (let from = 0; from < samples.length; from += 1024) {
    tracker.push(samples.subarray(from, Math.min(samples.length, from + 1024)));
  }
  return tracker.peaks();
}

// The peaks between `from` and `to` seconds.
function peaksWithin(peaks, from, to) {
  return peaks.filter((peak) => peak >= from && peak <= to);
}

// The amplitude of a sine whose 32 ms windows read `levelDb` (0 dB is full scale): a sine's
// mean square is half its amplitude squared.
function amplitudeFor(levelDb) {
  return Math.sqrt(2 * 10 ** (levelDb / 10));
}

// A 1 kHz tone `seconds` long that starts at `fromSeconds` (silence before it) with a 20 ms
// fade-in, its amplitude `amplitude` times gainAt(seconds). At 16 kHz a hop holds 8 of its
// periods, so every hop of the steady tone carries the same power.
function tone(seconds, amplitude, gainAt = () => 1, fromSeconds = 0) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const start = Math.round(fromSeconds * RATE);
  const fade = Math.round(0.02 * RATE);
  for (let i = start; i < samples.length; i += 1) {
    const fadeIn = Math.min(1, (i - start) / fade);
    samples[i] = amplitude * fadeIn * gainAt(i / RATE) * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  }
  return samples;
}

// A raised-cosine step from `from` to `to` over `seconds`, `t` seconds in.
function ramp(from, to, t, seconds) {
  const share = Math.min(1, Math.max(0, t / seconds));
  return from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * share));
}

// Swells of a steady tone: each {at, db} rises by `db` over 20 ms from `at`, holds for 60 ms
// (long enough for whole windows at the top) and falls back over 20 ms. As an amplitude gain.
function swells(list) {
  return (t) => {
    const swell = list.find(({ at }) => t >= at && t < at + 0.1);
    if (!swell) {
      return 1;
    }
    const d = t - swell.at;
    const db = d < 0.02 ? ramp(0, swell.db, d, 0.02) : ramp(swell.db, 0, d - 0.08, 0.02);
    return 10 ** (db / 20);
  };
}

// The middle of a swell from swells(): its top runs from 20 to 80 ms after `at`.
function swellMiddle(swell) {
  return swell.at + 0.05;
}

test("loudness is read in the 100 to 5000 Hz band", () => {
  // At 48 kHz, a phone's own rate, over a steady 1 kHz tone: bursts strong enough to make a
  // window 7 dB louder unfiltered. Inside the band (125 Hz, 1.5 kHz, 4 kHz) they lose under
  // 1.5 dB and count; a 40 Hz thump loses 16 dB and a 10 kHz tone 14 dB, so neither clears the
  // 2 dB over the steady tone that a peak needs.
  const sampleRate = 48000;
  const floor = 0.05;
  const burstAmplitude = floor * Math.sqrt(10 ** (7 / 10) - 1);
  const frequencies = [40, 125, 1500, 4000, 10000];
  const bursts = [0, 1].flatMap((round) =>
    frequencies.map((frequency, index) => ({ frequency, at: 2 + round * 3 + index * 0.5 })),
  );
  const samples = new Float32Array(9 * sampleRate);
  const fade = Math.round(0.02 * sampleRate);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = floor * Math.min(1, i / fade) * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  }
  for (const { frequency, at } of bursts) {
    // 25 ms up, 100 ms steady, 25 ms down.
    const from = Math.round(at * sampleRate);
    const length = Math.round(0.15 * sampleRate);
    for (let k = 0; k < length; k += 1) {
      const t = k / sampleRate;
      const envelope = t < 0.025 ? ramp(0, 1, t, 0.025) : ramp(1, 0, t - 0.125, 0.025);
      const phase = (2 * Math.PI * frequency * (from + k)) / sampleRate;
      samples[from + k] += burstAmplitude * envelope * Math.sin(phase);
    }
  }
  const peaks = peaksOf(samples, sampleRate);
  const counted = bursts
    .filter(({ at }) => peaksWithin(peaks, at, at + 0.15).length > 0)
    .map(({ frequency }) => frequency);
  assert.deepEqual(counted, [125, 1500, 4000, 125, 1500, 4000]);
  assert.equal(peaksWithin(peaks, 0.5, 9).length, 6, "no peak but the six bursts");
});

test("a peak is 2 dB over the running median: a 2.4 dB swell counts, a 1.7 dB one does not", () => {
  // 3 s of silence, then a steady tone. From 7 s, when the tone fills most of the windows so far
  // and the median is its level, it swells by 1.7 and 2.4 dB in turn. The silence keeps the
  // quietest quarter of the windows at -120 dB, so a threshold taken from a lower percentile
  // would pass every swell.
  const list = [7, 7.5, 8, 8.5, 9, 9.5].map((at, index) => ({ at, db: index % 2 ? 2.4 : 1.7 }));
  const peaks = peaksOf(tone(12, 0.05, swells(list), 3));
  const counted = list.filter((swell) => {
    return peaksWithin(peaks, swellMiddle(swell) - 0.05, swellMiddle(swell) + 0.05).length > 0;
  });
  assert.deepEqual(
    counted.map((swell) => swell.db),
    [2.4, 2.4, 2.4],
  );
  assert.equal(peaksWithin(peaks, 6, 12).length, 3, "no peak between the swells");
  // The steady tone is one sound: its start is a peak, and nothing after it until the swells.
  const before = peaksWithin(peaks, 0, 7);
  assert.equal(before.length, 1, `peaks before the swells: ${before}`);
  assert.ok(Math.abs(before[0] - 3) < 0.1, `the tone's start, at ${before[0]} s`);
});

test("the median is kept in 0.05 dB bins: a 2.05 dB swell counts, a 1.95 dB one not", () => {
  // The tone reads -40.96 dB, 0.04 dB over the bottom of a 0.05 dB bin, a 0.25 dB bin and a 1 dB
  // bin alike. 0.05 dB bins read its median within 0.025 dB; 0.25 dB bins would read it about
  // 0.09 dB high and 1 dB bins about 0.46 dB high, so the 2.05 dB swell would miss too.
  const list = [4, 4.5, 5, 5.5, 6, 6.5].map((at, index) => ({ at, db: index % 2 ? 1.95 : 2.05 }));
  const peaks = peaksOf(tone(8, amplitudeFor(-40.96), swells(list)));
  const counted = list.filter((swell) => {
    return peaksWithin(peaks, swellMiddle(swell) - 0.05, swellMiddle(swell) + 0.05).length > 0;
  });
  assert.deepEqual(
    counted.map((swell) => swell.db),
    [2.05, 2.05, 2.05],
  );
  assert.equal(peaksWithin(peaks, 1, 8).length, 3, "no peak but the 2.05 dB swells");
});

test("a second peak needs a 1.5 dB dip: a swell dipping 1.2 dB counts once, 1.8 dB twice", () => {
  // A steady tone swells by 6 dB twice in a row, 180 ms apart (each top held 60 ms), falling
  // between the two tops by `dip` dB for 60 ms.
  const doubles = [];
  for (let round = 0; round < 3; round += 1) {
    for (const dip of [1.2, 1.8]) {
      doubles.push({ at: 3 + doubles.length * 0.8, dip });
    }
  }
  const gainAt = (t) => {
    const double = doubles.find(({ at }) => t >= at && t < at + 0.3);
    if (!double) {
      return 1;
    }
    const d = t - double.at;
    const low = 6 - double.dip;
    // Up 30 ms, top 60 ms, down 30 ms, dip 60 ms, up 30 ms, top 60 ms, down 30 ms.
    const steps = [
      [0, 0, 6],
      [0.09, 6, low],
      [0.18, low, 6],
      [0.27, 6, 0],
    ];
    const [start, from, to] = steps.filter(([begin]) => d >= begin).pop();
    return 10 ** (ramp(from, to, d - start, 0.03) / 20);
  };
  const peaks = peaksOf(tone(8, 0.05, gainAt));
  for (const { at, dip } of doubles) {
    assert.equal(
      peaksWithin(peaks, at, at + 0.3).length,
      dip < 1.5 ? 1 : 2,
      `a ${dip} dB dip at ${at} s`,
    );
  }
});

// A steady tone, amplitude `floor`, whose power is `powers[n]` times its own in hop n (1 where
// not given): the detector's hops start at the first sample, and the tone crosses zero at each
// hop's edge, so the extra power stays in its hop.
function hopPowers(seconds, floor, powers) {
  const samples = tone(seconds, floor);
  for (const [hop, power] of powers) {
    for (let i = hop * HOP; i < (hop + 1) * HOP; i += 1) {
      samples[i] *= Math.sqrt(power);
    }
  }
  return samples;
}

// The peaks inside a pattern that starts at hop `first`, give or take 50 ms.
function peaksInPattern(peaks, first, hops) {
  return peaksWithin(peaks, (first * HOP) / RATE - 0.05, ((first + hops) * HOP) / RATE + 0.05);
}

test("a peak is the loudest window within 3 hops either side", () => {
  // Over a steady tone (power 1 a hop), a short loud sound A fills one hop at power 11 and a
  // softer sound B the 4 hops starting `gap` hops after it at power 3. A window holds 4 hops, so
  // B's loudest window has power 4 + 8 = 12 and A's 4 + 10 = 14 (16 when B's first hop falls in
  // it). Between them the level dips at least 1.76 dB under B's, and B clears the threshold, so
  // the look-ahead alone decides: B starting 3 hops after A puts its loudest window 3 hops from
  // A's, inside the look-ahead, and B is no peak; 4 hops after A, it is one.
  const starts = [400, 460, 520, 580, 640];
  const powers = (gap) =>
    new Map(
      starts.flatMap((first) => [[first, 11], ...[0, 1, 2, 3].map((n) => [first + gap + n, 3])]),
    );
  for (const [gap, expected] of [
    [3, 1],
    [4, 2],
  ]) {
    const peaks = peaksOf(hopPowers(6.5, 0.05, powers(gap)));
    for (const first of starts) {
      assert.equal(peaksInPattern(peaks, first, 8).length, expected, `B ${gap} hops after A`);
    }
  }
});

test("32 ms windows every 8 ms: two short sounds 40 ms apart count twice, 32 ms once", () => {
  // Over a steady tone, two sounds each one hop long at power 5, `gap` hops apart. 5 hops (40 ms)
  // leave a 32 ms window between them with neither sound in it: a 3 dB dip, so two peaks. 4 hops
  // (32 ms) leave none, so one. 40 ms windows would merge the first pair; 24 ms windows, or
  // 6 ms hops, would split the second.
  const starts = [400, 460, 520, 580, 640];
  for (const [gap, expected] of [
    [5, 2],
    [4, 1],
  ]) {
    const powers = new Map(starts.flatMap((first) => [[first, 5], [first + gap, 5]]));
    const peaks = peaksOf(hopPowers(6.5, 0.05, powers));
    for (const first of starts) {
      assert.equal(peaksInPattern(peaks, first, 8).length, expected, `sounds ${gap} hops apart`);
    }
  }
});

// Bursts 150 ms long, 0.4 s apart from 0.5 s, in silence, of a 125 Hz voice (16 harmonics of
// equal power) mixed with white noise: the voice `voiceShare` of the power. Returns each
// burst's middle with the samples.
function voiceWithNoise(voiceShare, count = 40) {
  const random = seeded(7);
  const samples = new Float32Array(Math.round((count * 0.4 + 1) * RATE));
  const middles = [];
  for (let n = 0; n < count; n += 1) {
    const from = Math.round((0.5 + n * 0.4) * RATE);
    const length = Math.round(0.15 * RATE);
    middles.push((from + length / 2) / RATE);
    for (let k = 0; k < length; k += 1) {
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / length);
      let voice = 0;
      for (let h = 1; h <= 16; h += 1) {
        voice += Math.sin((2 * Math.PI * 125 * h * (from + k)) / RATE + h * h);
      }
      // Each part at unit power: 16 sines of power 1/2, and uniform noise times sqrt(3).
      const noise = Math.sqrt(3) * (random() * 2 - 1);
      const mixed =
        Math.sqrt(voiceShare) * voice * Math.sqrt(2 / 16) + Math.sqrt(1 - voiceShare) * noise;
      samples[from + k] = 0.1 * envelope * mixed;
    }
  }
  return { samples, middles };
}

// How many of `middles` have a peak within 0.1 s.
function countedAt(peaks, middles) {
  return middles.filter((middle) => peaks.some((peak) => Math.abs(peak - middle) < 0.1)).length;
}

test("voicing needs an autocorrelation of 0.45: a breathy voice counts, a hiss does not", () => {
  // Loudness alone makes every burst a peak; voicing decides. A breathy voice, 44% of its power
  // the voice, is voiced in every burst (a bar of 0.6 would pass about 1 in 7). A hiss with a
  // little voice in it, 24%, is voiced in none (a bar of 0.3 would pass most).
  const breathy = voiceWithNoise(0.44);
  assert.equal(countedAt(peaksOf(breathy.samples), breathy.middles), 40);
  const hiss = voiceWithNoise(0.24);
  assert.equal(countedAt(peaksOf(hiss.samples), hiss.middles), 0);
});

// Bursts 200 ms long, 0.5 s apart from 0.5 s, in silence, of a pulse train at `pitch` Hz: one
// click a period, as the vocal folds give. The clicks repeat only at the period, so the pitch
// alone decides whether a burst is voiced.
function pulses(pitch, count = 20) {
  const samples = new Float32Array(Math.round((count * 0.5 + 1) * RATE));
  const middles = [];
  for (let n = 0; n < count; n += 1) {
    const from = Math.round((0.5 + n * 0.5) * RATE);
    const length = Math.round(0.2 * RATE);
    middles.push((from + length / 2) / RATE);
    for (let p = 0; (p * RATE) / pitch < length; p += 1) {
      const k = Math.round((p * RATE) / pitch);
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / length);
      samples[from + k] += 0.5 * envelope;
      samples[from + k + 1] -= 0.25 * envelope;
    }
  }
  return { samples, middles };
}

test("the pitch range starts at 75 Hz: a voice at 85 Hz is voiced, a creak at 65 Hz is not", () => {
  const low = pulses(85);
  assert.equal(countedAt(peaksOf(low.samples), low.middles), 20, "85 Hz");
  const creak = pulses(65);
  assert.equal(countedAt(peaksOf(creak.samples), creak.middles), 0, "65 Hz");
});

test("a sample that is not a finite number reads as silence: later peaks are as they were", () => {
  // Swells of a steady tone after half a second of digital silence; the bad samples fall in
  // that silence, where silence is what was there.
  const list = [1, 1.5, 2, 2.5, 3].map((at) => ({ at, db: 6 }));
  const clean = tone(4, 0.05, swells(list), 0.5);
  const expected = peaksOf(clean);
  assert.equal(expected.length, 6, "the tone's start and five swells");
  // A Float32Array holds no other value that is not a finite number.
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    const spoiled = clean.slice();
    spoiled[Math.round(0.2 * RATE)] = bad;
    assert.deepEqual(peaksOf(spoiled), expected, String(bad));
  }
});
