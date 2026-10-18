// Tests for the revamped Practice screen (frontend/screens/practice.js, DESIGN.md sections 6-8):
// the record zone per state, the error block's focus and second action, and the hint copy. A
// normal take is analyzed in the background after Stop, so its progress and its failures are
// read from the top banner (app.ui.banner, mounted here into a node from the same fake
// document); the in-place blocks remain for Too short, Microphone blocked and the sample. The
// screen and the real ui.js run in a vm context against the shared fake DOM, extended here (and
// only here) with focus(), contains(), a descendant querySelector and the document's
// activeElement; the browser APIs a take touches (getUserMedia, MediaRecorder, Blob,
// performance.now, setInterval, fetch) are fakes as well.
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

// A fake element that also records focus() calls, finds a class anywhere below it and says
// whether a node sits inside it, which the shared fake (direct children only, no focus) cannot.
class RevampElement extends FakeElement {
  constructor(tagName, namespaceURI, focusLog) {
    super(tagName, namespaceURI);
    this.focusLog = focusLog;
  }

  focus() {
    this.focusLog.push(this);
  }

  // Like Node.contains: true for the element itself and for anything below it.
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

// The same element without querySelector. Below its section the screen guards that call, as it
// guards focus() and contains(), so a stand-in DOM that lacks it still runs every state.
class UnsearchableElement extends RevampElement {
  get querySelector() {
    return undefined;
  }
}

// The fake document also carries an <html> stand-in, where app.ui.applyTheme sets data-theme,
// and an activeElement: the element focused last, or null before the first focus() call. Every
// element it builds is a RevampElement unless the caller passes another class.
function revampDocument(focusLog, Element = RevampElement) {
  return {
    documentElement: { dataset: {} },
    get activeElement() {
      return focusLog.length > 0 ? focusLog[focusLog.length - 1] : null;
    },
    createElement: (tagName) => new Element(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new Element(tagName, namespaceURI, focusLog),
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
    document: revampDocument(focused, options.elementClass),
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
  if (options.localStorage) {
    context.localStorage = options.localStorage;
  }
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
    html: context.document.documentElement,
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

// The same setup with the top banner mounted into a node built by the fake document, where a
// normal take's analysis reports. Practice is only mounted, not shown: a take saved before
// show() waits in the ready banner for "See results", so a test that expects Results to open on
// its own calls t.practice.show({}) first.
function withBanner(options) {
  const t = setup(options);
  const node = t.app.ui.el("div", { class: "banner" });
  node.hidden = true;
  t.app.ui.banner.mount(node);
  t.banner = node;
  return t;
}

function textOf(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node.textContent;
  }
  return node.children.map(textOf).join("");
}

function part(node, name) {
  return node.children.find((child) => child.classList.contains(name));
}

// {kind, title, body, actions: [label]} as painted, or null while the banner is down.
function bannerView(t) {
  const node = t.banner;
  if (node.hidden) {
    return null;
  }
  const text = part(node, "banner__text");
  const actions = part(node, "banner__actions");
  return {
    kind: node.dataset.kind,
    title: part(text, "banner__title").textContent,
    body: part(text, "banner__body").textContent,
    actions: actions ? actions.children.map(textOf) : [],
  };
}

function bannerButton(t, label) {
  const actions = part(t.banner, "banner__actions");
  return actions.children.find((button) => textOf(button) === label);
}

const WORKING_BODY_8S = "Your 0:08 take. Usually 5 to 15 seconds.";
const WORKING_BODY_30S = "Your 0:30 take. Usually 5 to 15 seconds.";

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

// A normal take is analyzed in the background, so a failed upload lands on the top banner, not
// in the record zone: Practice stays idle for the next take. "Record a new take" drops the held
// take, takes the banner down and asks the router for Practice; nothing of the take comes back.
test("a failed upload puts Upload failed on the banner; Record a new take drops the take", async () => {
  const t = withBanner();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();

  assert.equal(t.root.dataset.state, "idle", "the failure never blocks the record zone");
  assert.deepEqual(t.stateEl.children, []);
  assert.deepEqual(bannerView(t), {
    kind: "failed",
    title: "Upload failed",
    body: MESSAGES.network,
    actions: ["Retry upload", NEW_TAKE],
  });
  const secondary = bannerButton(t, NEW_TAKE);
  assert.ok(secondary.classList.contains("btn--secondary"), "never the screen's primary button");

  const retry = bannerButton(t, "Retry upload");
  secondary.click();
  assert.equal(bannerView(t), null);
  assert.deepEqual(t.calls.go, [{ name: "practice", params: undefined }]);
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.stateEl.children, []);
  assert.equal(t.banner.children.length, 0, "no Retry upload is left for the dropped take");
  retry.click();
  await flush();
  assert.equal(t.calls.analyze.length, 1, "the dropped take can no longer be re-sent");
  t.practice.show({});
  assert.equal(bannerView(t), null, "nothing of the dropped take comes back on show()");
  assert.equal(t.calls.analyze.length, 1, "the dropped take can no longer be re-sent");
});

test("provider and unknown upload failures offer the same second action on the banner", async () => {
  for (const kind of ["provider", "unknown"]) {
    const t = withBanner();
    await recordTake(t, 8000);
    t.rejectUpload(apiError(kind));
    await flush();
    const view = bannerView(t);
    assert.equal(view.body, MESSAGES.provider, kind);
    assert.deepEqual(view.actions, ["Retry upload", NEW_TAKE], kind);
  }
});

test("Retry upload on the banner re-sends the same take after a failure", async () => {
  const t = withBanner();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  bannerButton(t, "Retry upload").click();
  assert.equal(bannerView(t).kind, "working");
  assert.equal(t.root.dataset.state, "idle", "Practice stays free while the take is re-sent");
  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob);
});

// The backend answers 400 when it hears under 5 seconds of speech. Re-sending the same blob can
// never pass and costs a provider call each time, so the take goes and the banner says Too short
// in the words of the block a Stop under 5 seconds shows, with Record again as its one action.
test("a backend too short drops the take; the banner says Too short with Record again only", async () => {
  const t = withBanner();
  await recordTake(t, 8000);
  const moves = t.focused.length;
  t.rejectUpload(apiError("too_short"));
  await flush();
  assert.deepEqual(bannerView(t), {
    kind: "failed",
    title: "Too short",
    body: MESSAGES.too_short,
    actions: ["Record again"],
  });
  assert.equal(t.focused.length, moves, "the banner pulls no focus from the screen");
  assert.deepEqual(t.stateEl.children, [], "nothing lands in the record zone");

  const short = setup();
  await recordTake(short, 2000);
  const [, title, body, action] = stateBlock(short).children;
  assert.deepEqual(
    [title.textContent, body.textContent, labelOf(action)],
    ["Too short", MESSAGES.too_short, "Record again"],
    "the same words as a Stop under 5 seconds",
  );

  bannerButton(t, "Record again").click();
  assert.equal(bannerView(t), null);
  assert.deepEqual(t.calls.go, [{ name: "practice", params: undefined }]);
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.stateEl.children, []);
  assert.equal(t.timer.textContent, "0:00", "the dropped take's time went with it at Stop");
  assert.equal(t.calls.analyze.length, 1, "the take is never sent again");
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

// No error path is announced: the in-place block speaks through its alert role and focuses its
// title; the banner's Upload failed is read by its own color and words and pulls no focus.
// An error block is an alert, so nothing is said on top of it. The banner is no live region: its
// titles go through the live region as they change, and it moves no focus.
test("an error block is not announced; the banner's titles are, and it moves no focus", async () => {
  const t = withBanner();
  await recordTake(t, 8000);
  const moves = t.focused.length;
  t.rejectUpload(apiError("network"));
  await flush();
  assert.equal(bannerView(t).title, "Upload failed");
  assert.equal(t.focused.length, moves);
  assert.deepEqual(t.calls.announce, [
    "Recording started",
    "Recording stopped, 8 seconds",
    "Analyzing your speech",
    "Upload failed",
  ]);

  const denied = setup();
  denied.recordButton.click();
  denied.denyMic();
  await flush();
  assert.equal(denied.focused.length, 1);
  assert.equal(denied.focused[0], byClass(stateBlock(denied), "state__title"));
  assert.deepEqual(denied.calls.announce, []);
});

// Where focus goes when the record zone changes (DESIGN.md section 9). Leaving an error block
// clears the node that held focus; without a move, focus falls to <body> and the next Tab skips
// Record for the nav. The fake click() never focuses, like a tap in Safari; a keyboard user's
// button is focused first.
function lastFocused(t) {
  return t.focused[t.focused.length - 1];
}

function cardTextOf(t) {
  return byClass(byClass(t.body, "passage-card"), "passage-card__text");
}

test("Try again after Microphone blocked hands focus back to Record", async () => {
  const t = setup();
  t.recordButton.click();
  t.denyMic();
  await flush();
  const tryAgain = byClass(stateBlock(t), "state__action");
  tryAgain.focus();
  tryAgain.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(lastFocused(t), t.recordButton);
});

test("Record again after a too-short take hands focus from the title back to Record", async () => {
  const t = setup();
  await recordTake(t, 2000);
  assert.equal(lastFocused(t), byClass(stateBlock(t), "state__title"));
  byClass(stateBlock(t), "state__action").click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(lastFocused(t), t.recordButton);
});

// "Record a new take" lives on the banner now. Its click takes the banner down and asks the
// router for Practice; on Practice already that changes nothing, so the screen hands the focus
// the button held to Record, as an error block's action does. No focus call lands on the hidden
// banner.
test("Record a new take on the banner hands focus back to Record", async () => {
  const t = withBanner();
  // On show: the route to Practice then changes nothing, so the screen places focus itself.
  t.practice.show({});
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  const newTake = bannerButton(t, NEW_TAKE);
  newTake.focus();
  newTake.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.banner.hidden, true);
  assert.deepEqual(t.calls.go, [{ name: "practice", params: undefined }]);
  assert.equal(lastFocused(t), t.recordButton);
});

test("Try again after the sample failed hands focus back to the sample button", async () => {
  const t = setup();
  t.sampleButton.focus();
  t.sampleButton.click();
  await flush();
  await flush();
  assert.equal(byClass(stateBlock(t), "state__title").textContent, "Sample unavailable");
  const tryAgain = byClass(stateBlock(t), "state__action");
  tryAgain.focus();
  tryAgain.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(lastFocused(t), t.sampleButton);
});

test("leaving an error block leaves focus alone when the block did not hold it", async () => {
  const t = setup();
  t.recordButton.click();
  t.denyMic();
  await flush();
  const tryAgain = byClass(stateBlock(t), "state__action");
  cardTextOf(t).focus();
  const moves = t.focused.length;
  tryAgain.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.focused.length, moves);
});

