// Tests for the Progress revamp (DESIGN.md section 6, "Segmented control" and "Chart"): round y
// ticks, the metric switch as a segmented control with short option labels, and the full metric
// names on the title, the chart label and the table caption. Like progress.test.js, the pure
// helpers run with no document, and show() runs ui.js plus screens/progress.js against the shared
// fake DOM with a stub summarize that hands back each session's `metrics` as the summary.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const PROGRESS_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "progress.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

// DESIGN.md section 6: round steps, at most five intervals between the lowest and highest tick.
const ROUND_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200];
const MAX_INTERVALS = 5;

const OPTION_LABELS = ["Pace", "Fillers", "Pauses", "Clean"];
const FULL_NAMES = [
  "Words per minute",
  "Fillers per minute",
  "Mid-sentence pauses",
  "Longest clean stretch",
];
const OPTION_CLASS = "segmented__option";
const SELECTED_CLASS = "segmented__option segmented__option--selected";

// Sessions as the store hands them over: newest first. The stub summarize returns `metrics`,
// so these are the summary numbers directly.
function session(id, createdAt, metrics) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Free talk",
    durationSeconds: 60,
    metrics,
    transcript: [],
  };
}

// Three takes a day apart at noon UTC, so each falls on its own local day in any time zone.
const NEWEST_FIRST = [
  session("s3", "2026-10-09T12:00:00.000Z", {
    wpm: 140,
    fillersPerMinute: 1,
    pauseCount: 0,
    cleanStretchSeconds: 6.5,
  }),
  session("s2", "2026-10-08T12:00:00.000Z", {
    wpm: 160,
    fillersPerMinute: 2.5,
    pauseCount: 3,
    cleanStretchSeconds: 4.2,
  }),
  session("s1", "2026-10-07T12:00:00.000Z", {
    wpm: 150,
    fillersPerMinute: 4,
    pauseCount: 1,
    cleanStretchSeconds: 2.1,
  }),
];

function bareApp() {
  return {
    screens: { results: { summarize: (stored) => stored.metrics } },
    ui: {},
    store: {},
    router: {},
  };
}

function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  return context.app.screens.progress;
}

function mountProgress(sessions) {
  const context = { app: bareApp(), document: fakeDocument() };
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
  return { app: context.app, progress, body };
}

function fullText(node) {
  const own = node.textContent || "";
  return own + (node.children || []).map(fullText).join("");
}

function childrenByTag(node, tagName) {
  return node.children.filter((child) => child.tagName === tagName);
}

function controlOf(body) {
  const control = byClass(body, "segmented");
  assert.ok(control, "the body should hold the segmented control");
  return control;
}

function chartOf(body) {
  const svg = body.children.find(
    (child) => child.tagName === "svg" && child.getAttribute("class") === "chart",
  );
  assert.ok(svg, "the body should hold the chart");
  return svg;
}

function titleOf(body) {
  const title = byClass(body, "progress__title");
  assert.ok(title, "the body should hold the metric title");
  return title;
}

function captionOf(body) {
  const table = byClass(body, "sr-only");
  assert.ok(table, "the body should hold the screen-reader table");
  return fullText(childrenByTag(table, "caption")[0]);
}

// A deterministic stream of numbers in [0, 1), so the property test is the same on every run.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test("scale picks the smallest round step with at most five intervals", () => {
  const progress = loadPure();
  const cases = [
    [[150, 160, 140], "wpm", [120, 130, 140, 150, 160]],
    [[150], "wpm", [130, 135, 140, 145, 150]],
    [[128, 141, 137, 152, 158], "wpm", [100, 120, 140, 160]],
    [[128, 141, 137, 152, 76], "wpm", [50, 75, 100, 125, 150, 175]],
    [[0, 0], "fillersPerMinute", [0, 2, 4, 6, 8, 10]],
    [[0, 10.1], "fillersPerMinute", [0, 5, 10, 15, 20]],
    [[4, 3, 2, 1, 21.4], "fillersPerMinute", [0, 10, 20, 30]],
    [[1, 2, 2, 0, 3], "pauseCount", [0, 2, 4, 6, 8, 10]],
    [[0, 0, 0, 0, 4.9], "cleanStretchSeconds", [0, 2, 4, 6, 8, 10]],
    [[], "wpm", [0, 2, 4, 6, 8, 10]],
  ];
  for (const [values, key, ticks] of cases) {
    const scaled = progress.scale(values, key);
    const label = `${key} ${JSON.stringify(values)}`;
    assert.deepEqual([...scaled.yTicks], ticks, label);
    assert.equal(scaled.yMin, ticks[0], `${label} yMin`);
    assert.equal(scaled.yMax, ticks[ticks.length - 1], `${label} yMax`);
  }
});

