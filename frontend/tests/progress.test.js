// Tests for frontend/screens/progress.js (app.screens.progress). series() and scale() run with
// no `document` and a stub summarize that hands back session.metrics as is, exactly as the brief
// describes; mount/show run against the shared fake DOM with the real ui.js loaded into the same
// vm context, a fake app.store that serves a fixed list, and a fake app.router that records taps.
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

// The geometry the brief fixes: a 320 x 200 box with 36 / 12 / 12 / 28 padding, so the plot
// runs from x 36 to 308 and from y 12 (top value) to 172 (bottom value).
const LEFT = 36;
const RIGHT = 308;
const TOP = 12;
const BOTTOM = 172;
const CENTER_X = 172;
const TOLERANCE = 1e-6;

const EMPTY_STATE_CLASS = "state state--empty";
const CHIP_LABELS = ["Words per minute", "Fillers per minute", "Pauses"];
const WPM_COLOR = "var(--accent)";
const FILLERS_COLOR = "var(--filler)";
const PAUSES_COLOR = "var(--pause)";

// Three stored sessions, newest first, the order app.store.list() hands them over in. The stub
// summarize returns `metrics` unchanged, so these are the summary numbers directly: oldest first
// the pace reads 150, 160, 140, exactly the brief's scale example.
function session(id, createdAt, wpm, fillersPerMinute, pauseCount) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Free talk",
    durationSeconds: 60,
    metrics: { wpm, fillersPerMinute, pauseCount },
    transcript: [],
  };
}
const FIRST = session("s1", "2026-10-08T18:00:00.000Z", 150, 4, 1);
const SECOND = session("s2", "2026-10-09T22:21:00.000Z", 160, 2.5, 3);
const THIRD = session("s3", "2026-10-10T09:05:00.000Z", 140, 1, 0);
const NEWEST_FIRST = [THIRD, SECOND, FIRST];

function bareApp() {
  return {
    screens: { results: { summarize: (stored) => stored.metrics } },
    ui: {},
    store: {},
    router: {},
  };
}

// Loads progress.js with no document and the stub summarize, exactly as the brief describes.
function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  return { app: context.app, progress: context.app.screens.progress };
}

// Loads ui.js then progress.js against the fake document. The store serves `sessions` as given
// (newest first, as the real store sorts); every list and route call is recorded.
function mountProgress(sessions) {
  const document = fakeDocument();
  const calls = { lists: 0, routes: [] };
  const context = { app: bareApp(), document };
  context.app.store.list = () => {
    calls.lists += 1;
    return Promise.resolve([...sessions]);
  };
  context.app.router.go = (name, params) => {
    calls.routes.push({ name, id: params ? params.id : undefined });
  };
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
  return { app: context.app, progress, body, calls };
}

// Many sessions a minute apart, oldest first in time but handed over newest first.
function manySessions(count) {
  return Array.from({ length: count }, (_, index) => {
    const minute = String(index).padStart(2, "0");
    return session("m" + index, "2026-10-10T10:" + minute + ":00.000Z", 150, 1, 1);
  }).reverse();
}

function assertCloseTo(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < TOLERANCE,
    `${label}: ${actual} should be within ${TOLERANCE} of ${expected}`,
  );
}

function assertAllCloseTo(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  actual.forEach((value, index) => assertCloseTo(value, expected[index], `${label}[${index}]`));
}

// What a browser's textContent would return: the node's own text followed by its children's.
function fullText(node) {
  const own = node.textContent || "";
  const children = node.children || [];
  return own + children.map(fullText).join("");
}

function chipsOf(body) {
  const row = byClass(body, "chip-row");
  assert.ok(row, "the body should hold the chip row");
  return row.children;
}

// SVG elements take their class through setAttribute, so the lookup reads the attribute.
function chartOf(body) {
  const svg = body.children.find(
    (child) => child.tagName === "svg" && child.getAttribute("class") === "chart",
  );
  assert.ok(svg, "the body should hold the chart");
  return svg;
}

function tableOf(body) {
  const table = byClass(body, "sr-only");
  assert.ok(table, "the body should hold the screen-reader table");
  return table;
}

function childrenByTag(node, tagName) {
  return node.children.filter((child) => child.tagName === tagName);
}

function polylineOf(svg) {
  const lines = childrenByTag(svg, "polyline");
  assert.equal(lines.length, 1, "exactly one polyline");
  return lines[0];
}

