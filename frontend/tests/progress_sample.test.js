// Tests for the bundled sample on Progress (review code-4 and demo-5). History lists the sample
// a visitor opens from Practice, but it is not one of the speaker's takes: Progress leaves every
// session app.screens.results.isSample marks out of the series, the chart, the summary row and
// the table, and out of the count that decides "Need two sessions". progress.js runs with the
// real results.js loaded for isSample and, as in progress.test.js, a summarize that hands back
// each session's `metrics` as its summary.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const PROGRESS_SOURCE = read(path.join("screens", "progress.js"));

function session(id, createdAt, metrics, passageTitle = "Your day") {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle,
    durationSeconds: 60,
    metrics,
    transcript: [],
  };
}

// Two takes and, newest of all, the sample (146 wpm, 10.5 fillers a minute), newest first as the
// store lists them. Counted, the sample would be Latest and Best, and the change would read
// "11 faster" against the takes' 135 average.
const TAKE_A = session("a", "2026-10-07T12:00:00.000Z", { wpm: 150, fillersPerMinute: 1 });
const TAKE_B = session("b", "2026-10-08T12:00:00.000Z", { wpm: 120, fillersPerMinute: 4 });
const SAMPLE = session(
  "s",
  "2026-10-09T12:00:00.000Z",
  { wpm: 146, fillersPerMinute: 10.5 },
  "Sample: Congress speech",
);
const NEWEST_FIRST = [SAMPLE, TAKE_B, TAKE_A];

// The real results.js for isSample, with summarize swapped for the stub. `withIsSample: false`
// drops isSample, as a results module that predates it would.
function contextWith(options = {}) {
  const context = { app: { screens: {}, ui: {}, store: {}, router: {} } };
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  context.app.screens.results.summarize = (stored) => stored.metrics;
  if (options.withIsSample === false) {
    delete context.app.screens.results.isSample;
  }
  return context;
}

function loadPure(options) {
  const context = contextWith(options);
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  return context.app.screens.progress;
}

async function showProgress(sessions, options) {
  const context = contextWith(options);
  context.document = fakeDocument();
  context.app.store.list = () => Promise.resolve([...sessions]);
  context.app.router.go = () => {};
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.progress.mount(root);
  await context.app.screens.progress.show();
  return { app: context.app, body };
}

function fullText(node) {
  const own = node.textContent || "";
  return own + (node.children || []).map(fullText).join("");
}

function chartOf(body) {
  const svg = body.children.find((child) => child.tagName === "svg");
  assert.ok(svg, "the body should hold the chart");
  return svg;
}

// [label, value text] for each cell of the summary row.
function summaryCells(body) {
  return byClass(body, "progress-summary").children.map((item) =>
    item.children.map((part) => fullText(part)),
  );
}

function tableRows(body) {
  const table = byClass(body, "sr-only");
  const tbody = table.children.find((child) => child.tagName === "tbody");
  return tbody.children.map((row) => row.children.map(fullText));
}

test("series leaves the sample out", () => {
  const progress = loadPure();
  assert.deepEqual(progress.series(NEWEST_FIRST, "wpm"), [150, 120]);
  assert.deepEqual(progress.series([SAMPLE], "fillersPerMinute"), []);
});

test("one take and a sample still need a second take", async () => {
  const { body } = await showProgress([SAMPLE, TAKE_B]);
  assert.equal(body.children.length, 1);
  const [, title, text] = body.children[0].children;
  assert.equal(title.textContent, "Need two sessions");
  assert.equal(text.textContent, "Record one more to see a trend.");
});

test("a sample alone counts as no take at all", async () => {
  const { body } = await showProgress([SAMPLE]);
  const [, title, text] = body.children[0].children;
  assert.equal(title.textContent, "Need two sessions");
  assert.equal(text.textContent, "Record two sessions to see a trend.");
});

test("the chart, the summary and the table show the speaker's takes only", async () => {
  const { app, body } = await showProgress(NEWEST_FIRST);
  const svg = chartOf(body);
  assert.equal(svg.getAttribute("aria-label"), "Words per minute over 2 sessions, latest 120");
  assert.equal(svg.children.filter((child) => child.tagName === "circle").length, 2);
  assert.deepEqual(summaryCells(body), [
    ["Latest", "120 wpm"],
    ["Best", "150 wpm"],
    ["From your average", "30 slower"],
  ]);
  assert.deepEqual(tableRows(body), [
    ["1", app.ui.formatDate(TAKE_A.createdAt), "150"],
    ["2", app.ui.formatDate(TAKE_B.createdAt), "120"],
  ]);
});

test("without isSample every session counts, as before", async () => {
  assert.deepEqual(loadPure({ withIsSample: false }).series(NEWEST_FIRST, "wpm"), [150, 120, 146]);
  const { body } = await showProgress(NEWEST_FIRST, { withIsSample: false });
  assert.equal(
    chartOf(body).getAttribute("aria-label"),
    "Words per minute over 3 sessions, latest 146",
  );
});
