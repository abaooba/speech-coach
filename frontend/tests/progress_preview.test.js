// Progress under two sessions: the state block keeps its four pinned children and gains a
// preview: an example trend chart, a caption and a two-take tracker that fills as takes land.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const UI_SOURCE = fs.readFileSync(path.join(FRONTEND, "ui.js"), "utf8");
const PROGRESS_SOURCE = fs.readFileSync(path.join(FRONTEND, "screens", "progress.js"), "utf8");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8");

// One stored take, as progress.test.js builds one: the stub summarize hands metrics back as
// the summary, so these are the numbers Progress reads.
const TAKE = {
  id: "t1",
  createdAt: "2026-10-11T19:07:00.000Z",
  passageId: "free-talk",
  passageTitle: "Your day",
  durationSeconds: 60,
  metrics: { wpm: 150, fillersPerMinute: 2, pauseCount: 0 },
  transcript: [],
};

function bareApp() {
  return {
    screens: { results: { summarize: (stored) => stored.metrics } },
    ui: {},
    store: {},
    router: {},
  };
}

// The same mount progress.test.js uses: ui.js then progress.js in one vm context against the
// fake document, a store that serves `sessions` newest first, a router that swallows taps.
function mountProgress(sessions) {
  const document = fakeDocument();
  const context = { app: bareApp(), document };
  context.app.store.list = () => Promise.resolve([...sessions]);
  context.app.router.go = () => {};
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Progress";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);
  const progress = context.app.screens.progress;
  progress.mount(root);
  return { progress, body };
}

function find(node, className) {
  if (node.className && node.className.split(" ").includes(className)) return node;
  for (const child of node.children || []) {
    const hit = find(child, className);
    if (hit) return hit;
  }
  return null;
}

function ruleFor(selector) {
  const match = CSS.match(new RegExp("\\n" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("the preview is the block's fifth child and holds chart, caption and tracker", async () => {
  const { progress, body } = mountProgress([]);
  await progress.show();
  assert.equal(body.children.length, 1);
  const block = body.children[0];
  assert.equal(block.children.length, 5);
  const figure = block.children[4];
  assert.equal(figure.className, "state__preview");
  assert.deepEqual(
    figure.children.map((child) => child.tagName + "." + child.className),
    ["svg.progress-preview__chart", "p.progress-preview__caption", "ol.progress-preview__steps"],
  );
});

test("the chart is decorative, 320 by 120, with a target band, a dashed line and six points", async () => {
  const { progress, body } = mountProgress([]);
  await progress.show();
  const chart = find(body, "progress-preview__chart");
  assert.equal(chart.getAttribute("viewBox"), "0 0 320 120");
  assert.equal(chart.getAttribute("aria-hidden"), "true");
  assert.ok(find(chart, "progress-preview__band"));
  const line = find(chart, "progress-preview__line");
  assert.equal(line.getAttribute("points").split(" ").length, 6);
  const points = chart.children.filter((c) => c.tagName === "circle");
  assert.equal(points.length, 6);
});

test("the caption says it is an example, in under 15 words", async () => {
  const { progress, body } = mountProgress([]);
  await progress.show();
  const caption = find(body, "progress-preview__caption");
  assert.equal(caption.textContent, "Example: fillers per minute falling over six takes.");
  assert.ok(caption.textContent.split(" ").length < 15);
});

test("the tracker fills one step per recorded take", async () => {
  for (const [sessions, done] of [
    [[], []],
    [[TAKE], ["progress-preview__step--done"]],
  ]) {
    const { progress, body } = mountProgress(sessions);
    await progress.show();
    const steps = find(body, "progress-preview__steps");
    assert.equal(steps.getAttribute("aria-label"), done.length + " of 2 takes recorded");
    assert.deepEqual(steps.children.map((li) => li.textContent), ["Take 1", "Take 2"]);
    const doneSteps = steps.children.filter((li) => li.className.includes("--done"));
    assert.equal(doneSteps.length, done.length);
  }
});

test("with one take the block is still the body's last child", async () => {
  const { progress, body } = mountProgress([TAKE]);
  await progress.show();
  const last = body.children[body.children.length - 1];
  assert.equal(last.className, "state state--empty");
  assert.equal(last.children[2].textContent, "Record one more to see a trend.");
});

test("styles.css draws the preview from tokens only", () => {
  assert.match(ruleFor(".state__preview"), /width: 100%/);
  assert.match(ruleFor(".state__preview"), /margin: var\(--s-4\) 0 0/);
  assert.match(ruleFor(".progress-preview__chart"), /color: var\(--filler\)/);
  assert.match(ruleFor(".progress-preview__band"), /fill: var\(--ok-bg\)/);
  assert.match(ruleFor(".progress-preview__line"), /stroke-dasharray/);
  assert.match(ruleFor(".progress-preview__step--done"), /background: var\(--accent-soft\)/);
  assert.match(ruleFor(".progress-preview__caption"), /color: var\(--muted\)/);
});
