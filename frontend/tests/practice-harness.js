// Mounts the Practice screen (frontend/screens/practice.js) for the level mode and topic tests:
// ui.js and practice.js run in a vm context against the shared fake DOM, extended here with
// focus(), contains(), a descendant querySelector, parentNode and insertBefore (level mode adds
// its banner and its live tap to the body while a request is held). Every browser API a take
// touches (getUserMedia, MediaRecorder, Blob, performance.now, setInterval) is a fake the tests
// drive by hand, and a level request's callbacks log their calls.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const PRACTICE_SOURCE = fs.readFileSync(path.join(FRONTEND, "screens", "practice.js"), "utf8");
const UI_SOURCE = fs.readFileSync(path.join(FRONTEND, "ui.js"), "utf8");
const PASSAGES_SOURCE = fs.readFileSync(path.join(FRONTEND, "passages.js"), "utf8");

// The same sentences api.js freezes (DESIGN.md section 8); the fake app.api carries them.
const MESSAGES = Object.freeze({
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
});

// Talk first, as in passages.js: a prompt with topics, one without, then two Read passages.
const PASSAGES = [
  {
    id: "free-talk",
    kind: "prompt",
    title: "Your day",
    text: "First topic.",
    topics: ["First topic.", "Second topic.", "Third topic."],
    targetWpm: [140, 160],
    timeLimitSeconds: 60,
  },
  {
    id: "congress",
    kind: "prompt",
    title: "Congress speech",
    text: "Pick a bill.",
    targetWpm: [130, 160],
    timeLimitSeconds: 180,
  },
  { id: "read1", kind: "passage", title: "Gettysburg", text: "Four score", targetWpm: [130, 150] },
  { id: "read2", kind: "passage", title: "Drill", text: "Strong students", targetWpm: [120, 140] },
];

const ANALYSIS = Object.freeze({
  transcript: [{ text: "hello", start: 0.1, end: 0.5 }],
  metrics: { words_per_minute: 150, pauses: [] },
});

const SAVED_ID = "session-1";

// What a level request's judge returns: the session's `path` (spec section 6).
const JUDGED_PATH = Object.freeze({
  play: "fillers-3",
  kind: "loop",
  take: 1,
  scored: false,
  passed: null,
  stage: null,
  inRoom: null,
});

const IMPROMPTU_TOPIC = "Schools should ban phones in class.";

// The material of a talk level: the Impromptu prompt on one picked topic.
const PROMPT_MATERIAL = Object.freeze({
  kind: "prompt",
  id: "impromptu",
  title: "Impromptu",
  text: IMPROMPTU_TOPIC,
  targetWpm: [140, 160],
  topic: IMPROMPTU_TOPIC,
});

// The material of a reading level: a cold read, whose text is also the script.
const PASSAGE_MATERIAL = Object.freeze({
  kind: "passage",
  id: "cold-courts",
  title: "Courts and cameras",
  text: "Cameras in courtrooms let the public see justice done.",
  targetWpm: [140, 160],
  topic: null,
});

// A fake element that logs focus() calls, finds a class anywhere below it, says whether a node
// sits inside it and keeps parentNode, which the shared fake (direct children only) cannot.
class LevelElement extends FakeElement {
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
      const deeper = typeof child.querySelector === "function" ? child.querySelector(selector) : null;
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