// Stop on a normal take keeps focus where it was: the Stop button, now Record, so a keyboard
// user can start the next take at once. The banner says the take is analyzed, and Results opens
// on its own once the take is saved while Practice waits in idle.
test("Stop from the keyboard keeps focus on Record; the banner says the take is analyzed", async () => {
  const t = withBanner();
  t.practice.show({});
  t.recordButton.focus();
  await recordTake(t, 8000);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(lastFocused(t), t.recordButton);
  assert.deepEqual(bannerView(t), {
    kind: "working",
    title: "Analyzing your speech",
    body: WORKING_BODY_8S,
    actions: [],
  });

  const moves = t.focused.length;
  t.resolveUpload({ transcript: [], metrics: {} });
  await flush();
  assert.equal(t.calls.go[0].name, "results");
  assert.equal(bannerView(t), null, "the banner goes down as Results opens");
  assert.equal(t.focused.length, moves, "a saved take moves no focus before Results opens");
});

// The repaint to the working banner drops the Retry button that held focus, so focus moves to
// the banner itself (tabindex -1, never a Tab stop) and stays by "Analyzing your speech",
// never falling to <body>.
test("Retry upload hands focus from its button to the banner as it turns to working", async () => {
  const t = withBanner();
  await recordTake(t, 8000);
  t.rejectUpload(apiError("network"));
  await flush();
  const retry = bannerButton(t, "Retry upload");
  retry.focus();
  retry.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(bannerView(t).kind, "working");
  assert.equal(t.banner.getAttribute("tabindex"), "-1", "script can focus it; Tab never stops");
  assert.equal(lastFocused(t), t.banner);
});

