// Tests for sending the script with each take (T34). api.js adds an optional "script" field to
// the upload; Practice sends a Read passage's text, or on Talk the script pasted into the
// collapsible box in the hint row, fixed at Stop so the banner's Retry upload re-sends it
// unchanged. Every browser API is a fake in a vm context.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const API_SOURCE = fs.readFileSync(path.join(FRONTEND, "api.js"), "utf8");
const UI_SOURCE = fs.readFileSync(path.join(FRONTEND, "ui.js"), "utf8");
const PRACTICE_SOURCE = fs.readFileSync(path.join(FRONTEND, "screens", "practice.js"), "utf8");
const STYLES = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8");
const DESIGN = fs.readFileSync(path.join(FRONTEND, "DESIGN.md"), "utf8");

// The backend's MAX_SCRIPT_CHARACTERS (backend/app.py).
const MAX_SCRIPT_CHARACTERS = 20000;

const PASSAGE_TEXT = "Four score and seven years ago our fathers brought forth on this continent.";
const PASSAGES = [
  {
    id: "talk",
    kind: "prompt",
    title: "Your day",
    text: "Talk about your day.",
    topics: ["Talk about your day.", "Talk about your week."],
    targetWpm: [1, 2],
  },
  { id: "read", kind: "passage", title: "Gettysburg", text: PASSAGE_TEXT, targetWpm: [1, 2] },
];

const MESSAGES = Object.freeze({
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
});

// --- api.js ---------------------------------------------------------------------------------

class FakeFormData {
  constructor() {
    this.entries = [];
  }

  append(name, value, filename) {
    this.entries.push(filename === undefined ? { name, value } : { name, value, filename });
  }
}

function loadApi() {
  const calls = [];
  const context = {
    app: {},
    FormData: FakeFormData,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  };
  vm.runInNewContext(API_SOURCE, context, { filename: "api.js" });
  return { api: context.app.api, calls };
}

const BLOB = { size: 1234, type: "audio/webm" };

test("analyze sends a script as the form field 'script' after the audio", async () => {
  const { api, calls } = loadApi();

  await api.analyze(BLOB, "audio/webm", PASSAGE_TEXT);

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].init.body.entries)), [
    { name: "audio", value: BLOB, filename: "recording.webm" },
    { name: "script", value: PASSAGE_TEXT },
  ]);
});

test("analyze sends the script as given, line breaks and edge spaces included", async () => {
  const { api, calls } = loadApi();
  const script = "  First line.\nSecond line.  ";

  await api.analyze(BLOB, "audio/mp4", script);

  assert.equal(calls[0].init.body.entries[1].value, script);
});

test("no script, an empty one or one of only spaces adds no script field", async () => {
  for (const script of [undefined, null, "", "   \n\t ", 42]) {
    const { api, calls } = loadApi();
    await api.analyze(BLOB, "audio/webm", script);
    assert.deepEqual(
      calls[0].init.body.entries.map((entry) => entry.name),
      ["audio"],
      `for ${JSON.stringify(script)}`,
    );
  }
});

// --- practice.js ----------------------------------------------------------------------------

class FakeBlob {
  constructor(parts, options) {
    this.parts = Array.from(parts);
    this.type = (options && options.type) || "";
  }
}

