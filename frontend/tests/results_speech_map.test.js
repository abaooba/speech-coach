// Tests for the Results speech map (DESIGN.md section 6). The pure timelineSegments(report)
// turns the app.delivery report into 0 to 1 positions measured from the first word, and the
// pure speechMapRows(report, words) lays the take out along a rail: every moment a row in time
// order with its pixels of rail (fillers close together share a row, a pause or the clean
// stretch holds its length). show() draws them for a take with words: a heading, the first
// word's edge row, the list of moment cards (clock, rail mark, kind over detail) and the last
// word's edge row. Checked on the real clip and on the sample take that Practice offers.
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
const CSS = read("styles.css");
const SAMPLE = JSON.parse(read("sample-session.json"));

const SVG_NS = "http://www.w3.org/2000/svg";
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};
const PASSAGES = [
  { id: "gettysburg-opening", targetWpm: [130, 150] },
  { id: "explain-something", targetWpm: [130, 160], timeLimitSeconds: 120 },
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function loadPure() {
  const context = { app: { screens: {}, passages: PASSAGES, ui: {}, store: {}, router: {} } };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app;
}

function segmentsFor(words, metrics) {
  const app = loadPure();
  return plain(app.screens.results.timelineSegments(app.delivery.analyze(words, metrics)));
}

// Words 0.3 s long with 0.1 s between them, as delivery.test.js builds them.
function timed(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: round3(index * 0.4),
    end: round3(index * 0.4 + 0.3),
  }));
}

test("results.js exports timelineSegments beside summarize", () => {
  assert.equal(typeof loadPure().screens.results.timelineSegments, "function");
});

test("the real clip: every filler, mid-sentence pause and the clean stretch, from 0 to 1", () => {
  const segments = segmentsFor(CLIP_WORDS, CLIP_METRICS);
  assert.equal(segments.start, 1.287);
  assert.equal(segments.seconds, 30.908);
  assert.deepEqual(
    segments.fillers.map((filler) => round3(filler.at)),
    [0.014, 0.037, 0.058, 0.12, 0.293, 0.479, 0.584, 0.599, 0.803, 0.872, 0.976],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.time),
    [1.723, 2.417, 3.079, 5, 10.352, 16.098, 19.327, 19.794, 26.112, 28.231, 31.451],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.text),
    ["so", "um", "basically", "um", "um", "um", "uh", "um", "uh", "um", "uh"],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.kind),
    ["habit", "hesitation", "habit", ...Array(8).fill("hesitation")],
  );
  assert.deepEqual(
    segments.pauses.map((pause) => [round3(pause.from), round3(pause.to)]),
    [
      [0.43, 0.479],
      [0.504, 0.584],
      [0.622, 0.693],
    ],
  );
  assert.deepEqual(
    segments.pauses.map((pause) => [pause.time, pause.seconds]),
    [
      [14.567, 1.531],
      [16.853, 2.474],
      [20.517, 2.185],
    ],
  );
  const clean = segments.cleanStretch;
  assert.deepEqual(
    [round3(clean.from), round3(clean.to), clean.time, clean.endTime, clean.seconds],
    [0.134, 0.293, 5.436, 10.352, 4.9],
  );
});

test("the sample take: five fillers, no pauses, a clean stretch from the first word", () => {
  const segments = segmentsFor(SAMPLE.transcript, SAMPLE.metrics);
  assert.equal(segments.start, 1.794);
  assert.equal(segments.seconds, 28.701);
  assert.deepEqual(
    segments.fillers.map((filler) => round3(filler.at)),
    [0.48, 0.508, 0.533, 0.759, 0.882],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.text),
    ["um", "like", "you know", "uh", "uh"],
  );
  assert.deepEqual(segments.pauses, []);
  const clean = segments.cleanStretch;
  assert.deepEqual(
    [round3(clean.from), round3(clean.to), clean.time, clean.endTime, clean.seconds],
    [0, 0.48, 1.794, 15.559, 13.8],
  );
});

