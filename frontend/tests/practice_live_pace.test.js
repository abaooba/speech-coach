// Tests for the live pace row while a take records (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7, Capture, Display and the
// Validation result). A take opens an AudioContext of its own: MediaStreamSource ->
// ScriptProcessor(1024, 1, 1) -> a zero gain -> the output, and each block goes to an
// app.delivery.livePace tracker. A row in the timer shows the waiting sentence, then the cue
// alone until the take's mode (Talk or Read) has a kept words-a-peak factor, and from then on
// "About 150 wpm" and the cue. It repaints once per new whole second from the clock's tick, is
// never announced, and shows only while a normal take records. Once a take's analysis is back,
// its mode's factor is tuned (app.delivery.paceFactorAfter) and kept in a store flag, never on
// the session. Every browser API is a fake the tests drive by hand. The estimator is a fake whose
// readings each test sets, with cue ids unlike delivery.js's own so the row must use
// app.delivery's; the last tests run the real one on synthetic syllables.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");
const { PASSAGE_MATERIAL, flush, levelRequest, plain, reaches } = require("./practice-harness");

const FRONTEND = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");
const UI_SOURCE = read("ui.js");
const DELIVERY_SOURCE = read("delivery.js");
const LANGUAGE_SOURCE = read("language.js");
const PRACTICE_SOURCE = read(path.join("screens", "practice.js"));

const SECOND = 1000;
const SAVED_ID = "session-1";
const WAITING = "Your pace shows after a few seconds.";
const TALK_FLAG = "livePaceFactor:talk";
const READ_FLAG = "livePaceFactor:read";

// The same sentences api.js freezes (DESIGN.md section 8); the fake app.api carries them.
const MESSAGES = Object.freeze({
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
});

// Talk first, as in passages.js: a timed prompt, then a Read passage with a band of its own.
const PASSAGES = [
  {
    id: "free-talk",
    kind: "prompt",
    title: "Your day",
    text: "Talk about your day.",
    targetWpm: [140, 160],
    timeLimitSeconds: 60,
  },
  {
    id: "read1",
    kind: "passage",
    title: "Explainer: rainbows",
    text: "Sunlight bends inside each raindrop.",
    targetWpm: [150, 170],
  },
];

// The backend's answer: 40 words over 24 s, times in seconds, as api.analyze resolves it.
const WORDS = Array.from({ length: 40 }, (_, i) => ({
  text: "word",
  start: Math.round((1 + i * 0.6) * 1000) / 1000,
  end: Math.round((1.4 + i * 0.6) * 1000) / 1000,
}));
const ANALYSIS = Object.freeze({
  transcript: WORDS,
  metrics: { words_per_minute: 100, pauses: [] },
});

// The fake estimator's cue ids: not delivery.js's strings, so a row that wrote its own would fail.
const CUE = Object.freeze({ ON_TARGET: "cue:on", SLOW_DOWN: "cue:slow", SPEED_UP: "cue:fast" });

// app.delivery's live pace half, faked. livePace keeps every tracker it makes; a tracker logs
// the blocks pushed to it and how often it was read, and hands back `reading` and `peakTimes`
// as the test sets them. paceFactorAfter logs its arguments and returns `nextFactor`, or the kept
// factor (LIVE_PACE_FACTOR for none) as the real one does for a take that does not count.
function fakeDelivery() {
  const delivery = {
    ...CUE,
    LIVE_PACE_FACTOR: 0.69,
    trackers: [],
    tunings: [],
    nextFactor: null,
    livePace(sampleRate, options) {
      if (!(sampleRate >= 8000)) {
        throw new RangeError("livePace needs a sample rate of 8000 Hz or more");
      }
      const tracker = {
        sampleRate,
        options,
        blocks: [],
        reads: 0,
        reading: { wpm: null, cue: null },
        peakTimes: [],
        push(samples) {
          tracker.blocks.push(samples);
        },
        read() {
          tracker.reads += 1;
          return { ...tracker.reading };
        },
        peaks() {
          return tracker.peakTimes.slice();
        },
      };
      delivery.trackers.push(tracker);
      return tracker;
    },
    paceFactorAfter(factor, words, peaks) {
      delivery.tunings.push({ factor, words, peaks });
      if (delivery.nextFactor !== null) {
        return delivery.nextFactor;
      }
      return typeof factor === "number" ? factor : delivery.LIVE_PACE_FACTOR;
    },
  };
  return delivery;
}

// A Web Audio node: logs what it connects to and each disconnect().
class FakeAudioNode {
  constructor(kind, extra) {
    this.kind = kind;
    this.connections = [];
    this.disconnects = 0;
    Object.assign(this, extra);
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnects += 1;
  }
}