test("the stop announcement says 1 second for a one-second take", async () => {
  const cases = [
    [400, "Recording stopped, 0 seconds"],
    [1500, "Recording stopped, 1 second"],
    [2500, "Recording stopped, 2 seconds"],
  ];
  for (const [ms, words] of cases) {
    const t = setup();
    await recordTake(t, ms);
    assert.deepEqual(t.calls.announce, ["Recording started", words], `${ms} ms`);
  }
});

test("a take that ends on its own leaves focus alone when it sat outside the record zone", async () => {
  const t = withBanner();
  t.recordButton.click();
  t.grantMic();
  await flush();
  const text = cardTextOf(t);
  text.focus();
  t.clock.advance(8000);
  FakeMediaRecorder.last.finish();
  await flush();
  assert.equal(t.root.dataset.state, "idle", "the track ended on its own; the take left for the banner");
  assert.equal(bannerView(t).kind, "working");
  assert.equal(lastFocused(t), text);
});

test("the banner and the Too short block still show where elements have no querySelector", async () => {
  // With no title to find, the block's title takes neither tabindex nor focus; nothing throws.
  const t = withBanner({ elementClass: UnsearchableElement });
  t.recordButton.focus();
  await recordTake(t, 8000);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(bannerView(t).kind, "working");
  t.rejectUpload(apiError("network"));
  await flush();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(bannerView(t).kind, "failed");
  assert.equal(lastFocused(t), t.recordButton, "focus stays where it was");

  const short = withBanner({ elementClass: UnsearchableElement });
  short.recordButton.focus();
  await recordTake(short, 2000);
  assert.equal(short.root.dataset.state, "error");
  assert.equal(stateBlock(short).getAttribute("role"), "alert");
  assert.equal(lastFocused(short), short.recordButton, "no title to focus");
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

// Talk and Read (DESIGN.md sections 6 and 7, queue T26). Prompts come first, as in passages.js.
const MODES = [
  {
    id: "day",
    kind: "prompt",
    title: "Your day",
    text: "First topic.",
    topics: ["First topic.", "Second topic.", "Third topic."],
    targetWpm: [140, 160],
    timeLimitSeconds: 60,
  },
  {
    id: "imp",
    kind: "prompt",
    title: "Impromptu",
    text: "Rule topic.",
    topics: ["Rule topic.", "Uniform topic."],
    targetWpm: [140, 160],
    timeLimitSeconds: 120,
  },
  {
    id: "congress",
    kind: "prompt",
    title: "Congress speech",
    text: "Pick a bill.",
    targetWpm: [130, 160],
    timeLimitSeconds: 180,
    format: "Congress",
  },
  { id: "read1", kind: "passage", title: "Gettysburg", text: "Four score", targetWpm: [130, 150] },
  { id: "read2", kind: "passage", title: "Drill", text: "Strong students", targetWpm: [120, 140] },
];

const PASSAGES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "passages.js"), "utf8");

