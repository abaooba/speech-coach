// Tests for the edges of the rank card in frontend/rankcard.js (docs/PLAN.md T37; the build spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 11 and its tier spec, sections 4, 9 and
// 10): the values where one step either way changes what the card says.
// - The gate. rankcard.js keeps its own copy of rank.js's Flawless bar (2 minutes or more, 97 or
//   more, no long pause), since it reads rank.js only through takeScore, rating, tier, streak and
//   TIERS. At each edge of that bar the pills must agree with the tier rank.js names, so the two
//   copies cannot drift apart unnoticed.
// - The projection. "One 2-minute take scoring 79 or more reaches Varsity." is a promise: one
//   more take of that length at that score reaches the tier, and one point lower does not. The
//   takes it asks rank.js about are exactly 2 or 3 minutes long.
// - The change line: what a screen reader hears around "No change" and "Down", and the new tier
//   on a line whose rating did not move.
// ui.js, rank.js and rankcard.js run for real against the shared fake DOM. app.screens.results is
// a stub, as in rankcard_model.test.js: summarize hands back each take's report, a clean take
// whose pace sits (100 - score) x 5 wpm above the default band, so rank.js's own takeScore gives
// exactly the score a test names.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = { ui: read("ui.js"), rank: read("rank.js"), rankCard: read("rankcard.js") };

const DEFAULT_BAND = [140, 160];
const WPM_PER_POINT = 5;
const SECONDS_PER_MINUTE = 60;
const GATE_RULE = "2 minutes or more, 97 or more, no long pause.";

// A stored take on day `day` of October 2026 at local noon that scores `score` over `seconds`.
// Each long pause costs rank.js 3 errors on top, so a take with one scores less than `score`.
function takeOf(id, day, score, seconds = 120, longPauses = 0) {
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T12:00:00",
    passageId: "free-talk",
    passageTitle: "Your day",
    report: {
      speakingSeconds: seconds,
      fillerCount: 0,
      repeatCount: 0,
      midSentencePauseCount: 0,
      longPauseCount: longPauses,
      misreads: [],
      skips: [],
      wordsPerMinute: DEFAULT_BAND[1] + (100 - score) * WPM_PER_POINT,
    },
  };
}

// `count` perfect 3-minute takes, p0, p1, ..., one a day from day `firstDay`.
function perfectTakes(count, firstDay = 1) {
  return Array.from({ length: count }, (_, index) =>
    takeOf("p" + index, firstDay + index, 100, 180),
  );
}

// One 2-minute 50 rates 44.0, a Contender.
const FIFTY = takeOf("fifty", 1, 50);

// Ten perfect 3-minute takes rate 100, every one passing the bar: Flawless. Then a perfect take
// of only 100 s keeps the rating at 100 but fails the bar: Master.
const FLAWLESS_THEN_SHORT = [...perfectTakes(10), takeOf("short", 11, 100, 100)];

// ui.js, rank.js and rankcard.js in one context, in index.html's order, with the stub results.
function load() {
  const results = {
    summarize: (take) => ({ report: take.report, target: [...DEFAULT_BAND] }),
    isSample: () => false,
  };
  const context = { app: { screens: { results } }, document: fakeDocument() };
  for (const name of ["ui", "rank", "rankCard"]) {
    vm.runInNewContext(SOURCES[name], context, { filename: name + ".js" });
  }
  return context.app;
}

// The model as plain data: objects built inside the vm context carry its own prototypes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function progressOf(takes) {
  const options = { screen: "progress", today: "2026-10-20T12:00:00" };
  return plain(load().rankCard.model(takes, options));
}

function resultsOf(takes, takeId) {
  return plain(load().rankCard.model(takes, { screen: "results", takeId }));
}

// Nine perfect 3-minute takes, then `last`. Every case below rates 99 or more, so rank.js names
// the tier Flawless exactly when all ten takes pass its bar, and Master when one does not.
function nineThen(last) {
  return [...perfectTakes(9), last];
}

