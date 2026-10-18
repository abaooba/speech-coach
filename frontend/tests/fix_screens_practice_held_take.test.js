// Tests that a normal take whose upload failed is kept, failure and all, while the speaker moves
// around the app (frontend/screens/practice.js). Since the owner's report of 2026-10-18 a normal
// take is analyzed in the background: Stop leaves Practice idle at 0:00 and the top banner
// (app.ui.banner) carries Upload failed, Retry upload and Record a new take over every screen,
// so leaving Practice and coming back finds the same banner and an idle record zone, never an
// error block there. Retry re-sends the same recording; Record a new take and Record again drop
// it. Every other error, which Practice still draws in place, goes back to idle on show().
// The screen and the real ui.js run in a vm context against the shared fake DOM, extended here
// with focus() and a descendant querySelector as in practice_revamp.test.js; the browser APIs a
// take touches are fakes driven by hand, and the banner is mounted into a node from the same
// fake document.
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

// The same sentences api.js freezes (DESIGN.md section 8); the fake app.api carries them.
const MESSAGES = Object.freeze({
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
});

const UPLOAD_FAILED = "Upload failed";
const RETRY = "Retry upload";
const NEW_TAKE = "Record a new take";
const TOO_SHORT = "Too short";
const RECORD_AGAIN = "Record again";
const ANALYZING = "Analyzing your speech";

// A fake element that logs focus() calls and finds a class anywhere below it.
class FocusElement extends FakeElement {
  constructor(tagName, namespaceURI, focusLog) {
    super(tagName, namespaceURI);
    this.focusLog = focusLog;
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
      const canSearch = typeof child.querySelector === "function";
      const deeper = canSearch ? child.querySelector(selector) : null;
      if (deeper) {
        return deeper;
      }
    }
    return null;
  }
}