function realPassages() {
  const context = { app: {} };
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  return JSON.parse(JSON.stringify(context.app.passages));
}

// Handles for the parts P3 adds, read straight from the body like the other Practice tests.
function modeParts(t) {
  const modeSwitch = byClass(t.body, "segmented");
  const card = byClass(t.body, "passage-card");
  const timerWrap = byClass(t.body, "practice__timer");
  const limitBar = byClass(timerWrap, "practice__limit-bar");
  const chipRow = byClass(t.body, "chip-row");
  return {
    modeSwitch,
    options: modeSwitch.children,
    talk: modeSwitch.children.find((option) => option.textContent === "Talk"),
    read: modeSwitch.children.find((option) => option.textContent === "Read"),
    chipRow,
    chips: chipRow.children,
    cardTitle: byClass(card, "passage-card__title"),
    cardText: byClass(card, "passage-card__text"),
    newTopic: byClass(card, "passage-card__new"),
    limit: byClass(timerWrap, "practice__limit"),
    limitBar,
    limitFill: limitBar.children[0],
  };
}

function visibleChipLabels(parts) {
  return parts.chips.filter((chip) => !chip.hidden).map((chip) => chip.textContent);
}

function chipFor(parts, id) {
  return parts.chips.find((chip) => chip.dataset.passageId === id);
}

test("the mode switch is a labeled group of Talk and Read toggles, first in the body", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  assert.equal(t.body.children[0], parts.modeSwitch);
  assert.equal(parts.modeSwitch.className, "segmented");
  assert.equal(parts.modeSwitch.getAttribute("role"), "group");
  assert.equal(parts.modeSwitch.getAttribute("aria-label"), "Practice mode");
  assert.deepEqual(
    parts.options.map((option) => option.textContent),
    ["Talk", "Read"],
  );
  for (const option of parts.options) {
    assert.equal(option.tagName, "button");
    assert.equal(option.getAttribute("type"), "button");
    assert.ok(option.classList.contains("segmented__option"));
  }
});

test("Practice opens on the first entry's tab with that entry selected", () => {
  const talkFirst = modeParts(setup({ passages: MODES }));
  assert.equal(talkFirst.talk.getAttribute("aria-pressed"), "true");
  assert.ok(talkFirst.talk.classList.contains("segmented__option--selected"));
  assert.equal(talkFirst.read.getAttribute("aria-pressed"), "false");
  assert.ok(!talkFirst.read.classList.contains("segmented__option--selected"));
  assert.equal(talkFirst.cardTitle.textContent, "Your day");

  const readFirst = setup({ passages: [...MODES.slice(3), ...MODES.slice(0, 3)] });
  const parts = modeParts(readFirst);
  assert.equal(parts.read.getAttribute("aria-pressed"), "true");
  assert.equal(readFirst.practice.selectedPassage().id, "read1");
});

