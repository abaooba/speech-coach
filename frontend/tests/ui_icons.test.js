// Tests for the shared icons in frontend/ui.js: app.ui.icon(), the named icons and the secondary
// action in app.ui.renderState(), and app.ui.formatDay(). ui.js runs in a vm context with the
// shared fake document, so every node is a FakeElement the tests read directly.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeTextNode, fakeDocument } = require("./fake-dom");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const SVG_NS = "http://www.w3.org/2000/svg";

const FILLED = { fill: "currentColor", stroke: "none" };

// The geometry DESIGN.md section 2 names, as [tag, attributes] per child, in drawing order.
const EXPECTED_ICONS = {
  mic: [
    ["path", { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" }],
    ["path", { d: "M19 11a7 7 0 0 1-14 0" }],
    ["line", { x1: "12", y1: "18", x2: "12", y2: "22" }],
    ["line", { x1: "8", y1: "22", x2: "16", y2: "22" }],
  ],
  chart: [
    ["polyline", { points: "3 17 9 11 13 15 21 7" }],
    ["polyline", { points: "15 7 21 7 21 13" }],
  ],
  search: [
    ["circle", { cx: "11", cy: "11", r: "7" }],
    ["line", { x1: "16.65", y1: "16.65", x2: "21", y2: "21" }],
  ],
  alert: [
    ["polygon", { points: "12 3 22 20 2 20" }],
    ["line", { x1: "12", y1: "9", x2: "12", y2: "13" }],
    ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }],
  ],
  trash: [
    ["polyline", { points: "3 6 5 6 21 6" }],
    ["path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }],
    ["path", { d: "M10 11v6" }],
    ["path", { d: "M14 11v6" }],
    ["path", { d: "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }],
  ],
  check: [["polyline", { points: "20 6 9 17 4 12" }]],
  "arrow-right": [
    ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }],
    ["polyline", { points: "12 5 19 12 12 19" }],
  ],
  refresh: [
    ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }],
    ["path", { d: "M21 3v5h-5" }],
  ],
  "triangle-up": [["polygon", { points: "12 5 21 19 3 19", ...FILLED }]],
  "triangle-down": [["polygon", { points: "3 5 21 5 12 19", ...FILLED }]],
  dash: [["line", { x1: "5", y1: "12", x2: "19", y2: "12" }]],
  contrast: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M12 3v18a9 9 0 0 0 0-18z", fill: "currentColor" }],
  ],
  moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" }]],
  sun: [
    ["circle", { cx: "12", cy: "12", r: "4" }],
    ["path", { d: "M12 2v2" }],
    ["path", { d: "M12 20v2" }],
    ["path", { d: "m4.93 4.93 1.41 1.41" }],
    ["path", { d: "m17.66 17.66 1.41 1.41" }],
    ["path", { d: "M2 12h2" }],
    ["path", { d: "M20 12h2" }],
    ["path", { d: "m6.34 17.66-1.41 1.41" }],
    ["path", { d: "m19.07 4.93-1.41 1.41" }],
  ],
};

// The state icons renderState draws for each named icon, by the tag of their first child.
const STATE_ICON_FIRST_TAG = { mic: "path", chart: "polyline", search: "circle" };

function loadUi() {
  const context = { app: {}, document: fakeDocument() };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  return { ui: context.app.ui, document: context.document };
}

function sortedClasses(element) {
  return element.className.split(/\s+/).filter(Boolean).sort();
}

// Renders a state block into a fresh root and returns the block.
function renderBlock(ui, document, options) {
  const root = document.createElement("div");
  ui.renderState(root, options);
  return root.children[0];
}

test("ui.js loads with no document and adds icon and formatDay to app.ui only", () => {
  const context = { app: {} };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  assert.deepEqual(Object.keys(context.app), ["ui"]);
  assert.equal(typeof context.app.ui.icon, "function");
  assert.equal(typeof context.app.ui.formatDay, "function");
});