test("no timeline without words, without a first word time or without speaking time", () => {
  const app = loadPure();
  const { timelineSegments } = app.screens.results;
  assert.equal(timelineSegments(app.delivery.analyze([], CLIP_METRICS)), null);
  const instant = app.delivery.analyze([{ text: "hi", start: 2, end: 2 }], {});
  assert.equal(timelineSegments(instant), null, "no speaking time");
  assert.equal(timelineSegments(null), null);
  assert.equal(timelineSegments(undefined), null);
  assert.equal(timelineSegments({}), null);
  assert.equal(timelineSegments({ speechStart: "1", speakingSeconds: 10 }), null);
});

test("only mid-sentence pauses are drawn, and a mark past the last word stops at 1", () => {
  const words = timed("We win. The plan works today.");
  const afterPeriod = [words[1].end, 2];
  const midSentence = [words[3].end, 100];
  const segments = segmentsFor(words, { pauses: [afterPeriod, midSentence], repeats: [] });
  assert.equal(segments.pauses.length, 1);
  assert.equal(segments.pauses[0].time, words[3].end);
  assert.equal(segments.pauses[0].to, 1, "clamped to the last word");
});

test("a take with no clean speech has no clean-stretch band", () => {
  const segments = segmentsFor([{ text: "um", start: 1, end: 1.4 }], { pauses: [], repeats: [] });
  assert.equal(segments.cleanStretch, null);
  assert.equal(segments.fillers.length, 1);
});

test("timelineSegments does not change the report it reads", () => {
  const app = loadPure();
  const report = app.delivery.analyze(CLIP_WORDS, CLIP_METRICS);
  const before = JSON.stringify(report);
  app.screens.results.timelineSegments(report);
  assert.equal(JSON.stringify(report), before);
});

// The pure rows: the rail laid out in pixels.
function rowsFor(words, metrics) {
  const app = loadPure();
  return plain(app.screens.results.speechMapRows(app.delivery.analyze(words, metrics), words));
}

test("results.js exports speechMapRows beside timelineSegments", () => {
  assert.equal(typeof loadPure().screens.results.speechMapRows, "function");
});

test("the real clip: ten rows in time order, clustered fillers, pauses with their word", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  // 360 px over 30.9 s would be 11.6 px a second; the scale caps at 8.
  assert.equal(map.pxPerSecond, 8);
  assert.deepEqual(
    map.rows.map((row) => [row.kind, row.time, row.gap, row.height]),
    [
      ["filler", 1.723, 3, 0],
      ["clean", 5.436, 3, 39],
      ["filler", 10.352, 0, 0],
      ["pause", 14.567, 34, 12],
      ["filler", 16.098, 0, 0],
      ["restart", 16.515, 3, 0],
      ["pause", 16.853, 3, 20],
      ["filler", 19.327, 0, 0],
      ["pause", 20.517, 6, 17],
      ["filler", 26.112, 27, 0],
    ],
  );
  const [first, clean, , pause, , restart, , pair, , last] = map.rows;
  assert.deepEqual([first.words, first.count, first.lastTime], [
    ["so", "um", "basically", "um"],
    4,
    5,
  ]);
  assert.deepEqual([clean.seconds, clean.endTime], [4.9, 10.352]);
  assert.deepEqual([pause.seconds, pause.afterWord], [1.531, "piano"], "bare of its comma");
  assert.equal(restart.phrase, "and I, uh, and I", "first copy through the second");
  assert.deepEqual([pair.words, pair.lastTime], [["uh", "um"], 19.794]);
  assert.deepEqual([last.words, last.lastTime], [["uh", "um", "uh"], 31.451]);
  // 32.195 is the last word's end; the last filler starts at 31.451: 0.744 s of rail.
  assert.equal(map.endGap, 6);
});

test("a filler joins the row before it within 4 seconds, never across another moment", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  const fillers = map.rows.filter((row) => row.kind === "filler");
  assert.deepEqual(
    fillers.map((row) => row.count),
    [4, 1, 1, 2, 3],
    "11 fillers on five rows",
  );
  // 26.112, 28.231 and 31.451 are 2.1 and 3.2 s apart: one row. 5.0 and 10.352 are not.
  assert.equal(fillers[4].time, 26.112);
  assert.equal(fillers[1].time, 10.352, "the clean stretch sits between 5.0 and 10.352");
});