// [the newest take's edge, the take, whether it passes the bar]
const GATE_EDGES = [
  ["a score of exactly 97", takeOf("edge", 10, 97, 180), true],
  ["a score of 96.9", takeOf("edge", 10, 96.9, 180), false],
  ["exactly 2 minutes", takeOf("edge", 10, 100, 120), true],
  ["119.9 s", takeOf("edge", 10, 100, 119.9), false],
  // Half an hour with one long pause still scores 98.5: the pause alone fails it.
  ["a long pause", takeOf("edge", 10, 100, 1800, 1), false],
];

test("at each edge of the Flawless bar the gate's pills agree with rank.js's tier", () => {
  for (const [edge, last, passes] of GATE_EDGES) {
    const model = progressOf(nineThen(last));
    assert.ok(model.rating >= 99, edge + ": the rating alone reaches Flawless's floor");
    assert.equal(
      model.gate.pills.every(Boolean),
      model.tier === "Flawless",
      edge + ": the pills and rank.js's tier agree",
    );
    assert.equal(model.tier, passes ? "Flawless" : "Master", edge);
    assert.deepEqual(model.gate.pills, [...Array(9).fill(true), passes], edge);
    assert.equal(model.gate.passing, passes ? 10 : 9, edge);
    assert.equal(
      model.gate.text,
      passes
        ? "All of your last 10 takes pass. Each new take must too: " + GATE_RULE
        : "9 of your last 10 takes pass. Flawless needs all 10: " + GATE_RULE,
      edge,
    );
  }
});

// Ten 3-minute 87s rate 87.0. One perfect 2-minute take lifts that only to 87.9, so the promise
// that reaches Champion's 88 is a 3-minute one.
const TEN_87S = Array.from({ length: 10 }, (_, index) => takeOf("e" + index, index + 1, 87, 180));

// [takes, the Results foot for the newest]. A first 2-minute take scoring a rates
// (40 x 3 + 2a) / 5, and one more 2-minute take scoring s makes (120 + 2a + 2s) / 7, which
// reaches Varsity's 60 at s = 150 - a. 71.9 needs 78.1: a whole 79, which a projected take one
// second longer would bring down to 78. 71.1 needs 78.9: a whole 79, which a projected take one
// second shorter would push up to 80.
const PROMISES = [
  [
    [takeOf("first", 1, 71.9)],
    "This take scored 72. One 2-minute take scoring 79 or more reaches Varsity.",
  ],
  [
    [takeOf("first", 1, 71.1)],
    "This take scored 71. One 2-minute take scoring 79 or more reaches Varsity.",
  ],
  [TEN_87S, "This take scored 87. One 3-minute take scoring 97 or more reaches Champion."],
];
const PROMISE = /One ([23])-minute take scoring (\d+) or more reaches (\w+)\.$/;

// The tier after one more take, scoring `score` over `seconds`, the day after the newest take.
function tierAfter(takes, score, seconds) {
  const newest = Math.max(...takes.map((take) => Number(take.createdAt.slice(8, 10))));
  return progressOf([...takes, takeOf("next", newest + 1, score, seconds)]).tier;
}

test("a projection is kept by one take of its length and score, and missed one point lower", () => {
  for (const [takes, foot] of PROMISES) {
    assert.equal(resultsOf(takes, takes[takes.length - 1].id).foot.text, foot);
    const [, minutes, score, tier] = foot.match(PROMISE);
    const seconds = Number(minutes) * SECONDS_PER_MINUTE;
    assert.equal(tierAfter(takes, Number(score), seconds), tier, foot);
    assert.notEqual(tierAfter(takes, Number(score) - 1, seconds), tier, foot + " One point lower");
    if (minutes === "3") {
      assert.notEqual(tierAfter(takes, 100, 120), tier, foot + " Not a perfect 2-minute take");
    }
  }
});

// The takes the Results projection adds after the newest of `takes`, as rank.js is asked to rate
// them. rank.js rates the newest takes, so every projected take is dated after the newest.
function projectedTakes(takes) {
  const app = load();
  const rate = app.rank.rating;
  const newest = Math.max(...takes.map((take) => Date.parse(take.createdAt)));
  const added = [];
  app.rank.rating = (history) => {
    added.push(...history.filter((entry) => Date.parse(entry.createdAt) > newest).map(plain));
    return rate(history);
  };
  app.rankCard.model(takes, { screen: "results", takeId: takes[takes.length - 1].id });
  return added;
}