class FakeMediaRecorder {
  constructor(stream, options) {
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
    (this.listeners.dataavailable || []).forEach((handler) => handler({ data: { size: 9 } }));
    (this.listeners.stop || []).forEach((handler) => handler({ type: "stop" }));
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Mounts Practice on the two-entry data above. The fake app.api logs each upload with the
// script it was given and leaves it pending until the test settles it.
function setup() {
  let now = 0;
  const calls = { analyze: [] };
  const uploads = [];
  const app = {
    screens: {},
    ui: {},
    store: { save: () => Promise.resolve("session-1") },
    api: {
      messages: MESSAGES,
      analyze(blob, contentType, script) {
        calls.analyze.push({ blob, contentType, script });
        return new Promise((resolve, reject) => uploads.push({ resolve, reject }));
      },
    },
    passages: PASSAGES.map((entry) => ({ ...entry })),
    router: { go() {} },
  };
  const context = {
    app,
    document: fakeDocument(),
    navigator: {
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
    },
    MediaRecorder: FakeMediaRecorder,
    Blob: FakeBlob,
    performance: { now: () => now },
    setInterval: () => 1,
    clearInterval() {},
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  app.ui.announce = () => {};
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.practice.mount(root);

  const hint = byClass(body, "practice__hint");
  const scriptBox = byClass(hint, "practice__script");
  const scriptInput = scriptBox && scriptBox.children.find((child) => child.tagName === "textarea");
  return {
    app,
    practice: app.screens.practice,
    root,
    body,
    calls,
    scriptBox,
    scriptInput,
    summary: scriptBox && scriptBox.children[0],
    hint,
    // What a speaker typing or pasting does: a new value, then the input event.
    type(text) {
      scriptInput.value = text;
      (scriptInput.listeners.input || []).forEach((handler) => handler({ type: "input" }));
    },
    tab: (label) => byClass(body, "segmented").children.find((b) => b.textContent === label),
    recordButton: byClass(body, "btn-record"),
    // Taps Record, lets 12 seconds pass and taps Stop, which uploads the take.
    async recordTake() {
      this.recordButton.click();
      await flush();
      now += 12000;
      this.recordButton.click();
      FakeMediaRecorder.last.finish();
      await flush();
    },
    rejectUpload(kind) {
      const error = new Error(MESSAGES[kind]);
      error.kind = kind;
      uploads.shift().reject(error);
    },
  };
}

test("a take on the Read tab is sent with its passage's text as the script", async () => {
  const t = setup();
  t.tab("Read").click();

  await t.recordTake();

  assert.equal(t.calls.analyze.length, 1);
  assert.equal(t.calls.analyze[0].script, PASSAGE_TEXT);
});

test("a Talk take is sent with the pasted script, trimmed", async () => {
  const t = setup();
  t.scriptInput.value = "\n  My constructive case, word for word.  \n";

  await t.recordTake();

  assert.equal(t.calls.analyze[0].script, "My constructive case, word for word.");
});

test("a Talk take with the script box left empty is sent with no script", async () => {
  const t = setup();
  t.scriptInput.value = "";

  await t.recordTake();

  assert.equal(t.calls.analyze[0].script, "");
});

// A normal take is analyzed in the background, so a failed upload reports on the top banner
// (app.ui.banner, real ui.js) and not in the record zone. This mounts the banner to a node of
// the fake document and finds one of its buttons by label.
function mountBanner(t) {
  const node = new FakeElement("div");
  node.className = "banner";
  node.hidden = true;
  t.app.ui.banner.mount(node);
  t.banner = node;
}

function bannerButton(t, label) {
  const actions = byClass(t.banner, "banner__actions");
  return actions.children.find((button) => button.children[0].textContent === label);
}

test("the banner's Retry upload sends the same script, even after the box was edited", async () => {
  const t = setup();
  mountBanner(t);
  t.scriptInput.value = "The script as it was at Stop.";
  await t.recordTake();
  t.rejectUpload("network");
  await flush();
  t.scriptInput.value = "Edited after the take.";

  assert.equal(t.banner.dataset.kind, "failed", "the failure sits on the banner, not Practice");
  bannerButton(t, "Retry upload").click();
  await flush();

  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].script, "The script as it was at Stop.");
});

test("the script box sits in the hint row after the sample button, adding no row", () => {
  const t = setup();
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
  assert.equal(t.hint.tagName, "div", "a <details> cannot sit inside a <p>");
  assert.deepEqual(
    t.hint.children.map((child) => child.className),
    ["practice__hint-text", "btn btn--ghost practice__sample", "practice__script"],
  );
  assert.deepEqual(t.root.children.map((child) => child.className), ["screen__body"]);
});

test("once the box holds a script, its summary says so and counts the words", () => {
  const t = setup();
  t.type("  My case, word for word.\n");
  assert.equal(t.summary.textContent, "Your script (5 words)");
  t.type("Resolved.");
  assert.equal(t.summary.textContent, "Your script (1 word)");
  t.type(Array(3270).fill("word").join(" "));
  assert.equal(t.summary.textContent, "Your script (3,270 words)");
  t.type(" \n ");
  assert.equal(t.summary.textContent, "Paste your script (optional)");
});

// New topic draws any topic but the one on screen (tester feedback spec, section 2.2): with two
// topics, the other one.
test("a script left in the closed box is named on its summary and still sent", async () => {
  const t = setup();
  t.scriptBox.open = true;
  t.type("Our case rests on two points.");
  t.scriptBox.open = false;
  const card = byClass(t.body, "passage-card");
  const before = byClass(card, "passage-card__text").textContent;
  byClass(card, "passage-card__new").click();
  assert.equal(
    byClass(card, "passage-card__text").textContent,
    PASSAGES[0].topics.find((topic) => topic !== before),
  );

  assert.equal(t.summary.textContent, "Your script (6 words)");
  await t.recordTake();
  assert.equal(t.calls.analyze[0].script, "Our case rests on two points.");
});

test("the script box is a <details> whose summary reads 'Paste your script (optional)'", () => {
  const t = setup();
  assert.equal(t.scriptBox.tagName, "details");
  const [summary] = t.scriptBox.children;
  assert.equal(summary.tagName, "summary");
  assert.equal(summary.textContent, "Paste your script (optional)");
});

test("the textarea has a visible label, a description and the backend's length cap", () => {
  const t = setup();
  const id = t.scriptInput.getAttribute("id");
  assert.ok(id, "the textarea has an id");
  const label = t.scriptBox.children.find((child) => child.tagName === "label");
  assert.equal(label.getAttribute("for"), id);
  assert.equal(label.textContent, "Your script");
  const describedBy = t.scriptInput.getAttribute("aria-describedby");
  const note = t.scriptBox.children.find((child) => child.getAttribute("id") === describedBy);
  assert.equal(note.textContent, "Your take is checked against it for restarts, skips and misreads.");
  assert.equal(t.scriptInput.getAttribute("maxlength"), String(MAX_SCRIPT_CHARACTERS));
});

test("the script box shows on Talk only", () => {
  const t = setup();
  assert.equal(t.scriptBox.hidden, false, "Talk is the first tab");
  t.tab("Read").click();
  assert.equal(t.scriptBox.hidden, true);
  t.tab("Talk").click();
  assert.equal(t.scriptBox.hidden, false);
});

test("the script stays readable but cannot change while a take records or uploads", async () => {
  const t = setup();
  assert.equal(t.scriptInput.readOnly, false);
  t.recordButton.click();
  await flush();
  assert.equal(t.practice.state, "recording");
  assert.equal(t.scriptInput.readOnly, true);
  assert.equal(t.scriptInput.disabled, false, "a disabled box could not be scrolled or read");
});

// --- styles and design notes ----------------------------------------------------------------

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = STYLES.match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"));
  return match ? match[1] : null;
}