test("the gap of rail before a row counts from the end of the moment before", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  const [, clean, afterClean, pause] = map.rows;
  // The first row's four fillers end at 5.0; the clean stretch starts 0.436 s later.
  assert.equal(clean.gap, Math.round((5.436 - 5) * 8));
  // The clean stretch holds 4.9 s of rail; the um at 10.352 starts right at its end.
  assert.equal(afterClean.gap, 0);
  assert.equal(pause.gap, Math.round((14.567 - 10.352) * 8));
  assert.equal(pause.height, Math.round(1.531 * 8));
});

test("the sample take: the clean stretch first, then two filler rows", () => {
  const map = rowsFor(SAMPLE.transcript, SAMPLE.metrics);
  assert.deepEqual(
    map.rows.map((row) => [row.kind, row.time, row.gap, row.height]),
    [
      ["clean", 1.794, 0, 110],
      ["filler", 15.559, 0, 0],
      ["filler", 23.571, 52, 0],
    ],
  );
  assert.deepEqual(map.rows[1].words, ["um", "like", "you know"]);
  assert.deepEqual(map.rows[2].words, ["uh", "uh"]);
  assert.equal(map.endGap, 27);
});

test("a long take shrinks to 2 px a second; a short one stretches to 8", () => {
  const long = rowsFor(steady(400, 0.5, [399]).transcript, {});
  assert.equal(long.pxPerSecond, 2, "200 s at 360 px would be 1.8");
  const medium = rowsFor(steady(180, 0.5, [179]).transcript, {});
  assert.equal(medium.pxPerSecond, 4, "90 s: 360 / 90");
  assert.equal(rowsFor(steady(16, 0.5, [15]).transcript, {}).pxPerSecond, 8);
});

test("a long pause is its own kind, a pause before the first word names no word", () => {
  const words = timed("We win. The plan works today.");
  const metrics = { pauses: [[0, 1.6], [words[1].end, 6], [words[3].end, 1.5]], repeats: [] };
  const map = rowsFor(words, metrics);
  assert.deepEqual(
    map.rows.filter((row) => row.kind !== "clean").map((row) => [row.kind, row.afterWord]),
    [
      ["long-pause", "win"],
      ["pause", "plan"],
    ],
    "the 1.6 s silence before the first word is not counted, so it has no row",
  );
  const twoWords = [
    { text: "Hi", start: 1, end: 1.4 },
    { text: "there", start: 4, end: 4.4 },
  ];
  const first = rowsFor(twoWords, { pauses: [[1.4, 2.6]], repeats: [] });
  assert.equal(first.rows.find((row) => row.kind === "pause").afterWord, "Hi");
});

test("a restart without a second copy in the words keeps the repeat's own text", () => {
  const words = timed("We need a plan that works today and every day.");
  const map = rowsFor(words, { pauses: [], repeats: [{ text: "We need", at: 0 }] });
  const restart = map.rows.find((row) => row.kind === "restart");
  assert.equal(restart.phrase, "We need");
});

test("no map without words, speaking time or a report", () => {
  const app = loadPure();
  const { speechMapRows } = app.screens.results;
  assert.equal(speechMapRows(app.delivery.analyze([], CLIP_METRICS), []), null);
  assert.equal(speechMapRows(null, []), null);
  assert.equal(speechMapRows({}, []), null);
});

test("speechMapRows does not change the report or the words it reads", () => {
  const app = loadPure();
  const report = app.delivery.analyze(CLIP_WORDS, CLIP_METRICS);
  const before = JSON.stringify([report, CLIP_WORDS]);
  app.screens.results.speechMapRows(report, CLIP_WORDS);
  assert.equal(JSON.stringify([report, CLIP_WORDS]), before);
});