function focusDocument(focusLog) {
  return {
    documentElement: { dataset: {} },
    get activeElement() {
      return focusLog.length > 0 ? focusLog[focusLog.length - 1] : null;
    },
    createElement: (tagName) => new FocusElement(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new FocusElement(tagName, namespaceURI, focusLog),
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
    intervals.forEach((entry) => {
      if (entry.next <= end && (due === null || entry.next < due.next)) {
        due = entry;
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
        now = due.next;
        due.next += due.ms;
        due.callback();
      }
      now = end;
    },
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

// Loads ui.js and practice.js against the fakes, mounts the banner into a node of its own and
// the screen into a section that holds only its body. Returns the parts by class, the call logs
// and the controls for the mic prompt, the upload and the sample fetch.
function setup() {
  const clock = fakeClock();
  const focused = [];
  const calls = { analyze: [], save: [], go: [] };
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
    passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
    router: {
      go(name, params) {
        calls.go.push({ name, params });
      },
    },
  };
  const context = {
    app,
    document: focusDocument(focused),
    navigator: {
      mediaDevices: {
        getUserMedia() {
          return new Promise((resolve, reject) => micAnswers.push({ resolve, reject }));
        },
      },
    },
    MediaRecorder: FakeMediaRecorder,
    Blob: FakeBlob,
    fetch: () => Promise.resolve({ ok: false }),
    performance: clock.performance,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  app.ui.announce = () => {};
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const banner = app.ui.el("div", { class: "banner" });
  banner.hidden = true;
  app.ui.banner.mount(banner);

  const root = new FocusElement("section", null, focused);
  root.dataset.state = "idle";
  const body = new FocusElement("div", null, focused);
  body.className = "screen__body";
  root.appendChild(body);
  const practice = app.screens.practice;
  practice.mount(root);

  return {
    practice,
    root,
    banner,
    clock,
    calls,
    focused,
    timer: byClass(byClass(body, "practice__timer"), "timer"),
    recordButton: byClass(body, "btn-record"),
    sampleButton: byClass(byClass(body, "practice__hint"), "practice__sample"),
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

// Records a take of `ms` milliseconds and stops it; its upload is left in flight.
async function recordTake(t, ms) {
  t.recordButton.click();
  t.grantMic();
  await flush();
  t.clock.advance(ms);
  t.recordButton.click();
  FakeMediaRecorder.last.finish();
  await flush();
}

// The title, body and button labels of the block in the record zone, or null when it is empty.
function blockText(t) {
  const block = t.stateEl.children[0];
  if (!block) {
    return null;
  }
  const title = byClass(block, "state__title");
  const text = byClass(block, "state__body");
  const buttons = block.children.filter((child) => child.tagName === "button");
  return {
    title: title ? title.textContent : null,
    body: text ? text.textContent : null,
    buttons: buttons.map((button) => button.children[0].textContent),
  };
}

// The text under a node, its own or its children's, as the banner's buttons keep their label in
// a child text node.
function textOf(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node.textContent;
  }
  return node.children.map(textOf).join("");
}

// {kind, title, body, buttons: [label]} as the banner is painted, or null while it is down.
function bannerView(t) {
  const node = t.banner;
  if (node.hidden) {
    return null;
  }
  const text = byClass(node, "banner__text");
  const actions = byClass(node, "banner__actions");
  return {
    kind: node.dataset.kind,
    title: byClass(text, "banner__title").textContent,
    body: byClass(text, "banner__body").textContent,
    buttons: actions ? actions.children.map(textOf) : [],
  };
}

function bannerButton(t, label) {
  const actions = byClass(t.banner, "banner__actions");
  return actions.children.find((button) => textOf(button) === label);
}

// What the banner says while a failed upload holds the take, with the sentence the failure gave.
function uploadFailedBanner(sentence) {
  return { kind: "failed", title: UPLOAD_FAILED, body: sentence, buttons: [RETRY, NEW_TAKE] };
}

// What the banner says while a single take of eight seconds is being analyzed.
const ANALYZING_BANNER = Object.freeze({
  kind: "working",
  title: ANALYZING,
  body: "Your 0:08 take. Usually 5 to 15 seconds.",
  buttons: [],
});

// Leaves the screen and comes back, as the router does: hide(), then show() on return.
function leaveAndComeBack(t) {
  t.practice.hide();
  t.practice.show({});
}

test("a failed upload keeps its banner across screens; Retry upload re-sends the same take", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  assert.equal(t.root.dataset.state, "idle", "the failure never blocks the record zone");
  assert.equal(blockText(t), null);
  assert.deepEqual(bannerView(t), uploadFailedBanner(MESSAGES.network));

  leaveAndComeBack(t);
  assert.equal(t.root.dataset.state, "idle", "Practice opens free for the next take");
  assert.equal(blockText(t), null);
  assert.deepEqual(bannerView(t), uploadFailedBanner(MESSAGES.network), "the held take is kept");
  assert.equal(t.timer.textContent, "0:00", "the clock belongs to the next take");

  bannerButton(t, RETRY).click();
  assert.equal(t.root.dataset.state, "idle", "the retry runs in the background too");
  assert.deepEqual(bannerView(t), ANALYZING_BANNER);
  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob, "the same recording is re-sent");
  t.resolveUpload({ transcript: [], metrics: {} });
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(t.calls.go[0].name, "results", "Practice waited in idle, so Results opens at once");
  assert.equal(bannerView(t), null, "the banner comes down with the job");
});

test("the banner keeps the failure's own message after a return and leaves focus alone", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("provider"));
  await flush();
  t.recordButton.focus();

  leaveAndComeBack(t);
  assert.equal(blockText(t), null, "no block in the record zone to take focus");
  assert.deepEqual(bannerView(t), uploadFailedBanner(MESSAGES.provider));
  assert.equal(
    t.focused[t.focused.length - 1],
    t.recordButton,
    "the banner never pulls focus from where the speaker left it",
  );
});

test("an upload that fails while Practice is hidden waits in the banner for the return", async () => {
  const t = setup();
  await recordTake(t, 9000);
  t.practice.hide();
  assert.equal(t.root.dataset.state, "idle", "Practice was free as soon as the take left it");
  assert.equal(bannerView(t).kind, "working", "the job keeps going off screen");
  t.rejectUpload(apiError("network"));
  await flush();
  assert.deepEqual(bannerView(t), uploadFailedBanner(MESSAGES.network));

  t.practice.show({});
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(blockText(t), null);
  assert.deepEqual(bannerView(t), uploadFailedBanner(MESSAGES.network), "the banner is global");
  assert.equal(t.timer.textContent, "0:00");

  bannerButton(t, NEW_TAKE).click();
  assert.equal(bannerView(t), null, "the dropped take's banner goes with it");
  assert.deepEqual(t.calls.go, [{ name: "practice", params: undefined }]);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(blockText(t), null);
  assert.equal(t.timer.textContent, "0:00");
});

test("Record a new take drops the held take: the banner is down and the next visit opens in idle", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  leaveAndComeBack(t);
  bannerButton(t, NEW_TAKE).click();
  assert.equal(bannerView(t), null);
  assert.deepEqual(t.calls.go, [{ name: "practice", params: undefined }]);
  assert.equal(t.root.dataset.state, "idle");

  leaveAndComeBack(t);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(blockText(t), null);
  assert.equal(bannerView(t), null, "nothing of the take comes back");
  assert.equal(t.calls.analyze.length, 1, "the dropped take is never sent again");
});