// An AudioContext class for one test. Options: sampleRate, state ("running" or "suspended"),
// rejectResume, failOnCreate, and failAt ("source", "processor" or "gain") for a node that
// cannot be made. Every instance is kept, with the nodes made on it, and `log` hears each step.
function fakeAudioContextClass(options, log) {
  class FakeAudioContext {
    constructor() {
      log.push("AudioContext");
      if (options.failOnCreate) {
        throw new Error("no audio device");
      }
      this.sampleRate = options.sampleRate || 48000;
      this.state = options.state || "running";
      this.destination = new FakeAudioNode("destination");
      this.nodes = [];
      this.resumes = 0;
      this.closes = 0;
      FakeAudioContext.instances.push(this);
    }

    make(kind, extra) {
      if (options.failAt === kind) {
        throw new Error("cannot make a " + kind);
      }
      const node = new FakeAudioNode(kind, extra);
      this.nodes.push(node);
      return node;
    }

    createMediaStreamSource(stream) {
      return this.make("source", { stream });
    }

    createScriptProcessor(bufferSize, inputs, outputs) {
      return this.make("processor", { bufferSize, inputs, outputs, onaudioprocess: null });
    }

    createGain() {
      return this.make("gain", { gain: { value: 1 } });
    }

    resume() {
      this.resumes += 1;
      if (options.rejectResume) {
        return Promise.reject(new Error("resume needs a gesture"));
      }
      this.state = "running";
      return Promise.resolve();
    }

    close() {
      this.closes += 1;
      this.state = "closed";
      return Promise.resolve();
    }
  }
  FakeAudioContext.instances = [];
  return FakeAudioContext;
}

// A fake element that logs focus(), finds a class anywhere below it, says whether a node sits
// inside it and keeps parentNode (level mode adds its banner to the body), as practice-harness.js
// does.
class LiveElement extends FakeElement {
  constructor(tagName, namespaceURI, focusLog) {
    super(tagName, namespaceURI);
    this.focusLog = focusLog;
    this.parentNode = null;
  }

  focus() {
    this.focusLog.push(this);
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }

  querySelector(selector) {
    const wanted = selector.replace(/^\./, "");
    for (const child of this.children) {
      if (child.classList && child.classList.contains(wanted)) {
        return child;
      }
      const deeper =
        typeof child.querySelector === "function" ? child.querySelector(selector) : null;
      if (deeper) {
        return deeper;
      }
    }
    return null;
  }

  appendChild(child) {
    super.appendChild(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    if (index === -1) {
      throw new Error("insertBefore: the reference is not a child");
    }
    this.children.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    super.removeChild(child);
    child.parentNode = null;
    return child;
  }
}

function liveDocument(focusLog) {
  return {
    documentElement: { dataset: {} },
    get activeElement() {
      return focusLog.length > 0 ? focusLog[focusLog.length - 1] : null;
    },
    createElement: (tagName) => new LiveElement(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new LiveElement(tagName, namespaceURI, focusLog),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: () => null,
  };
}

// A clock the tests move by hand: performance.now reads it and interval callbacks fire in order.
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
    advance(ms) {
      const end = now + ms;
      for (let due = nextDue(end); due !== null; due = nextDue(end)) {
        now = due.entry.next;
        due.entry.next += due.entry.ms;
        due.entry.callback();
      }
      now = end;
    },
    activeIntervals: () => intervals.size,
  };
}

function fakeMediaRecorderClass() {
  class FakeMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = (options && options.mimeType) || "";
      this.state = "inactive";
      this.listeners = {};
      FakeMediaRecorder.last = this;
    }

    static isTypeSupported(type) {
      return type === "audio/webm";
    }

    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    }

    removeEventListener(type, handler) {
      this.listeners[type] = (this.listeners[type] || []).filter((other) => other !== handler);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
    }

    // What a browser does after stop(), or on its own when the track ends: a last chunk, then
    // the stop event.
    finish() {
      this.state = "inactive";
      (this.listeners.dataavailable || []).forEach((handler) => handler({ data: { size: 10 } }));
      (this.listeners.stop || []).forEach((handler) => handler({ type: "stop" }));
    }
  }
  FakeMediaRecorder.last = null;
  return FakeMediaRecorder;
}

class FakeBlob {
  constructor(parts, options) {
    this.parts = Array.from(parts);
    this.type = (options && options.type) || "";
  }
}