// The body rows of the sr-only table as [session number, date, value] strings.
function tableRows(table) {
  const tbody = childrenByTag(table, "tbody")[0];
  assert.ok(tbody, "the table has a tbody");
  return tbody.children.map((row) => row.children.map(fullText));
}

test("progress.js registers app.screens.progress and touches no DOM at load time", () => {
  const { app, progress } = loadPure();
  assert.deepEqual(Object.keys(app.screens).sort(), ["progress", "results"]);
  for (const name of ["mount", "show", "hide", "series", "scale"]) {
    assert.equal(typeof progress[name], "function", `progress.${name} should be a function`);
  }
});

test("series returns the metric oldest first for each key", () => {
  const { progress } = loadPure();
  assert.deepEqual(progress.series(NEWEST_FIRST, "wpm"), [150, 160, 140]);
  assert.deepEqual(progress.series(NEWEST_FIRST, "fillersPerMinute"), [4, 2.5, 1]);
  assert.deepEqual(progress.series(NEWEST_FIRST, "pauseCount"), [1, 3, 0]);
  assert.deepEqual(NEWEST_FIRST.map((stored) => stored.id), ["s3", "s2", "s1"], "input untouched");
});

test("series hands each session to summarize at call time and reads a bad value as 0", () => {
  const { app, progress } = loadPure();
  const seen = [];
  app.screens.results.summarize = (stored) => {
    seen.push(stored);
    return stored.id === "s2" ? { wpm: "fast" } : { wpm: 100 };
  };
  assert.deepEqual(progress.series(NEWEST_FIRST, "wpm"), [100, 0, 100]);
  assert.deepEqual(seen, [THIRD, SECOND, FIRST]);
  assert.deepEqual(progress.series([], "wpm"), []);
});

test("scale([150,160,140], 'wpm'): x from 36 to 308, y axis 120 to 160 in thirds", () => {
  const { progress } = loadPure();
  const scaled = progress.scale([150, 160, 140], "wpm");
  assert.equal(scaled.points.length, 3);
  assert.equal(scaled.points[0].x, LEFT);
  assert.equal(scaled.points[1].x, CENTER_X);
  assert.equal(scaled.points[2].x, RIGHT);
  assert.equal(scaled.yMin, 120);
  assert.equal(scaled.yMax, 160);
  assertAllCloseTo(scaled.yTicks, [120, 120 + 40 / 3, 120 + 80 / 3, 160], "yTicks");
  // 160 is the top of the axis; 150 and 140 sit a quarter and a half of the way down the
  // 160px plot, so a value of 120 (the axis floor) would land on the bottom line at 172.
  assert.equal(scaled.points[1].y, TOP);
  assert.equal(scaled.points[0].y, TOP + (BOTTOM - TOP) / 4);
  assert.equal(scaled.points[2].y, TOP + (BOTTOM - TOP) / 2);
});

test("scale maps the axis floor to the bottom line and the axis top to the top line", () => {
  const { progress } = loadPure();
  const scaled = progress.scale([0, 10], "pauseCount");
  assert.equal(scaled.yMin, 0);
  assert.equal(scaled.yMax, 10);
  assert.equal(scaled.points[0].y, BOTTOM);
  assert.equal(scaled.points[1].y, TOP);
});

test("scale([150], 'wpm') centers the single point at x 172", () => {
  const { progress } = loadPure();
  const scaled = progress.scale([150], "wpm");
  assert.equal(scaled.points.length, 1);
  assert.equal(scaled.points[0].x, CENTER_X);
  assert.equal(scaled.yMin, 130);
  assert.equal(scaled.yMax, 150);
  assert.equal(scaled.points[0].y, TOP);
});

test("scale([0,0], 'fillersPerMinute') spans 0 to 10 and never divides by zero", () => {
  const { progress } = loadPure();
  const scaled = progress.scale([0, 0], "fillersPerMinute");
  assert.equal(scaled.yMin, 0);
  assert.equal(scaled.yMax, 10);
  assertAllCloseTo(scaled.yTicks, [0, 10 / 3, 20 / 3, 10], "yTicks");
  scaled.points.forEach((point) => {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), "finite coordinates");
    assert.equal(point.y, BOTTOM);
  });
});

test("scale([3], 'pauseCount') starts the axis at 0", () => {
  const { progress } = loadPure();
  const scaled = progress.scale([3], "pauseCount");
  assert.equal(scaled.yMin, 0);
  assert.equal(scaled.yMax, 10);
  assert.equal(scaled.points[0].y, TOP + ((BOTTOM - TOP) * 7) / 10);
});

