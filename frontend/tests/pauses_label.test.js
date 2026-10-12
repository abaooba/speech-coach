// Tests for the pauses label (owner decision after T32). The pauses card counts every
// mid-sentence pause and every 5 s+ freeze, even one after a full stop, so its label on Results,
// the Progress chart's title and aria-label, the "How we count" heading and the DESIGN.md copy
// read "Pauses", not "Mid-sentence pauses". The timeline still splits mid-sentence pauses from
// long ones, so its legend keeps "Mid-sentence pause".
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
const DELIVERY_SOURCE = read("delivery.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const PROGRESS_SOURCE = read(path.join("screens", "progress.js"));
const HOW_HTML = read("how.html");
const DESIGN = read("DESIGN.md");

const OLD_LABEL = "Mid-sentence pauses";

// A take with words, a pause after a full stop of 6 s (a freeze) and one of 2 s mid-sentence.
const SESSION = {
  id: "s1",
  createdAt: "2026-10-12T10:00:00.000Z",
  passageId: "free-talk",
  passageTitle: "Free talk",
  durationSeconds: 12,
  metrics: {
    pauses: [
      [0.8, 6],
      [7.4, 2],
    ],
    repeats: [],
    fillers: {},
    pace_windows: [],
  },
  transcript: [
    { text: "We", start: 0, end: 0.3 },
    { text: "start.", start: 0.4, end: 0.8 },
    { text: "Then", start: 6.8, end: 7.1 },
    { text: "the", start: 7.1, end: 7.4 },
    { text: "point", start: 9.4, end: 9.8 },
    { text: "lands.", start: 9.9, end: 10.3 },
  ],
};

async function showResults(session) {
  const context = {
    app: {
      screens: {},
      passages: [],
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return body;
}

async function showProgressPauses(sessions) {
  const context = {
    app: {
      screens: { results: { summarize: (stored) => stored.metrics } },
      ui: {},
      store: { list: () => Promise.resolve([...sessions]) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const progress = context.app.screens.progress;
  progress.mount(root);
  await progress.show();
  byClass(body, "segmented").children[2].click();
  return body;
}

// What a browser's textContent would return: the node's own text followed by its children's.
function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function progressSession(id, createdAt, pauseCount) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Free talk",
    durationSeconds: 60,
    metrics: { wpm: 150, fillersPerMinute: 1, pauseCount },
    transcript: [],
  };
}

test("the Results pauses card reads Pauses and counts the freeze after a full stop", async () => {
  const cards = byClass(await showResults(SESSION), "metric-grid").children;
  const card = cards[2];
  assert.equal(byClass(card, "metric-card__label").textContent, "Pauses");
  assert.equal(fullText(byClass(card, "metric-card__value")), "2");
});

test("the Progress pauses chart is titled Pauses and labelled with it", async () => {
  const body = await showProgressPauses([
    progressSession("b", "2026-10-11T10:00:00.000Z", 2),
    progressSession("a", "2026-10-10T10:00:00.000Z", 1),
  ]);
  assert.equal(byClass(body, "progress__title").textContent, "Pauses");
  const chart = body.children.find(
    (child) => child.tagName === "svg" && child.getAttribute("class") === "chart",
  );
  assert.equal(chart.getAttribute("aria-label"), "Pauses over 2 sessions, latest 2");
});

test("How we count names its pauses section Pauses", () => {
  assert.match(HOW_HTML, /<h2>4\. Pauses<\/h2>/);
  assert.ok(!HOW_HTML.includes("<h2>4. " + OLD_LABEL), "the old heading is gone");
});

test("How we count keeps the freeze paragraph and the Freeze tip row", () => {
  assert.ok(HOW_HTML.includes("A pause of 5 s or more counts wherever it falls"));
  assert.match(HOW_HTML, /<th scope="row">Freeze<\/th>/);
});

test("DESIGN.md names the card and the chart Pauses", () => {
  assert.ok(!DESIGN.includes('"' + OLD_LABEL + '"'), "no quoted old label is left");
  assert.ok(DESIGN.includes('"Pace", "Fillers", "Pauses", "Clean stretch"'));
  assert.ok(
    DESIGN.includes('"Words per minute", "Fillers per minute", "Pauses", "Longest clean stretch"'),
  );
});