// Loads ui.js, language.js (unless `language` is false), the real delivery.js (`realDelivery`)
// or the fake estimator (`delivery`: null for none, or an object of one's own), and practice.js,
// and mounts the screen into a section that holds only its body. Options: `audio` for the
// AudioContext fake, `audioGlobal` for the name it goes under ("AudioContext",
// "webkitAudioContext" or "none"), `flags` for the store's flags, `pauses` for app.pauses.
function setup(options = {}) {
  const clock = fakeClock();
  const focused = [];
  const log = [];
  const calls = {
    analyze: [],
    save: [],
    go: [],
    announce: [],
    getFlag: [],
    setFlag: [],
    constraints: [],
    timers: 0,
  };
  const micAnswers = [];
  const uploads = [];
  const streams = [];
  const flags = new Map(Object.entries(options.flags || {}));
  const failures = { save: 0, getFlag: false, setFlag: false };
  const app = {
    screens: {},
    ui: {},
    store: {
      save(session) {
        calls.save.push(session);
        if (failures.save > 0) {
          failures.save -= 1;
          return Promise.reject(new Error("disk full"));
        }
        return Promise.resolve(SAVED_ID);
      },
      getFlag(key) {
        calls.getFlag.push(key);
        return failures.getFlag
          ? Promise.reject(new Error("blocked"))
          : Promise.resolve(flags.get(key));
      },
      setFlag(key, value) {
        calls.setFlag.push([key, value]);
        if (failures.setFlag) {
          return Promise.reject(new Error("blocked"));
        }
        flags.set(key, value);
        return Promise.resolve();
      },
    },
    api: {
      messages: MESSAGES,
      analyze(blob, contentType, script) {
        calls.analyze.push({ blob, contentType, script });
        return new Promise((resolve, reject) => uploads.push({ resolve, reject }));
      },
    },
    passages: plain(options.passages || PASSAGES),
    router: {
      go(name, params) {
        calls.go.push({ name, params });
      },
    },
  };
  if (options.pauses) {
    app.pauses = options.pauses(log);
  }
  if (!options.realDelivery && options.delivery !== null) {
    app.delivery = options.delivery || fakeDelivery();
  }
  const AudioContextClass = fakeAudioContextClass(options.audio || {}, log);
  const MediaRecorderClass = fakeMediaRecorderClass();
  const context = {
    app,
    document: liveDocument(focused),
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          calls.constraints.push(constraints);
          return new Promise((resolve, reject) => micAnswers.push({ resolve, reject }));
        },
      },
    },
    MediaRecorder: MediaRecorderClass,
    Blob: FakeBlob,
    performance: clock.performance,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    // The row has no timer of its own: these only count calls.
    setTimeout: () => {
      calls.timers += 1;
    },
    requestAnimationFrame: () => {
      calls.timers += 1;
    },
    fetch: options.fetch,
  };
  const audioGlobal = options.audioGlobal || "AudioContext";
  if (audioGlobal !== "none") {
    context[audioGlobal] = AudioContextClass;
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  app.ui.announce = (text) => calls.announce.push(text);
  if (options.realDelivery) {
    vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  }
  if (options.language !== false) {
    vm.runInNewContext(LANGUAGE_SOURCE, context, { filename: "language.js" });
  }
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = new LiveElement("section", null, focused);
  root.dataset.state = "idle";
  const body = new LiveElement("div", null, focused);
  body.className = "screen__body";
  root.appendChild(body);
  const practice = app.screens.practice;
  practice.mount(root);

  const t = {
    app,
    practice,
    root,
    body,
    clock,
    calls,
    log,
    flags,
    failures,
    streams,
    AudioContext: AudioContextClass,
    MediaRecorder: MediaRecorderClass,
    recordButton: byClass(body, "btn-record"),
    grantMic() {
      const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
      const stream = { tracks, getTracks: () => tracks };
      streams.push(stream);
      micAnswers.shift().resolve(stream);
    },
    resolveUpload(result = ANALYSIS) {
      uploads.shift().resolve(plain(result));
    },
    rejectUpload(kind) {
      const error = new Error(MESSAGES[kind]);
      error.kind = kind;
      uploads.shift().reject(error);
    },
    // show() as the router runs it, with the flags it reads settled.
    async show() {
      practice.show({});
      await flush();
    },
    async startRecording() {
      t.recordButton.click();
      t.grantMic();
      await flush();
    },
    async stopRecording() {
      t.recordButton.click();
      t.MediaRecorder.last.finish();
      await flush();
    },
    // A whole take of `ms` milliseconds: the first block arrives `firstBlockMs` after the
    // recorder starts, and the tracker reports `peaks`; the take is left uploading, and the
    // clock moves past Stop's grace, so the next Record tap starts a take.
    async recordTake(ms, { firstBlockMs = 100, peaks = [1, 2, 3] } = {}) {
      await t.startRecording();
      t.clock.advance(firstBlockMs);
      block(t);
      lastTracker(t).peakTimes = peaks.slice();
      t.clock.advance(ms - firstBlockMs);
      await t.stopRecording();
      t.clock.advance(SECOND);
    },
    startLevel(request) {
      practice.startLevelTake(request);
      practice.show({});
    },
  };
  return t;
}

// The audio graph the latest take opened: its context and the nodes made on it, by kind.
function graph(t) {
  const { instances } = t.AudioContext;
  const context = instances[instances.length - 1];
  const node = (kind) => context.nodes.find((candidate) => candidate.kind === kind) || null;
  return { context, source: node("source"), processor: node("processor"), gain: node("gain") };
}

// One block from the microphone, as a ScriptProcessor hands it over: channel 0 holds `samples`.
function block(t, samples = new Float32Array(1024)) {
  graph(t).processor.onaudioprocess({
    inputBuffer: { getChannelData: (channel) => (channel === 0 ? samples : null) },
  });
}

function lastTracker(t) {
  const { trackers } = t.app.delivery;
  return trackers[trackers.length - 1];
}

function paceRow(t) {
  return byClass(byClass(t.body, "practice__timer"), "practice__pace");
}

// The text a reader sees in a node: the fake keeps an element's own text apart from its children.
function textOf(node) {
  return (node.textContent || "") + (node.children || []).map(textOf).join("");
}

// A child of the row: "tag.class" for an element, its quoted text for a text node.
function describe(node) {
  if (node.nodeType === 3) {
    return JSON.stringify(node.textContent);
  }
  return node.tagName + "." + node.className;
}

function rowView(t) {
  const row = paceRow(t);
  return { hidden: row.hidden, parts: row.children.map(describe), text: textOf(row) };
}

// Sets the tracker's next reading and moves the clock to the next whole second, where the row
// reads it.
function readNext(t, reading) {
  lastTracker(t).reading = reading;
  t.clock.advance(SECOND);
}

// True when the take's audio graph was let go: its handler cleared, each node disconnected and
// the context closed.
function assertReleased(g) {
  assert.equal(g.processor.onaudioprocess, null, "the handler is cleared");
  for (const node of [g.source, g.processor, g.gain]) {
    assert.ok(node.disconnects >= 1, node.kind + " is disconnected");
  }
  assert.equal(g.context.closes, 1, "the context is closed");
}

// --- the cue ids ---