test("every axis uses a listed step, covers its data and has at most five intervals", () => {
  const progress = loadPure();
  const random = seededRandom(7);
  const ceilings = { wpm: 260, fillersPerMinute: 40, pauseCount: 25, cleanStretchSeconds: 90 };
  for (let round = 0; round < 400; round += 1) {
    const key = Object.keys(ceilings)[round % 4];
    const count = 1 + Math.floor(random() * 12);
    const whole = key === "pauseCount" || key === "wpm";
    const values = Array.from({ length: count }, () => {
      const value = random() * ceilings[key];
      return whole ? Math.round(value) : Math.round(value * 10) / 10;
    });
    const { yMin, yMax, yTicks, points } = progress.scale(values, key);
    const label = `${key} ${JSON.stringify(values)}`;
    const step = yTicks[1] - yTicks[0];

    assert.ok(ROUND_STEPS.includes(step), `${label}: step ${step}`);
    assert.ok(yTicks.length - 1 <= MAX_INTERVALS, `${label}: ${yTicks.length - 1} intervals`);
    yTicks.forEach((tick, index) => assert.equal(tick, yMin + index * step, `${label} tick`));
    assert.equal(yTicks[yTicks.length - 1], yMax, `${label}: the last tick is the top`);
    assert.equal(yMin % step, 0, `${label}: the floor is a whole step`);
    assert.ok(yMin <= Math.min(...values) && yMax >= Math.max(...values), `${label}: covers`);
    if (key !== "wpm") {
      assert.equal(yMin, 0, `${label}: counts start at 0`);
    }
    points.forEach((point) => assert.ok(point.y >= 12 && point.y <= 172, `${label}: inside`));
  }
});

test("a huge malformed value still gets a short axis instead of thousands of ticks", () => {
  const progress = loadPure();
  const { yMin, yMax, yTicks } = progress.scale([0, 1e6], "fillersPerMinute");
  assert.equal(yMin, 0);
  assert.ok(yMax >= 1e6);
  assert.ok(yTicks.length - 1 <= MAX_INTERVALS, `${yTicks.length - 1} intervals`);
});

test("the metric switch is a labeled group of four toggle buttons, Pace selected", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();

  const control = controlOf(body);
  assert.equal(body.children[0], control, "the control is the body's first child");
  assert.equal(control.tagName, "div");
  assert.equal(control.className, "segmented");
  assert.equal(control.getAttribute("role"), "group");
  assert.equal(control.getAttribute("aria-label"), "Chart metric");

  const options = control.children;
  assert.deepEqual(options.map(fullText), OPTION_LABELS);
  options.forEach((option) => {
    assert.equal(option.tagName, "button");
    assert.equal(option.getAttribute("type"), "button");
  });
  assert.deepEqual(
    options.map((option) => [option.className, option.getAttribute("aria-pressed")]),
    [
      [SELECTED_CLASS, "true"],
      [OPTION_CLASS, "false"],
      [OPTION_CLASS, "false"],
      [OPTION_CLASS, "false"],
    ],
  );
});

test("each tap keeps the same control and buttons and moves the selection", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();
  const control = controlOf(body);
  const options = [...control.children];

  for (const [index] of OPTION_LABELS.entries()) {
    options[index].click();
    assert.equal(body.children[0], control, "the control is the same node, still first");
    assert.deepEqual(control.children, options, "the buttons are the same nodes");
    assert.deepEqual(
      options.map((option) => option.getAttribute("aria-pressed") === "true"),
      OPTION_LABELS.map((_, other) => other === index),
    );
    assert.deepEqual(
      options.map((option) => option.className === SELECTED_CLASS),
      OPTION_LABELS.map((_, other) => other === index),
    );
  }
});

test("the title, the chart label and the caption name the selected metric in full", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();
  const options = controlOf(body).children;

  for (const [index, name] of FULL_NAMES.entries()) {
    options[index].click();
    const title = titleOf(body);
    assert.equal(title.tagName, "h2");
    assert.equal(body.children[1], title, "the title sits right under the control");
    assert.equal(fullText(title), name);
    const label = chartOf(body).getAttribute("aria-label");
    assert.ok(label.startsWith(name + " over 3 sessions, latest "), label);
    assert.equal(captionOf(body), name + " by session");
  }
});

test("a second show keeps one control, one title and one chart", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();
  controlOf(body).children[3].click();
  await progress.show();

  const count = (name) => body.children.filter((child) => child.className === name).length;
  assert.equal(count("segmented"), 1);
  assert.equal(count("progress__title"), 1);
  assert.equal(body.children.filter((child) => child.tagName === "svg").length, 1);
  assert.equal(fullText(titleOf(body)), "Longest clean stretch", "the choice survives");
});