test("scale rounds the top up to a ten, keeps the wpm floor at or above 0, and tolerates []", () => {
  const { progress } = loadPure();
  assert.equal(progress.scale([0, 7.2], "fillersPerMinute").yMax, 10);
  assert.equal(progress.scale([0, 10.1], "fillersPerMinute").yMax, 20);
  const lowPace = progress.scale([5, 15], "wpm");
  assert.equal(lowPace.yMin, 0);
  assert.equal(lowPace.yMax, 20);
  const nothing = progress.scale([], "wpm");
  assert.deepEqual(nothing.points, []);
  assert.equal(nothing.yMin, 0);
  assert.equal(nothing.yMax, 10);
});

test("scale honors the opts it is given and leaves the defaults alone", () => {
  const { progress } = loadPure();
  const narrow = progress.scale([1, 2], "pauseCount", { width: 100, padLeft: 10, padRight: 10 });
  assert.equal(narrow.points[0].x, 10);
  assert.equal(narrow.points[1].x, 90);
  assert.equal(narrow.points[0].y, TOP + ((BOTTOM - TOP) * 9) / 10, "height still defaults");
  const again = progress.scale([1, 2], "pauseCount");
  assert.equal(again.points[0].x, LEFT);
  assert.equal(again.points[1].x, RIGHT);
});

test("show() with fewer than two sessions renders Need two sessions with a Record action", async () => {
  for (const sessions of [[], [THIRD]]) {
    const { progress, body, calls } = mountProgress(sessions);
    await progress.show();
    assert.equal(calls.lists, 1);
    assert.equal(body.children.length, 1);
    const block = body.children[0];
    assert.equal(block.className, EMPTY_STATE_CLASS);
    assert.equal(block.getAttribute("role"), null);
    const [icon, title, text, action] = block.children;
    assert.equal(icon.tagName, "svg");
    assert.equal(title.textContent, "Need two sessions");
    assert.equal(text.textContent, "Record one more to see a trend.");
    assert.equal(action.className, "state__action btn btn--secondary");
    assert.equal(fullText(action), "Record");
    action.click();
    assert.deepEqual(calls.routes, [{ name: "practice", id: undefined }]);
  }
});