test("with the real passages Practice opens on Talk with About you and its first topic", () => {
  const t = setup({ passages: realPassages() });
  const parts = modeParts(t);
  assert.equal(parts.talk.getAttribute("aria-pressed"), "true");
  assert.equal(t.practice.selectedPassage().id, "free-talk");
  assert.equal(parts.cardTitle.textContent, "About you");
  assert.equal(
    parts.cardText.textContent,
    "Talk about something you are looking forward to this week.",
  );
  assert.deepEqual(visibleChipLabels(parts), [
    "About you 1:00",
    "Impromptu 2:00",
    "Interview answer 1:30",
    "Explain something 2:00",
    "Tell a story 2:00",
  ]);
});

test("each tab lists only its own entries; timed chips read the title and the limit", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  assert.deepEqual(visibleChipLabels(parts), [
    "Your day 1:00",
    "Impromptu 2:00",
    "Congress speech 3:00",
  ]);
  parts.read.click();
  assert.deepEqual(visibleChipLabels(parts), ["Gettysburg", "Drill"]);
  assert.equal(parts.read.getAttribute("aria-pressed"), "true");
  assert.equal(parts.talk.getAttribute("aria-pressed"), "false");
});

test("each tab keeps its own selection, and switching tabs scrolls the chips back", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  chipFor(parts, "imp").click();
  parts.read.click();
  assert.equal(t.practice.selectedPassage().id, "read1");
  chipFor(parts, "read2").click();
  assert.equal(parts.cardTitle.textContent, "Drill");
  assert.equal(chipFor(parts, "read2").getAttribute("aria-pressed"), "true");

  parts.chipRow.scrollLeft = 120;
  parts.talk.click();
  assert.equal(parts.chipRow.scrollLeft, 0);
  assert.equal(t.practice.selectedPassage().id, "imp");
  assert.ok(chipFor(parts, "imp").classList.contains("chip--selected"));
  assert.ok(!chipFor(parts, "read2").classList.contains("chip--selected"), "hidden tab");
  parts.read.click();
  assert.equal(t.practice.selectedPassage().id, "read2");
});

test("New topic moves to the next topic, wraps, and each prompt keeps its place", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  assert.equal(parts.newTopic.tagName, "button");
  assert.ok(parts.newTopic.classList.contains("btn"));
  assert.ok(parts.newTopic.classList.contains("btn--ghost"));
  assert.equal(parts.newTopic.textContent, "New topic");
  const icon = parts.newTopic.children[0];
  assert.equal(icon.getAttribute("data-icon"), "refresh", "the refresh icon follows the words");

  assert.equal(parts.cardText.textContent, "First topic.");
  parts.newTopic.click();
  assert.equal(parts.cardText.textContent, "Second topic.");
  parts.newTopic.click();
  assert.equal(parts.cardText.textContent, "Third topic.");
  parts.newTopic.click();
  assert.equal(parts.cardText.textContent, "First topic.", "wraps to the first topic");
  parts.newTopic.click();

  chipFor(parts, "imp").click();
  assert.equal(parts.cardText.textContent, "Rule topic.");
  chipFor(parts, "day").click();
  assert.equal(parts.cardText.textContent, "Second topic.", "the topic stays as it was left");
});

test("a new topic scrolls the text back to the top", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  parts.cardText.scrollTop = 40;
  parts.newTopic.click();
  assert.equal(parts.cardText.scrollTop, 0);
});

test("New topic reads the new topic out, since focus stays on the button", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  parts.newTopic.click();
  assert.deepEqual(t.calls.announce, ["Second topic."]);
  parts.newTopic.click();
  parts.newTopic.click();
  assert.deepEqual(t.calls.announce, ["Second topic.", "Third topic.", "First topic."]);
});

test("New topic shows only for a prompt with topics, and only in idle", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  assert.equal(parts.newTopic.hidden, false);
  chipFor(parts, "congress").click();
  assert.equal(parts.newTopic.hidden, true, "no topics to cycle");
  parts.read.click();
  assert.equal(parts.newTopic.hidden, true, "passages have no topics");
  parts.talk.click();
  chipFor(parts, "day").click();
  for (const state of ["recording", "uploading", "error"]) {
    t.practice.render(state, { title: "t", body: "b" });
    assert.equal(parts.newTopic.hidden, true, state);
    assert.equal(parts.newTopic.disabled, true, state);
    parts.newTopic.click();
    assert.equal(parts.cardText.textContent, "First topic.", `${state} keeps the topic`);
  }
  t.practice.render("idle");
  assert.equal(parts.newTopic.hidden, false);
  assert.equal(parts.newTopic.disabled, false);
});

