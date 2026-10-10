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
