// Tests for frontend/screens/practice.js (app.screens.practice). The module is loaded with
// vm.runInNewContext; the pure parts run with no `document` at all, and the DOM parts run
// against a tiny fake element tree with the real ui.js loaded into the same context.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PRACTICE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "practice.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

const PASSAGES = [
  { id: "a", kind: "passage", title: "A", text: "x", targetWpm: [140, 160] },
  { id: "b", kind: "prompt", title: "B", text: "y", targetWpm: [120, 130] },
];

const EXPECTED_STATES = ["idle", "recording", "uploading", "error"];

// A minimal stand-in for a DOM element: only what practice.js and ui.js touch.
class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  names() {
    return this.owner.className.split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.names().includes(name);
  }

  add(name) {
    if (!this.contains(name)) {
      this.owner.className = [...this.names(), name].join(" ");
    }
  }

  remove(name) {
    this.owner.className = this.names().filter((other) => other !== name).join(" ");
  }

  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return on;
  }
}

class FakeElement {
  constructor(tagName, namespaceURI) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI || null;
    this.className = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.classList = new FakeClassList(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index === -1) {
      throw new Error("removeChild: not a child");
    }
    this.children.splice(index, 1);
    return child;
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(handler);
  }

  // Mirrors a real button: a disabled control never fires its click handlers.
  click() {
    if (this.disabled) {
      return;
    }
    (this.listeners.click || []).forEach((handler) => handler({ type: "click" }));
  }

  querySelector(selector) {
    const wanted = selector.replace(/^\./, "");
    return this.children.find((child) => child.classList && child.classList.contains(wanted)) || null;
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
  }
}

function fakeDocument() {
  return {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (namespaceURI, tagName) => new FakeElement(tagName, namespaceURI),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: () => null,
  };
}

function bareApp() {
  return {
    screens: {},
    ui: {},
    store: {},
    api: { messages: {} },
    passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
    router: {},
  };
}

// Loads practice.js with no document and a stub app.ui, exactly as the brief describes.
function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });
  return { app: context.app, practice: context.app.screens.practice };
}

// Loads ui.js then practice.js against the fake document, mounts into a fake section,
// and hands back the nodes a test needs by class name.
function mountPractice() {
  const document = fakeDocument();
  const context = { app: bareApp(), document };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = new FakeElement("section");
  root.dataset.state = "idle";
  const heading = new FakeElement("h1");
  heading.textContent = "Practice";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);

  const practice = context.app.screens.practice;
  practice.mount(root);
  return { practice, root, body, ...partsOf(body) };
}

function byClass(parent, name) {
  return parent.children.find((child) => child.classList && child.classList.contains(name));
}

function partsOf(body) {
  const chipRow = byClass(body, "chip-row");
  const card = byClass(body, "passage-card");
  const timerWrap = byClass(body, "practice__timer");
  const recordButton = byClass(body, "btn-record");
  return {
    chipRow,
    chips: chipRow.children,
    card,
    cardTitle: byClass(card, "passage-card__title"),
    cardTarget: byClass(card, "passage-card__target"),
    cardText: byClass(card, "passage-card__text"),
    timerWrap,
    recDot: byClass(timerWrap, "rec-dot"),
    timer: byClass(timerWrap, "timer"),
    recordButton,
    recordLabel: byClass(body, "btn-record__label"),
    hint: byClass(body, "practice__hint"),
    stateEl: byClass(body, "practice__state"),
  };
}

test("practice.js registers app.screens.practice and touches no DOM at load time", () => {
  const { app, practice } = loadPure();
  assert.deepEqual(Object.keys(app.screens), ["practice"]);
  for (const name of ["mount", "show", "hide", "viewFor", "render", "selectedPassage"]) {
    assert.equal(typeof practice[name], "function", `practice.${name} should be a function`);
  }
  // Array.from: the module's array comes from another vm realm, so its prototype differs.
  assert.deepEqual(Array.from(practice.STATES), EXPECTED_STATES);
  assert.equal(practice.state, "idle");
});

test("viewFor('recording') shows Stop, presses the button and disables chips", () => {
  const { practice } = loadPure();
  const view = practice.viewFor("recording");
  assert.equal(view.dataState, "recording");
  assert.equal(view.recordLabel, "Stop");
  assert.equal(view.recordAriaLabel, "Stop recording");
  assert.equal(view.recordPressed, true);
  assert.equal(view.chipsDisabled, true);
  assert.equal(view.showHint, true);
  assert.equal(view.showRecord, true);
});

