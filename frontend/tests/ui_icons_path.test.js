// Tests for the icons the Loop Path's screens draw (spec
// docs/superpowers/specs/2026-10-14-loop-path.md, section 0 and the Path and Level screens):
// route (the nav's Path item), lock, flag, crown, clock, play, stop, lightbulb, external-link,
// chevron-left, calendar, close and user, added to app.ui.icon's ICONS right after `sun`, in the
// same 24-unit box with round 2-unit strokes in currentColor. ui.js runs in a vm context with the
// shared fake document, so every node is a FakeElement the tests read directly.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument } = require("./fake-dom");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const SVG_NS = "http://www.w3.org/2000/svg";

// The geometry of each new icon, as [tag, attributes] per child, in drawing order.
const PATH_ICONS = {
  route: [
    ["circle", { cx: "6", cy: "19", r: "3" }],
    ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }],
    ["circle", { cx: "18", cy: "5", r: "3" }],
  ],
  lock: [
    ["rect", { x: "3", y: "11", width: "18", height: "11", rx: "2" }],
    ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
  ],
  flag: [
    ["path", { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" }],
    ["line", { x1: "4", y1: "22", x2: "4", y2: "15" }],
  ],
  crown: [
    ["path", { d: "M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" }],
    ["path", { d: "M5 20h14" }],
  ],
  clock: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["polyline", { points: "12 6 12 12 16 14" }],
  ],
  play: [["polygon", { points: "6 3 20 12 6 21 6 3" }]],
  stop: [["rect", { x: "6", y: "6", width: "12", height: "12", rx: "2" }]],
  lightbulb: [
    [
      "path",
      {
        d:
          "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5" +
          ".7.7 1.3 1.5 1.5 2.5",
      },
    ],
    ["path", { d: "M9 18h6" }],
    ["path", { d: "M10 22h4" }],
  ],
  "external-link": [
    ["path", { d: "M15 3h6v6" }],
    ["path", { d: "M10 14 21 3" }],
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
  ],
  "chevron-left": [["path", { d: "m15 18-6-6 6-6" }]],
  calendar: [
    ["rect", { x: "3", y: "4", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M16 2v4" }],
    ["path", { d: "M8 2v4" }],
    ["path", { d: "M3 10h18" }],
  ],
  close: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
  user: [
    ["circle", { cx: "12", cy: "7", r: "4" }],
    ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
  ],
};

function loadUi() {
  const context = { app: {}, document: fakeDocument() };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  return context.app.ui;
}

test("every Path icon is a 24-unit currentColor svg with round 2-unit strokes", () => {
  const ui = loadUi();
  for (const name of Object.keys(PATH_ICONS)) {
    const svg = ui.icon(name);
    assert.ok(svg, name + " is drawn");
    assert.equal(svg.tagName, "svg", name);
    assert.equal(svg.namespaceURI, SVG_NS, name);
    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24", name);
    assert.equal(svg.getAttribute("width"), "20", name);
    assert.equal(svg.getAttribute("fill"), "none", name);
    assert.equal(svg.getAttribute("stroke"), "currentColor", name);
    assert.equal(svg.getAttribute("stroke-width"), "2", name);
    assert.equal(svg.getAttribute("stroke-linecap"), "round", name);
    assert.equal(svg.getAttribute("stroke-linejoin"), "round", name);
    assert.equal(svg.getAttribute("aria-hidden"), "true", name);
    assert.equal(svg.getAttribute("data-icon"), name, name);
    assert.equal(ui.icon(name, 32).getAttribute("width"), "32", name);
  }
});

test("each Path icon draws its shapes, first child first, all of them stroked", () => {
  const ui = loadUi();
  for (const [name, shapes] of Object.entries(PATH_ICONS)) {
    const svg = ui.icon(name);
    assert.deepEqual(
      svg.children.map((child) => [child.tagName, child.attributes]),
      shapes,
      name,
    );
    svg.children.forEach((child) => {
      assert.equal(child.namespaceURI, SVG_NS, name);
      assert.equal(child.getAttribute("fill"), null, name + " is drawn in strokes");
    });
  }
});

test("the nav's route icon is two dots joined by an S curve", () => {
  const [start, curve, end] = loadUi().icon("route").children;
  assert.deepEqual([start.tagName, curve.tagName, end.tagName], ["circle", "path", "circle"]);
  // The curve leaves the lower dot rightward, turns back left, then turns right to the upper.
  assert.match(curve.getAttribute("d"), /^M9 19h.*a3\.5 3\.5 0 0 0 .*a3\.5 3\.5 0 0 1 .*H15$/);
});

test("the Path icons sit in ICONS right after sun, in the order the spec lists them", () => {
  const block = UI_SOURCE.slice(UI_SOURCE.indexOf("const ICONS = deepFreeze({"));
  const keyAt = (name) => {
    const key = /^[a-z]+$/.test(name) ? name : JSON.stringify(name);
    const at = block.indexOf("\n    " + key + ": [");
    assert.ok(at !== -1, name + " is a key of ICONS");
    return at;
  };
  const names = ["sun", ...Object.keys(PATH_ICONS)];
  const positions = names.map(keyAt);
  positions.slice(1).forEach((position, index) => {
    assert.ok(position > positions[index], names[index + 1] + " comes after " + names[index]);
  });
  const between = block.slice(positions[0] + 1, positions[1]);
  assert.doesNotMatch(between, /\n {4}"?[a-z-]+"?: \[/, "no icon between sun and route");
});