test("tabs, chips and New topic are disabled while recording, uploading and in error", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  for (const state of ["recording", "uploading", "error"]) {
    t.practice.render(state, { title: "t", body: "b" });
    parts.options.forEach((option) => assert.equal(option.disabled, true, `${state} tab`));
    parts.chips.forEach((chip) => assert.equal(chip.disabled, true, `${state} chip`));
    parts.read.click();
    assert.equal(parts.talk.getAttribute("aria-pressed"), "true", `${state} keeps the tab`);
  }
  t.practice.render("idle");
  parts.options.forEach((option) => assert.equal(option.disabled, false));
});

test("a tab with no entries is disabled", () => {
  const t = setup({ passages: MODES.slice(3) });
  const parts = modeParts(t);
  assert.equal(parts.talk.disabled, true);
  assert.equal(parts.read.disabled, false);
  assert.equal(parts.read.getAttribute("aria-pressed"), "true");
});

test("a timed entry shows / 1:00 and an empty bar; untimed entries hide both", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  assert.equal(parts.limit.tagName, "span");
  assert.ok(parts.limit.classList.contains("num"));
  assert.equal(parts.limit.textContent, "/ 1:00");
  assert.equal(parts.limit.hidden, false);
  assert.equal(parts.limitBar.hidden, false);
  assert.equal(parts.limitBar.getAttribute("aria-hidden"), "true");
  assert.ok(parts.limitFill.classList.contains("practice__limit-fill"));
  assert.equal(parts.limitFill.getAttribute("style"), "transform: scaleX(0)");

  chipFor(parts, "imp").click();
  assert.equal(parts.limit.textContent, "/ 2:00");
  parts.read.click();
  assert.equal(parts.limit.hidden, true);
  assert.equal(parts.limitBar.hidden, true);
});

test("the bar fills with elapsed over the limit and turns over at the limit", async () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  t.recordButton.click();
  t.grantMic();
  await flush();
  assert.equal(t.clock.activeIntervals(), 1, "one interval drives the clock and the bar");

  t.clock.advance(15000);
  assert.equal(t.timer.textContent, "0:15");
  assert.equal(parts.limitFill.getAttribute("style"), "transform: scaleX(0.25)");
  assert.ok(!parts.limitBar.classList.contains("practice__limit-bar--over"));

  t.clock.advance(45000);
  assert.equal(parts.limitFill.getAttribute("style"), "transform: scaleX(1)");
  assert.ok(parts.limitBar.classList.contains("practice__limit-bar--over"));

  t.clock.advance(5000);
  assert.equal(t.root.dataset.state, "recording", "the limit never stops a take");
  assert.equal(t.timer.textContent, "1:05");
  assert.equal(parts.limitFill.getAttribute("style"), "transform: scaleX(1)");
  assert.ok(parts.limitBar.classList.contains("practice__limit-bar--over"));
  assert.equal(t.clock.activeIntervals(), 1);
});

// Idle shows "0:00" and an empty bar (DESIGN.md section 7): a take that is let go takes its time
// with it. Stop lets a normal take go to the banner at once, which names its length, so the
// clock and the bar are back at the start before the analysis is even answered.
const EMPTY_FILL = "transform: scaleX(0)";

test("Stop empties the bar and resets the clock at once; the banner names the take's length", async () => {
  const t = withBanner({ passages: MODES });
  const parts = modeParts(t);
  await recordTake(t, 30000);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  assert.equal(t.timer.textContent, "0:00", "the take's time went with it to the banner");
  assert.equal(bannerView(t).body, WORKING_BODY_30S);
  t.rejectUpload(apiError("network"));
  await flush();
  bannerButton(t, NEW_TAKE).click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  assert.equal(t.timer.textContent, "0:00", "the dropped take brings no time back");

  // Record is ignored for a moment after a Stop (a bouncing thumb), so the clock moves on.
  t.clock.advance(500);
  t.recordButton.click();
  t.grantMic();
  await flush();
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  assert.ok(!parts.limitBar.classList.contains("practice__limit-bar--over"));
});