test("delivery.js exports the live row's cue ids beside HESITATION and HABIT", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  const { delivery } = app;
  assert.equal(delivery.ON_TARGET, "on-target");
  assert.equal(delivery.SLOW_DOWN, "slow-down");
  assert.equal(delivery.SPEED_UP, "speed-up");
  const keys = Object.keys(delivery);
  const habit = keys.indexOf("HABIT");
  assert.deepEqual(
    keys.slice(habit + 1, habit + 4),
    ["ON_TARGET", "SLOW_DOWN", "SPEED_UP"],
    "right after HESITATION and HABIT",
  );
  const cueAt = (estimate) =>
    delivery.nextLiveReading(null, { at: 6, estimate, quietSeconds: 0.2, band: [140, 160] }).cue;
  assert.equal(cueAt(150), delivery.ON_TARGET);
  assert.equal(cueAt(200), delivery.SLOW_DOWN);
  assert.equal(cueAt(90), delivery.SPEED_UP);
});

// --- the row ---

test("the row is a p after the limit bar in the timer, aria-live off, built hidden", () => {
  const t = setup();
  const timer = byClass(t.body, "practice__timer");
  assert.deepEqual(
    timer.children.map((child) => child.className),
    ["rec-dot", "timer num", "practice__limit num", "practice__limit-bar", "practice__pace"],
  );
  const row = paceRow(t);
  assert.equal(row.tagName, "p");
  assert.equal(row.getAttribute("aria-live"), "off");
  assert.equal(row.hidden, true);
  for (const name of ["role", "aria-label", "tabindex"]) {
    assert.equal(row.getAttribute(name), null, name);
  }
  // The body keeps its eight parts: the row lives inside the timer.
  assert.deepEqual(
    t.body.children.map((child) => child.className),
    [
      "segmented",
      "chip-row",
      "passage-card",
      "practice__timer",
      "btn-record",
      "btn-record__label",
      "practice__hint",
      "practice__state",
    ],
  );
});

test("a take opens its own audio context: source, ScriptProcessor(1024, 1, 1), zero gain, output", async () => {
  const t = setup();
  await t.startRecording();
  assert.equal(t.AudioContext.instances.length, 1);
  const g = graph(t);
  assert.equal(g.source.stream, t.streams[0]);
  assert.deepEqual([g.processor.bufferSize, g.processor.inputs, g.processor.outputs], [1024, 1, 1]);
  assert.equal(g.gain.gain.value, 0);
  assert.deepEqual(g.source.connections, [g.processor]);
  assert.deepEqual(g.processor.connections, [g.gain]);
  assert.deepEqual(g.gain.connections, [g.context.destination]);
  assert.equal(typeof g.processor.onaudioprocess, "function");
  // The tracker runs at the context's own rate, with the entry's band and no factor yet.
  const tracker = lastTracker(t);
  assert.equal(tracker.sampleRate, 48000);
  assert.deepEqual(plain(tracker.options.band), [140, 160]);
  assert.equal(tracker.options.factor, null);
  assert.equal(t.root.dataset.state, "recording");
});

test("the capture starts right after the pause sampler and leaves it and the mic request alone", async () => {
  const started = [];
  const pauses = (log) => ({
    start(stream) {
      log.push("pauses.start");
      started.push(stream);
    },
    stop() {
      log.push("pauses.stop");
      return [];
    },
    reconcile: (metrics) => metrics,
  });
  const t = setup({ pauses });
  await t.startRecording();
  assert.deepEqual(t.log, ["pauses.start", "AudioContext"]);
  assert.equal(started[0], t.streams[0], "the sampler gets the same stream");
  assert.deepEqual(plain(t.calls.constraints), [{ audio: true }]);
  assert.equal(t.AudioContext.instances.length, 1, "a context of its own, beside the sampler's");
});

test("a suspended context is resumed, as pauses.js does, and a refused resume changes nothing", async () => {
  for (const rejectResume of [false, true]) {
    const t = setup({ audio: { state: "suspended", rejectResume } });
    await t.startRecording();
    await flush();
    assert.equal(graph(t).context.resumes, 1, "resumed once");
    assert.equal(t.root.dataset.state, "recording");
    assert.equal(paceRow(t).hidden, false);
  }
  const running = setup();
  await running.startRecording();
  assert.equal(graph(running).context.resumes, 0, "a running context is left as it is");
});

test("webkitAudioContext stands in when there is no AudioContext", async () => {
  const t = setup({ audioGlobal: "webkitAudioContext" });
  await t.startRecording();
  assert.equal(t.AudioContext.instances.length, 1);
  assert.equal(paceRow(t).hidden, false);
});

test("each block's first channel goes to the tracker as it arrives", async () => {
  const t = setup();
  await t.startRecording();
  const first = new Float32Array(1024).fill(0.1);
  const second = new Float32Array(1024).fill(0.2);
  block(t, first);
  block(t, second);
  const tracker = lastTracker(t);
  assert.equal(tracker.blocks.length, 2);
  assert.equal(tracker.blocks[0], first);
  assert.equal(tracker.blocks[1], second);
});

test("a take starts at the waiting sentence and keeps it until the tracker has a number", async () => {
  const t = setup();
  await t.startRecording();
  const waiting = { hidden: false, parts: ["span.practice__pace-placeholder"], text: WAITING };
  assert.deepEqual(rowView(t), waiting);
  for (let second = 1; second <= 4; second += 1) {
    readNext(t, { wpm: null, cue: null });
    assert.deepEqual(rowView(t), waiting, "at " + second + " s");
  }
});

