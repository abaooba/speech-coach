// Tests for the Results speech map (DESIGN.md section 6). The pure timelineSegments(report)
// turns the app.delivery report into 0 to 1 positions measured from the first word, and the
// pure speechMapRows(report, words) lays the take out as a stack of same-height cards beside a
// rail that is linear in time: every moment a row with its card's place in the stack, its
// second on the rail, the words around it and the transcript mark its button scrolls to.
// show() draws them for a take with words: a heading, the first word's cap, the rail SVG beside
// the list of cards (clock and kind, context, Show in transcript) and the last word's cap.
// Checked on the real clip and on the sample take that Practice offers.
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

// The pure rows: the stack and the rail in pixels.
function rowsFor(words, metrics) {
  const app = loadPure();
  return plain(app.screens.results.speechMapRows(app.delivery.analyze(words, metrics), words));
}

// "…I play piano, [1.5 s] um, and I,…": a row's context as one string, marks in brackets.
function contextText(context) {
  if (!context) {
    return null;
  }
  const words = context.tokens.map((token) => (token.mark ? "[" + token.text + "]" : token.text));
  return (context.before ? "…" : "") + words.join(" ") + (context.after ? "…" : "");
}

test("results.js exports speechMapRows beside timelineSegments", () => {
  assert.equal(typeof loadPure().screens.results.speechMapRows, "function");
});

test("the real clip: ten cards in time order, each at its place in the stack", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  // Ten cards of 100px with 8px between: the rail is exactly as tall.
  assert.equal(map.height, 1072);
  assert.deepEqual(
    map.rows.map((row) => [row.kind, row.time, row.index, row.cardTop, row.cardMid]),
    [
      ["filler", 1.723, 0, 0, 50],
      ["clean", 5.436, 1, 108, 158],
      ["filler", 10.352, 2, 216, 266],
      ["pause", 14.567, 3, 324, 374],
      ["filler", 16.098, 4, 432, 482],
      ["restart", 16.515, 5, 540, 590],
      ["pause", 16.853, 6, 648, 698],
      ["filler", 19.327, 7, 756, 806],
      ["pause", 20.517, 8, 864, 914],
      ["filler", 26.112, 9, 972, 1022],
    ],
  );
});

test("the real clip: every moment sits on the rail at its second, linear in time", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  // 1072 px over 30.908 s from the first word at 1.287: 34.68 px a second.
  const at = (time) => Math.round(((time - 1.287) / 30.908) * 1072 * 10) / 10;
  assert.deepEqual(
    map.rows.map((row) => [row.railY, row.railEnd]),
    [
      [at(1.723), at(1.723)],
      [at(5.436), at(10.352)],
      [at(10.352), at(10.352)],
      [at(14.567), at(14.567 + 1.531)],
      [at(16.098), at(16.098)],
      [at(16.515), at(16.515)],
      [at(16.853), at(16.853 + 2.474)],
      [at(19.327), at(19.327)],
      [at(20.517), at(20.517 + 2.185)],
      [at(26.112), at(26.112)],
    ],
  );
  assert.equal(map.rows[1].railEnd, map.rows[2].railY, "the clean stretch ends at the um");
});

test("the real clip: clustered fillers, pauses with their word, the restarted phrase", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  const [first, clean, , pause, , restart, , pair, , last] = map.rows;
  assert.deepEqual([first.words, first.count, first.lastTime], [
    ["so", "um", "basically", "um"],
    4,
    5,
  ]);
  assert.deepEqual([clean.seconds, clean.endTime, clean.context], [4.9, 10.352, null]);
  assert.deepEqual([pause.seconds, pause.afterWord, pause.pauseIndex], [1.531, "piano", 0]);
  assert.equal(restart.phrase, "and I, uh, and I", "first copy through the second");
  assert.deepEqual([pair.words, pair.lastTime], [["uh", "um"], 19.794]);
  assert.deepEqual([last.words, last.lastTime], [["uh", "um", "uh"], 31.451]);
});