test("show() renders the chip row, the wpm chart and the sr-only table", async () => {
  const { app, progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();

  assert.equal(body.children.length, 3);
  const [row, svg, table] = body.children;
  assert.equal(row.className, "chip-row");
  assert.equal(svg, chartOf(body));
  assert.equal(table, tableOf(body));

  const chips = chipsOf(body);
  assert.deepEqual(chips.map(fullText), CHIP_LABELS);
  chips.forEach((chip) => {
    assert.equal(chip.tagName, "button");
    assert.equal(chip.getAttribute("type"), "button");
  });
  assert.deepEqual(
    chips.map((chip) => [chip.className, chip.getAttribute("aria-pressed")]),
    [
      ["chip chip--selected", "true"],
      ["chip", "false"],
      ["chip", "false"],
    ],
  );

  assert.equal(svg.tagName, "svg");
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(svg.getAttribute("viewBox"), "0 0 320 200");
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "Words per minute over 3 sessions, latest 140");

  // Gridlines first, then the axes, the labels, the line, the dots: later nodes paint on top.
  assert.deepEqual(
    svg.children.map((child) => child.tagName),
    [
      ...Array(4).fill("line"),
      ...Array(2).fill("line"),
      ...Array(4).fill("text"),
      ...Array(3).fill("text"),
      "polyline",
      ...Array(3).fill("circle"),
    ],
  );
  svg.children.forEach((child) => {
    assert.equal(child.namespaceURI, "http://www.w3.org/2000/svg", child.tagName);
  });

  const lines = childrenByTag(svg, "line");
  const gridlines = lines.slice(0, 4);
  assert.deepEqual(
    gridlines.map((line) => [line.getAttribute("stroke"), line.getAttribute("stroke-width")]),
    Array(4).fill(["var(--grid)", "1"]),
  );
  assert.deepEqual(
    gridlines.map((line) => [line.getAttribute("x1"), line.getAttribute("x2")]),
    Array(4).fill(["36", "308"]),
  );
  assert.deepEqual(
    gridlines.map((line) => line.getAttribute("y1")),
    ["172", "118.67", "65.33", "12"],
  );
  gridlines.forEach((line) => assert.equal(line.getAttribute("y1"), line.getAttribute("y2")));

  const [yAxis, xAxis] = lines.slice(4);
  assert.deepEqual(
    [yAxis, xAxis].map((line) => line.getAttribute("stroke")),
    ["var(--border)", "var(--border)"],
  );
  assert.deepEqual(
    ["x1", "x2", "y1", "y2"].map((name) => yAxis.getAttribute(name)),
    ["36", "36", "12", "172"],
  );
  assert.deepEqual(
    ["x1", "x2", "y1", "y2"].map((name) => xAxis.getAttribute(name)),
    ["36", "308", "172", "172"],
  );

  const texts = childrenByTag(svg, "text");
  const yLabels = texts.slice(0, 4);
  assert.deepEqual(
    yLabels.map((label) => label.textContent),
    ["120", "133", "147", "160"],
  );
  yLabels.forEach((label) => {
    assert.equal(label.getAttribute("text-anchor"), "end");
    assert.equal(label.getAttribute("fill"), "var(--muted)");
    assert.ok(Number(label.getAttribute("x")) < LEFT, "y labels sit left of the axis");
  });
  assert.deepEqual(
    yLabels.map((label) => label.getAttribute("y")),
    ["172", "118.67", "65.33", "12"],
  );

  const xLabels = texts.slice(4);
  assert.deepEqual(xLabels.map((label) => label.textContent), ["1", "2", "3"]);
  assert.deepEqual(xLabels.map((label) => label.getAttribute("x")), ["36", "172", "308"]);
  xLabels.forEach((label) => {
    assert.equal(label.getAttribute("text-anchor"), "middle");
    assert.equal(label.getAttribute("fill"), "var(--muted)");
    assert.ok(Number(label.getAttribute("y")) > BOTTOM, "x labels sit under the axis");
    assert.ok(Number(label.getAttribute("y")) <= 200, "x labels stay inside the box");
  });

  const polyline = polylineOf(svg);
  assert.equal(polyline.getAttribute("points"), "36,52 172,12 308,92");
  assert.equal(polyline.getAttribute("fill"), "none");
  assert.equal(polyline.getAttribute("stroke"), WPM_COLOR);
  assert.equal(polyline.getAttribute("stroke-width"), "2");

  const circles = childrenByTag(svg, "circle");
  assert.deepEqual(
    circles.map((dot) => [
      dot.getAttribute("cx"),
      dot.getAttribute("cy"),
      dot.getAttribute("r"),
      dot.getAttribute("fill"),
    ]),
    [
      ["36", "52", "4", WPM_COLOR],
      ["172", "12", "4", WPM_COLOR],
      ["308", "92", "4", WPM_COLOR],
    ],
  );

  assert.equal(table.tagName, "table");
  assert.equal(table.className, "sr-only");
  const caption = childrenByTag(table, "caption")[0];
  assert.ok(caption, "the table has a caption");
  assert.equal(fullText(caption), "Words per minute by session");
  const headerRow = childrenByTag(table, "thead")[0].children[0];
  assert.deepEqual(headerRow.children.map(fullText), ["Session", "Date", "Words per minute"]);
  assert.deepEqual(tableRows(table), [
    ["1", app.ui.formatDate(FIRST.createdAt), "150"],
    ["2", app.ui.formatDate(SECOND.createdAt), "160"],
    ["3", app.ui.formatDate(THIRD.createdAt), "140"],
  ]);
});

test("no color attribute in the chart is a hex literal", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();
  const svg = chartOf(body);
  const colorValues = [svg, ...svg.children].flatMap((node) =>
    ["stroke", "fill"].map((name) => node.getAttribute(name)).filter((value) => value !== null),
  );
  assert.ok(colorValues.length > 0);
  colorValues.forEach((value) => {
    assert.ok(value === "none" || /^var\(--[a-z-]+\)$/.test(value), value);
  });
});