test("a retry that saves opens Results and lets the take go: the next visit opens in idle", async () => {
  const t = setup();
  // Practice is on show, as after the router's boot route, so the saved take opens Results.
  t.practice.show({});
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  bannerButton(t, RETRY).click();
  t.resolveUpload({ transcript: [], metrics: {} });
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(t.calls.go[0].name, "results");
  assert.equal(bannerView(t), null, "the banner comes down as Results opens");

  leaveAndComeBack(t);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(blockText(t), null);
  assert.equal(bannerView(t), null);
  assert.equal(t.timer.textContent, "0:00");
});

test("a retry that fails again keeps the newer message in the banner across a return", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  bannerButton(t, RETRY).click();
  t.rejectUpload(apiError("provider"));
  await flush();
  assert.deepEqual(bannerView(t), uploadFailedBanner(MESSAGES.provider));

  leaveAndComeBack(t);
  assert.equal(bannerView(t).body, MESSAGES.provider, "the newer failure's own message stays");
  assert.equal(blockText(t), null);
  assert.equal(t.calls.analyze.length, 2);
});

test("a retry the backend finds too short shows Too short in the banner; Record again drops it", async () => {
  const t = setup();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  bannerButton(t, RETRY).click();
  t.rejectUpload(apiError("too_short"));
  await flush();
  assert.deepEqual(bannerView(t), {
    kind: "failed",
    title: TOO_SHORT,
    body: MESSAGES.too_short,
    buttons: [RECORD_AGAIN],
  });
  assert.equal(blockText(t), null, "the verdict is the banner's, not the record zone's");

  leaveAndComeBack(t);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(bannerView(t).title, TOO_SHORT, "the verdict waits for the speaker");

  bannerButton(t, RECORD_AGAIN).click();
  assert.equal(bannerView(t), null, "the take is gone, so its banner is too");
  assert.deepEqual(t.calls.go, [{ name: "practice", params: undefined }]);
  leaveAndComeBack(t);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(blockText(t), null);
  assert.equal(t.calls.analyze.length, 2, "a too-short take is never sent again");
});

test("every other error still goes back to idle when the speaker comes back", async () => {
  const denied = setup();
  denied.recordButton.click();
  denied.denyMic();
  await flush();
  assert.equal(blockText(denied).title, "Microphone blocked");
  leaveAndComeBack(denied);
  assert.equal(denied.root.dataset.state, "idle", "microphone blocked");

  const short = setup();
  await recordTake(short, 2000);
  assert.equal(blockText(short).title, TOO_SHORT);
  leaveAndComeBack(short);
  assert.equal(short.root.dataset.state, "idle", "too short");

  const sample = setup();
  sample.sampleButton.click();
  await flush();
  await flush();
  assert.equal(blockText(sample).title, "Sample unavailable");
  leaveAndComeBack(sample);
  assert.equal(sample.root.dataset.state, "idle", "sample unavailable");
});
