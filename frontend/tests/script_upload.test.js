// Tests for sending the script with each take (T34). api.js adds an optional "script" field to
// the upload; Practice sends a Read passage's text, or on Talk the script pasted into the
// collapsible box under the record zone. Every browser API is a fake in a vm context.
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
  { id: "talk", kind: "prompt", title: "Your day", text: "Talk about your day.", targetWpm: [1, 2] },
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

  const scriptBox = byClass(root, "practice__script");
  return {
    practice: app.screens.practice,
    root,
    body,
    calls,
    scriptBox,
    scriptInput: scriptBox && scriptBox.children.find((child) => child.tagName === "textarea"),
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

test("Retry upload sends the same script, even after the box was edited", async () => {
  const t = setup();
  t.scriptInput.value = "The script as it was at Stop.";
  await t.recordTake();
  t.rejectUpload("network");
  await flush();
  t.scriptInput.value = "Edited after the take.";

  const block = byClass(t.body, "practice__state").children[0];
  block.children.find((child) => child.className.includes("state__action")).click();
  await flush();

  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].script, "The script as it was at Stop.");
});

test("the script box follows the record zone, outside the body's fixed list of parts", () => {
  const t = setup();
  assert.deepEqual(
    t.root.children.map((child) => child.className),
    ["screen__body", "practice__script"],
  );
  assert.equal(byClass(t.body, "practice__script"), undefined);
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

test("the script box keeps its size in Practice's column and sits --s-3 below the zone", () => {
  const box = rule("#screen-practice .practice__script");
  assert.ok(box, "a rule for the box");
  assert.match(box, /flex:\s*none/);
  assert.match(box, /margin-top:\s*var\(--s-3\)/);
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
});
