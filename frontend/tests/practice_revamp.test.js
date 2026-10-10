// Tests for the revamped Practice screen (frontend/screens/practice.js, DESIGN.md sections 6 to 8):
// the record zone per state, the error block's focus and second action, and the hint copy. The
// screen and the real ui.js run in a vm context against the shared fake DOM, extended here (and
// only here) with focus() and a descendant querySelector; the browser APIs a take touches
// (getUserMedia, MediaRecorder, Blob, performance.now, setInterval, fetch) are fakes as well.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");

const PRACTICE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "practice.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

const PASSAGES = [
  { id: "a", kind: "passage", title: "A", text: "x", targetWpm: [140, 160] },
  { id: "b", kind: "prompt", title: "B", text: "y", targetWpm: [120, 130] },
];

const MESSAGES = Object.freeze({
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
});

const IDLE_HINT = "Tap to record. Stop uploads automatically.";
const NEW_TAKE = "Record a new take";

// A fake element that also records focus() calls and finds a class anywhere below it, which the
// shared fake (direct children only, no focus) cannot.
class RevampElement extends FakeElement {
  constructor(tagName, namespaceURI, focusLog) {
    super(tagName, namespaceURI);
    this.focusLog = focusLog;
  }

  focus() {
    this.focusLog.push(this);
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
}

function revampDocument(focusLog) {
  return {
    createElement: (tagName) => new RevampElement(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new RevampElement(tagName, namespaceURI, focusLog),
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
  const error = new Error(MESSAGES[kind] || MESSAGES.provider);
  error.kind = kind;
  return error;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Loads ui.js and practice.js against the fakes and mounts the screen into a section that holds
// only its body, like the other Practice tests. Returns the parts by class plus the call logs.
function setup(options = {}) {
  const clock = fakeClock();
  const focused = [];
  const calls = { analyze: [], save: [], go: [], announce: [], fetch: [] };
  const micAnswers = [];
  const uploads = [];
  const app = {
    screens: {},
    ui: {},
    store: {
      save(session) {
        calls.save.push(session);
        return Promise.resolve("session-1");
      },
    },
    api: {
      messages: MESSAGES,
      analyze(blob, contentType) {
        calls.analyze.push({ blob, contentType });
        return new Promise((resolve, reject) => uploads.push({ resolve, reject }));
      },
    },
    passages: (options.passages || PASSAGES).map((entry) => ({
      ...entry,
      targetWpm: [...entry.targetWpm],
    })),
    router: {
      go(name, params) {
        calls.go.push({ name, params });
      },
    },
  };
  const context = {
    app,
    document: revampDocument(focused),
    navigator: {
      mediaDevices: {
        getUserMedia() {
          return new Promise((resolve, reject) => micAnswers.push({ resolve, reject }));
        },
      },
    },
    MediaRecorder: FakeMediaRecorder,
    Blob: FakeBlob,
    fetch(url) {
      calls.fetch.push(url);
      return Promise.resolve({ ok: false });
    },
    performance: clock.performance,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  app.ui.announce = (text) => calls.announce.push(text);
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = options.root || new RevampElement("section", null, focused);
  root.dataset.state = "idle";
  let body = byClass(root, "screen__body");
  if (!body) {
    body = new RevampElement("div", null, focused);
    body.className = "screen__body";
    root.appendChild(body);
  }
  const practice = app.screens.practice;
  practice.mount(root);

  const hint = byClass(body, "practice__hint");
  return {
    app,
    practice,
    root,
    body,
    clock,
    calls,
    focused,
    timer: byClass(byClass(body, "practice__timer"), "timer"),
    recordButton: byClass(body, "btn-record"),
    hint,
    sampleButton: byClass(hint, "practice__sample"),
    stateEl: byClass(body, "practice__state"),
    grantMic() {
      micAnswers.shift().resolve({ getTracks: () => [{ stop() {} }] });
    },
    denyMic() {
      micAnswers.shift().reject(new Error("Permission denied"));
    },
    rejectUpload(error) {
      uploads.shift().reject(error);
    },
    resolveUpload(result) {
      uploads.shift().resolve(result);
    },
  };
}

// Records a take of `ms` milliseconds and stops it; the upload (if any) is left in flight.
async function recordTake(t, ms) {
  t.recordButton.click();
  t.grantMic();
  await flush();
  t.clock.advance(ms);
  t.recordButton.click();
  FakeMediaRecorder.last.finish();
  await flush();
}

function stateBlock(t) {
  return t.stateEl.children[0];
}

function labelOf(button) {
  return button.children[0].textContent;
}

test("viewFor shows the record button and its label only in idle and recording", () => {
  const { practice } = setup();
  assert.equal(practice.viewFor("idle").showRecord, true);
  assert.equal(practice.viewFor("recording").showRecord, true);
  assert.equal(practice.viewFor("uploading").showRecord, false);
  assert.equal(practice.viewFor("error").showRecord, false);
});

test("render('error') makes the block's title focusable and moves focus to it", () => {
  const t = setup();
  t.practice.render("error", {
    title: "Upload failed",
    body: MESSAGES.network,
    actionLabel: "Retry upload",
    onAction() {},
  });
  const title = byClass(stateBlock(t), "state__title");
  assert.equal(title.getAttribute("tabindex"), "-1");
  assert.equal(t.focused[t.focused.length - 1], title);
  assert.equal(stateBlock(t).getAttribute("role"), "alert", "the alert role still speaks it");
});

test("a failed upload offers Record a new take, which drops the held take", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();

  const block = stateBlock(t);
  assert.equal(block.children.length, 5, "icon, title, body, retry and the secondary action");
  const [, title, body, retry, secondary] = block.children;
  assert.equal(title.textContent, "Upload failed");
  assert.equal(body.textContent, MESSAGES.network);
  assert.equal(labelOf(retry), "Retry upload");
  assert.equal(labelOf(secondary), NEW_TAKE);
  assert.ok(secondary.classList.contains("btn--ghost"));
  assert.ok(secondary.classList.contains("state__secondary"));

  secondary.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.stateEl.children, []);
  retry.click();
  assert.equal(t.calls.analyze.length, 1, "the dropped take can no longer be re-sent");
  assert.equal(t.root.dataset.state, "idle");
});

test("provider and unknown upload failures offer the same second action", async () => {
  for (const kind of ["provider", "unknown"]) {
    const t = setup();
    await recordTake(t, 8000);
    t.rejectUpload(apiError(kind));
    await flush();
    const [, , body, , secondary] = stateBlock(t).children;
    assert.equal(body.textContent, MESSAGES.provider, kind);
    assert.equal(labelOf(secondary), NEW_TAKE, kind);
  }
});

test("Retry upload still re-sends the same take after a failure", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  stateBlock(t).children[3].click();
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob);
});

test("mic denied, too short and the sample error keep a single action", async () => {
  const denied = setup();
  denied.recordButton.click();
  denied.denyMic();
  await flush();
  assert.equal(stateBlock(denied).children.length, 4, "mic denied");

  const short = setup();
  await recordTake(short, 2000);
  assert.equal(stateBlock(short).children.length, 4, "too short");

  const sample = setup();
  sample.sampleButton.click();
  await flush();
  await flush();
  assert.equal(byClass(stateBlock(sample), "state__title").textContent, "Sample unavailable");
  assert.equal(stateBlock(sample).children.length, 4, "sample error");
});

test("every error path moves focus to its title and none of them is announced", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  assert.equal(t.focused[t.focused.length - 1], byClass(stateBlock(t), "state__title"));
  assert.deepEqual(t.calls.announce, ["Recording started", "Recording stopped, 8 seconds"]);

  const denied = setup();
  denied.recordButton.click();
  denied.denyMic();
  await flush();
  assert.equal(denied.focused.length, 1);
  assert.equal(denied.focused[0], byClass(stateBlock(denied), "state__title"));
  assert.deepEqual(denied.calls.announce, []);
});

