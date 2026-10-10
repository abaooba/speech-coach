// Tests for the Progress revamp (DESIGN.md section 6, "Segmented control" and "Chart"): round y
// ticks, the metric switch as a segmented control with short option labels, the full metric
// names, the summary row (summaryFor), the fillers target band and its legend, the personal best
// ring and label, and short dates on the x axis. Like progress.test.js, the pure helpers run with
// no document, and show() runs ui.js plus screens/progress.js against the shared fake DOM with a
// stub summarize that hands back each session's `metrics` as the summary.
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

// The audit seed as summarize sees it, newest first: four free talks from Oct 5 to Oct 8 and
// the Gettysburg clip on Oct 10, each at noon UTC so every take is on its own local day.
const SEED = [
  ["t1", "2026-10-05", 128, 4, 1, 0, [140, 160]],
  ["t2", "2026-10-06", 141, 3, 2, 0, [140, 160]],
  ["t3", "2026-10-07", 137, 2, 2, 0, [140, 160]],
  ["t4", "2026-10-08", 152, 1, 0, 0, [140, 160]],
  ["t5", "2026-10-10", 76, 21.4, 3, 4.9, [130, 150]],
]
  .map(([id, day, wpm, fillersPerMinute, pauseCount, cleanStretchSeconds, target]) =>
    session(id, day + "T12:00:00.000Z", {
      wpm,
      fillersPerMinute,
      pauseCount,
      cleanStretchSeconds,
      target,
    }),
  )
  .reverse();

const SERIES_COLORS = ["var(--accent)", "var(--filler)", "var(--pause)", "var(--ok)"];
const SVG_NS = "http://www.w3.org/2000/svg";
const PLOT = { left: 36, right: 308, top: 12, bottom: 172 };

// Sessions one per day at noon UTC from Oct 1, newest first, all with the same numbers.
function dailySessions(count) {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return session("d" + index, `2026-10-${day}T12:00:00.000Z`, {
      wpm: 150,
      fillersPerMinute: 1,
      pauseCount: 1,
      cleanStretchSeconds: 5,
    });
  }).reverse();
}

// Sessions newest first whose numbers for one metric are `values`, oldest first in time.
function sessionsWith(key, values) {
  return values
    .map((value, index) => {
      const day = String(index + 1).padStart(2, "0");
      return session("v" + index, `2026-10-${day}T12:00:00.000Z`, {
        wpm: 150,
        fillersPerMinute: 1,
        pauseCount: 1,
        cleanStretchSeconds: 5,
        [key]: value,
      });
    })
    .reverse();
}

async function showMetric(sessions, optionIndex) {
  const mounted = mountProgress(sessions);
  await mounted.progress.show();
  controlOf(mounted.body).children[optionIndex].click();
  return mounted;
}

function summaryOf(body) {
  const summary = byClass(body, "progress-summary");
  assert.ok(summary, "the body should hold the summary row");
  return summary;
}

// [label, value text, icon name or null] for each cell of the summary row.
function summaryCells(body) {
  return summaryOf(body).children.map((item) => {
    const [label, value] = item.children;
    const icon = value.children.find((child) => child.tagName === "svg");
    return [fullText(label), fullText(value), icon ? icon.getAttribute("data-icon") : null];
  });
}

function svgChildren(svg, className) {
  return svg.children.filter((child) => child.getAttribute("class") === className);
}

function xLabelsOf(svg) {
  return childrenByTag(svg, "text").filter(
    (label) => Number(label.getAttribute("y")) > PLOT.bottom,
  );
}

function bestLabelOf(svg) {
  const labels = svgChildren(svg, "chart__best-label");
  assert.equal(labels.length, 1, "one Best label");
  return labels[0];
}

// [x, y, text-anchor] of the Best label.
function bestSpot(svg) {
  const label = bestLabelOf(svg);
  return [label.getAttribute("x"), label.getAttribute("y"), label.getAttribute("text-anchor")];
}