// The DOM half: show() against the fake document.
async function showSession(session) {
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
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

const CLIP_SESSION = {
  id: "clip",
  createdAt: "2026-10-10T15:30:00Z",
  passageId: "gettysburg-opening",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 33.1,
  metrics: CLIP_METRICS,
  transcript: CLIP_WORDS,
};
const SAMPLE_SESSION = { ...SAMPLE, id: "sample", createdAt: "2026-10-10T17:30:00Z" };

function outline(node) {
  if (node.nodeType === 3) {
    return "#text";
  }
  const className = node.className || node.getAttribute("class") || "";
  return node.tagName + "." + className;
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function stageOf(body) {
  return byClass(byClass(body, "speech-map"), "speech-map__stage");
}

function momentsOf(body) {
  return byClass(stageOf(body), "speech-map__moments");
}

// [kind, clock, label, detail, style] for one moment row.
function rowShape(row) {
  const [time, mark, card] = row.children;
  const [kind, detail] = card.children;
  assert.equal(mark.getAttribute("aria-hidden"), "true");
  return [
    row.className.replace("moment moment--", ""),
    time.textContent,
    kind.textContent,
    detail.textContent,
    row.getAttribute("style"),
  ];
}

test("the map sits between the headline and the stat strip, as one section", async () => {
  const body = await showSession(CLIP_SESSION);
  const names = body.children.map(outline);
  const headline = names.indexOf("section.headline");
  assert.equal(names[headline + 1], "section.speech-map");
  assert.equal(names[headline + 2], "div.stat-strip");
  const map = byClass(body, "speech-map");
  assert.deepEqual(map.children.map(outline), [
    "h2.results__heading speech-map__heading",
    "div.speech-map__stage",
  ]);
  assert.equal(map.children[0].textContent, "Speech map");
  assert.deepEqual(stageOf(body).children.map(outline), [
    "p.speech-map__edge speech-map__edge--start",
    "ol.speech-map__moments",
    "p.speech-map__edge speech-map__edge--end",
  ]);
});

test("a take without words has no map", async () => {
  const body = await showSession({ ...CLIP_SESSION, transcript: [] });
  assert.equal(byClass(body, "speech-map"), undefined);
});

test("the list is labelled with the take's sums and counts its rows as items", async () => {
  const list = momentsOf(await showSession(CLIP_SESSION));
  assert.equal(list.tagName, "ol");
  assert.equal(list.getAttribute("role"), "list");
  assert.equal(
    list.getAttribute("aria-label"),
    "Speech map from 0:01 to 0:32: 11 fillers, 3 mid-sentence pauses, 1 restart, " +
      "a 4.9 second clean stretch",
  );
  assert.equal(list.children.length, 10);
  list.children.forEach((row) => assert.equal(row.tagName, "li"));
});

test("the edge rows name the first and last word with their clocks", async () => {
  const stage = stageOf(await showSession(CLIP_SESSION));
  const [start, , end] = stage.children;
  for (const edge of [start, end]) {
    assert.deepEqual(edge.children.map(outline), [
      "span.speech-map__time num",
      "span.speech-map__dot",
      "span.speech-map__edge-text",
    ]);
    assert.equal(edge.children[1].getAttribute("aria-hidden"), "true");
  }
  assert.deepEqual(
    start.children.map((part) => part.textContent),
    ["0:01", "", "First word"],
  );
  assert.equal(start.getAttribute("style"), null, "the rail starts here");
  assert.deepEqual(end.children.map((part) => part.textContent), ["0:32", "", "Last word"]);
  assert.equal(end.getAttribute("style"), "margin-top:6px;min-height:0px", "0.744 s of rail");
});

test("every row is its clock, its mark and a card with the kind over the detail", async () => {
  const list = momentsOf(await showSession(CLIP_SESSION));
  list.children.forEach((row) => {
    assert.deepEqual(row.children.map(outline), [
      "span.moment__time num",
      "span.moment__mark",
      "div.moment__card",
    ]);
    assert.deepEqual(row.children[2].children.map(outline), ["p.moment__kind", "p.moment__detail"]);
  });
  const rail = (gap, height) => "margin-top:" + gap + "px;min-height:" + height + "px";
  assert.deepEqual(list.children.map(rowShape), [
    ["filler", "0:01", "4 fillers", "“so”, “um”, “basically”, “um”", rail(3, 0)],
    ["clean", "0:05", "Clean stretch", "4.9 s without a filler or pause, to 0:10", rail(3, 39)],
    ["filler", "0:10", "Filler", "“um”", rail(0, 0)],
    ["pause", "0:14", "Mid-sentence pause", "1.5 s after “piano”", rail(34, 12)],
    ["filler", "0:16", "Filler", "“um”", rail(0, 0)],
    ["restart", "0:16", "Restart", "“and I, uh, and I”", rail(3, 0)],
    ["pause", "0:16", "Mid-sentence pause", "2.5 s after “I”", rail(3, 20)],
    ["filler", "0:19", "2 fillers", "“uh”, “um”", rail(0, 0)],
    ["pause", "0:20", "Mid-sentence pause", "2.2 s after “um”", rail(6, 17)],
    ["filler", "0:26", "3 fillers", "“uh”, “um”, “uh”", rail(27, 0)],
  ]);
});

test("a row reads as one sentence of visible text: clock, kind, detail", async () => {
  const list = momentsOf(await showSession(CLIP_SESSION));
  assert.equal(fullText(list.children[5]), "0:16Restart“and I, uh, and I”");
  assert.equal(
    fullText(list.children[1]),
    "0:05Clean stretch4.9 s without a filler or pause, to 0:10",
  );
});

test("the sample take's map: label, rows and the rail's end", async () => {
  const body = await showSession(SAMPLE_SESSION);
  const list = momentsOf(body);
  assert.equal(
    list.getAttribute("aria-label"),
    "Speech map from 0:01 to 0:30: 5 fillers, no mid-sentence pauses, " +
      "a 13.8 second clean stretch",
  );
  const rail = (gap, height) => "margin-top:" + gap + "px;min-height:" + height + "px";
  assert.deepEqual(list.children.map(rowShape), [
    ["clean", "0:01", "Clean stretch", "13.8 s without a filler or pause, to 0:15", rail(0, 110)],
    ["filler", "0:15", "3 fillers", "“um”, “like”, “you know”", rail(0, 0)],
    ["filler", "0:23", "2 fillers", "“uh”, “uh”", rail(52, 0)],
  ]);
  const [start, , end] = stageOf(body).children;
  assert.equal(start.children[0].textContent, "0:01");
  assert.equal(end.children[0].textContent, "0:30");
  assert.equal(end.getAttribute("style"), "margin-top:27px;min-height:0px");
});

// Back-to-back words, each `seconds` long; "um" at the indexes in `umAt`.
function steady(count, seconds, umAt = []) {
  return {
    id: "steady",
    createdAt: "2026-10-10T18:00:00Z",
    passageId: "gettysburg-opening",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: count * seconds,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: umAt.includes(index) ? "um" : "word",
      start: index * seconds,
      end: (index + 1) * seconds,
    })),
  };
}