test("an over-limit take leaves no rust bar in idle; other chips never rescale it", async () => {
  const t = withBanner({ passages: MODES });
  const parts = modeParts(t);
  await recordTake(t, 70000);
  assert.ok(!parts.limitBar.classList.contains("practice__limit-bar--over"), "Stop lets it go");
  assert.equal(bannerView(t).body, "Your 1:10 take. Usually 5 to 15 seconds.");
  t.rejectUpload(apiError("network"));
  await flush();
  bannerButton(t, NEW_TAKE).click();
  assert.ok(!parts.limitBar.classList.contains("practice__limit-bar--over"));
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  chipFor(parts, "imp").click();
  assert.equal(parts.limit.textContent, "/ 2:00");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  assert.ok(!parts.limitBar.classList.contains("practice__limit-bar--over"));
});

test("a take resets the clock and empties the bar at Stop, before Results opens", async () => {
  const t = withBanner({ passages: MODES });
  t.practice.show({});
  const parts = modeParts(t);
  await recordTake(t, 42000);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.timer.textContent, "0:00");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  assert.deepEqual(t.calls.go, [], "Results waits for the save");
  t.resolveUpload({ transcript: [], metrics: {} });
  await flush();
  assert.equal(t.calls.go[0].name, "results");
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.timer.textContent, "0:00");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
});

test("leaving mid-take and coming back starts at 0:00 with an empty bar", async () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  t.recordButton.click();
  t.grantMic();
  await flush();
  t.clock.advance(40000);
  assert.equal(parts.limitFill.getAttribute("style"), "transform: scaleX(0.6667)");
  t.practice.hide();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.timer.textContent, "0:00");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
});

test("after a too-short take idle keeps its time on the clock, the bar empty", async () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  await recordTake(t, 3000);
  assert.equal(byClass(stateBlock(t), "state__title").textContent, "Too short");
  stateBlock(t).children[3].click();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.timer.textContent, "0:03", "practice-capture.test.js pins this clock");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);

  t.practice.hide();
  t.practice.show({});
  assert.equal(t.timer.textContent, "0:00", "coming back to the screen lets it go");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
});

// A take analyzed in the background is the banner's business: leaving and coming back finds
// Practice idle at 0:00 with an empty bar, the job still running, and Results opens on its own
// once the take is saved while Practice waits in idle.
test("show() while a take is analyzed opens idle at 0:00; the banner keeps the take", async () => {
  const t = withBanner({ passages: MODES });
  const parts = modeParts(t);
  await recordTake(t, 30000);
  t.practice.hide();
  assert.equal(bannerView(t).kind, "working", "hide() leaves the job running");
  t.practice.show({});
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(t.timer.textContent, "0:00");
  assert.equal(parts.limitFill.getAttribute("style"), EMPTY_FILL);
  assert.equal(bannerView(t).body, WORKING_BODY_30S);
  t.resolveUpload({ transcript: [], metrics: {} });
  await flush();
  assert.equal(t.calls.go[0].name, "results", "saved after show(), the take opens Results at once");
});

test("a take saves the entry's title and id, whichever topic was showing", async () => {
  const t = setup({ passages: MODES });
  modeParts(t).newTopic.click();
  await recordTake(t, 6000);
  t.resolveUpload({ transcript: [], metrics: {} });
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(t.calls.save[0].passageId, "day");
  assert.equal(t.calls.save[0].passageTitle, "Your day");
});

// The theme toggle beside the wordmark (DESIGN.md sections 6 and 8, queue T27). The shared fakes
// only hold the body, so these tests mount into a section that has the header as well.
const THEME_KEY = "speech-coach-theme";
const THEME_LOOKS = {
  auto: ["contrast", "Theme: Auto. Switch to dark."],
  dark: ["moon", "Theme: Dark. Switch to light."],
  light: ["sun", "Theme: Light. Switch to auto."],
};

function fakeStorage(saved) {
  const items = saved ? { [THEME_KEY]: saved } : {};
  return {
    items,
    getItem: (key) => (Object.hasOwn(items, key) ? items[key] : null),
    setItem: (key, value) => {
      items[key] = String(value);
    },
  };
}

function blockedStorage() {
  return {
    getItem() {
      throw new Error("storage is blocked");
    },
    setItem() {
      throw new Error("storage is blocked");
    },
  };
}