test("until the take's mode has a kept factor, the row shows the cue alone", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t), {
    hidden: false,
    parts: ["span.practice__pace-cue practice__pace-cue--ok"],
    text: "On target",
  });
  const cue = paceRow(t).children[0];
  assert.equal(cue.textContent, "On target", "the words come first in the DOM");
  assert.equal(cue.children.length, 1);
  const icon = cue.children[0];
  assert.equal(icon.getAttribute("data-icon"), "check");
  assert.equal(icon.getAttribute("width"), "16");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
});

test("with a kept factor the row shows About 150 wpm, a space and the cue", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.8, "the tracker counts with the kept factor");
  assert.deepEqual(rowView(t).text, WAITING, "the number waits for the tracker too");
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t), {
    hidden: false,
    parts: [
      "span.practice__pace-number num",
      '" "',
      "span.practice__pace-cue practice__pace-cue--ok",
    ],
    text: "About 150 wpm On target",
  });
  assert.equal(paceRow(t).children[0].textContent, "About 150 wpm");
});

test("Slow down and Speed up carry the alert triangle in the warn tone, with or without the number", async () => {
  for (const flags of [{}, { [TALK_FLAG]: 0.7 }]) {
    const t = setup({ flags });
    await t.show();
    await t.startRecording();
    const prefix = TALK_FLAG in flags ? "About 185 wpm " : "";
    readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
    assert.equal(rowView(t).text, prefix + "Slow down");
    let cue = paceRow(t).children[paceRow(t).children.length - 1];
    assert.equal(cue.className, "practice__pace-cue practice__pace-cue--warn");
    assert.equal(cue.children[0].getAttribute("data-icon"), "alert");
    readNext(t, { wpm: 115, cue: CUE.SPEED_UP });
    assert.equal(rowView(t).text, prefix.replace("185", "115") + "Speed up");
    cue = paceRow(t).children[paceRow(t).children.length - 1];
    assert.equal(cue.className, "practice__pace-cue practice__pace-cue--warn");
    assert.equal(cue.children[0].getAttribute("data-icon"), "alert");
  }
});

test("the number is the estimator's, rounded there: the row writes it as it comes", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 152, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 152 wpm On target");
});

test("the row shows the cue the tracker holds, never one it judges from the number itself", async () => {
  // 200 is far over 140 to 160, but the tracker still holds On target (its 3 s hold).
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 200, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 200 wpm On target");
  readNext(t, { wpm: 120, cue: CUE.SLOW_DOWN });
  assert.equal(rowView(t).text, "About 120 wpm Slow down");
});

test("the row reads the tracker once per new whole second on the clock, from the clock's tick", async () => {
  const t = setup();
  await t.startRecording();
  const tracker = lastTracker(t);
  t.clock.advance(750);
  assert.equal(tracker.reads, 0);
  t.clock.advance(250);
  assert.equal(tracker.reads, 1, "at 1 s");
  t.clock.advance(750);
  assert.equal(tracker.reads, 1);
  t.clock.advance(250);
  assert.equal(tracker.reads, 2, "at 2 s");
  t.clock.advance(10 * SECOND);
  assert.equal(tracker.reads, 12, "at 12 s");
});

test("the row's children are rebuilt only when its words change", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  const before = paceRow(t).children.slice();
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  t.practice.render("recording");
  assert.equal(paceRow(t).children.length, before.length);
  paceRow(t).children.forEach((child, index) => assert.equal(child, before[index]));
  readNext(t, { wpm: 155, cue: CUE.ON_TARGET });
  assert.notEqual(paceRow(t).children[0], before[0], "new words, new children");
  assert.equal(rowView(t).text, "About 155 wpm On target");
});

test("the row is shown only while recording: hidden in idle, uploading and error", async () => {
  const t = setup();
  assert.equal(paceRow(t).hidden, true, "idle");
  await t.startRecording();
  assert.equal(paceRow(t).hidden, false, "recording");
  t.practice.render("uploading");
  assert.equal(paceRow(t).hidden, true, "uploading");
  t.practice.render("error", { title: "Upload failed", body: MESSAGES.network });
  assert.equal(paceRow(t).hidden, true, "error");
  t.practice.render("recording");
  assert.equal(paceRow(t).hidden, false, "recording again");
  t.clock.advance(6 * SECOND);
  await t.stopRecording();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(paceRow(t).hidden, true, "idle after Stop");
});

test("in level mode every take is captured, but the row stays hidden in every state", async () => {
  const { request } = levelRequest();
  const t = setup();
  t.startLevel(request);
  assert.equal(paceRow(t).hidden, true, "idle");
  await t.startRecording();
  assert.equal(t.AudioContext.instances.length, 1, "the capture runs");
  assert.equal(t.app.delivery.trackers.length, 1);
  block(t);
  t.clock.advance(3 * SECOND);
  assert.equal(paceRow(t).hidden, true, "recording");
  t.clock.advance(3 * SECOND);
  await t.stopRecording();
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(paceRow(t).hidden, true, "uploading");
  t.rejectUpload("network");
  await flush();
  assert.equal(t.root.dataset.state, "error");
  assert.equal(paceRow(t).hidden, true, "error");
});