test("the label counts in words and picks a or an for the clean stretch", async () => {
  const label = async (session) => momentsOf(await showSession(session)).getAttribute("aria-label");
  assert.equal(
    await label(steady(16, 0.5, [15])),
    "Speech map from 0:00 to 0:08: 1 filler, no mid-sentence pauses, " +
      "a 7.5 second clean stretch",
  );
  assert.match(await label(steady(16, 0.5)), /: no fillers, .* an 8 second clean stretch$/);
  assert.match(await label(steady(22, 0.5)), /an 11 second clean stretch$/);
  assert.match(
    await label(steady(1, 0.4, [0])),
    /: 1 filler, no mid-sentence pauses, no clean stretch$/,
  );
});

test("a take with no moments at all still has its edges and an empty list", async () => {
  const words = [{ text: "um", start: 1, end: 1.4 }];
  const body = await showSession({ ...steady(1, 0.4), transcript: words });
  const list = momentsOf(body);
  assert.equal(list.children.length, 1, "the one um is a row");
  const quiet = { ...steady(2, 0.5), transcript: [] };
  assert.equal(byClass(await showSession(quiet), "speech-map"), undefined);
});

// Every declaration styles.css gives this selector outside @-rules, later rules winning.
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

test("every row is a grid on the same three columns: clock, rail, card", () => {
  const columns = "calc(var(--s-6) + var(--s-2)) var(--s-3) minmax(0, 1fr)";
  for (const selector of [".speech-map__edge", ".moment"]) {
    const row = rule(selector);
    assert.equal(row.display, "grid");
    assert.equal(row["grid-template-columns"], columns);
    assert.equal(row["column-gap"], "var(--s-2)");
    assert.equal(row["align-items"], "start");
  }
  assert.equal(rule(".moment")["padding-top"], "var(--s-2)", "rows never touch");
  const list = rule(".speech-map__moments");
  assert.equal(list["list-style"], "none");
  assert.equal(list.padding, "0");
});