test("tapping Fillers per minute swaps the chart and table in place, chip row stays", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();
  const row = body.children[0];
  const firstSvg = chartOf(body);
  const chips = chipsOf(body);

  chips[1].click();

  assert.equal(body.children.length, 3);
  assert.equal(body.children[0], row, "the chip row is the same node");
  assert.deepEqual(chipsOf(body), chips, "the chips are the same nodes");
  assert.deepEqual(
    chips.map((chip) => [chip.className, chip.getAttribute("aria-pressed")]),
    [
      ["chip", "false"],
      ["chip chip--selected", "true"],
      ["chip", "false"],
    ],
  );

  const svg = chartOf(body);
  assert.notEqual(svg, firstSvg, "the chart is rebuilt");
  assert.equal(svg.getAttribute("aria-label"), "Fillers per minute over 3 sessions, latest 1");
  const polyline = polylineOf(svg);
  assert.equal(polyline.getAttribute("stroke"), FILLERS_COLOR);
  // Fillers 4, 2.5, 1 on a 0 to 10 axis: 60%, 75% and 90% of the way down the 160px plot.
  assert.equal(polyline.getAttribute("points"), "36,108 172,132 308,156");
  childrenByTag(svg, "circle").forEach((dot) => assert.equal(dot.getAttribute("fill"), FILLERS_COLOR));
  assert.deepEqual(
    childrenByTag(svg, "text").slice(0, 4).map((label) => label.textContent),
    ["0", "3", "7", "10"],
  );

  const table = tableOf(body);
  assert.equal(fullText(childrenByTag(table, "caption")[0]), "Fillers per minute by session");
  assert.deepEqual(
    tableRows(table).map((cells) => cells[2]),
    ["4", "2.5", "1"],
  );
});

test("tapping Pauses draws the pause count in the pause color", async () => {
  const { progress, body } = mountProgress(NEWEST_FIRST);
  await progress.show();
  chipsOf(body)[2].click();

  const svg = chartOf(body);
  assert.equal(svg.getAttribute("aria-label"), "Pauses over 3 sessions, latest 0");
  const polyline = polylineOf(svg);
  assert.equal(polyline.getAttribute("stroke"), PAUSES_COLOR);
  // Pauses 1, 3, 0 on a 0 to 10 axis.
  assert.equal(polyline.getAttribute("points"), "36,156 172,124 308,172");
  childrenByTag(svg, "circle").forEach((dot) => assert.equal(dot.getAttribute("fill"), PAUSES_COLOR));
  assert.deepEqual(
    chipsOf(body).map((chip) => chip.getAttribute("aria-pressed")),
    ["false", "false", "true"],
  );
  assert.deepEqual(
    tableRows(tableOf(body)).map((cells) => cells[2]),
    ["1", "3", "0"],
  );
});

test("the chosen metric survives leaving and reopening the screen", async () => {
  const { progress, body, calls } = mountProgress(NEWEST_FIRST);
  await progress.show();
  chipsOf(body)[1].click();
  progress.hide();
  await progress.show();

  assert.equal(calls.lists, 2);
  assert.equal(body.children.length, 3, "a second show replaces the chart, never stacks");
  assert.deepEqual(
    chipsOf(body).map((chip) => chip.getAttribute("aria-pressed")),
    ["false", "true", "false"],
  );
  assert.equal(polylineOf(chartOf(body)).getAttribute("stroke"), FILLERS_COLOR);
});

test("x labels: every session up to eight, every other one beyond that", async () => {
  const eight = mountProgress(manySessions(8));
  await eight.progress.show();
  const eightLabels = childrenByTag(chartOf(eight.body), "text").slice(4);
  assert.deepEqual(
    eightLabels.map((label) => label.textContent),
    ["1", "2", "3", "4", "5", "6", "7", "8"],
  );

  const nine = mountProgress(manySessions(9));
  await nine.progress.show();
  const svg = chartOf(nine.body);
  const nineLabels = childrenByTag(svg, "text").slice(4);
  assert.deepEqual(nineLabels.map((label) => label.textContent), ["1", "3", "5", "7", "9"]);
  assert.deepEqual(
    nineLabels.map((label) => label.getAttribute("x")),
    ["36", "104", "172", "240", "308"],
  );
  assert.equal(childrenByTag(svg, "circle").length, 9, "every session still gets a dot");
  assert.equal(svg.getAttribute("aria-label"), "Words per minute over 9 sessions, latest 150");
  assert.equal(tableRows(tableOf(nine.body)).length, 9);
});

test("a store that cannot be read shows Need two sessions instead of throwing", async () => {
  const { app, progress, body } = mountProgress(NEWEST_FIRST);
  app.store.list = () => Promise.reject(new Error("IndexedDB is unavailable"));
  await assert.doesNotReject(() => progress.show());
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].className, EMPTY_STATE_CLASS);
});

test("when two loads overlap, the later show wins", async () => {
  const { app, progress, body } = mountProgress([]);
  let releaseFirst = null;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let listCalls = 0;
  app.store.list = () => {
    listCalls += 1;
    return listCalls === 1 ? first : Promise.resolve([THIRD]);
  };

  const pendingSlow = progress.show();
  await progress.show();
  releaseFirst(NEWEST_FIRST);
  await pendingSlow;

  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].className, EMPTY_STATE_CLASS, "the slow load must not paint over");
});