test("icon builds every named icon as a 24-unit currentColor svg, 20px by default", () => {
  const { ui } = loadUi();
  for (const name of Object.keys(EXPECTED_ICONS)) {
    const svg = ui.icon(name);
    assert.equal(svg.tagName, "svg", name);
    assert.equal(svg.namespaceURI, SVG_NS, name);
    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24", name);
    assert.equal(svg.getAttribute("width"), "20", name);
    assert.equal(svg.getAttribute("height"), "20", name);
    assert.equal(svg.getAttribute("fill"), "none", name);
    assert.equal(svg.getAttribute("stroke"), "currentColor", name);
    assert.equal(svg.getAttribute("stroke-width"), "2", name);
    assert.equal(svg.getAttribute("stroke-linecap"), "round", name);
    assert.equal(svg.getAttribute("stroke-linejoin"), "round", name);
    assert.equal(svg.getAttribute("aria-hidden"), "true", name);
    assert.equal(svg.getAttribute("data-icon"), name, name);
    assert.equal(svg.className, "", `${name}: an svg's className is read-only in browsers`);
    assert.equal(svg.getAttribute("class"), null, `${name}: callers add their own class`);
  }
});

test("icon draws each name with the geometry DESIGN.md lists, first child first", () => {
  const { ui } = loadUi();
  for (const [name, shapes] of Object.entries(EXPECTED_ICONS)) {
    const svg = ui.icon(name);
    const drawn = svg.children.map((child) => [child.tagName, child.attributes]);
    assert.deepEqual(drawn, shapes, name);
    svg.children.forEach((child) => assert.equal(child.namespaceURI, SVG_NS, name));
  }
});

test("icon takes a size and returns a fresh svg on every call", () => {
  const { ui } = loadUi();
  const large = ui.icon("check", 32);
  assert.equal(large.getAttribute("width"), "32");
  assert.equal(large.getAttribute("height"), "32");
  assert.equal(ui.icon("mic", 16).getAttribute("width"), "16");

  const first = ui.icon("mic");
  const second = ui.icon("mic");
  assert.notEqual(first, second);
  assert.notEqual(first.children[0], second.children[0]);
  first.children[0].setAttribute("d", "M0 0");
  assert.equal(ui.icon("mic").children[0].getAttribute("d"), EXPECTED_ICONS.mic[0][1].d);
});

test("icon returns null for a name it does not know", () => {
  const { ui } = loadUi();
  assert.equal(ui.icon("rocket"), null);
  assert.equal(ui.icon("toString"), null);
  assert.equal(ui.icon(undefined), null);
  assert.equal(ui.icon(""), null);
});

test("renderState draws a named icon at 32px with the state__icon class", () => {
  const { ui, document } = loadUi();
  for (const [name, firstTag] of Object.entries(STATE_ICON_FIRST_TAG)) {
    const block = renderBlock(ui, document, {
      kind: "empty",
      title: "No sessions yet",
      body: "Your first recording will show up here.",
      icon: name,
    });
    const [icon] = block.children;
    assert.equal(icon.tagName, "svg", name);
    assert.equal(icon.namespaceURI, SVG_NS, name);
    assert.equal(icon.getAttribute("class"), "state__icon", name);
    assert.equal(icon.getAttribute("data-icon"), name, name);
    assert.equal(icon.getAttribute("width"), "32", name);
    assert.equal(icon.getAttribute("height"), "32", name);
    assert.equal(icon.getAttribute("aria-hidden"), "true", name);
    assert.equal(icon.getAttribute("stroke"), "currentColor", name);
    assert.equal(icon.children[0].tagName, firstTag, name);
  }
});

test("renderState keeps the circle for an empty block with no icon or an unknown one", () => {
  const { ui, document } = loadUi();
  for (const icon of [undefined, "rocket"]) {
    const block = renderBlock(ui, document, { kind: "empty", title: "T", body: "B", icon });
    const [svg] = block.children;
    assert.equal(svg.getAttribute("class"), "state__icon", String(icon));
    assert.equal(svg.getAttribute("width"), "32", String(icon));
    assert.equal(svg.children[0].tagName, "circle", String(icon));
    assert.equal(svg.getAttribute("data-icon"), null, String(icon));
  }
});

