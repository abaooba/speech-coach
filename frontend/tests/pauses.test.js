// Tests for frontend/pauses.js, the Web Audio pause detector: the pure helpers (rms,
// percentile, findSilences, reconcile) on hand-made samples, and start()/stop() against a fake
// AudioContext, AnalyserNode, clock and interval timer injected into the vm context, the same
// way practice-capture.test.js drives practice.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PAUSES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "pauses.js"), "utf8");

const SAMPLE_EVERY_MS = 50;

// Objects built inside the vm realm have a foreign prototype; a JSON round-trip makes them
// comparable with deepEqual.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Loads pauses.js into a fresh context with the given globals and returns app.pauses.
function load(globals = {}) {
  const app = {};
  const context = { app, ...globals };
  vm.runInNewContext(PAUSES_SOURCE, context, { filename: "pauses.js" });
  return app.pauses;
}

// A list of {t, rms} samples 50 ms apart built from [count, rms] runs, in order. Times are
// exact milliseconds so the expected starts and lengths come out as round numbers.
function series(runs) {
  const samples = [];
  runs.forEach(([count, rms]) => {
    for (let i = 0; i < count; i += 1) {
      samples.push({ t: (samples.length * SAMPLE_EVERY_MS) / 1000, rms });
    }
  });
  return samples;
}

// One second of samples at the given level.
function seconds(count, rms) {
  return [Math.round((count * 1000) / SAMPLE_EVERY_MS), rms];
}