// The polyline's points as numbers, oldest first.
function polylinePoints(svg) {
  const [line] = childrenByTag(svg, "polyline");
  return line
    .getAttribute("points")
    .split(" ")
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

function round2(value) {
  return String(Math.round(value * 100) / 100);
}

test("progress exports summaryFor beside series and scale", () => {
  const progress = loadPure();
  for (const name of ["series", "scale", "summaryFor"]) {
    assert.equal(typeof progress[name], "function", name);
  }
});

test("summaryFor reads the latest take against the mean of the takes before it", () => {
  const progress = loadPure();
  const summary = progress.summaryFor([4, 3, 2, 1, 21.4], "fillersPerMinute");
  assert.equal(summary.latest, 21.4);
  assert.equal(summary.average, 2.5);
  assert.ok(Math.abs(summary.change - 18.9) < 1e-9, String(summary.change));
  assert.equal(summary.best, 1);
  assert.equal(summary.bestIndex, 3);

  const two = progress.summaryFor([150, 140], "wpm");
  assert.equal(two.latest, 140);
  assert.equal(two.average, 150);
  assert.equal(two.change, -10);
});

test("summaryFor picks the fewest fillers and pauses and the longest clean stretch", () => {
  const progress = loadPure();
  const fillers = progress.summaryFor([2.5, 1.2, 3, 1.4], "fillersPerMinute");
  assert.deepEqual([fillers.best, fillers.bestIndex], [1.2, 1]);
  const pauses = progress.summaryFor([3, 0, 2, 1], "pauseCount");
  assert.deepEqual([pauses.best, pauses.bestIndex], [0, 1]);
  const clean = progress.summaryFor([4.9, 12.5, 2.1, 3], "cleanStretchSeconds");
  assert.deepEqual([clean.best, clean.bestIndex], [12.5, 1]);
});

test("summaryFor gives a tie to the most recent take", () => {
  const progress = loadPure();
  assert.equal(progress.summaryFor([1, 2, 1, 3], "fillersPerMinute").bestIndex, 2);
  assert.equal(progress.summaryFor([0, 0, 0], "pauseCount").bestIndex, 2);
  assert.equal(progress.summaryFor([4.9, 1, 4.9, 2], "cleanStretchSeconds").bestIndex, 2);
  assert.equal(progress.summaryFor([150, 145, 158], "wpm").bestIndex, 2, "all inside the band");
});

test("summaryFor ranks pace by the distance from each take's own band", () => {
  const progress = loadPure();
  const seedTargets = SEED.map((stored) => stored.metrics.target).reverse();
  const seed = progress.summaryFor([128, 141, 137, 152, 76], "wpm", seedTargets);
  assert.deepEqual([seed.best, seed.bestIndex], [152, 3], "141 and 152 are inside: latest wins");

  // 175 is 5 over 150-170 and 125 is 5 under 130-150; 155 is 5 over 140-150 but comes last.
  const targets = [
    [150, 170],
    [130, 150],
    [140, 150],
  ];
  assert.equal(progress.summaryFor([175, 125, 155], "wpm", targets).bestIndex, 2);
  assert.equal(progress.summaryFor([175, 125, 156], "wpm", targets).bestIndex, 1);
  assert.equal(progress.summaryFor([100, 170], "wpm", [[90, 110], [140, 160]]).bestIndex, 0);
});

test("summaryFor falls back to 140 to 160 when a take has no usable band", () => {
  const progress = loadPure();
  assert.equal(progress.summaryFor([139, 161, 120], "wpm").bestIndex, 1);
  assert.equal(progress.summaryFor([165, 139, 120], "wpm", [null, [1], "x"]).bestIndex, 1);
  assert.equal(progress.summaryFor([165, 120], "wpm", [undefined, [100, 120]]).bestIndex, 1);
});

test("a take with nothing measured never wins fillers or pauses", () => {
  const progress = loadPure();
  const fillers = progress.summaryFor([null, 2, 3], "fillersPerMinute");
  assert.deepEqual([fillers.best, fillers.bestIndex], [2, 1]);
  assert.equal(fillers.average, 1, "it still reads as 0 in the average, as the chart draws it");
  assert.equal(progress.summaryFor([1, null], "pauseCount").bestIndex, 0);
  const none = progress.summaryFor([null, null], "fillersPerMinute");
  assert.deepEqual([none.best, none.bestIndex, none.latest], [null, -1, 0]);
});

test("summaryFor handles a single take and no takes", () => {
  const progress = loadPure();
  const one = progress.summaryFor([5], "pauseCount");
  assert.deepEqual(
    [one.latest, one.best, one.bestIndex, one.average, one.change],
    [5, 5, 0, null, null],
  );
  const empty = progress.summaryFor([], "wpm");
  assert.deepEqual(
    [empty.latest, empty.best, empty.bestIndex, empty.average, empty.change],
    [null, null, -1, null, null],
  );
});

test("the summary row sits under the title: latest, best, change from the average", async () => {
  const { body } = await showMetric(SEED, 1);
  const summary = summaryOf(body);
  assert.equal(summary.tagName, "dl");
  assert.equal(body.children[2], summary, "control, title, then the summary");
  summary.children.forEach((item) => {
    assert.equal(item.tagName, "div");
    assert.equal(item.className, "progress-summary__item");
    const [label, value] = item.children;
    assert.equal(label.tagName, "dt");
    assert.equal(label.className, "progress-summary__label");
    assert.equal(value.tagName, "dd");
    assert.ok(value.classList.contains("num"), "figures are tabular");
  });
  assert.deepEqual(summaryCells(body), [
    ["Latest", "21.4 /min", null],
    ["Best", "1.0 /min", null],
    ["From your average", "18.9 more", "triangle-up"],
  ]);
  const [latest, best, change] = summary.children.map((item) => item.children[1]);
  assert.equal(latest.className, "progress-summary__value num");
  assert.equal(best.className, "progress-summary__value num");
  assert.equal(change.className, "progress-summary__change num");
  const icon = change.children[0];
  assert.equal(icon.tagName, "svg", "the icon comes before the words");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
});

test("each metric writes its values and its change in the Results delta words", async () => {
  const expected = [
    [
      ["Latest", "76 wpm", null],
      ["Best", "152 wpm", null],
      ["From your average", "64 slower", "triangle-down"],
    ],
    [
      ["Latest", "21.4 /min", null],
      ["Best", "1.0 /min", null],
      ["From your average", "18.9 more", "triangle-up"],
    ],
    [
      ["Latest", "3", null],
      ["Best", "0", null],
      ["From your average", "2 more", "triangle-up"],
    ],
    [
      ["Latest", "4.9 s", null],
      ["Best", "4.9 s", null],
      ["From your average", "4.9 s longer", "triangle-up"],
    ],
  ];
  for (const [index, cells] of expected.entries()) {
    const { body } = await showMetric(SEED, index);
    assert.deepEqual(summaryCells(body), cells, OPTION_LABELS[index]);
  }
});

test("the change reads fewer, faster, shorter or No change with the matching icon", async () => {
  const cases = [
    ["fillersPerMinute", 1, [3, 2.6, 1.6], "1.2 fewer", "triangle-down"],
    ["wpm", 0, [140, 150, 157], "12 faster", "triangle-up"],
    ["cleanStretchSeconds", 3, [6, 4.2, 3], "2.1 s shorter", "triangle-down"],
    ["pauseCount", 2, [1, 3, 2], "No change", "dash"],
    ["fillersPerMinute", 1, [2, 2.04], "No change", "dash"],
    ["pauseCount", 2, [0, 1], "1 more", "triangle-up"],
  ];
  for (const [key, option, values, text, icon] of cases) {
    const { body } = await showMetric(sessionsWith(key, values), option);
    const [, , change] = summaryCells(body);
    assert.deepEqual(change.slice(1), [text, icon], `${key} ${JSON.stringify(values)}`);
  }
});

test("the fillers chart shades the target band from 0 to 3 under the gridlines", async () => {
  const { body } = await showMetric(SEED, 1);
  const svg = chartOf(body);
  // The seed's fillers axis runs 0 to 30, so 3 sits a tenth of the way up the 160-unit plot.
  const bandTop = PLOT.bottom - 16;

  const [band] = svgChildren(svg, "chart__band");
  assert.ok(band, "a band rect");
  assert.equal(band.tagName, "rect");
  assert.equal(band.namespaceURI, SVG_NS);
  assert.deepEqual(
    ["x", "width", "y", "height", "fill"].map((name) => band.getAttribute(name)),
    ["36", "272", String(bandTop), "16", "var(--ok-bg)"],
  );
  assert.equal(svg.children[0], band, "the band is the bottom layer");
  const firstGrid = svg.children.findIndex(
    (child) => child.getAttribute("stroke") === "var(--grid)",
  );
  assert.ok(firstGrid > 0, "the gridlines come after the band");

  const [target] = svgChildren(svg, "chart__target");
  assert.ok(target, "a dashed target line");
  assert.equal(target.tagName, "line");
  assert.deepEqual(
    ["x1", "x2", "y1", "y2", "stroke", "stroke-width"].map((name) => target.getAttribute(name)),
    ["36", "308", String(bandTop), String(bandTop), "var(--ok)", "1"],
  );
  assert.ok(target.getAttribute("stroke-dasharray"), "the target line is dashed");
});

test("a legend under the fillers chart explains the band; no other metric has one", async () => {
  const { body } = await showMetric(SEED, 1);
  const svg = chartOf(body);
  const legend = byClass(body, "chart__legend");
  assert.ok(legend, "the fillers chart has a legend");
  assert.equal(legend.tagName, "p");
  assert.equal(body.children[body.children.indexOf(svg) + 1], legend, "right under the chart");
  assert.equal(fullText(legend), "Target under 3", "the micro label from DESIGN.md section 8");
  const swatch = legend.children[0];
  assert.equal(swatch.tagName, "span");
  assert.equal(swatch.className, "chart__swatch");
  assert.equal(swatch.getAttribute("aria-hidden"), "true");
  assert.equal(byClass(body, "sr-only").tagName, "table", "the table is still the first sr-only");

  for (const index of [0, 2, 3]) {
    const other = await showMetric(SEED, index);
    assert.equal(byClass(other.body, "chart__legend"), undefined, OPTION_LABELS[index]);
    const otherSvg = chartOf(other.body);
    assert.deepEqual(svgChildren(otherSvg, "chart__band"), [], OPTION_LABELS[index]);
    assert.deepEqual(svgChildren(otherSvg, "chart__target"), [], OPTION_LABELS[index]);
  }
});

test("the best take gets a 7-unit ring and a Best label in the series color, on top", async () => {
  // Best points in the seed: pace 152 (Oct 8), fillers 1.0 (Oct 8), pauses 0 (Oct 8) and the
  // clean stretch 4.9 (Oct 10), on axes of 50-175, 0-30, 0-10 and 0-10.
  const centers = [
    [240, 12 + (175 - 152) * 1.28],
    [240, PLOT.bottom - 16 / 3],
    [240, PLOT.bottom],
    [308, PLOT.bottom - 4.9 * 16],
  ];
  for (const [index, [cx, cy]] of centers.entries()) {
    const { body } = await showMetric(SEED, index);
    const svg = chartOf(body);
    const color = SERIES_COLORS[index];
    const rings = svgChildren(svg, "chart__best");
    assert.equal(rings.length, 1, OPTION_LABELS[index]);
    const [ring] = rings;
    assert.equal(ring.tagName, "path");
    assert.equal(
      ring.getAttribute("d"),
      `M${round2(cx - 7)} ${round2(cy)} a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0`,
    );
    assert.deepEqual(
      ["fill", "stroke", "stroke-width"].map((name) => ring.getAttribute(name)),
      ["none", color, "2"],
    );
    const label = bestLabelOf(svg);
    assert.equal(label.textContent, "Best");
    assert.equal(label.getAttribute("fill"), color);
    const lastDot = svg.children.map((child) => child.tagName).lastIndexOf("circle");
    assert.ok(svg.children.indexOf(ring) > lastDot, "the ring paints over the dots");
    assert.ok(svg.children.indexOf(label) > svg.children.indexOf(ring), "the label is last");
    assert.equal(childrenByTag(svg, "circle").length, 5, "the ring is not another dot");
  }
});

test("the Best label sits above the point, away from the steeper segment", async () => {
  // Fillers 2.0 then 1.0 (best) then 21.4: the right segment is steeper, so the label goes left.
  const seed = await showMetric(SEED, 1);
  assert.deepEqual(bestSpot(chartOf(seed.body)), ["231", "154.67", "end"]);

  // The mirror image: a steep left segment sends the label right of the point.
  const mirrored = await showMetric(sessionsWith("fillersPerMinute", [21.4, 1, 2, 3, 4]), 1);
  assert.deepEqual(bestSpot(chartOf(mirrored.body)), ["113", "154.67", "start"]);
});

test("the Best label centers over a dip when both sides would cross the line", async () => {
  // Pauses 2, 0 (best), 3 around Oct 8: both diagonal spots touch a segment.
  const { body } = await showMetric(SEED, 2);
  assert.deepEqual(bestSpot(chartOf(body)), ["240", "160", "middle"]);
});

test("the Best label drops below a point at the top and stays inside at either end", async () => {
  // 10 tops a 0-10 axis: no room above, so the label goes below, away from the steeper right.
  const top = await showMetric(sessionsWith("cleanStretchSeconds", [9.9, 10, 9]), 3);
  assert.deepEqual(bestSpot(chartOf(top.body)), ["163", "33", "end"]);

  // At the last point the side away from the line is off the chart, so the label centers over
  // the point, slid inward until its 27-unit box ends at the chart's right edge (320).
  const last = await showMetric(SEED, 3);
  assert.deepEqual(bestSpot(chartOf(last.body)), ["306.5", "81.6", "middle"]);

  // At the first point it slides right until its box starts at the y axis (36).
  const first = await showMetric(sessionsWith("fillersPerMinute", [1, 4, 3]), 1);
  assert.deepEqual(bestSpot(chartOf(first.body)), ["49.5", "144", "middle"]);
});

test("the Best label clears a line that falls steeply into the latest take", async () => {
  // Fillers 10, 9, 1: the line drops into the best take from the upper left, through every
  // spot above the point, so the label tucks in level with the point, left of the ring.
  const { body } = await showMetric(sessionsWith("fillersPerMinute", [10, 9, 1]), 1);
  const svg = chartOf(body);
  const [x, y, anchor] = bestSpot(svg).map((value, index) => (index < 2 ? Number(value) : value));
  const share = { start: 0, middle: 0.5, end: 1 }[anchor];
  const box = { left: x - 27 * share, right: x - 27 * share + 27, top: y - 9, bottom: y };
  const points = polylinePoints(svg);
  points.slice(1).forEach((point, index) => {
    const from = points[index];
    const left = Math.max(from.x, box.left);
    const right = Math.min(point.x, box.right);
    if (left > right) {
      return;
    }
    const yAt = (at) => from.y + ((point.y - from.y) * (at - from.x)) / (point.x - from.x);
    const low = Math.min(yAt(left), yAt(right));
    const high = Math.max(yAt(left), yAt(right));
    assert.ok(low > box.bottom || high < box.top, `segment ${index} crosses the label`);
  });
  assert.ok(box.left >= PLOT.left && box.right <= 320 && box.top >= 0, "inside the chart");
  assert.deepEqual(bestSpot(svg), ["296", "160.5", "end"]);
});

test("with nothing measured, Best reads Not measured and no ring is drawn", async () => {
  const unmeasured = { speakingSeconds: 0 };
  const sessions = [
    session("u2", "2026-10-09T12:00:00.000Z", { fillersPerMinute: 0, report: unmeasured }),
    session("u1", "2026-10-08T12:00:00.000Z", { fillersPerMinute: 0, report: unmeasured }),
  ];
  const { body } = await showMetric(sessions, 1);
  assert.deepEqual(summaryCells(body)[1], ["Best", "Not measured", null]);
  const svg = chartOf(body);
  assert.deepEqual(svgChildren(svg, "chart__best"), []);
  assert.deepEqual(svgChildren(svg, "chart__best-label"), []);

  const mixed = [
    session("m2", "2026-10-09T12:00:00.000Z", {
      fillersPerMinute: 2,
      report: { speakingSeconds: 30 },
    }),
    session("m1", "2026-10-08T12:00:00.000Z", { fillersPerMinute: 0, report: unmeasured }),
  ];
  const shown = await showMetric(mixed, 1);
  assert.deepEqual(summaryCells(shown.body)[1], ["Best", "2.0 /min", null]);
});

test("x labels are short dates under each take up to five, the last end-anchored", async () => {
  const { app, body } = await showMetric(SEED, 0);
  const labels = xLabelsOf(chartOf(body));
  const days = [...SEED].reverse().map((stored) => app.ui.formatDay(stored.createdAt));
  assert.deepEqual(
    labels.map((label) => label.textContent),
    days,
  );
  assert.deepEqual(
    labels.map((label) => [label.getAttribute("x"), label.getAttribute("text-anchor")]),
    [
      ["36", "middle"],
      ["104", "middle"],
      ["172", "middle"],
      ["240", "middle"],
      ["308", "end"],
    ],
  );
  labels.forEach((label) => {
    assert.equal(label.getAttribute("fill"), "var(--muted)");
    assert.ok(Number(label.getAttribute("y")) <= 200, "inside the box");
  });
});

test("past five takes the x axis shows five dates spread from first to last", async () => {
  const sessions = dailySessions(9);
  const { app, body } = await showMetric(sessions, 0);
  const svg = chartOf(body);
  const labels = xLabelsOf(svg);
  const oldestFirst = [...sessions].reverse();
  assert.deepEqual(
    labels.map((label) => label.textContent),
    [0, 2, 4, 6, 8].map((index) => app.ui.formatDay(oldestFirst[index].createdAt)),
  );
  assert.deepEqual(
    labels.map((label) => label.getAttribute("x")),
    ["36", "104", "172", "240", "308"],
  );
  assert.equal(labels[4].getAttribute("text-anchor"), "end");
  assert.equal(childrenByTag(svg, "circle").length, 9, "every take keeps its dot");

  const twenty = await showMetric(dailySessions(20), 0);
  const spread = xLabelsOf(chartOf(twenty.body)).map((label) => label.getAttribute("x"));
  // Takes 0, 5, 10, 14 and 19 of 20, spaced 272 / 19 apart.
  assert.deepEqual(spread, [0, 5, 10, 14, 19].map((index) => round2(36 + (272 * index) / 19)));
});

test("a second take on the same day adds no second date label", async () => {
  const sessions = [
    session("c", "2026-10-09T12:01:00.000Z", { wpm: 150 }),
    session("b", "2026-10-09T12:00:00.000Z", { wpm: 150 }),
    session("a", "2026-10-08T12:00:00.000Z", { wpm: 150 }),
  ];
  const { app, body } = await showMetric(sessions, 0);
  const labels = xLabelsOf(chartOf(body));
  assert.deepEqual(
    labels.map((label) => [label.textContent, label.getAttribute("x")]),
    [
      [app.ui.formatDay("2026-10-08T12:00:00.000Z"), "36"],
      [app.ui.formatDay("2026-10-09T12:00:00.000Z"), "172"],
    ],
  );
});

test("every chart color is a token name, for each metric", async () => {
  for (const [index] of OPTION_LABELS.entries()) {
    const { body } = await showMetric(SEED, index);
    const svg = chartOf(body);
    const values = [svg, ...svg.children].flatMap((node) =>
      ["stroke", "fill"].map((name) => node.getAttribute(name)).filter((value) => value !== null),
    );
    values.forEach((value) => {
      assert.ok(value === "none" || /^var\(--[a-z-]+\)$/.test(value), value);
    });
  }
});

test("the body reads control, title, summary, chart, legend, then the same table", async () => {
  const { app, body } = await showMetric(SEED, 1);
  assert.deepEqual(
    body.children.map((child) => child.className || child.getAttribute("class")),
    [
      "segmented",
      "progress__title",
      "progress-summary",
      "chart",
      "chart__legend num",
      "sr-only",
    ],
  );
  const table = byClass(body, "sr-only");
  const rows = childrenByTag(table, "tbody")[0].children.map((row) => row.children.map(fullText));
  assert.deepEqual(
    rows,
    [...SEED].reverse().map((stored, index) => [
      String(index + 1),
      app.ui.formatDate(stored.createdAt),
      String(stored.metrics.fillersPerMinute),
    ]),
  );
  const headers = childrenByTag(table, "thead")[0].children[0].children.map(fullText);
  assert.deepEqual(headers, ["Session", "Date", "Fillers per minute"]);
});

test("Need two sessions shows the chart icon", async () => {
  const { progress, body } = mountProgress([SEED[0]]);
  await progress.show();
  const block = body.children[0];
  assert.equal(block.className, "state state--empty");
  assert.equal(block.children[0].getAttribute("data-icon"), "chart");
  assert.equal(fullText(block.children[1]), "Need two sessions");
});
