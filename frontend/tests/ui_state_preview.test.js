// renderState's optional preview: a figure.state__preview after the actions, holding whatever
// the caller passes, and nothing when no preview is given.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

function ui() {
  const context = { app: {}, document: fakeDocument(() => null) };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  return context;
}

test("a preview node becomes the block's last child inside figure.state__preview", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  const chart = document.createElement("svg");
  app.ui.renderState(root, {
    kind: "empty",
    title: "Need two sessions",
    body: "Record two sessions to see a trend.",
    actionLabel: "Record",
    preview: chart,
  });
  const block = root.children[0];
  assert.equal(block.children.length, 5);
  const figure = block.children[4];
  assert.equal(figure.tagName, "figure");
  assert.equal(figure.className, "state__preview");
  assert.equal(figure.children[0], chart);
});

test("an array of preview nodes keeps its order", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  const first = document.createElement("svg");
  const second = document.createElement("p");
  app.ui.renderState(root, { kind: "empty", title: "T", body: "B.", preview: [first, second] });
  const figure = root.children[0].children[3];
  assert.equal(figure.children.length, 2);
  assert.equal(figure.children[0], first);
  assert.equal(figure.children[1], second);
});

test("without a preview the block is unchanged", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  app.ui.renderState(root, { kind: "empty", title: "T", body: "B.", actionLabel: "Go" });
  assert.equal(root.children[0].children.length, 4);
});

test("a preview comes after the secondary action too", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  app.ui.renderState(root, {
    kind: "error",
    title: "T",
    body: "B.",
    actionLabel: "Retry",
    secondaryLabel: "Drop",
    preview: document.createElement("p"),
  });
  const block = root.children[0];
  assert.equal(block.children.length, 6);
  assert.equal(block.children[5].className, "state__preview");
});

test("ui.js is the only file that builds a state__preview", () => {
  assert.ok(UI_SOURCE.includes('"state__preview"'));
  const screens = path.join(__dirname, "..", "screens");
  for (const file of fs.readdirSync(screens)) {
    const source = fs.readFileSync(path.join(screens, file), "utf8");
    assert.ok(!source.includes("state__preview"), file + " must pass preview to renderState");
  }
});

test("the figure is an element the fake DOM can hold", () => {
  assert.ok(new FakeElement("figure"));
});
