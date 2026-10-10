// Tests for frontend/ui.js (app.ui). The module is loaded with vm.runInNewContext so that
// `app` and `document` are injected fakes; no browser or DOM library is involved.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

// A minimal stand-in for a DOM element: only what ui.js touches.
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

  dispatch(type) {
    (this.listeners[type] || []).forEach((handler) => handler({ type }));
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
  }
}

function fakeDocument() {
  const elementsById = {};
  return {
    elementsById,
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (namespaceURI, tagName) => new FakeElement(tagName, namespaceURI),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => elementsById[id] || null,
  };
}

function loadUi(document) {
  const context = { app: {} };
  if (document !== undefined) {
    context.document = document;
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  return { ui: context.app.ui, app: context.app };
}

function classes(element) {
  return element.className.split(/\s+/).filter(Boolean);
}

test("ui.js assigns exactly app.ui and touches no DOM at load time", () => {
  const { app, ui } = loadUi(undefined);
  assert.deepEqual(Object.keys(app), ["ui"]);
  for (const name of ["el", "clear", "renderState", "announce", "formatClock", "formatDate"]) {
    assert.equal(typeof ui[name], "function", `app.ui.${name} should be a function`);
  }
});

test("formatClock floors seconds into m:ss", () => {
  const { ui } = loadUi(fakeDocument());
  assert.equal(ui.formatClock(65), "1:05");
  assert.equal(ui.formatClock(0), "0:00");
  assert.equal(ui.formatClock(125), "2:05");
  assert.equal(ui.formatClock(59.9), "0:59");
  assert.equal(ui.formatClock(600), "10:00");
});

test("formatClock never crashes on bad input", () => {
  const { ui } = loadUi(fakeDocument());
  assert.equal(ui.formatClock(-3), "0:00");
  assert.equal(ui.formatClock(NaN), "0:00");
  assert.equal(ui.formatClock(undefined), "0:00");
});

test("formatDate renders a short month, day and 12-hour time", () => {
  const { ui } = loadUi(fakeDocument());
  const text = ui.formatDate("2026-10-09T22:21:00");
  assert.ok(text.includes("Oct 9"), `expected 'Oct 9' in ${JSON.stringify(text)}`);
  assert.ok(text.includes("10:21 PM"), `expected '10:21 PM' in ${JSON.stringify(text)}`);
  assert.equal(ui.formatDate("not a date"), "");
});

test("el sets className, attributes and a string child", () => {
  const document = fakeDocument();
  const { ui } = loadUi(document);
  const paragraph = ui.el("p", { class: "x", "aria-label": "y" }, "hi");
  assert.equal(paragraph.tagName, "p");
  assert.equal(paragraph.className, "x");
  assert.equal(paragraph.getAttribute("aria-label"), "y");
  assert.equal(paragraph.getAttribute("class"), null, "class must not go through setAttribute");
  assert.equal(paragraph.children.length, 1);
  assert.ok(paragraph.children[0] instanceof FakeTextNode);
  assert.equal(paragraph.children[0].textContent, "hi");
});

test("el handles text, dataset, role and on* listeners", () => {
  const { ui } = loadUi(fakeDocument());
  let clicks = 0;
  const button = ui.el("button", {
    text: "Go",
    dataset: { id: "abc", kind: "primary" },
    role: "tab",
    onClick: () => {
      clicks += 1;
    },
  });
  assert.equal(button.textContent, "Go");
  assert.deepEqual(button.dataset, { id: "abc", kind: "primary" });
  assert.equal(button.getAttribute("role"), "tab");
  assert.equal(button.getAttribute("onClick"), null, "listeners must not become attributes");
  button.dispatch("click");
  assert.equal(clicks, 1);
});

test("el accepts a node, an array of nodes and strings, or no children", () => {
  const { ui } = loadUi(fakeDocument());
  const inner = ui.el("span", {}, "inner");
  const single = ui.el("div", {}, inner);
  assert.deepEqual(single.children, [inner]);

  const list = ui.el("div", null, ["a", ui.el("b", {}, "bold"), "c"]);
  assert.equal(list.children.length, 3);
  assert.equal(list.children[0].textContent, "a");
  assert.equal(list.children[1].tagName, "b");
  assert.equal(list.children[2].textContent, "c");

  const empty = ui.el("div");
  assert.deepEqual(empty.children, []);
});

test("clear removes every child of the root", () => {
  const document = fakeDocument();
  const { ui } = loadUi(document);
  const root = document.createElement("div");
  root.appendChild(document.createElement("p"));
  root.appendChild(document.createTextNode("text"));
  ui.clear(root);
  assert.deepEqual(root.children, []);
});

test("renderState builds the empty block with a circle icon and a secondary action", () => {
  const document = fakeDocument();
  const { ui } = loadUi(document);
  const root = document.createElement("div");
  root.appendChild(document.createElement("p"));
  let actions = 0;
  ui.renderState(root, {
    kind: "empty",
    title: "No sessions yet",
    body: "Your first recording will show up here.",
    actionLabel: "Record",
    onAction: () => {
      actions += 1;
    },
  });

  assert.equal(root.children.length, 1, "renderState clears the root first");
  const block = root.children[0];
  assert.deepEqual(classes(block), ["state", "state--empty"]);
  assert.equal(block.getAttribute("role"), null);

  const [icon, title, body, action] = block.children;
  assert.equal(icon.tagName, "svg");
  assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(icon.getAttribute("class"), "state__icon");
  assert.equal(icon.getAttribute("width"), "32");
  assert.equal(icon.getAttribute("height"), "32");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(icon.children[0].tagName, "circle");

  assert.equal(title.tagName, "h2");
  assert.equal(title.className, "state__title");
  assert.equal(title.textContent, "No sessions yet");
  assert.equal(body.tagName, "p");
  assert.equal(body.className, "state__body");
  assert.equal(body.textContent, "Your first recording will show up here.");

  assert.equal(action.tagName, "button");
  assert.equal(action.getAttribute("type"), "button");
  assert.deepEqual(classes(action).sort(), ["btn", "btn--secondary", "state__action"]);
  assert.equal(action.children[0].textContent, "Record");
  action.dispatch("click");
  assert.equal(actions, 1);
});

test("renderState builds the error block as an alert with a triangle and primary action", () => {
  const document = fakeDocument();
  const { ui } = loadUi(document);
  const root = document.createElement("div");
  ui.renderState(root, {
    kind: "error",
    title: "Upload failed",
    body: "Could not reach the server. Your recording is still here.",
    actionLabel: "Retry upload",
    onAction: () => {},
  });
  const block = root.children[0];
  assert.deepEqual(classes(block), ["state", "state--error"]);
  assert.equal(block.getAttribute("role"), "alert");
  const [icon, , , action] = block.children;
  assert.equal(icon.tagName, "svg");
  assert.equal(icon.children[0].tagName, "polygon");
  assert.deepEqual(classes(action).sort(), ["btn", "btn--primary", "state__action"]);
});

test("renderState builds the loading block as a status with a spinner and no button", () => {
  const document = fakeDocument();
  const { ui } = loadUi(document);
  const root = document.createElement("div");
  ui.renderState(root, {
    kind: "loading",
    title: "Analyzing your speech",
    body: "Usually 5 to 15 seconds.",
  });
  const block = root.children[0];
  assert.deepEqual(classes(block), ["state", "state--loading"]);
  assert.equal(block.getAttribute("role"), "status");
  assert.equal(block.children.length, 3, "no action button without actionLabel");
  const [spinner, title, body] = block.children;
  assert.equal(spinner.tagName, "div");
  assert.equal(spinner.className, "spinner");
  assert.equal(title.textContent, "Analyzing your speech");
  assert.equal(body.textContent, "Usually 5 to 15 seconds.");
});

test("announce writes the live region and tolerates a missing one", () => {
  const document = fakeDocument();
  const { ui } = loadUi(document);
  assert.doesNotThrow(() => ui.announce("Recording started"));
  const live = document.createElement("div");
  document.elementsById.live = live;
  ui.announce("Recording stopped, 42 seconds");
  assert.equal(live.textContent, "Recording stopped, 42 seconds");
});
