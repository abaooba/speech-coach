// Tests for the Talk | Read split on Progress (owner decision 2026-10-22; Superdesign draft
// "Progress — Talk / Read segmented modes", picked by the judge). A take read aloud has no filler
// words to say and few pauses, so charting it beside free talk drew a saw-tooth and let a read's
// 0 win Best. Once the speaker has a read take (app.language.isReadTake), a Talk | Read switch
// sits above the metric switch and each mode charts only its own takes; read takes chart Slips
// (restarts and misread words a minute) in Fillers' place. With no read take the screen is the
// one it always was. ui.js, passages.js, language.js and screens/progress.js run for real
// against the shared fake DOM; summarize is a stub that hands back each session's `metrics` as
// its summary, as in progress_revamp.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "passages.js", "language.js", path.join("screens", "progress.js")].map(
  (file) => [file, read(file)],
);

// A stored session on `day` of October 2026 at noon UTC; `metrics` doubles as its summary.
function sessionOf(id, day, passageId, metrics) {
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T12:00:00.000Z",
    passageId,
    passageTitle: passageId,
    durationSeconds: 60,
    metrics,
    transcript: [],
  };
}

function talkOf(id, day, numbers) {
  return sessionOf(id, day, "free-talk", {
    wpm: 130,
    fillersPerMinute: 4,
    slipsPerMinute: 1,
    pauseCount: 4,
    cleanStretchSeconds: 10,
    ...numbers,
  });
}

function readOf(id, day, numbers) {
  return sessionOf(id, day, "explainer-rainbows", {
    wpm: 155,
    fillersPerMinute: 0,
    slipsPerMinute: 0,
    pauseCount: 0,
    cleanStretchSeconds: 40,
    ...numbers,
  });
}

// Three talk takes whose fillers fall 4, 3, 2 and two reads at 0 between them, oldest first.
const MIXED = [
  talkOf("t1", 1, { fillersPerMinute: 4, wpm: 120 }),
  readOf("r1", 2, { slipsPerMinute: 2.8, wpm: 153 }),
  talkOf("t2", 3, { fillersPerMinute: 3, wpm: 126 }),
  readOf("r2", 4, { slipsPerMinute: 1.4, wpm: 157 }),
  talkOf("t3", 5, { fillersPerMinute: 2, wpm: 132 }),
];