test("the rail is a 2px --border line through the rail column, behind the marks", () => {
  const rail = rule(".speech-map__stage::before");
  assert.equal(rail.position, "absolute");
  assert.equal(rail.width, "2px");
  assert.equal(rail.background, "var(--border)");
  assert.equal(rail.left, "calc(var(--s-6) + var(--s-2) + var(--s-2) + var(--s-3) / 2 - 1px)");
  assert.equal(rule(".speech-map__stage").position, "relative");
  assert.equal(rule(".moment__mark").position, "relative");
  assert.equal(rule(".moment__mark")["align-self"], "stretch");
});

test("marks keep the colours' meanings: amber filler, violet pause, pink freeze, green run", () => {
  assert.equal(rule(".moment--filler .moment__mark::before").background, "var(--filler)");
  assert.equal(rule(".moment--pause .moment__mark::before").background, "var(--pause)");
  assert.equal(rule(".moment--long-pause .moment__mark::before").background, "var(--pause-long)");
  const clean = rule(".moment--clean .moment__mark::before");
  assert.equal(clean.background, "var(--ok-bg)");
  assert.equal(clean.border, "2px solid var(--ok)");
  assert.equal(rule(".moment--restart .moment__mark::before").background, "var(--pause)");
  const point = rule(".moment__mark::before");
  assert.equal(point.width, "var(--s-3)");
  assert.equal(point.height, "var(--s-3)");
  assert.equal(point["border-radius"], "50%");
  // A span moment's block runs to the row's end, as long as the moment holds the rail.
  const span = rule(".moment--pause .moment__mark::before");
  assert.equal(span.bottom, "0");
  assert.equal(span.height, "auto");
});

test("the card carries its moment's colour on its edge and its kind, the detail in text", () => {
  const card = rule(".moment__card");
  assert.equal(card.background, "var(--surface)");
  assert.equal(card.border, "1px solid var(--border)");
  assert.equal(card["border-left-width"], "4px");
  assert.equal(card["border-radius"], "var(--r-card)");
  assert.equal(card["overflow-wrap"], "anywhere");
  for (const [kind, token] of [
    ["filler", "--filler"],
    ["pause", "--pause"],
    ["long-pause", "--pause-long"],
    ["restart", "--pause"],
    ["clean", "--ok"],
  ]) {
    assert.equal(rule(`.moment--${kind} .moment__card`)["border-left-color"], `var(${token})`);
    assert.equal(rule(`.moment--${kind} .moment__kind`).color, `var(${token})`);
  }
  const kind = rule(".moment__kind");
  assert.equal(kind["font-size"], "var(--fs-micro)");
  assert.equal(kind["font-weight"], "600");
  const detail = rule(".moment__detail");
  assert.equal(detail["font-size"], "var(--fs-small)");
  assert.equal(detail.margin, "var(--s-1) 0 0");
});

test("clocks and edge words are micro, muted and tabular, right-aligned on the rail", () => {
  const time = rule(".moment__time");
  assert.equal(time["font-size"], "var(--fs-micro)");
  assert.equal(time.color, "var(--muted)");
  assert.equal(time["text-align"], "right");
  assert.equal(time["white-space"], "nowrap");
  assert.equal(rule(".speech-map__edge-text")["font-size"], "var(--fs-micro)");
  assert.equal(rule(".speech-map__edge-text").color, "var(--muted)");
  assert.equal(rule(".speech-map__dot")["border-radius"], "50%");
  assert.equal(rule(".speech-map__dot").border, "2px solid var(--muted)");
  assert.equal(rule("#screen-results")["font-variant-numeric"], "tabular-nums");
});