test("renderState gives an error block the alert icon unless the caller names another", () => {
  const { ui, document } = loadUi();
  for (const icon of [undefined, "rocket"]) {
    const block = renderBlock(ui, document, { kind: "error", title: "T", body: "B", icon });
    const [svg] = block.children;
    assert.equal(svg.getAttribute("class"), "state__icon", String(icon));
    assert.equal(svg.getAttribute("data-icon"), "alert", String(icon));
    assert.equal(svg.getAttribute("width"), "32", String(icon));
    assert.equal(svg.children[0].tagName, "polygon", String(icon));
  }
  const named = renderBlock(ui, document, { kind: "error", title: "T", body: "B", icon: "mic" });
  assert.equal(named.children[0].getAttribute("data-icon"), "mic");
});

test("renderState keeps the spinner for a loading block even when an icon is named", () => {
  const { ui, document } = loadUi();
  const block = renderBlock(ui, document, {
    kind: "loading",
    title: "Analyzing your speech",
    body: "Usually 5 to 15 seconds.",
    icon: "mic",
  });
  assert.equal(block.children.length, 3);
  assert.equal(block.children[0].className, "spinner");
});

test("renderState adds a ghost secondary action after the primary one", () => {
  const { ui, document } = loadUi();
  const taps = [];
  const block = renderBlock(ui, document, {
    kind: "error",
    title: "Upload failed",
    body: "Could not reach the server. Your recording is still here.",
    actionLabel: "Retry upload",
    onAction: () => taps.push("retry"),
    secondaryLabel: "Record a new take",
    onSecondary: () => taps.push("new take"),
  });

  assert.equal(block.children.length, 5);
  const [icon, title, body, action, secondary] = block.children;
  assert.equal(icon.getAttribute("class"), "state__icon");
  assert.equal(title.className, "state__title");
  assert.equal(body.className, "state__body");
  assert.deepEqual(sortedClasses(action), ["btn", "btn--primary", "state__action"]);

  assert.equal(secondary.tagName, "button");
  assert.equal(secondary.getAttribute("type"), "button");
  assert.deepEqual(sortedClasses(secondary), ["btn", "btn--ghost", "state__secondary"]);
  assert.equal(secondary.children.length, 1);
  assert.ok(secondary.children[0] instanceof FakeTextNode, "the label is a child text node");
  assert.equal(secondary.children[0].textContent, "Record a new take");

  secondary.click();
  assert.deepEqual(taps, ["new take"]);
  action.click();
  assert.deepEqual(taps, ["new take", "retry"]);
});

test("renderState builds no secondary action without a secondaryLabel", () => {
  const { ui, document } = loadUi();
  const block = renderBlock(ui, document, {
    kind: "empty",
    title: "No sessions yet",
    body: "Your first recording will show up here.",
    actionLabel: "Record",
    onAction: () => {},
    onSecondary: () => {},
  });
  assert.equal(block.children.length, 4);
  assert.ok(!block.children.some((child) => child.className.includes("state__secondary")));
});

test("renderState puts a lone secondary action straight after the body", () => {
  const { ui, document } = loadUi();
  let taps = 0;
  const block = renderBlock(ui, document, {
    kind: "empty",
    title: "T",
    body: "B",
    secondaryLabel: "History",
    onSecondary: () => {
      taps += 1;
    },
  });
  assert.equal(block.children.length, 4);
  const secondary = block.children[3];
  assert.deepEqual(sortedClasses(secondary), ["btn", "btn--ghost", "state__secondary"]);
  secondary.click();
  assert.equal(taps, 1);
});

test("formatDay renders a short month and day with plain spaces", () => {
  const { ui } = loadUi();
  assert.equal(ui.formatDay("2026-10-09T22:21:00"), "Oct 9");
  assert.equal(ui.formatDay("2026-10-10T08:05:00"), "Oct 10");
  assert.equal(ui.formatDay("2026-01-31T12:00:00"), "Jan 31");
  assert.match(ui.formatDay("2026-12-01T00:30:00"), /^[A-Z][a-z]{2} \d{1,2}$/);
});

test("formatDay returns an empty string for something that is not a date", () => {
  const { ui } = loadUi();
  assert.equal(ui.formatDay("not a date"), "");
  assert.equal(ui.formatDay(undefined), "");
});