test("viewFor('idle') shows Record with chips enabled and the hint visible", () => {
  const { practice } = loadPure();
  const view = practice.viewFor("idle");
  assert.equal(view.dataState, "idle");
  assert.equal(view.recordLabel, "Record");
  assert.equal(view.recordAriaLabel, "Start recording");
  assert.equal(view.recordPressed, false);
  assert.equal(view.chipsDisabled, false);
  assert.equal(view.showHint, true);
  assert.equal(view.showRecord, true);
});

test("viewFor hides the record button while uploading and the hint on error", () => {
  const { practice } = loadPure();
  const uploading = practice.viewFor("uploading");
  assert.equal(uploading.showRecord, false);
  assert.equal(uploading.showHint, false);
  assert.equal(uploading.chipsDisabled, true);

  const error = practice.viewFor("error");
  assert.equal(error.showHint, false);
  assert.equal(error.showRecord, true);
  assert.equal(error.recordLabel, "Record");
  assert.equal(error.recordPressed, false);
});

test("viewFor throws on any string outside STATES", () => {
  const { practice } = loadPure();
  assert.throws(() => practice.viewFor("nope"), /nope/);
  assert.throws(() => practice.viewFor(""));
  assert.throws(() => practice.viewFor(undefined));
});

test("mount builds the chip row, passage card, timer, record button, hint and state block", () => {
  const parts = mountPractice();
  assert.deepEqual(
    parts.body.children.map((child) => child.className),
    [
      "chip-row",
      "passage-card",
      "practice__timer",
      "btn-record",
      "btn-record__label",
      "practice__hint",
      "practice__state",
    ],
  );

  assert.equal(parts.chips.length, PASSAGES.length);
  parts.chips.forEach((chip, index) => {
    assert.equal(chip.tagName, "button");
    assert.equal(chip.getAttribute("type"), "button");
    assert.equal(chip.textContent, PASSAGES[index].title);
  });
  assert.equal(parts.chips[0].getAttribute("aria-pressed"), "true");
  assert.ok(parts.chips[0].classList.contains("chip--selected"));
  assert.equal(parts.chips[1].getAttribute("aria-pressed"), "false");
  assert.ok(!parts.chips[1].classList.contains("chip--selected"));

  assert.equal(parts.card.tagName, "section");
  assert.equal(parts.cardTitle.tagName, "h2");
  assert.equal(parts.cardTitle.textContent, "A");
  assert.equal(parts.cardTarget.textContent, "Target 140 to 160 wpm");
  assert.equal(parts.cardText.textContent, "x");

  assert.equal(parts.recDot.tagName, "span");
  assert.equal(parts.recDot.getAttribute("aria-hidden"), "true");
  assert.ok(parts.timer.classList.contains("num"));
  assert.equal(parts.timer.getAttribute("aria-live"), "off");
  assert.equal(parts.timer.textContent, "0:00");

  assert.equal(parts.recordButton.tagName, "button");
  assert.equal(parts.recordButton.getAttribute("type"), "button");
  assert.equal(parts.recordButton.getAttribute("aria-label"), "Start recording");
  assert.equal(parts.recordButton.getAttribute("aria-pressed"), "false");
  const icons = parts.recordButton.children.filter((child) => child.tagName === "svg");
  assert.equal(icons.length, 2, "a mic icon and a stop icon");
  for (const icon of icons) {
    assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(icon.getAttribute("aria-hidden"), "true");
  }
  assert.deepEqual(
    icons.map((icon) => icon.getAttribute("width")),
    ["28", "24"],
  );
  assert.equal(parts.recordLabel.textContent, "Record");

  assert.equal(parts.hint.textContent, "Tap to record. Stop uploads automatically.");
  assert.deepEqual(parts.stateEl.children, []);
  assert.equal(parts.root.dataset.state, "idle");
  assert.equal(parts.practice.selectedPassage().id, "a");
});

test("tapping a chip selects that passage and repaints the card", () => {
  const parts = mountPractice();
  parts.chips[1].click();
  assert.equal(parts.practice.selectedPassage().id, "b");
  assert.equal(parts.chips[1].getAttribute("aria-pressed"), "true");
  assert.ok(parts.chips[1].classList.contains("chip--selected"));
  assert.equal(parts.chips[0].getAttribute("aria-pressed"), "false");
  assert.ok(!parts.chips[0].classList.contains("chip--selected"));
  assert.equal(parts.cardTitle.textContent, "B");
  assert.equal(parts.cardTarget.textContent, "Target 120 to 130 wpm");
  assert.equal(parts.cardText.textContent, "y");
  assert.equal(parts.root.dataset.state, "idle", "selecting a passage keeps the state");
});