test("the projection asks rank.js about 2- and 3-minute takes only, with no long pause", () => {
  for (const [takes, foot] of PROMISES) {
    const added = projectedTakes(takes);
    const lengths = [...new Set(added.map((entry) => entry.speakingSeconds))];
    assert.deepEqual(lengths.sort((a, b) => a - b), [120, 180], foot);
    assert.deepEqual([...new Set(added.map((entry) => entry.longPauseCount))], [0], foot);
  }
});

test("a take that changes only the gate says No change and names the new tier", () => {
  const demoted = resultsOf(FLAWLESS_THEN_SHORT, "short");
  assert.equal(demoted.rating, 100);
  assert.deepEqual(demoted.change, {
    direction: "same",
    words: "No change",
    now: "Master",
    text: "No change, now Master",
  });
  // The other way: ten perfect 3-minute takes after a short one leave it eleventh back.
  const promoted = resultsOf([takeOf("short", 1, 100, 100), ...perfectTakes(10, 2)], "p9");
  assert.equal(promoted.rating, 100);
  assert.deepEqual(promoted.change, {
    direction: "same",
    words: "No change",
    now: "Flawless",
    text: "No change, now Flawless",
  });
});

// The class of an element: an SVG element keeps it in the attribute.
function classOf(node) {
  return node.className || (node.getAttribute ? node.getAttribute("class") : null) || "";
}

// The first element in the tree whose class list holds `name`.
function find(node, name) {
  if (!node.children) {
    return null;
  }
  if (classOf(node).split(" ").includes(name)) {
    return node;
  }
  for (const child of node.children) {
    const found = find(child, name);
    if (found) {
      return found;
    }
  }
  return null;
}

// What a screen reader hears from a node: its text and its children's, skipping aria-hidden.
function spoken(node) {
  if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
    return "";
  }
  return (node.textContent || "") + (node.children || []).map(spoken).join("");
}

// What the eye reads: text outside .sr-only.
function visible(node) {
  if (classOf(node).split(" ").includes("sr-only")) {
    return "";
  }
  return (node.textContent || "") + (node.children || []).map(visible).join("");
}

// The change line on the Results card for the newest of `takes`.
function changeLine(takes) {
  const app = load();
  const takeId = takes[takes.length - 1].id;
  const model = app.rankCard.model(takes, { screen: "results", takeId });
  return find(app.rankCard.build(model, { screen: "results" }), "rank-card__change");
}

test("a screen reader hears 'Rating: No change' and 'Rating Down', then 'with this take'", () => {
  // [takes, the line's direction, its icon, what the eye reads, what a screen reader hears]
  const cases = [
    // 44.0, then a 20 s 45: 44.02 still shows 44.0.
    [
      [FIFTY, takeOf("t", 2, 45, 20)],
      "same",
      "dash",
      "No change",
      "Rating: No change with this take",
    ],
    [
      FLAWLESS_THEN_SHORT,
      "same",
      "dash",
      "No change, now Master",
      "Rating: No change with this take, now Master",
    ],
    // 44.0, then a 41: 43.1.
    [
      [FIFTY, takeOf("t", 2, 41)],
      "down",
      "triangle-down",
      "Down 0.9",
      "Rating Down 0.9 with this take",
    ],
    // 44.0, then a 3-minute 0: 27.5, a Novice.
    [
      [FIFTY, takeOf("t", 2, 0, 180)],
      "down",
      "triangle-down",
      "Down 16.5, now Novice",
      "Rating Down 16.5 with this take, now Novice",
    ],
  ];
  for (const [takes, direction, icon, seen, heard] of cases) {
    const line = changeLine(takes);
    assert.equal(classOf(line), "rank-card__change rank-card__change--" + direction, seen);
    assert.equal(line.children[0].getAttribute("data-icon"), icon, seen);
    assert.equal(visible(line), seen);
    assert.equal(spoken(line), heard);
  }
});