for (const [name, options] of [
  ["no AudioContext", { audioGlobal: "none" }],
  ["no estimator", { delivery: null }],
  ["an estimator without livePace", { delivery: { LIVE_PACE_FACTOR: 0.69 } }],
  ["a sample rate under 8 kHz", { audio: { sampleRate: 4000 } }],
  ["a context that cannot open", { audio: { failOnCreate: true } }],
  ["a source that cannot be made", { audio: { failAt: "source" } }],
  ["a ScriptProcessor that cannot be made", { audio: { failAt: "processor" } }],
  ["a gain that cannot be made", { audio: { failAt: "gain" } }],
]) {
  test(`a take whose capture did not start (${name}) records without the row`, async () => {
    const t = setup(options);
    await t.startRecording();
    assert.equal(t.root.dataset.state, "recording");
    assert.equal(paceRow(t).hidden, true);
    t.clock.advance(6 * SECOND);
    assert.equal(paceRow(t).hidden, true, "for the whole take");
    assert.equal(t.clock.activeIntervals(), 1);
    await t.stopRecording();
    assert.equal(t.calls.analyze.length, 1, "the take still uploads");
  });
}

test("the pace is never announced", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
  for (let second = 0; second < 30; second += 1) {
    readNext(t, { wpm: 115, cue: CUE.SPEED_UP });
  }
  assert.deepEqual(t.calls.announce, ["Recording started", "0:30"]);
});

test("the row adds no interval, timeout or animation frame", async () => {
  const t = setup();
  await t.startRecording();
  assert.equal(t.clock.activeIntervals(), 1, "the clock's one 250 ms tick");
  for (let second = 0; second < 8; second += 1) {
    readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  }
  assert.equal(t.clock.activeIntervals(), 1);
  assert.equal(t.calls.timers, 0);
});

test("every take starts at the waiting sentence: nothing carries over", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.recordTake(8 * SECOND);
  await t.startRecording();
  assert.equal(t.app.delivery.trackers.length, 2, "a new tracker for the new take");
  assert.deepEqual(rowView(t).text, WAITING);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t).text, "About 150 wpm On target");
  t.clock.advance(5 * SECOND);
  await t.stopRecording();
  t.clock.advance(SECOND);
  await t.startRecording();
  assert.equal(t.app.delivery.trackers.length, 3);
  assert.deepEqual(rowView(t).text, WAITING);
});

// --- letting the capture go ---

test("Stop lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  const g = graph(t);
  t.clock.advance(8 * SECOND);
  await t.stopRecording();
  assertReleased(g);
  assert.equal(paceRow(t).hidden, true);
});

test("the track ending on its own lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  const g = graph(t);
  t.clock.advance(8 * SECOND);
  t.MediaRecorder.last.finish();
  await flush();
  assertReleased(g);
  assert.equal(t.calls.analyze.length, 1);
});

test("leaving mid-take lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  const g = graph(t);
  t.clock.advance(3 * SECOND);
  t.practice.hide();
  assertReleased(g);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(paceRow(t).hidden, true);
});

test("a take under 5 seconds lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  const g = graph(t);
  t.clock.advance(3 * SECOND);
  await t.stopRecording();
  assert.equal(t.root.dataset.state, "error");
  assertReleased(g);
  assert.equal(paceRow(t).hidden, true);
});

test("a level take's Stop lets the capture go", async () => {
  const { request } = levelRequest();
  const t = setup();
  t.startLevel(request);
  await t.startRecording();
  const g = graph(t);
  t.clock.advance(8 * SECOND);
  await t.stopRecording();
  assertReleased(g);
});

test("a throw while the graph is built lets go of what was made", async () => {
  for (const failAt of ["processor", "gain"]) {
    const t = setup({ audio: { failAt } });
    await t.startRecording();
    const g = graph(t);
    assert.ok(g.source.disconnects >= 1, "the source is disconnected");
    if (g.processor) {
      assert.ok(g.processor.disconnects >= 1, "the processor is disconnected");
      assert.equal(g.processor.onaudioprocess, null);
    }
    assert.equal(g.context.closes, 1, "the context is closed");
    assert.equal(t.root.dataset.state, "recording", "the take records on");
  }
});

test("a tracker that cannot run at the context's rate lets the context go", async () => {
  const t = setup({ audio: { sampleRate: 4000 } });
  await t.startRecording();
  const { context } = graph(t);
  assert.equal(context.closes, 1);
  assert.equal(t.app.delivery.trackers.length, 0);
});

// --- tuning the factor ---

test("after the take's analysis its mode's factor is tuned once and kept in its own flag", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND, { firstBlockMs: 120, peaks: [0.5, 1, 1.5] });
  assert.equal(t.app.delivery.tunings.length, 0, "nothing before the analysis");
  t.resolveUpload();
  await flush();
  assert.equal(t.app.delivery.tunings.length, 1);
  const [tuning] = t.app.delivery.tunings;
  assert.equal(tuning.factor, null, "no factor kept yet");
  assert.deepEqual(plain(tuning.words), plain(ANALYSIS.transcript));
  // The peaks count from the first block, which came 0.12 s after the recorder started; the
  // words count from the recorder's start.
  assert.deepEqual(
    tuning.peaks.map((peak) => Math.round(peak * 1000) / 1000),
    [0.62, 1.12, 1.62],
  );
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]]);
  assert.equal(t.flags.get(TALK_FLAG), 0.75);
});

test("a kept factor shows the number from the next take of that mode on", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.75);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 150 wpm On target");
  t.practice.hide();
  // Read has no factor yet: its row still shows the cue alone.
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null);
  assert.deepEqual(plain(lastTracker(t).options.band), [150, 170]);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "On target");
});