test("rms is the root mean square of the buffer, 0 for an empty one", () => {
  const pauses = load();
  assert.equal(pauses.rms(new Float32Array([3, 4])), Math.sqrt(12.5));
  assert.equal(pauses.rms(new Float32Array([1, -1, 1, -1])), 1);
  assert.equal(pauses.rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(pauses.rms(new Float32Array([0, 0, 0])), 0);
  assert.equal(pauses.rms(new Float32Array([])), 0);
});

test("percentile interpolates between the ranks of a sorted list", () => {
  const pauses = load();
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(pauses.percentile(sorted, 0), 1);
  assert.equal(pauses.percentile(sorted, 50), 3);
  assert.equal(pauses.percentile(sorted, 100), 5);
  assert.equal(pauses.percentile(sorted, 10), 1.4);
  assert.equal(pauses.percentile(sorted, 90), 4.6);
  assert.equal(pauses.percentile([7], 90), 7);
  assert.equal(pauses.percentile([], 50), 0);
});

test("findSilences reports one 3 s silence in a loud, quiet, loud take", () => {
  const pauses = load();
  const take = series([seconds(2, 0.3), seconds(3, 0.01), seconds(3, 0.3)]);
  assert.deepEqual(plain(pauses.findSilences(take)), [[2, 3]]);
  assert.deepEqual(plain(pauses.findSilences(take, 3.5)), [], "shorter than minSeconds");

  // The threshold adapts to the take: a quiet room six times softer gives the same answer.
  const soft = take.map((sample) => ({ t: sample.t, rms: sample.rms / 6 }));
  assert.deepEqual(plain(pauses.findSilences(soft)), [[2, 3]]);
});

test("findSilences counts a dip of exactly 1.5 s and ignores one of 1.45 s", () => {
  const pauses = load();
  const atThreshold = series([seconds(2, 0.3), [30, 0.01], seconds(2, 0.3)]);
  assert.deepEqual(plain(pauses.findSilences(atThreshold)), [[2, 1.5]]);
  const justUnder = series([seconds(2, 0.3), [29, 0.01], seconds(2, 0.3)]);
  assert.deepEqual(plain(pauses.findSilences(justUnder)), []);
});

test("findSilences finds nothing in a noisy take whose dips are all short", () => {
  const pauses = load();
  const runs = [];
  for (let i = 0; i < 20; i += 1) {
    runs.push([10, 0.3], [5, 0.01]);
  }
  assert.deepEqual(plain(pauses.findSilences(series(runs))), []);
});

test("findSilences returns [] for fewer than 10 samples or a flat signal", () => {
  const pauses = load();
  assert.deepEqual(plain(pauses.findSilences([])), []);
  assert.deepEqual(plain(pauses.findSilences(series([[9, 0]]))), [], "nine quiet samples");
  assert.deepEqual(plain(pauses.findSilences(series([seconds(10, 0)]))), [], "all zero");
  assert.deepEqual(plain(pauses.findSilences(series([seconds(10, 0.2)]))), [], "all equal");
});

test("findSilences measures a run at either edge of the take by the samples it has", () => {
  const pauses = load();
  const quietStart = series([seconds(2, 0.01), seconds(3, 0.3)]);
  assert.deepEqual(plain(pauses.findSilences(quietStart)), [[0, 2]]);
  const quietEnd = series([seconds(3, 0.3), seconds(2, 0.01)]);
  assert.deepEqual(plain(pauses.findSilences(quietEnd)), [[3, 1.95]]);
});

// A 12.5 s take: 2 s of room noise, speech from 2 s to 10 s with a 3 s silence from 5 s to
// 8 s, then 2.5 s of room noise after the last word. The backend would report duration 8.
function speechTake() {
  return series([
    seconds(2, 0.01),
    seconds(3, 0.3),
    seconds(3, 0.01),
    seconds(2, 0.3),
    seconds(2.5, 0.01),
  ]);
}

const SPEECH_DURATION = 8;

function metricsWith(overrides) {
  return { words_per_minute: 150, duration: SPEECH_DURATION, pauses: [], ...overrides };
}

test("reconcile keeps a transcript pause an energy silence overlaps, with the longer length", () => {
  const pauses = load();
  const transcriptShorter = metricsWith({ pauses: [[5.1, 1.6]] });
  assert.deepEqual(plain(pauses.reconcile(transcriptShorter, speechTake()).pauses), [[5.1, 3]]);

  const transcriptLonger = metricsWith({ pauses: [[5.1, 3.4]] });
  assert.deepEqual(plain(pauses.reconcile(transcriptLonger, speechTake()).pauses), [[5.1, 3.4]]);
});

test("reconcile adds an energy-only silence at its start, inside the speech span only", () => {
  const pauses = load();
  const result = pauses.reconcile(metricsWith({}), speechTake());
  assert.deepEqual(plain(result.pauses), [[5, 3]], "room noise before and after is not a pause");
  assert.equal(result.words_per_minute, 150, "the other metrics come through");
  assert.equal(result.duration, SPEECH_DURATION);
});

test("reconcile keeps a transcript pause no silence confirms, even with no samples", () => {
  const pauses = load();
  const metrics = metricsWith({ pauses: [[3, 1.6]] });
  assert.deepEqual(plain(pauses.reconcile(metrics, speechTake()).pauses), [[3, 1.6], [5, 3]]);
  assert.deepEqual(plain(pauses.reconcile(metrics, []).pauses), [[3, 1.6]]);
  assert.deepEqual(plain(pauses.reconcile(metrics, series([seconds(10, 0)])).pauses), [[3, 1.6]]);
});

test("reconcile skips the span check when metrics.duration is missing", () => {
  const pauses = load();
  const noDuration = { pauses: [] };
  assert.deepEqual(plain(pauses.reconcile(noDuration, speechTake()).pauses), [
    [0, 2],
    [5, 3],
    [10, 2.45],
  ]);
});

test("reconcile sorts by at and drops duplicate entries", () => {
  const pauses = load();
  const metrics = metricsWith({ pauses: [[8.5, 1.5], [3, 1.6], [3, 1.6]] });
  assert.deepEqual(plain(pauses.reconcile(metrics, speechTake()).pauses), [
    [3, 1.6],
    [5, 3],
    [8.5, 1.5],
  ]);
});

test("reconcile returns a new object and never changes its inputs", () => {
  const pauses = load();
  const metrics = metricsWith({ pauses: [[5.1, 1.6]], fillers: { um: 2 } });
  const samples = speechTake();
  const before = JSON.stringify({ metrics, samples });

  const result = pauses.reconcile(metrics, samples);
  assert.equal(JSON.stringify({ metrics, samples }), before);
  assert.notEqual(result, metrics);
  assert.notEqual(result.pauses, metrics.pauses);
  assert.deepEqual(plain(result), { ...plain(metrics), pauses: [[5.1, 3]] });
});

test("reconcile drops malformed transcript pauses instead of crashing", () => {
  const pauses = load();
  const garbage = metricsWith({ pauses: [null, [1], ["x", "y"], [3, 1.6]] });
  assert.deepEqual(plain(pauses.reconcile(garbage, speechTake()).pauses), [[3, 1.6], [5, 3]]);
  assert.deepEqual(plain(pauses.reconcile(metricsWith({ pauses: "none" }), speechTake()).pauses), [
    [5, 3],
  ]);
  assert.deepEqual(plain(pauses.reconcile(null, [])), { pauses: [] });
});