test("the real clip: three words either side, the moment marked, an ellipsis where cut", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  assert.deepEqual(map.rows.map((row) => contextText(row.context)), [
    "Hey, [so,] [um,] [basically,] [um,] m my day's…",
    null,
    "…is 10:21 PM. [Um,] I like to…",
    "…I play piano, [1.5 s] um, and I,…",
    "…I play piano, [um,] and I, uh,…",
    "…piano, um, [and] [I,] [uh,] [and] [I,] um, studying…",
    "…um, and I, [2.5 s] uh, and I,…",
    "…um, and I, [uh,] and I, [um,] studying for a…",
    "…and I, um, [2.2 s] studying for a…",
    "…quiz right now. [Uh,] in statistics and, [um,] AP statistics. [Uh,] yeah.",
  ]);
  const marks = map.rows[3].context.tokens.map((token) => token.mark);
  assert.deepEqual(marks, [null, null, null, "pause", null, null, null]);
  assert.deepEqual(
    map.rows[5].context.tokens.filter((token) => token.mark).map((token) => token.mark),
    Array(5).fill("restart"),
    "the restart marks both copies, as its phrase runs",
  );
});

test("the real clip: every card points at the transcript mark it talks about", () => {
  const map = rowsFor(CLIP_WORDS, CLIP_METRICS);
  assert.deepEqual(
    map.rows.map((row) => row.target),
    [
      "word-1",
      "word-5",
      "word-16",
      "pause-0",
      "word-25",
      "word-29",
      "pause-1",
      "word-28",
      "pause-2",
      "word-39",
    ],
  );
  assert.equal(CLIP_WORDS[29].text, "and", "the restart points at its second copy's first word");
  assert.equal(CLIP_WORDS[1].text, "so,", "a cluster points at its first filler");
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

test("the sample take: the clean stretch first, then two filler rows", () => {
  const map = rowsFor(SAMPLE.transcript, SAMPLE.metrics);
  assert.equal(map.height, 316);
  assert.deepEqual(
    map.rows.map((row) => [row.kind, row.time, row.cardTop, row.railY, row.railEnd, row.target]),
    [
      ["clean", 1.794, 0, 0, 151.6, "word-0"],
      ["filler", 15.559, 108, 151.6, 151.6, "word-30"],
      ["filler", 23.571, 216, 239.8, 239.8, "word-52"],
    ],
  );
  assert.deepEqual(map.rows[1].words, ["um", "like", "you know"]);
  assert.equal(
    contextText(map.rows[1].context),
    "…the beans coarsely. [Um,] [like,] [you] [know,] fine powder makes…",
    "both words of “you know” are marked",
  );
  assert.deepEqual(map.rows[2].words, ["uh", "uh"]);
});

test("a block on the rail is at least 10px tall and never runs past the rail", () => {
  const words = timed("We win. The plan works today.");
  words[5].start += 100;
  words[5].end += 100;
  const map = rowsFor(words, { pauses: [[words[3].end, 0.05], [words[4].end, 100]], repeats: [] });
  const pause = map.rows.find((row) => row.kind === "pause");
  assert.ok(pause, "the 0.05 s mid-sentence pause is counted");
  const blockHeight = Math.round((pause.railEnd - pause.railY) * 10) / 10;
  assert.equal(blockHeight, 10, "a 0.05 s pause still shows");
  const long = map.rows.find((row) => row.kind === "long-pause");
  assert.ok(long.railEnd > long.railY + 100, "the 100 s pause holds most of the rail");
  assert.ok(long.railEnd <= map.height, "and never runs past it");
});

test("a long pause is its own kind, a pause before the first word has no word", () => {
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
  const pause = first.rows.find((row) => row.kind === "pause");
  assert.equal(pause.afterWord, "Hi");
  assert.equal(contextText(pause.context), "Hi [2.6 s] there");
  const silent = rowsFor(twoWords, { pauses: [[0.2, 0.7]], repeats: [] });
  assert.ok(!silent.rows.some((row) => row.kind === "pause"), "not counted before the first word");
});

test("a restart without a second copy in the words keeps the repeat's own text", () => {
  const words = timed("We need a plan that works today and every day.");
  const map = rowsFor(words, { pauses: [], repeats: [{ text: "We need", at: 0 }] });
  const restart = map.rows.find((row) => row.kind === "restart");
  assert.equal(restart.phrase, "We need");
  assert.equal(restart.target, "word-0", "the word at its at");
  assert.equal(contextText(restart.context), "[We] need a…");
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

// The DOM half: show() against the fake document. `byId` registers elements getElementById
// should find, as a transcript mark the Show button scrolls to.
async function showSession(session, byId, announcements) {
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(byId),
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  if (announcements) {
    context.app.ui.announce = (text) => announcements.push(text);
  }
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

function mapBodyOf(body) {
  return byClass(stageOf(body), "speech-map__body");
}

function momentsOf(body) {
  return byClass(mapBodyOf(body), "speech-map__moments");
}

function railOf(body) {
  return mapBodyOf(body).children.find((node) => node.getAttribute("class") === "speech-map__rail");
}

const CLEAN_LINE = "Without a filler, pause or restart.";
const PAUSE_0 = "pause-0";
const PAUSE_2 = "pause-2";

// [kind, head text, context text, button target] for one card.
function cardShape(row) {
  const [card] = row.children;
  const [head, context, button] = card.children;
  return [
    row.className.replace("moment moment--", ""),
    head.children.map((part) => part.textContent).join(" "),
    fullText(context),
    button ? button.getAttribute("data-target") : null,
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
    "p.speech-map__cap speech-map__cap--start",
    "div.speech-map__body",
    "p.speech-map__cap speech-map__cap--end",
  ]);
  assert.deepEqual(mapBodyOf(body).children.map(outline), [
    "svg.speech-map__rail",
    "ol.speech-map__moments",
  ]);
});

test("a take without words has no map", async () => {
  const body = await showSession({ ...CLIP_SESSION, transcript: [] });
  assert.equal(byClass(body, "speech-map"), undefined);
});

test("the list is labelled with the take's sums and counts its cards as items", async () => {
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

test("the caps name the first and last word with their clocks, a ring on the rail", async () => {
  const stage = stageOf(await showSession(CLIP_SESSION));
  const [start, , end] = stage.children;
  for (const cap of [start, end]) {
    assert.deepEqual(cap.children.map(outline), [
      "span.speech-map__ring",
      "span.speech-map__cap-text",
    ]);
    assert.equal(cap.children[0].getAttribute("aria-hidden"), "true");
    assert.equal(cap.children[1].children[0].className, "num");
  }
  assert.equal(fullText(start), "0:01 · First word");
  assert.equal(fullText(end), "0:32 · Last word");
});

test("every card is its head, context and button; the head is clock then kind", async () => {
  const list = momentsOf(await showSession(CLIP_SESSION));
  list.children.forEach((row) => {
    assert.deepEqual(row.children.map(outline), ["div.moment__card"]);
    const [card] = row.children;
    assert.deepEqual(card.children.map(outline), [
      "p.moment__head",
      "p.moment__context",
      "button.moment__show",
    ]);
    assert.deepEqual(card.children[0].children.map(outline), [
      "span.moment__time num",
      "span.moment__kind",
    ]);
    const button = card.children[2];
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.textContent, "Show in transcript");
  });
  assert.deepEqual(list.children.map(cardShape), [
    ["filler", "0:01 4 fillers", "Hey, so, um, basically, um, m my day's…", "word-1"],
    ["clean", "0:05 to 0:10 Clean stretch · 4.9 s", CLEAN_LINE, "word-5"],
    ["filler", "0:10 Filler", "…is 10:21 PM. Um, I like to…", "word-16"],
    ["pause", "0:14 Mid-sentence pause · 1.5 s", "…I play piano, 1.5 s um, and I,…", PAUSE_0],
    ["filler", "0:16 Filler", "…I play piano, um, and I, uh,…", "word-25"],
    ["restart", "0:16 Restart", "…piano, um, and I, uh, and I, um, studying…", "word-29"],
    ["pause", "0:16 Mid-sentence pause · 2.5 s", "…um, and I, 2.5 s uh, and I,…", "pause-1"],
    ["filler", "0:19 2 fillers", "…um, and I, uh, and I, um, studying for a…", "word-28"],
    ["pause", "0:20 Mid-sentence pause · 2.2 s", "…and I, um, 2.2 s studying for a…", PAUSE_2],
    [
      "filler",
      "0:26 3 fillers",
      "…quiz right now. Uh, in statistics and, um, AP statistics. Uh, yeah.",
      "word-39",
    ],
  ]);
});

test("a card marks its moment in the transcript's own classes; plain words stay text", async () => {
  const list = momentsOf(await showSession(CLIP_SESSION));
  const contextOf = (index) => list.children[index].children[0].children[1];
  const marks = (node) => node.children.filter((child) => child.nodeType !== 3);
  assert.deepEqual(
    marks(contextOf(0)).map((mark) => [mark.className, mark.textContent]),
    [
      ["tok tok--filler", "so,"],
      ["tok tok--filler", "um,"],
      ["tok tok--filler", "basically,"],
      ["tok tok--filler", "um,"],
    ],
  );
  assert.deepEqual(
    marks(contextOf(3)).map((mark) => [mark.className, mark.textContent]),
    [["tok--pause num", "1.5 s"]],
  );
  assert.deepEqual(
    marks(contextOf(5)).map((mark) => mark.className),
    Array(5).fill("tok tok--restart"),
  );
  const plain = contextOf(3).children.filter((child) => child.nodeType === 3);
  assert.equal(plain.map((node) => node.textContent).join(""), "…I play piano,  um, and I,…");
  assert.equal(fullText(contextOf(3)), "…I play piano, 1.5 s um, and I,…");
  assert.equal(marks(contextOf(1)).length, 0, "the clean stretch's line is plain text");
});

test("the rail is an SVG as tall as the stack: the line, each elbow, each mark", async () => {
  const body = await showSession(CLIP_SESSION);
  const rail = railOf(body);
  assert.equal(rail.namespaceURI, SVG_NS);
  assert.equal(rail.getAttribute("aria-hidden"), "true");
  assert.equal(rail.getAttribute("width"), "56");
  assert.equal(rail.getAttribute("height"), "1072");
  assert.equal(rail.getAttribute("viewBox"), "0 0 56 1072");
  const names = rail.children.map((node) => node.tagName + "." + node.getAttribute("class"));
  const kinds = [
    "filler",
    "clean",
    "filler",
    "pause",
    "filler",
    "restart",
    "pause",
    "filler",
    "pause",
    "filler",
  ];
  const markTags = { filler: "circle", clean: "rect", pause: "rect", restart: "rect" };
  assert.deepEqual(names, [
    "line.speech-map__line",
    ...kinds.map((kind) => "path.speech-map__elbow speech-map__elbow--" + kind),
    ...kinds.map((kind) => markTags[kind] + ".speech-map__mark speech-map__mark--" + kind),
  ]);
  rail.children.forEach((node) => {
    assert.equal(node.namespaceURI, SVG_NS);
    for (const name of ["fill", "stroke"]) {
      const value = node.getAttribute(name);
      assert.ok(value === null || value === "none" || /^var\(--[a-z-]+\)$/.test(value), value);
    }
  });
  const line = rail.children[0];
  assert.deepEqual(
    ["x1", "y1", "x2", "y2", "stroke", "stroke-width"].map((name) => line.getAttribute(name)),
    ["24", "0", "24", "1072", "var(--border)", "2"],
  );
});

test("an elbow runs from the second to a lane, down it to the card, then across", async () => {
  const rail = railOf(await showSession(CLIP_SESSION));
  const elbows = rail.children.filter((node) => node.tagName === "path");
  assert.deepEqual(
    elbows.map((path) => path.getAttribute("d")),
    [
      "M24 15.1 H40 V50 H56",
      "M24 143.9 H40 V158 H56",
      "M24 314.4 H40 V266 H56",
      "M24 460.6 H40 V374 H56",
      "M24 513.7 H40 V482 H56",
      "M24 528.2 H40 V590 H56",
      "M24 539.9 H40 V698 H56",
      "M24 625.7 H40 V806 H56",
      "M24 667 H40 V914 H56",
      "M24 861 H40 V1022 H56",
    ],
  );
  elbows.forEach((path) => {
    assert.equal(path.getAttribute("fill"), "none");
    assert.equal(path.getAttribute("stroke-width"), "2");
  });
  assert.deepEqual(
    elbows.map((path) => path.getAttribute("stroke")),
    [
      "var(--filler)",
      "var(--ok)",
      "var(--filler)",
      "var(--pause)",
      "var(--filler)",
      "var(--pause)",
      "var(--pause)",
      "var(--filler)",
      "var(--pause)",
      "var(--filler)",
    ],
  );
});

test("marks: a filler's dot, a restart's diamond, a block as long as a pause or run", async () => {
  const rail = railOf(await showSession(CLIP_SESSION));
  const marks = rail.children.filter((node) => /speech-map__mark/.test(node.getAttribute("class")));
  const [dot, clean, , pause, , restart] = marks;
  assert.deepEqual(
    ["cx", "cy", "r", "fill"].map((name) => dot.getAttribute(name)),
    ["24", "15.1", "5", "var(--filler)"],
  );
  assert.deepEqual(
    ["x", "y", "width", "height", "rx", "fill", "stroke", "stroke-width"].map((name) =>
      clean.getAttribute(name),
    ),
    ["19", "143.9", "10", "170.5", "5", "var(--ok-bg)", "var(--ok)", "2"],
  );
  assert.deepEqual(
    ["x", "y", "width", "height", "fill"].map((name) => pause.getAttribute(name)),
    ["19", "460.6", "10", "53.1", "var(--pause)"],
  );
  assert.deepEqual(
    ["x", "y", "width", "height", "transform", "fill"].map((name) => restart.getAttribute(name)),
    ["19", "523.2", "10", "10", "rotate(45 24 528.2)", "var(--pause)"],
  );
});

test("a long pause's block, elbow and card take the long-pause colour", async () => {
  // Six seconds of silence after "win.", then the rest of the sentence.
  const words = timed("We win. The plan works today.").map((word, index) =>
    index < 2 ? word : { ...word, start: word.start + 6, end: word.end + 6 },
  );
  const session = { ...CLIP_SESSION, transcript: words, metrics: { pauses: [[words[1].end, 6]] } };
  const body = await showSession(session);
  const rail = railOf(body);
  const block = rail.children.find(
    (node) => node.getAttribute("class") === "speech-map__mark speech-map__mark--long-pause",
  );
  assert.equal(block.getAttribute("fill"), "var(--pause-long)");
  const elbow = rail.children.find(
    (node) => node.getAttribute("class") === "speech-map__elbow speech-map__elbow--long-pause",
  );
  assert.equal(elbow.getAttribute("stroke"), "var(--pause-long)");
  const [row] = momentsOf(body).children;
  assert.deepEqual(cardShape(row), [
    "long-pause",
    "0:00 Long pause · 6.0 s",
    "We win. 6.0 s The plan works…",
    "pause-0",
  ]);
  const mark = row.children[0].children[1].children.find((child) => child.nodeType !== 3);
  assert.equal(mark.className, "tok--pause tok--pause-long num");
});

test("Show in transcript scrolls to the mark, flashes it, focuses it and says so", async () => {
  const mark = new FakeElement("span");
  mark.className = "tok tok--filler";
  const calls = [];
  mark.scrollIntoView = (options) => calls.push(["scroll", options]);
  mark.focus = (options) => calls.push(["focus", options]);
  const said = [];
  const body = await showSession(CLIP_SESSION, { "word-16": mark }, said);
  const button = momentsOf(body).children[2].children[0].children[2];
  assert.equal(button.getAttribute("data-target"), "word-16");
  button.click();
  assert.deepEqual(plain(calls), [
    ["scroll", { block: "center", behavior: "smooth" }],
    ["focus", { preventScroll: true }],
  ]);
  assert.equal(mark.getAttribute("tabindex"), "-1");
  assert.ok(mark.classList.contains("tok--shown"), "the flash is on");
  assert.deepEqual(said, ["Shown in transcript."]);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.ok(!mark.classList.contains("tok--shown"), "and off again after 1.5 s");
});

test("Show in transcript does nothing when the document has no such mark", async () => {
  const said = [];
  const body = await showSession(CLIP_SESSION, {}, said);
  const button = momentsOf(body).children[0].children[0].children[2];
  assert.doesNotThrow(() => button.click());
  assert.deepEqual(said, []);
});

test("the transcript's words and pause markers carry the ids the cards point at", async () => {
  const body = await showSession(CLIP_SESSION);
  const spans = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  const ids = spans.map((span) => span.getAttribute("id"));
  assert.equal(ids[0], "word-0");
  assert.equal(spans[1].textContent, "so,");
  assert.equal(ids[1], "word-1");
  const pauses = spans.filter((span) => span.classList.contains("tok--pause"));
  assert.deepEqual(
    pauses.map((span) => span.getAttribute("id")),
    ["pause-0", "pause-1", "pause-2"],
  );
  const words = spans.filter((span) => span.classList.contains("tok"));
  assert.deepEqual(
    words.map((span) => span.getAttribute("id")),
    words.map((_, index) => "word-" + index),
    "every word, marked or plain, in order",
  );
  const targets = momentsOf(body).children.map(
    (row) => row.children[0].children[2].getAttribute("data-target"),
  );
  targets.forEach((target) => assert.ok(ids.includes(target), target + " exists"));
});

test("the sample take's map: label, cards and the rail's height", async () => {
  const body = await showSession(SAMPLE_SESSION);
  const list = momentsOf(body);
  assert.equal(
    list.getAttribute("aria-label"),
    "Speech map from 0:01 to 0:30: 5 fillers, no mid-sentence pauses, " +
      "a 13.8 second clean stretch",
  );
  assert.deepEqual(list.children.map(cardShape), [
    ["clean", "0:01 to 0:15 Clean stretch · 13.8 s", CLEAN_LINE, "word-0"],
    [
      "filler",
      "0:15 3 fillers",
      "…the beans coarsely. Um, like, you know, fine powder makes…",
      "word-30",
    ],
    [
      "filler",
      "0:23 2 fillers",
      "…wait four minutes, uh, exactly. So why does this work? Uh the metal filter…",
      "word-52",
    ],
  ]);
  assert.equal(railOf(body).getAttribute("height"), "316");
  const [start, , end] = stageOf(body).children;
  assert.equal(fullText(start), "0:01 · First word");
  assert.equal(fullText(end), "0:30 · Last word");
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

test("a take that is one um still has one card and a rail one card tall", async () => {
  const um = [{ text: "um", start: 1, end: 1.4 }];
  const body = await showSession({ ...steady(1, 0.4), transcript: um });
  assert.equal(momentsOf(body).children.length, 1);
  assert.equal(railOf(body).getAttribute("height"), "100");
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

test("every card is 100px tall with --s-2 between two, so the rail matches the stack", () => {
  assert.equal(rule(".moment").height, "calc(var(--s-7) * 2 + var(--s-1))", "48 * 2 + 4");
  assert.equal(rule(".moment + .moment")["margin-top"], "var(--s-2)");
  const card = rule(".moment__card");
  assert.equal(card.height, "100%");
  assert.equal(card.display, "grid");
  assert.equal(card["grid-template-rows"], "auto minmax(0, 1fr) auto");
  const list = rule(".speech-map__moments");
  assert.equal(list["list-style"], "none");
  assert.equal(list.margin, "0 0 0 calc(var(--s-7) + var(--s-2))", "past the 56px rail");
  const rail = rule(".speech-map__rail");
  assert.equal(rail.position, "absolute");
  assert.equal(rail.top, "0");
  assert.equal(rail.left, "0");
  assert.equal(rule(".speech-map__body").position, "relative");
});

test("the card carries its moment's colour on its edge and its kind; the context clamps", () => {
  const card = rule(".moment__card");
  assert.equal(card.background, "var(--surface)");
  assert.equal(card.border, "1px solid var(--border)");
  assert.equal(card["border-left-width"], "4px");
  assert.equal(card["border-radius"], "var(--r-card)");
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
  const head = rule(".moment__head");
  assert.equal(head["font-size"], "var(--fs-micro)");
  assert.equal(head["white-space"], "nowrap");
  assert.equal(rule(".moment__time").color, "var(--muted)");
  const context = rule(".moment__context");
  assert.equal(context["font-size"], "var(--fs-small)");
  assert.equal(context["-webkit-line-clamp"], "2");
  assert.equal(context.overflow, "hidden");
  assert.equal(context["overflow-wrap"], "anywhere");
});

test("Show in transcript is a 44px quiet control; the flash respects reduced motion", () => {
  const show = rule(".moment__show");
  assert.equal(show["min-height"], "44px");
  assert.equal(show.padding, "var(--s-3) 0");
  assert.equal(show.margin, "calc(-1 * var(--s-3)) 0");
  assert.equal(show.color, "var(--accent)");
  assert.equal(show.background, "none");
  const shown = rule(".tok--shown");
  assert.equal(shown.outline, "3px solid var(--accent)");
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const base = css.match(/\.tok--shown\s*\{([^}]*)\}/)[1];
  assert.ok(!base.includes("animation"), "no animation outside the motion query");
  const motion = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(motion !== -1);
  const block = css.slice(motion, css.indexOf("@keyframes tok-shown"));
  assert.match(block, /\.tok--shown\s*\{\s*animation: tok-shown 1\.5s ease-in-out;\s*\}/);
});

test("the caps are micro, muted rings on the rail's x", () => {
  const cap = rule(".speech-map__cap");
  assert.equal(cap["font-size"], "var(--fs-micro)");
  assert.equal(cap.color, "var(--muted)");
  assert.equal(cap["padding-left"], "calc(var(--s-5) - var(--s-3) / 2)", "centred on 24px");
  const ring = rule(".speech-map__ring");
  assert.equal(ring["border-radius"], "50%");
  assert.equal(ring.border, "2px solid var(--muted)");
  assert.equal(rule("#screen-results")["font-variant-numeric"], "tabular-nums");
});