test("show() reads each mode's factor from its flag; anything but a number counts as none", async () => {
  const t = setup({ flags: { [TALK_FLAG]: "0.8", [READ_FLAG]: 0.9 } });
  await t.show();
  assert.deepEqual(t.calls.getFlag.slice().sort(), [READ_FLAG, TALK_FLAG]);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "Talk's flag is no number");
  t.practice.hide();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9);
});

test("a Read passage, or a Talk take with a pasted script, records with the Read factor", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.6, [READ_FLAG]: 0.9 } });
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.6, "Talk");
  t.practice.hide();
  pasteScript(t, "My speech, word for word.");
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9, "Talk with a script is sent as a read");
  t.practice.hide();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9, "a Read passage");
});

// The analysis of a take that followed its script: the backend adds a script block.
function withScriptBlock(analysis) {
  return { ...analysis, metrics: { ...analysis.metrics, script: { skipped: [] } } };
}

// Pastes `text` into Talk's script box.
function pasteScript(t, text) {
  const box = byClass(byClass(t.body, "practice__hint"), "practice__script");
  box.children.find((child) => child.tagName === "textarea").value = text;
}

test("the take is tuned in the mode app.language.isReadTake gives its saved session", async () => {
  // A Talk take sent with a script it strayed from: no script block, so it counts as Talk,
  // though it recorded as a read.
  const strayed = setup({ flags: { [TALK_FLAG]: 0.6, [READ_FLAG]: 0.9 } });
  await strayed.show();
  pasteScript(strayed, "My speech, word for word.");
  strayed.app.delivery.nextFactor = 0.65;
  await strayed.recordTake(25 * SECOND);
  assert.equal(lastTracker(strayed).options.factor, 0.9, "recorded with Read's factor");
  strayed.resolveUpload();
  await flush();
  assert.equal(strayed.app.delivery.tunings[0].factor, 0.6, "tuned from Talk's factor");
  assert.deepEqual(plain(strayed.calls.setFlag), [[TALK_FLAG, 0.65]]);

  // A Talk take that followed its script carries a script block: it counts as Read.
  const followed = setup({ flags: { [TALK_FLAG]: 0.6, [READ_FLAG]: 0.9 } });
  await followed.show();
  pasteScript(followed, "My speech, word for word.");
  followed.app.delivery.nextFactor = 0.85;
  await followed.recordTake(25 * SECOND);
  followed.resolveUpload(withScriptBlock(ANALYSIS));
  await flush();
  assert.equal(followed.app.delivery.tunings[0].factor, 0.9, "tuned from Read's factor");
  assert.deepEqual(plain(followed.calls.setFlag), [[READ_FLAG, 0.85]]);
});

test("without language.js the take is tuned in the mode it was recorded in", async () => {
  const t = setup({ language: false });
  await t.show();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  t.app.delivery.nextFactor = 0.8;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[READ_FLAG, 0.8]]);
});

test("a factor the take left as it was is not kept", async () => {
  // No factor kept: a take that does not count gives back LIVE_PACE_FACTOR.
  const fresh = setup();
  await fresh.show();
  await fresh.recordTake(25 * SECOND);
  fresh.resolveUpload();
  await flush();
  assert.equal(fresh.app.delivery.tunings.length, 1);
  assert.deepEqual(fresh.calls.setFlag, []);
  await fresh.startRecording();
  assert.equal(lastTracker(fresh).options.factor, null, "still none");

  const kept = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await kept.show();
  await kept.recordTake(25 * SECOND);
  kept.resolveUpload();
  await flush();
  assert.equal(kept.app.delivery.tunings[0].factor, 0.8);
  assert.deepEqual(kept.calls.setFlag, []);
});

test("Retry never tunes a take twice", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  t.failures.save = 1;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  const banner = t.app.ui.banner.current();
  assert.equal(banner.title, "Upload failed");
  assert.equal(t.app.delivery.tunings.length, 1);
  banner.actions[0].onClick();
  await flush();
  assert.equal(t.calls.save.length, 2, "the save was tried again");
  assert.equal(t.calls.analyze.length, 1, "with the analysis it kept");
  assert.equal(t.app.delivery.tunings.length, 1, "and no second tuning");
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]]);
});

test("a store that cannot keep the factor changes nothing the speaker sees", async () => {
  const t = setup();
  await t.show();
  t.failures.setFlag = true;
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  assert.equal(t.calls.setFlag.length, 1, "it tried");
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.app.ui.banner.current(), null);
  assert.equal(t.root.dataset.state, "idle");
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "no factor was kept");
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "On target");
});

test("a store that cannot be read leaves the factors as they were", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  t.failures.getFlag = true;
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.8);
});

test("a take without a capture, or one no block reached, tunes nothing", async () => {
  const silent = setup({ audioGlobal: "none" });
  await silent.show();
  await silent.startRecording();
  silent.clock.advance(25 * SECOND);
  await silent.stopRecording();
  silent.resolveUpload();
  await flush();
  assert.equal(silent.app.delivery.tunings.length, 0);
  assert.deepEqual(silent.calls.setFlag, []);

  const blockless = setup();
  await blockless.show();
  await blockless.startRecording();
  blockless.clock.advance(25 * SECOND);
  await blockless.stopRecording();
  blockless.resolveUpload();
  await flush();
  assert.equal(blockless.app.delivery.tunings.length, 0);
  assert.deepEqual(blockless.calls.setFlag, []);
});