// Mounts Progress with the store listing `sessions` newest first. `rankCard` stands in for
// app.rankCard when given; `routes` records every router.go.
function mount(sessions, options) {
  const settings = options || {};
  const routes = [];
  const summarized = [];
  const summarize = (stored) => {
    summarized.push(stored.id);
    return stored.metrics;
  };
  const context = {
    app: {
      screens: { results: { summarize } },
      store: { list: () => Promise.resolve([...sessions].reverse()) },
      router: { go: (name) => routes.push(name) },
    },
    document: fakeDocument(),
  };
  if (settings.rankCard) {
    context.app.rankCard = settings.rankCard;
  }
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Progress";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);
  const progress = context.app.screens.progress;
  progress.mount(root);
  return { progress, body, routes, summarized };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function classesOf(body) {
  return body.children.map((child) => child.getAttribute("class") || child.className);
}

// The two segmented controls in body order: the mode switch first when there is one.
function switchesOf(body) {
  return body.children.filter((child) => child.classList.contains("segmented"));
}

function optionsOf(control) {
  return control.children.map((option) => option.textContent);
}

function pressedOf(control) {
  return control.children
    .filter((option) => option.getAttribute("aria-pressed") === "true")
    .map((option) => option.textContent);
}

function tap(control, label) {
  const option = control.children.find((child) => child.textContent === label);
  assert.ok(option, "an option labelled " + label);
  option.listeners.click[0]({ preventDefault() {} });
}

function chartOf(body) {
  const chart = body.children.find((child) => child.getAttribute("class") === "chart");
  assert.ok(chart, "the body holds the chart");
  return chart;
}

function dotsOf(body) {
  return chartOf(body).children.filter((child) => child.tagName === "circle");
}

function summaryOf(body) {
  const summary = byClass(body, "progress-summary");
  assert.ok(summary, "the body holds the summary row");
  return summary.children.map((item) => fullText(item));
}

function captionOf(body) {
  const caption = byClass(body, "progress__caption");
  return caption ? caption.textContent : null;
}

function titleOf(body) {
  return byClass(body, "progress__title").textContent;
}

test("with talk takes only, Progress draws as it always has, the rule loaded", async () => {
  const { progress, body } = mount(MIXED.filter((take) => take.passageId === "free-talk"));
  await progress.show();
  assert.deepEqual(classesOf(body), [
    "segmented",
    "progress__title",
    "progress-summary",
    "chart",
    "sr-only",
  ]);
  assert.equal(titleOf(body), "Words per minute");
  assert.equal(captionOf(body), null);
});

test("with a read take, the Talk | Read switch and its caption come first", async () => {
  const { progress, body } = mount(MIXED);
  await progress.show();
  assert.deepEqual(classesOf(body), [
    "segmented progress__modes",
    "progress__caption",
    "segmented",
    "progress__title",
    "progress-summary",
    "chart",
    "sr-only",
  ]);
  const [modes, metrics] = switchesOf(body);
  assert.equal(modes.getAttribute("role"), "group");
  assert.equal(modes.getAttribute("aria-label"), "Takes to show");
  assert.deepEqual(optionsOf(modes), ["Talk", "Read"]);
  assert.deepEqual(pressedOf(modes), ["Talk"]);
  assert.deepEqual(optionsOf(metrics), ["Pace", "Fillers", "Pauses", "Clean"]);
  assert.equal(captionOf(body), "3 takes · your own words · rated");
});

test("Talk charts its own takes only: no read take adds a point or wins Best", async () => {
  const { progress, body } = mount(MIXED);
  await progress.show();
  tap(switchesOf(body)[1], "Fillers");
  assert.equal(titleOf(body), "Talk · Fillers per minute");
  assert.equal(dotsOf(body).length, 3);
  assert.deepEqual(summaryOf(body), [
    "Latest2.0 /min",
    "Best2.0 /min",
    "From your average1.5 fewer",
  ]);
});

test("tapping Read charts the read takes, Slips in Fillers' place, the position kept", async () => {
  const { progress, body } = mount(MIXED);
  await progress.show();
  tap(switchesOf(body)[1], "Fillers");
  const modes = switchesOf(body)[0];
  tap(modes, "Read");
  assert.equal(switchesOf(body)[0], modes, "the same switch stays, so the tap keeps focus");
  assert.deepEqual(pressedOf(modes), ["Read"]);
  const metrics = switchesOf(body)[1];
  assert.deepEqual(optionsOf(metrics), ["Pace", "Slips", "Pauses", "Clean"]);
  assert.deepEqual(pressedOf(metrics), ["Slips"]);
  assert.equal(captionOf(body), "2 takes · read aloud · not rated");
  assert.equal(titleOf(body), "Read · Slips per minute");
  assert.equal(byClass(body, "progress__definition").textContent, "Restarts and misread words");
  assert.equal(dotsOf(body).length, 2);
  assert.deepEqual(summaryOf(body), [
    "Latest1.4 /min",
    "Best1.4 /min",
    "From your average1.4 fewer",
  ]);
  assert.equal(byClass(body, "chart__legend"), undefined, "no target band for slips");
});

test("every title, chart label and table caption names its mode", async () => {
  const { progress, body } = mount(MIXED);
  await progress.show();
  tap(switchesOf(body)[1], "Pace");
  assert.equal(titleOf(body), "Talk · Words per minute");
  tap(switchesOf(body)[0], "Read");
  assert.equal(titleOf(body), "Read · Words per minute");
  assert.ok(chartOf(body).getAttribute("aria-label").startsWith("Read · Words per minute over 2"));
  const table = byClass(body, "sr-only");
  assert.equal(fullText(table.children[0]), "Read · Words per minute by session");
  assert.equal(table.children[2].children.length, 2, "one row per read take");
});

test("the slips line is in the text colour, on 0 to 5 until a take goes higher", async () => {
  const { progress, body } = mount(MIXED);
  await progress.show();
  tap(switchesOf(body)[0], "Read");
  tap(switchesOf(body)[1], "Slips");
  const line = chartOf(body).children.find((child) => child.tagName === "polyline");
  assert.equal(line.getAttribute("stroke"), "var(--text)");
  // Arrays built inside the vm context carry its own prototypes: compare them as plain data.
  const axisOf = (values) => {
    const { yMin, yMax, yTicks } = progress.scale(values, "slipsPerMinute");
    return JSON.parse(JSON.stringify([yMin, yMax, yTicks]));
  };
  assert.deepEqual(axisOf([2.8, 1.3, 0]), [0, 5, [0, 1, 2, 3, 4, 5]]);
  assert.deepEqual(axisOf([6.2, 1]), [0, 8, [0, 2, 4, 6, 8]]);
});

test("a mode with under two takes shows Need two under the switch, and Record", async () => {
  const sessions = [talkOf("t1", 1), readOf("r1", 2), talkOf("t2", 3)];
  const { progress, body, routes } = mount(sessions);
  await progress.show();
  tap(switchesOf(body)[0], "Read");
  assert.deepEqual(classesOf(body), [
    "segmented progress__modes",
    "progress__caption",
    "state state--empty",
  ]);
  assert.equal(captionOf(body), "1 take · read aloud · not rated");
  const block = byClass(body, "state");
  assert.equal(byClass(block, "state__title").textContent, "Need two Read takes");
  assert.equal(
    byClass(block, "state__body").textContent,
    "Record one more Read take to see a trend.",
  );
  byClass(block, "state__action").listeners.click[0]({ preventDefault() {} });
  assert.deepEqual(routes, ["practice"]);
});

test("with read takes only Progress opens on Read, and Talk asks for two talk takes", async () => {
  const { progress, body } = mount([readOf("r1", 1), readOf("r2", 2)]);
  await progress.show();
  assert.deepEqual(pressedOf(switchesOf(body)[0]), ["Read"]);
  assert.equal(dotsOf(body).length, 2);
  tap(switchesOf(body)[0], "Talk");
  const block = byClass(body, "state");
  assert.equal(byClass(block, "state__title").textContent, "Need two Talk takes");
  assert.equal(byClass(block, "state__body").textContent, "Record two Talk takes to see a trend.");
  assert.equal(captionOf(body), "0 takes · your own words · rated");
});

test("the chosen mode and metric survive leaving and reopening the screen", async () => {
  const { progress, body } = mount(MIXED);
  await progress.show();
  tap(switchesOf(body)[0], "Read");
  tap(switchesOf(body)[1], "Pauses");
  progress.hide();
  await progress.show();
  assert.deepEqual(pressedOf(switchesOf(body)[0]), ["Read"]);
  assert.deepEqual(pressedOf(switchesOf(body)[1]), ["Pauses"]);
  assert.equal(titleOf(body), "Read · Pauses");
});

test("the rank card stays first, above the Talk | Read switch", async () => {
  const card = new FakeElement("section");
  card.className = "rank-card";
  const rankCard = { model: () => ({}), build: () => card };
  const { progress, body } = mount(MIXED, { rankCard });
  await progress.show();
  assert.equal(body.children[0], card);
  assert.equal(body.children[1].className, "segmented progress__modes");
  tap(switchesOf(body)[0], "Read");
  assert.equal(body.children[0], card, "a mode tap leaves the card in place");
});

test("a read that strayed from its passage is left out of Slips, not drawn as clean", async () => {
  // A take on a passage with no script block reports no misreads: one that strayed from its
  // passage, or one saved before takes were lined up against their script.
  const strayed = readOf("r2", 4, {
    slipsPerMinute: 0,
    report: { speakingSeconds: 40, followedScript: false },
  });
  const sessions = [talkOf("t1", 1), talkOf("t2", 2), readOf("r1", 3, { slipsPerMinute: 2.8 }),
    strayed, readOf("r3", 5, { slipsPerMinute: 1.4 })];
  const { progress, body } = mount(sessions);
  await progress.show();
  tap(switchesOf(body)[0], "Read");
  tap(switchesOf(body)[1], "Slips");
  assert.equal(dotsOf(body).length, 2);
  assert.deepEqual(summaryOf(body), [
    "Latest1.4 /min",
    "Best1.4 /min",
    "From your average1.4 fewer",
  ]);
  assert.equal(byClass(body, "sr-only").children[2].children.length, 2, "one row per counted read");
  tap(switchesOf(body)[1], "Pace");
  assert.equal(dotsOf(body).length, 3, "its pace still counts");
});

test("with no read counted for slips, Latest and Best read Not measured", async () => {
  const strayed = { slipsPerMinute: 0, report: { speakingSeconds: 40, followedScript: false } };
  const { progress, body } = mount([readOf("r1", 1, strayed), readOf("r2", 2, strayed)]);
  await progress.show();
  tap(switchesOf(body)[1], "Slips");
  assert.equal(dotsOf(body).length, 0);
  assert.deepEqual(summaryOf(body), [
    "LatestNot measured",
    "BestNot measured",
    "From your averageNot measured",
  ]);
});

test("each mode is summarized once, and a tap on the mode shown redraws nothing", async () => {
  const { progress, body, summarized } = mount(MIXED);
  await progress.show();
  assert.deepEqual(summarized, ["t3", "t2", "t1"], "Talk's takes, newest first, as listed");
  const modes = switchesOf(body)[0];
  tap(modes, "Read");
  tap(modes, "Talk");
  tap(modes, "Read");
  assert.deepEqual(summarized, ["t3", "t2", "t1", "r2", "r1"]);
  const chart = chartOf(body);
  tap(modes, "Read");
  assert.equal(chartOf(body), chart);
});

// --- styles.css ---

// The declarations of the rule whose selector list is exactly `selector`, outside any @media.
function declarations(selector) {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp("(^|})\\s*" + escaped + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return Object.fromEntries(
    match[2]
      .split(";")
      .map((part) => part.split(":").map((side) => side.trim()))
      .filter((pair) => pair.length === 2 && pair[0] !== ""),
  );
}

test("the caption is a small muted line under the switch, a gap above the next", () => {
  assert.deepEqual(declarations(".progress__caption"), {
    margin: "var(--s-2) 0 0",
    "font-size": "var(--fs-small)",
    "line-height": "1.4",
    color: "var(--muted)",
  });
  assert.deepEqual(declarations(".progress__caption + .segmented"), {
    "margin-top": "var(--s-5)",
  });
});

test("the Slips definition sits tight under its title, a small muted line", () => {
  assert.deepEqual(declarations(".progress__definition"), {
    margin: "0 0 var(--s-3)",
    "font-size": "var(--fs-small)",
    "line-height": "1.4",
    color: "var(--muted)",
  });
  assert.deepEqual(declarations(".progress__title:has(+ .progress__definition)"), {
    "margin-bottom": "var(--s-1)",
  });
});
