// Tests for the Results action bar (DESIGN.md sections 1, 3 and 6; audit L6): the last child of
// the screen, stuck above the nav, one row with a ghost "History" and the screen's only primary
// button, "Record again", whose width caps at 320px on wide screens.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);
const CSS = read("styles.css");

const SESSION = {
  id: "s1",
  createdAt: "2026-10-09T22:21:00.000Z",
  passageId: "gettysburg",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 3,
  metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
  transcript: "We win today.".split(" ").map((text, index) => ({
    text,
    start: index * 0.4,
    end: index * 0.4 + 0.3,
  })),
};

async function showResults(id) {
  const routes = [];
  const context = {
    app: {
      screens: {},
      passages: [{ id: "gettysburg", targetWpm: [130, 150] }],
      store: { get: (wanted) => Promise.resolve(wanted === SESSION.id ? SESSION : undefined) },
      router: { go: (name) => routes.push(name) },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id });
  return { body, routes };
}

// Every element under `node`, depth first.
function descendants(node) {
  return (node.children || []).flatMap((child) => [child, ...descendants(child)]);
}

test("the action bar is the last child: a ghost History, then Record again", async () => {
  const { body } = await showResults("s1");
  const actions = body.children[body.children.length - 1];
  assert.equal(actions.tagName, "div");
  assert.equal(actions.className, "results__actions");
  assert.deepEqual(
    actions.children.map((button) => [button.tagName, button.className, button.textContent]),
    [
      ["button", "btn btn--ghost", "History"],
      ["button", "btn btn--primary", "Record again"],
    ],
  );
  actions.children.forEach((button) => assert.equal(button.getAttribute("type"), "button"));
});

test("Record again is the only primary button on the screen", async () => {
  const { body } = await showResults("s1");
  const primaries = descendants(body).filter(
    (node) => node.classList && node.classList.contains("btn--primary"),
  );
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].textContent, "Record again");
});

test("found by class, Record again goes to Practice and History to History", async () => {
  const { body, routes } = await showResults("s1");
  const actions = byClass(body, "results__actions");
  byClass(actions, "btn--primary").click();
  byClass(actions, "btn--ghost").click();
  assert.deepEqual(routes, ["practice", "history"]);
});

test("a missing session shows no action bar, only the state's History action", async () => {
  const { body } = await showResults("nope");
  assert.equal(body.children.length, 1);
  assert.equal(byClass(body, "results__actions"), undefined);
});

// Every declaration styles.css gives this exact selector outside @-rules, later rules winning.
function rule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = {};
  let found = false;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((part) => part.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) {
      found = true;
      match[2].split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      });
    }
  }
  assert.ok(found, `styles.css needs a rule for ${selector}`);
  return declarations;
}

test("the bar sticks above the nav on the page background with a top border", () => {
  const bar = rule(".results__actions");
  assert.equal(bar.position, "sticky");
  assert.equal(bar.bottom, "calc(var(--nav-h) + env(safe-area-inset-bottom))");
  assert.equal(bar.background, "var(--bg)");
  assert.equal(bar["border-top"], "1px solid var(--border)");
  assert.equal(bar.display, "flex");
  assert.equal(bar.padding, "var(--s-3) 0");
  assert.notEqual(bar["flex-direction"], "column", "one row");
});

test("Record again fills the row and caps at 320px", () => {
  const primary = rule(".results__actions .btn--primary");
  assert.equal(primary.flex, "1 1 auto");
  assert.equal(primary["max-width"], "320px");
});