test("the sample is never tuned on", async () => {
  const sample = {
    passageId: "explain-something",
    passageTitle: "Sample: Explain something",
    durationSeconds: 34,
    metrics: { words_per_minute: 152.6, pauses: [] },
    transcript: WORDS,
  };
  const fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(plain(sample)) });
  const t = setup({ fetch });
  await t.show();
  byClass(byClass(t.body, "practice__hint"), "practice__sample").click();
  await flush();
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.app.delivery.tunings.length, 0);
  assert.deepEqual(t.calls.setFlag, []);
});

test("nothing of the live pace reaches the saved session", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND, { peaks: [0.5, 1, 1.5] });
  const tracker = lastTracker(t);
  t.resolveUpload();
  await flush();
  const [session] = t.calls.save;
  assert.deepEqual(Object.keys(session), [
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "transcript",
  ]);
  assert.deepEqual(plain(session.metrics), plain(ANALYSIS.metrics));
  assert.ok(!JSON.stringify(session).includes("0.75"), "no factor");
  assert.ok(!reaches(session, tracker), "no tracker");
  assert.ok(!/pace|factor|peak/i.test(JSON.stringify(Object.keys(session.metrics))));
});

test("a level take tunes its mode too", async () => {
  const { request } = levelRequest({ material: { ...PASSAGE_MATERIAL, targetWpm: [140, 160] } });
  const t = setup();
  await t.show();
  t.startLevel(request);
  t.app.delivery.nextFactor = 0.8;
  await t.recordTake(25 * SECOND);
  t.resolveUpload(withScriptBlock(ANALYSIS));
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(t.app.delivery.tunings.length, 1);
  assert.deepEqual(plain(t.calls.setFlag), [[READ_FLAG, 0.8]]);
});

// --- with the real estimator ---

// Speech-like samples at `sampleRate`: voiced syllables (12 harmonics of 120 Hz under a raised
// cosine, each 75% of its period) from 0.5 s, at `rateFor(t)` syllables a second.
function syllables(sampleRate, seconds, rateFor) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let t = 0.5; t < seconds - 0.5; ) {
    const period = 1 / rateFor(t);
    const from = Math.round(t * sampleRate);
    const length = Math.round(period * 0.75 * sampleRate);
    for (let k = 0; k < length && from + k < out.length; k += 1) {
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / length);
      let tone = 0;
      for (let h = 1; h <= 12; h += 1) {
        tone += Math.sin((2 * Math.PI * 120 * h * (from + k)) / sampleRate) / h;
      }
      out[from + k] = 0.15 * envelope * tone;
    }
    t += period;
  }
  return out;
}

// Records `samples` through the real estimator: before each tick of the clock one more block, so
// at every whole second the row reads exactly that much audio (1024 samples is 62.5 ms at
// 16384 Hz). Returns the row's text at each whole second.
async function recordThroughEstimator(t, samples) {
  await t.startRecording();
  const texts = [];
  const blockMs = (1024 / 16384) * 1000;
  for (let from = 0; from + 1024 <= samples.length; from += 1024) {
    block(t, samples.subarray(from, from + 1024));
    t.clock.advance(blockMs);
    if (Math.round(t.clock.performance.now()) % SECOND === 0) {
      texts.push(rowView(t).text);
    }
  }
  return texts;
}

// Practice on the real estimator at 16384 Hz, with a kept Talk factor of 0.69.
function withRealEstimator() {
  return setup({ realDelivery: true, audio: { sampleRate: 16384 }, flags: { [TALK_FLAG]: 0.69 } });
}

test("with the real estimator the row waits for 5 s of speech, then shows a number rounded to 5", async () => {
  const t = withRealEstimator();
  await t.show();
  const texts = await recordThroughEstimator(t, syllables(16384, 12, () => 4));
  assert.deepEqual(texts.slice(0, 5), Array(5).fill(WAITING), "1 to 5 s: not 5 s of speech yet");
  const numbers = texts.slice(5).map((text) => /^About (\d+) wpm On target$/.exec(text));
  assert.ok(numbers.every(Boolean), JSON.stringify(texts.slice(5)));
  for (const [, wpm] of numbers) {
    assert.equal(Number(wpm) % 5, 0, wpm);
    // 4 syllables a second at 0.69 words a syllable is 165.6 wpm.
    assert.ok(Math.abs(Number(wpm) - 165.6) <= 15, wpm);
  }
});

test("with the real estimator a new cue waits until the number has called for it for 3 s", async () => {
  const t = withRealEstimator();
  await t.show();
  // 4 syllables a second for 10 s (about 165 wpm), then 5.5 (about 228 wpm).
  const rate = (at) => (at < 10.5 ? 4 : 5.5);
  const texts = await recordThroughEstimator(t, syllables(16384, 24, rate));
  const readings = texts
    .map((text) => /^About (\d+) wpm (On target|Slow down|Speed up)$/.exec(text))
    .filter(Boolean)
    .map(([, wpm, cue]) => ({ wpm: Number(wpm), cue }));
  // The band is 140 to 160: Slow down is called for over 170.
  const over = readings.findIndex((reading) => reading.wpm > 170);
  assert.ok(over > 0, JSON.stringify(readings));
  assert.ok(readings.slice(over, over + 4).every((reading) => reading.wpm > 170));
  assert.deepEqual(
    readings.slice(over - 1, over + 4).map((reading) => reading.cue),
    ["On target", "On target", "On target", "On target", "Slow down"],
  );
});