test("the hint is a centered wrapping row: its words on one line, then sample and summary", () => {
  const hint = rule(".practice__hint");
  assert.match(hint, /flex-wrap:\s*wrap/);
  assert.match(hint, /justify-content:\s*center/);
  assert.match(rule(".practice__hint-text"), /flex-basis:\s*100%/);
  assert.doesNotMatch(STYLES, /#screen-practice \.practice__script\s*\{[^}]*margin-top/);
});

test("closed, the box sits beside the sample button and is never wider than its summary", () => {
  const box = rule("#screen-practice .practice__script");
  assert.match(box, /flex:\s*1 1 0/);
  assert.match(box, /max-width:\s*max-content/);
  assert.match(rule(".practice__sample"), /padding:\s*0 var\(--s-2\)/);
});

test("the open script box takes the hint's full width, its parts aligned to the start", () => {
  const open = rule("#screen-practice .practice__script[open]");
  assert.ok(open, "a rule for the open box");
  assert.match(open, /flex-basis:\s*100%/);
  assert.match(open, /max-width:\s*none/);
  assert.match(open, /text-align:\s*start/);
});

test("the summary is a 44px target and the textarea uses body text, at least 16px", () => {
  assert.match(rule(".practice__script-summary"), /min-height:\s*44px/);
  const box = rule(".practice__script-input");
  assert.match(box, /font-size:\s*var\(--fs-body\)/);
  assert.match(box, /width:\s*100%/);
  assert.match(box, /background:\s*var\(--surface\)/);
  assert.match(box, /border:\s*1px solid var\(--border\)/);
});

test("DESIGN.md lists the script box", () => {
  assert.match(DESIGN, /`details\.practice__script`/);
  assert.match(DESIGN, /Paste your script \(optional\)/);
  assert.match(DESIGN, /Your script \(124 words\)/);
  assert.doesNotMatch(DESIGN, /only cost to the one-screen layout/);
});