// A section holding header.screen__header (h1, wordmark, toggle) and the screen body.
function sectionWithHeader() {
  const focusLog = [];
  const make = (tagName, className) => {
    const node = new RevampElement(tagName, null, focusLog);
    node.className = className || "";
    return node;
  };
  const root = make("section");
  const header = make("header", "screen__header");
  const toggle = make("button", "icon-btn theme-toggle");
  toggle.setAttribute("type", "button");
  header.appendChild(make("h1"));
  header.appendChild(make("span", "wordmark"));
  header.appendChild(toggle);
  root.appendChild(header);
  root.appendChild(make("div", "screen__body"));
  return { root, toggle };
}

function assertToggleShows(toggle, theme) {
  const [iconName, label] = THEME_LOOKS[theme];
  assert.equal(toggle.children.length, 1, "exactly one icon");
  assert.equal(toggle.children[0].getAttribute("data-icon"), iconName);
  assert.equal(toggle.children[0].getAttribute("aria-hidden"), "true");
  assert.equal(toggle.getAttribute("aria-label"), label);
}

test("mount shows the saved theme on the toggle: contrast, moon or sun", () => {
  for (const theme of ["auto", "dark", "light"]) {
    const { root, toggle } = sectionWithHeader();
    setup({ root, localStorage: fakeStorage(theme === "auto" ? null : theme) });
    assertToggleShows(toggle, theme);
  }
});

test("each tap moves to the next theme, applies and saves it, and announces it", () => {
  const { root, toggle } = sectionWithHeader();
  const storage = fakeStorage(null);
  const t = setup({ root, localStorage: storage });

  toggle.click();
  assert.equal(t.html.dataset.theme, "dark");
  assert.equal(storage.items[THEME_KEY], "dark");
  assertToggleShows(toggle, "dark");

  toggle.click();
  assert.equal(t.html.dataset.theme, "light");
  assertToggleShows(toggle, "light");

  toggle.click();
  assert.ok(!Object.hasOwn(t.html.dataset, "theme"), "auto leaves the device setting in charge");
  assert.equal(storage.items[THEME_KEY], "auto");
  assertToggleShows(toggle, "auto");
  assert.deepEqual(t.calls.announce, ["Theme: Dark", "Theme: Light", "Theme: Auto"]);
});

test("the toggle keeps cycling when storage is blocked", () => {
  const { root, toggle } = sectionWithHeader();
  const t = setup({ root, localStorage: blockedStorage() });
  assertToggleShows(toggle, "auto");
  toggle.click();
  toggle.click();
  assert.equal(t.html.dataset.theme, "light");
  assertToggleShows(toggle, "light");
});

test("the toggle works in any state and leaves the screen's state alone", () => {
  const { root, toggle } = sectionWithHeader();
  const t = setup({ root, localStorage: fakeStorage(null) });
  t.practice.render("recording");
  toggle.click();
  assert.equal(t.root.dataset.state, "recording");
  assert.equal(t.html.dataset.theme, "dark");
});

test("a section without the toggle mounts as before", () => {
  const t = setup({ localStorage: fakeStorage("dark") });
  assert.equal(t.root.dataset.state, "idle");
  assert.ok(!Object.hasOwn(t.html.dataset, "theme"), "mount never applies a theme itself");
});

test("the passage text is a focusable region named by the card's title", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  const id = parts.cardTitle.getAttribute("id");
  assert.ok(id, "the title carries an id");
  assert.equal(parts.cardText.getAttribute("tabindex"), "0", "Safari never focuses a scroller");
  assert.equal(parts.cardText.getAttribute("role"), "region");
  assert.equal(parts.cardText.getAttribute("aria-labelledby"), id);
});

test("a chip that takes focus scrolls itself into view inside the row", () => {
  const t = setup({ passages: MODES });
  const parts = modeParts(t);
  const handlers = parts.chipRow.listeners.focusin || [];
  assert.equal(handlers.length, 1, "one focusin listener on the row");
  const chip = chipFor(parts, "congress");
  const asked = [];
  chip.scrollIntoView = (options) => asked.push(JSON.parse(JSON.stringify(options)));
  handlers[0]({ type: "focusin", target: chip });
  assert.deepEqual(asked, [{ inline: "nearest", block: "nearest" }]);
  const plainChip = chipFor(parts, "imp");
  assert.doesNotThrow(() => handlers[0]({ type: "focusin", target: plainChip }), "fakes lack it");
});

test("New topic follows the title in the card, so focus order runs top to bottom", () => {
  const t = setup({ passages: MODES });
  const card = byClass(t.body, "passage-card");
  assert.deepEqual(
    card.children.map((child) => child.className),
    [
      "passage-card__title",
      "btn btn--ghost passage-card__new",
      "passage-card__target",
      "passage-card__text",
    ],
  );
});