test("render('recording') flips the record button, disables the chips and sets data-state", () => {
  const parts = mountPractice();
  parts.practice.render("recording");
  assert.equal(parts.root.dataset.state, "recording");
  assert.equal(parts.practice.state, "recording");
  assert.equal(parts.recordButton.getAttribute("aria-label"), "Stop recording");
  assert.equal(parts.recordButton.getAttribute("aria-pressed"), "true");
  assert.equal(parts.recordLabel.textContent, "Stop");
  parts.chips.forEach((chip) => assert.equal(chip.disabled, true));
  assert.deepEqual(parts.stateEl.children, []);

  parts.chips[1].click();
  assert.equal(parts.practice.selectedPassage().id, "a", "chips are inert while recording");

  parts.practice.render("idle");
  parts.chips.forEach((chip) => assert.equal(chip.disabled, false));
  assert.equal(parts.recordLabel.textContent, "Record");
});

test("render('uploading') shows the loading block and render('idle') clears it", () => {
  const parts = mountPractice();
  parts.practice.render("uploading");
  assert.equal(parts.root.dataset.state, "uploading");
  assert.equal(parts.stateEl.children.length, 1);
  const block = parts.stateEl.children[0];
  assert.equal(block.className, "state state--loading");
  assert.equal(block.getAttribute("role"), "status");
  const [spinner, title, body] = block.children;
  assert.equal(spinner.className, "spinner");
  assert.equal(title.textContent, "Analyzing your speech");
  assert.equal(body.textContent, "Usually 5 to 15 seconds.");
  parts.chips.forEach((chip) => assert.equal(chip.disabled, true));

  parts.practice.render("idle");
  assert.equal(parts.root.dataset.state, "idle");
  assert.deepEqual(parts.stateEl.children, []);
});

test("render('error', detail) shows the error block with the given copy and action", () => {
  const parts = mountPractice();
  let actions = 0;
  parts.practice.render("error", {
    title: "Upload failed",
    body: "Could not reach the server. Your recording is still here.",
    actionLabel: "Retry upload",
    onAction: () => {
      actions += 1;
    },
  });
  assert.equal(parts.root.dataset.state, "error");
  const block = parts.stateEl.children[0];
  assert.equal(block.className, "state state--error");
  assert.equal(block.getAttribute("role"), "alert");
  const [, title, body, action] = block.children;
  assert.equal(title.textContent, "Upload failed");
  assert.equal(body.textContent, "Could not reach the server. Your recording is still here.");
  assert.equal(action.children[0].textContent, "Retry upload");
  action.click();
  assert.equal(actions, 1);
  assert.equal(parts.recordLabel.textContent, "Record");
  assert.equal(parts.recordButton.getAttribute("aria-pressed"), "false");
});

test("render never touches the timer text", () => {
  const parts = mountPractice();
  parts.timer.textContent = "0:42";
  for (const state of EXPECTED_STATES) {
    parts.practice.render(state, { title: "t", body: "b" });
    assert.equal(parts.timer.textContent, "0:42", `render(${state}) changed the timer`);
  }
});

test("render rejects an unknown state before changing anything", () => {
  const parts = mountPractice();
  parts.practice.render("recording");
  assert.throws(() => parts.practice.render("nope"), /nope/);
  assert.equal(parts.root.dataset.state, "recording");
  assert.equal(parts.practice.state, "recording");
});

test("show() returns to idle except while recording or uploading", () => {
  const parts = mountPractice();
  parts.practice.render("error", { title: "t", body: "b", actionLabel: "Retry", onAction() {} });
  parts.practice.show({});
  assert.equal(parts.root.dataset.state, "idle");
  assert.deepEqual(parts.stateEl.children, []);

  parts.practice.render("recording");
  parts.practice.show({});
  assert.equal(parts.root.dataset.state, "recording");

  parts.practice.render("uploading");
  parts.practice.show({});
  assert.equal(parts.root.dataset.state, "uploading");
  assert.equal(parts.stateEl.children.length, 1);

  assert.doesNotThrow(() => parts.practice.hide());
});