  // Like Node.insertBefore: `child` goes right before `reference`, which must be a child.
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

// The document: activeElement is the element focused last, or null before any focus() call.
function levelDocument(focusLog) {
  return {
    documentElement: { dataset: {} },
    get activeElement() {
      return focusLog.length > 0 ? focusLog[focusLog.length - 1] : null;
    },
    createElement: (tagName) => new LevelElement(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new LevelElement(tagName, namespaceURI, focusLog),
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

  // What a browser does after stop(): one last chunk, then the stop event.
  finish() {
    this.state = "inactive";
    (this.listeners.dataavailable || []).forEach((handler) => handler({ data: { size: 10 } }));
    (this.listeners.stop || []).forEach((handler) => handler({ type: "stop" }));
  }
}

class FakeBlob {
  constructor(parts, options) {
    this.parts = Array.from(parts);
    this.type = (options && options.type) || "";
  }
}

function apiError(kind) {
  const error = new Error(MESSAGES[kind]);
  error.kind = kind;
  return error;
}

// Lets every pending promise chain settle, including the awaits inside practice.js.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Objects built inside the vm realm have a foreign prototype; a JSON round-trip makes them
// comparable with deepEqual.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// True when `target` is `value` or sits anywhere inside it (arrays and plain objects).
function reaches(value, target, seen = new Set()) {
  if (value === target) {
    return true;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).some((inner) => reaches(inner, target, seen));
}

// The passages.js data as the app ships it, for the tests that read real topics.
function realPassages() {
  const context = { app: {} };
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  return plain(context.app.passages);
}

// A level request (spec section 7) for Fillers level 3's take 1, with `overrides` on top. Its
// judge, onSaved and onLeave log their arguments in `log`; judge returns JUDGED_PATH.
function levelRequest(overrides = {}) {
  const log = { judge: [], onSaved: [], onLeave: [] };
  const request = {
    eyebrow: "Path: Fillers, level 3",
    title: "Take 1 of 2",
    body: "Talk for 90 s. Take 2 counts: 6 or fewer fillers a minute.",
    material: { ...PROMPT_MATERIAL, targetWpm: [...PROMPT_MATERIAL.targetWpm] },
    seconds: 90,
    liveTap: false,
    judge(result) {
      log.judge.push(result);
      return { ...JUDGED_PATH };
    },
    onSaved(saved) {
      log.onSaved.push(saved);
    },
    onLeave(...args) {
      log.onLeave.push(args);
    },
    ...overrides,
  };
  return { request, log };
}

// Loads ui.js and practice.js against the fakes and mounts the screen into a section that holds
// only its body, like the other Practice tests. Returns the screen, its body, the call logs and
// the controls for the mic prompt, the clock and the upload.
function setup(options = {}) {
  const clock = fakeClock();
  const focused = [];
  const calls = { analyze: [], save: [], go: [], announce: [] };
  const micAnswers = [];
  const uploads = [];
  const app = {
    screens: {},
    ui: {},
    store: {
      save(session) {
        calls.save.push(session);
        return Promise.resolve(SAVED_ID);
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
    app.pauses = options.pauses;
  }
  const context = {
    app,
    document: levelDocument(focused),
    navigator: {
      mediaDevices: {
        getUserMedia() {
          return new Promise((resolve, reject) => micAnswers.push({ resolve, reject }));
        },
      },
    },
    MediaRecorder: FakeMediaRecorder,
    Blob: FakeBlob,
    performance: clock.performance,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  app.ui.announce = (text) => calls.announce.push(text);
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = new LevelElement("section", null, focused);
  root.dataset.state = "idle";
  const body = new LevelElement("div", null, focused);
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
    focused,
    recordButton: byClass(body, "btn-record"),
    stateEl: byClass(body, "practice__state"),
    grantMic() {
      micAnswers.shift().resolve({ getTracks: () => [{ stop() {} }] });
    },
    denyMic() {
      micAnswers.shift().reject(new Error("Permission denied"));
    },
    resolveUpload(result = ANALYSIS) {
      uploads.shift().resolve(result);
    },
    rejectUpload(kind) {
      uploads.shift().reject(apiError(kind));
    },
    // Taps Record and grants the microphone: the take is recording.
    async startRecording() {
      t.recordButton.click();
      t.grantMic();
      await flush();
    },
    // Taps Stop and lets the recorder hand over its last chunk: the take uploads (or is too
    // short), and the upload is left in flight.
    async stopRecording() {
      t.recordButton.click();
      FakeMediaRecorder.last.finish();
      await flush();
    },
    // A whole take of `ms` milliseconds, left uploading.
    async recordTake(ms) {
      await t.startRecording();
      t.clock.advance(ms);
      await t.stopRecording();
    },
    // startLevelTake, then the show() the router runs once it reaches #/practice.
    startLevel(request) {
      practice.startLevelTake(request);
      practice.show({});
    },
  };
  return t;
}

// The screen's parts, read from the body by class. The banner and the live tap are null while
// they are not in the body.
function parts(t) {
  const card = byClass(t.body, "passage-card");
  const timer = byClass(t.body, "practice__timer");
  const hint = byClass(t.body, "practice__hint");
  const banner = byClass(t.body, "practice__banner") || null;
  const liveTap = byClass(t.body, "practice__live-tap") || null;
  const scriptBox = byClass(hint, "practice__script");
  const modeSwitch = byClass(t.body, "segmented");
  return {
    modeSwitch,
    talk: modeSwitch.children.find((option) => option.textContent === "Talk"),
    read: modeSwitch.children.find((option) => option.textContent === "Read"),
    chipRow: byClass(t.body, "chip-row"),
    chips: byClass(t.body, "chip-row").children,
    banner,
    eyebrow: banner && byClass(banner, "practice__banner-eyebrow"),
    bannerTitle: banner && byClass(banner, "practice__banner-title"),
    bannerBody: banner && byClass(banner, "practice__banner-body"),
    leave: banner && byClass(banner, "practice__banner-leave"),
    card,
    cardTitle: byClass(card, "passage-card__title"),
    cardTarget: byClass(card, "passage-card__target"),
    cardText: byClass(card, "passage-card__text"),
    newTopic: byClass(card, "passage-card__new"),
    timer: byClass(timer, "timer"),
    limit: byClass(timer, "practice__limit"),
    limitFill: byClass(timer, "practice__limit-bar").children[0],
    limitBar: byClass(timer, "practice__limit-bar"),
    recordLabel: byClass(t.body, "btn-record__label"),
    liveTap,
    liveTapButton: liveTap && byClass(liveTap, "practice__live-tap-button"),
    liveTapCount: liveTap && byClass(liveTap, "practice__live-tap-count"),
    hint,
    hintText: byClass(hint, "practice__hint-text"),
    sample: byClass(hint, "practice__sample"),
    scriptBox,
    scriptInput: scriptBox.children.find((child) => child.tagName === "textarea"),
  };
}

// The block in the record zone: its class, title, action and secondary action.
function stateBlock(t) {
  const block = t.stateEl.children[0] || null;
  if (block === null) {
    return null;
  }
  const buttons = block.children.filter((child) => child.tagName === "button");
  return {
    className: block.className,
    title: byClass(block, "state__title").textContent,
    action: buttons.find((button) => button.classList.contains("state__action")) || null,
    secondary: buttons.find((button) => button.classList.contains("state__secondary")) || null,
  };
}

function labelOf(button) {
  return button.children.length > 0 ? button.children[0].textContent : button.textContent;
}

// The classes of the body's parts, in order.
function bodyClasses(t) {
  return t.body.children.map((child) => child.className);
}

module.exports = {
  ANALYSIS,
  IMPROMPTU_TOPIC,
  JUDGED_PATH,
  MESSAGES,
  PASSAGES,
  PASSAGE_MATERIAL,
  PROMPT_MATERIAL,
  SAVED_ID,
  bodyClasses,
  flush,
  labelOf,
  levelRequest,
  parts,
  plain,
  reaches,
  realPassages,
  setup,
  stateBlock,
};