test("the hint text sits in its own span, followed by the sample button", () => {
  const t = setup();
  const [text, sample] = t.hint.children;
  assert.equal(text.tagName, "span");
  assert.equal(text.className, "practice__hint-text");
  assert.equal(text.textContent, IDLE_HINT);
  assert.equal(sample, t.sampleButton);
  assert.ok(sample.classList.contains("practice__sample"));
});

const RECORDING_HINT = "Tap Stop when you finish. It uploads right away.";

test("viewFor gives the hint copy: tap to record in idle, tap Stop while recording (M2)", () => {
  const { practice } = setup();
  assert.equal(practice.viewFor("idle").hintText, IDLE_HINT);
  assert.equal(practice.viewFor("recording").hintText, RECORDING_HINT);
});

test("render swaps the hint words and keeps the sample button in the hint (M2)", () => {
  const t = setup();
  const text = byClass(t.hint, "practice__hint-text");
  t.practice.render("recording");
  assert.equal(text.textContent, RECORDING_HINT);
  assert.equal(t.hint.children[1], t.sampleButton, "the sample button stays a direct child");
  t.practice.render("idle");
  assert.equal(text.textContent, IDLE_HINT);
});

test("the record icons draw in currentColor so the button's --on-record colors them (L5)", () => {
  const t = setup();
  const [mic, stop] = t.recordButton.children;
  assert.equal(mic.getAttribute("stroke"), "currentColor");
  assert.equal(stop.getAttribute("fill"), "currentColor");
});

test("the passage text scrolls back to the top only when the passage changes (M1)", () => {
  const t = setup();
  const card = byClass(t.body, "passage-card");
  const text = byClass(card, "passage-card__text");
  const chips = byClass(t.body, "chip-row").children;
  text.scrollTop = 50;
  t.practice.render("recording");
  t.practice.render("idle");
  assert.equal(text.scrollTop, 50, "a state change keeps the reader's place");
  const other = chips.find((chip) => chip.dataset.passageId === "b");
  other.click();
  assert.equal(text.scrollTop, 0);
});
