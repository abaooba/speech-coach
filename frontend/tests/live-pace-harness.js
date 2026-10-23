// Mounts the Practice screen (frontend/screens/practice.js) for the live pace tests (spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7): ui.js, language.js,
// delivery.js or a fake estimator, and practice.js run in a vm context against the shared fake
// DOM. Every browser API a take touches (getUserMedia, MediaRecorder, AudioContext and its
// nodes, Blob, performance.now, setInterval) is a fake the tests drive by hand, and the fake
// estimator hands back the readings, peaks and factors each test sets.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");
const { flush, plain } = require("./practice-harness");

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
// rejectResume, holdResume (resume() answers only when the test calls the instance's
// answerResume(accepted)), failOnCreate, and failAt ("source", "processor" or "gain") for a node
// that cannot be made. Every instance is kept, with the nodes made on it, and `log` hears each
// step.
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
      if (options.holdResume) {
        return new Promise((resolve, reject) => {
          this.answerResume = (accepted) => {
            if (!accepted) {
              reject(new Error("resume needs a gesture"));
              return;
            }
            this.state = "running";
            resolve();
          };
        });
      }
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
// "webkitAudioContext" or "none"), `flags` for the store's flags, `pauses` for app.pauses. The
// vm context is handed back as `context`, so a test can take a global away or replace it.
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
    context,
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

module.exports = {
  ANALYSIS,
  CUE,
  DELIVERY_SOURCE,
  MESSAGES,
  PASSAGES,
  READ_FLAG,
  SAVED_ID,
  SECOND,
  TALK_FLAG,
  WAITING,
  WORDS,
  assertReleased,
  block,
  fakeDelivery,
  graph,
  lastTracker,
  paceRow,
  readNext,
  rowView,
  setup,
};
