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

test("reconcile keeps an overlapping transcript pause with the longer length", () => {
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

// A clock the tests move by hand: performance.now reads it and setInterval callbacks fire in
// order as advance() passes their due times.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map();

  function nextDue(end) {
    let due = null;
    intervals.forEach((entry, id) => {
      if (entry.next <= end && (due === null || entry.next < due.entry.next)) {
        due = { id, entry };
      }
    });
    return due;
  }

  function advance(ms) {
    const end = now + ms;
    for (let due = nextDue(end); due !== null; due = nextDue(end)) {
      now = due.entry.next;
      due.entry.next += due.entry.ms;
      due.entry.callback();
    }
    now = end;
  }

  return {
    performance: { now: () => now },
    setInterval(callback, ms) {
      const id = nextId++;
      intervals.set(id, { callback, ms, next: now + ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    advance,
    activeIntervals: () => intervals.size,
  };
}

// The analyser fills every frame with one amplitude taken from `levels` in turn (so the
// frame's rms is that amplitude), repeating the last level once they run out.
class FakeAnalyserNode {
  constructor(levels) {
    this.fftSize = 0;
    this.levels = levels;
    this.reads = 0;
  }

  getFloatTimeDomainData(buffer) {
    const level = this.levels[Math.min(this.reads, this.levels.length - 1)];
    this.reads += 1;
    buffer.fill(level);
  }
}

class FakeMediaStreamSource {
  constructor(stream) {
    this.stream = stream;
    this.connectedTo = null;
    this.disconnectCalls = 0;
  }

  connect(node) {
    this.connectedTo = node;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }
}

// An AudioContext stand-in whose analyser plays back `levels`; `state` is what the browser
// reports right after construction ("running", or "suspended" as iOS Safari may).
function fakeAudioContextClass(levels, state = "running") {
  class FakeAudioContext {
    constructor() {
      this.state = state;
      this.source = null;
      this.analyser = null;
      this.resumeCalls = 0;
      this.closeCalls = 0;
      FakeAudioContext.instances.push(this);
    }

    createMediaStreamSource(stream) {
      this.source = new FakeMediaStreamSource(stream);
      return this.source;
    }

    createAnalyser() {
      this.analyser = new FakeAnalyserNode(levels);
      return this.analyser;
    }

    resume() {
      this.resumeCalls += 1;
      this.state = "running";
      return Promise.resolve();
    }

    close() {
      this.closeCalls += 1;
      this.state = "closed";
      return Promise.resolve();
    }
  }
  FakeAudioContext.instances = [];
  return FakeAudioContext;
}

// Loads pauses.js with a fake clock and the given AudioContext globals.
function loadLive(audioGlobals) {
  const clock = fakeClock();
  const pauses = load({
    performance: clock.performance,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    ...audioGlobals,
  });
  return { pauses, clock, stream: { id: "mic" } };
}

test("start wires the stream into a 2048-point analyser and samples rms every 50 ms", () => {
  const AudioContext = fakeAudioContextClass([0.5, 0.25, 0]);
  const { pauses, clock, stream } = loadLive({ AudioContext });
  clock.advance(1234);
  pauses.start(stream);

  const context = AudioContext.instances[0];
  assert.equal(context.source.stream, stream);
  assert.equal(context.source.connectedTo, context.analyser);
  assert.equal(context.analyser.fftSize, 2048);
  assert.equal(clock.activeIntervals(), 1);
  assert.equal(context.resumeCalls, 0, "a running context is left alone");

  clock.advance(49);
  assert.equal(context.analyser.reads, 0, "the first sample waits for the first tick");
  clock.advance(1);
  assert.equal(context.analyser.reads, 1);
  clock.advance(100);
  assert.deepEqual(plain(pauses.stop()), [
    { t: 0.05, rms: 0.5 },
    { t: 0.1, rms: 0.25 },
    { t: 0.15, rms: 0 },
  ]);
});

test("stop clears the interval, disconnects, closes the context and then returns []", () => {
  const AudioContext = fakeAudioContextClass([0.5]);
  const { pauses, clock, stream } = loadLive({ AudioContext });
  pauses.start(stream);
  clock.advance(100);

  const samples = pauses.stop();
  const context = AudioContext.instances[0];
  assert.equal(samples.length, 2);
  assert.equal(clock.activeIntervals(), 0);
  assert.equal(context.source.disconnectCalls, 1);
  assert.equal(context.closeCalls, 1);

  clock.advance(100);
  assert.deepEqual(plain(pauses.stop()), [], "a second stop has nothing to hand back");
  assert.equal(samples.length, 2, "the first stop's samples are untouched");
  assert.equal(context.closeCalls, 1, "nothing is closed twice");
  assert.equal(context.source.disconnectCalls, 1);
});

test("stop before start returns [] without any Web Audio globals", () => {
  assert.deepEqual(plain(load().stop()), []);
});

test("start falls back to webkitAudioContext and resumes a suspended context", () => {
  const webkitAudioContext = fakeAudioContextClass([0.5], "suspended");
  const { pauses, clock, stream } = loadLive({ webkitAudioContext });
  pauses.start(stream);
  const context = webkitAudioContext.instances[0];
  assert.equal(context.resumeCalls, 1);
  clock.advance(50);
  assert.deepEqual(plain(pauses.stop()), [{ t: 0.05, rms: 0.5 }]);
});

test("start without Web Audio, or with a context that refuses to open, samples nothing", () => {
  const none = loadLive({});
  none.pauses.start(none.stream);
  assert.equal(none.clock.activeIntervals(), 0);
  assert.deepEqual(plain(none.pauses.stop()), []);

  class RefusingAudioContext {
    constructor() {
      throw new Error("too many contexts");
    }
  }
  const refusing = loadLive({ AudioContext: RefusingAudioContext });
  refusing.pauses.start(refusing.stream);
  assert.equal(refusing.clock.activeIntervals(), 0);
  assert.deepEqual(plain(refusing.pauses.stop()), []);
});

test("a second start releases the first context and begins a fresh sample list", () => {
  const AudioContext = fakeAudioContextClass([0.5]);
  const { pauses, clock, stream } = loadLive({ AudioContext });
  pauses.start(stream);
  clock.advance(100);
  pauses.start({ id: "second mic" });

  const [first, second] = AudioContext.instances;
  assert.equal(first.closeCalls, 1);
  assert.equal(first.source.disconnectCalls, 1);
  assert.equal(second.source.stream.id, "second mic");
  assert.equal(clock.activeIntervals(), 1);
  clock.advance(50);
  assert.deepEqual(plain(pauses.stop()), [{ t: 0.05, rms: 0.5 }]);
});

test("index.html loads pauses.js right after tips.js and before screens/practice.js", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const sources = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const at = sources.indexOf("pauses.js");
  assert.notEqual(at, -1, "pauses.js is not loaded");
  assert.equal(sources[at - 1], "tips.js");
  assert.equal(sources[at + 1], "screens/practice.js");
});
