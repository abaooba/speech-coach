// Tests for app.rankCard.model in frontend/rankcard.js: everything the rank card "ladder and
// lens" shows (docs/PLAN.md T37; the build spec docs/superpowers/specs/2026-10-14-loop-path.md
// section 11 and its tier spec, sections 7 to 9). rank.js runs for real. app.screens.results is
// a stub: summarize hands back each take's report, and isSample reads the "Sample: " title as
// results.js does. A report is a clean take whose pace sits (100 - score) x 5 wpm above the
// default band, so rank.js's own takeScore gives exactly the score a test names.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const RANK_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "rank.js"), "utf8");
const CARD_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "rankcard.js"), "utf8");

const DEFAULT_BAND = [140, 160];
const WPM_PER_POINT = 5;
const SAMPLE_PREFIX = "Sample: ";

// The tiers best first, as the ladder lists them.
const LADDER_NAMES = ["Flawless", "Master", "Champion", "Elite", "Varsity", "Contender", "Novice"];
const LADDER_FLOORS = [99, 96, 88, 75, 60, 40, 0];
// Each tier's slice of the 0 to 100 ruler, lowest first.
const SLICES = [
  [0, 40],
  [40, 60],
  [60, 75],
  [75, 88],
  [88, 96],
  [96, 99],
  [99, 100],
];

const GATE_RULE = "2 minutes or more, 97 or more, no long pause.";

// A stored take on day `day` of October 2026 at local noon (rank.js counts streak days on the
// local calendar) that scores `score` over `seconds`. Each long pause costs rank.js 3 errors on
// top, so a take with one scores less than `score`.
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

function sampleOf(id, day) {
  return { ...takeOf(id, day, 100, 180), passageTitle: SAMPLE_PREFIX + "Congress" };
}

// The owner's two real takes from 2026-10-11 (rank.test.js): 33.5 and 48.0, a 39.8 rating.
const CHURCH = {
  ...takeOf("church", 10, 0),
  report: {
    speakingSeconds: 61.764,
    fillerCount: 3,
    repeatCount: 1,
    midSentencePauseCount: 0,
    longPauseCount: 1,
    misreads: [],
    skips: [],
    wordsPerMinute: 142.8,
  },
};
const UNIFORMS = {
  ...takeOf("uniforms", 11, 0),
  report: {
    speakingSeconds: 42.882,
    fillerCount: 2,
    repeatCount: 1,
    midSentencePauseCount: 0,
    longPauseCount: 0,
    misreads: [],
    skips: [],
    wordsPerMinute: 159.5,
  },
};
const OWNER = [CHURCH, UNIFORMS];

// Ten 2-minute takes that rate 38.1 (Novice), then a 72 that lifts the rating to 41.2.
const BEFORE_A_72 = [41, 30, 35, 41, 38, 33, 44, 36, 40, 43.2].map((score, index) =>
  takeOf("b" + index, index + 1, score),
);
const AFTER_A_72 = [...BEFORE_A_72, takeOf("seventy-two", 11, 72)];

// `count` perfect 3-minute takes, one a day: 1 rates 70, 2 rate 80, 5 rate 90, 9 rate 97.9.
function perfectTakes(count) {
  return Array.from({ length: count }, (_, index) => takeOf("p" + index, index + 1, 100, 180));
}

// Ten 3-minute takes, seven at 100 and three at 97.7: every one passes the gate, a 99.3 rating.
const FLAWLESS = Array.from({ length: 10 }, (_, index) =>
  takeOf("f" + index, index + 1, index < 7 ? 100 : 97.7, 180),
);

// One 2-minute 50 rates 44.0, a Contender.
const FIFTY = takeOf("fifty", 1, 50);

// Loads rank.js (unless `withoutRank`) and rankcard.js into one context with the stub results.
// `summarized` records every take summarize is handed.
function load(options) {
  const settings = options || {};
  const summarized = [];
  const results = {
    summarize: (take) => {
      summarized.push(take);
      return { report: take.report, target: [...DEFAULT_BAND] };
    },
    isSample: (take) =>
      typeof take.passageTitle === "string" && take.passageTitle.startsWith(SAMPLE_PREFIX),
  };
  const context = { app: { screens: { results } } };
  if (!settings.withoutRank) {
    vm.runInNewContext(RANK_SOURCE, context, { filename: "rank.js" });
  }
  if (settings.wrapRank) {
    context.app.rank = settings.wrapRank(context.app.rank);
  }
  vm.runInNewContext(CARD_SOURCE, context, { filename: "rankcard.js" });
  return { context, app: context.app, card: context.app.rankCard, summarized };
}

// The model as plain data: objects built inside the vm context carry its own prototypes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function progressOf(takes, today = "2026-10-20T12:00:00") {
  const { card } = load();
  return plain(card.model(takes, { screen: "progress", today }));
}

function resultsOf(takes, takeId) {
  const { card } = load();
  return plain(card.model(takes, { screen: "results", takeId }));
}

// The ladder's expected rows, best first, for the speaker's tier `name`: every tier below it is
// passed and every tier above it ahead.
function ladderFor(name) {
  const current = LADDER_NAMES.indexOf(name);
  return LADDER_NAMES.map((tier, row) => ({
    name: tier,
    floor: LADDER_FLOORS[row],
    state: row > current ? "passed" : row === current ? "current" : "ahead",
    top: row === 0,
  }));
}

// The ruler's expected slices, lowest first, with the speaker's tier `name` marked current.
function slicesFor(name) {
  const current = SLICES.length - 1 - LADDER_NAMES.indexOf(name);
  return SLICES.map(([floor, ceiling], index) => ({ floor, ceiling, current: index === current }));
}

test("rankcard.js assigns app.rankCard with a model function and no other global", () => {
  const { context, app, card } = load();
  assert.deepEqual(Object.keys(context), ["app"]);
  assert.deepEqual(Object.keys(app).sort(), ["rank", "rankCard", "screens"]);
  assert.equal(typeof card.model, "function");
});

test("there is no card without rank.js, with no rated take, or with samples alone", () => {
  const withoutRank = load({ withoutRank: true }).card;
  assert.equal(withoutRank.model(OWNER, { screen: "progress", today: "2026-10-12" }), null);
  assert.equal(withoutRank.model(OWNER, { screen: "results", takeId: "uniforms" }), null);

  const { card } = load();
  for (const takes of [[], null, undefined, [null, 7, "take"], [sampleOf("s", 1)]]) {
    assert.equal(card.model(takes, { screen: "progress", today: "2026-10-12" }), null);
  }
  const undated = { ...FIFTY, createdAt: "not a date" };
  assert.equal(card.model([undated], { screen: "progress", today: "2026-10-12" }), null);
});

// [tier, takes, rating as shown, floor, ceiling, fill %, caption]. The fill is the rating's
// place between the floor and the ceiling: 39.79 of 0 to 40 is 99.49%, 41.22 of 40 to 60 is 6.1%,
// 97.86 of 96 to 99 is 61.9%, 99.31 of 99 to 100 is 31%.
const TIER_CASES = [
  ["Novice", OWNER, 39.8, 0, 40, 99.49, "0.2 to Contender"],
  ["Contender", AFTER_A_72, 41.2, 40, 60, 6.1, "18.8 to Varsity"],
  ["Varsity", perfectTakes(1), 70, 60, 75, 66.67, "5.0 to Elite"],
  ["Elite", perfectTakes(2), 80, 75, 88, 38.46, "8.0 to Champion"],
  ["Champion", perfectTakes(5), 90, 88, 96, 25, "6.0 to Master"],
  ["Master", perfectTakes(9), 97.9, 96, 99, 61.9, "1.1 to Flawless"],
  ["Flawless", FLAWLESS, 99.3, 99, 100, 31, "Top tier"],
];

test("every tier has its bar range, fill, caption, ruler slice and ladder states", () => {
  for (const [tier, takes, rating, floor, ceiling, fill, caption] of TIER_CASES) {
    const model = progressOf(takes);
    assert.equal(model.tier, tier);
    assert.equal(model.rating, rating, tier + " rating");
    assert.equal(model.floor, floor, tier + " floor");
    assert.equal(model.ceiling, ceiling, tier + " ceiling");
    assert.equal(model.fill, fill, tier + " fill");
    assert.equal(model.next.text, caption, tier + " caption");
    assert.deepEqual(model.slices, slicesFor(tier), tier + " slices");
    assert.deepEqual(model.ladder, ladderFor(tier), tier + " ladder");
    const current = model.ladder.filter((row) => row.state === "current");
    assert.deepEqual(current.map((row) => row.name), [tier], "exactly one current row");
  }
});

test("the caption names the points, the next tier and its floor for the hidden words", () => {
  assert.deepEqual(progressOf(AFTER_A_72).next, {
    text: "18.8 to Varsity",
    points: "18.8",
    name: "Varsity",
    floor: 60,
  });
  assert.deepEqual(progressOf(FLAWLESS).next, {
    text: "Top tier",
    points: null,
    name: null,
    floor: null,
  });
});

test("a Master at 99 whose last 10 takes do not all pass has a full bar and '99 reached'", () => {
  // Ten perfect takes, the newest only 100 s long: a 100 rating, but the gate is not met.
  const takes = perfectTakes(10);
  takes[9] = takeOf("short", 10, 100, 100);
  const model = progressOf(takes);
  assert.equal(model.tier, "Master");
  assert.equal(model.rating, 100);
  assert.equal(model.fill, 100);
  assert.equal(model.next.text, "99 reached");
  assert.equal(model.next.points, null);
  assert.deepEqual(model.gate.pills, [...Array(9).fill(true), false]);
  assert.equal(
    model.gate.text,
    "9 of your last 10 takes pass. Flawless needs all 10: " + GATE_RULE,
  );
});

test("the rating is never rounded up onto a floor its tier has not reached", () => {
  // One 2-minute 39.9 rates (120 + 79.8) / 5 = 39.96: Novice, so it shows 39.9, not 40.0.
  const model = progressOf([takeOf("close", 1, 39.9)]);
  assert.equal(model.tier, "Novice");
  assert.equal(model.rating, 39.9);
  assert.equal(model.next.text, "0.1 to Contender");
});

test("Progress has no change line and no notch; Results says what this take did", () => {
  const progress = progressOf([FIFTY, takeOf("sixty", 2, 60)]);
  assert.equal(progress.change, null);
  assert.equal(progress.notch, null);

  const results = resultsOf([FIFTY, takeOf("sixty", 2, 60)], "sixty");
  assert.deepEqual(results.change, {
    direction: "up",
    words: "Up 4.6",
    now: null,
    text: "Up 4.6",
  });
});

test("change copy: up, down, no change, promotion, demotion and the first take", () => {
  const cases = [
    // 44.0 then a 60: 340 / 7 = 48.57.
    [[FIFTY, takeOf("t", 2, 60)], { direction: "up", words: "Up 4.6", now: null }],
    // 44.0 then a 41: 302 / 7 = 43.14.
    [[FIFTY, takeOf("t", 2, 41)], { direction: "down", words: "Down 0.9", now: null }],
    // 44.0 then a 20 s 45, a quarter weight: 44.02 still shows 44.0.
    [[FIFTY, takeOf("t", 2, 45, 20)], { direction: "same", words: "No change", now: null }],
    // 38.1 then a 72: 41.2.
    [AFTER_A_72, { direction: "up", words: "Up 3.1", now: "Contender" }],
    // 44.0 then a 3-minute 0: 220 / 8 = 27.5.
    [[FIFTY, takeOf("t", 2, 0, 180)], { direction: "down", words: "Down 16.5", now: "Novice" }],
    [[takeOf("t", 1, 72)], { direction: "first", words: "First rated take", now: null }],
  ];
  const texts = [
    "Up 4.6",
    "Down 0.9",
    "No change",
    "Up 3.1, now Contender",
    "Down 16.5, now Novice",
    "First rated take",
  ];
  cases.forEach(([takes, expected], index) => {
    const newest = takes[takes.length - 1].id;
    assert.deepEqual(resultsOf(takes, newest).change, { ...expected, text: texts[index] });
  });
});

test("the notch marks the rating before this take only in the same tier, 0.1 or more away", () => {
  // 44.0 before, in Contender's 40 to 60: 20% along the bar.
  assert.equal(resultsOf([FIFTY, takeOf("t", 2, 60)], "t").notch, 20);
  // A 20 s 50 moves 44.0 to 44.098: shown 44.1, exactly 0.1 up.
  const tenth = resultsOf([FIFTY, takeOf("t", 2, 50, 20)], "t");
  assert.equal(tenth.change.words, "Up 0.1");
  assert.equal(tenth.notch, 20);
  // A 20 s 45 moves it to 44.016: shown 44.0, under 0.1.
  assert.equal(resultsOf([FIFTY, takeOf("t", 2, 45, 20)], "t").notch, null);
  // 38.1 was Novice, 41.2 is Contender: another tier, so no notch.
  assert.equal(resultsOf(AFTER_A_72, "seventy-two").notch, null);
  assert.equal(resultsOf([FIFTY], "fifty").notch, null, "a first take has nothing before it");
});

test("the Results foot gives the take's whole score and the three projections", () => {
  const foot = (takes, id) => resultsOf(takes, id).foot;
  // The owner's 39.8 needs one 2-minute 40.5, shown as 41.
  assert.deepEqual(foot(OWNER, "uniforms"), {
    icon: null,
    text: "This take scored 48. One 2-minute take scoring 41 or more reaches Contender.",
  });
  // 41.2 needs three perfect 3-minute takes to reach 60.
  assert.equal(
    foot(AFTER_A_72, "seventy-two").text,
    "This take scored 72. At least 3 more takes to Varsity, even perfect ones.",
  );
  // A first 72 rates 52.8: one 2-minute 78 makes (120 + 144 + 156) / 7 = 60.
  assert.equal(
    foot([takeOf("first", 1, 72)], "first").text,
    "This take scored 72. One 2-minute take scoring 78 or more reaches Varsity.",
  );
});

test("one take that needs over 100 in 2 minutes is projected as a 3-minute take", () => {
  // Ten 3-minute 87s rate 87.0: a perfect 2-minute take only reaches 87.9, a 3-minute 97 makes 88.
  const takes = Array.from({ length: 10 }, (_, index) => takeOf("e" + index, index + 1, 87, 180));
  assert.equal(
    resultsOf(takes, "e9").foot.text,
    "This take scored 87. One 3-minute take scoring 97 or more reaches Champion.",
  );
});

test("a Master or Flawless take gets its score and nothing more", () => {
  assert.equal(resultsOf(perfectTakes(9), "p8").foot.text, "This take scored 100.");
  // The newest Flawless take scored 97.7.
  assert.equal(resultsOf(FLAWLESS, "f9").foot.text, "This take scored 98.");
});

test("the gate shows for Master and Flawless only", () => {
  for (const [, takes] of TIER_CASES.slice(0, 5)) {
    assert.equal(progressOf(takes).gate, null);
  }
  assert.deepEqual(progressOf(FLAWLESS).gate, {
    pills: Array(10).fill(true),
    passing: 10,
    text: "All of your last 10 takes pass. Each new take must too: " + GATE_RULE,
  });
});

test("with fewer than 10 takes the gate's oldest slots stay empty", () => {
  // Nine perfect 3-minute takes rate 97.9, a Master: nine pass, one slot has no take yet.
  assert.deepEqual(progressOf(perfectTakes(9)).gate, {
    pills: [false, ...Array(9).fill(true)],
    passing: 9,
    text: "9 of your last 10 takes pass. Flawless needs all 10: " + GATE_RULE,
  });
});

test("a take passes the gate with 2 minutes, 97 or more and no long pause; oldest left", () => {
  // Every take scores 100 except the half-hour one, whose one long pause leaves it 98.5. The
  // 100 s takes are too short; the long pause fails the half-hour take. Four pass.
  const seconds = [100, 180, 100, 100, 120, 100, 180, 100, 180, 1800];
  const takes = seconds.map((length, index) =>
    takeOf("g" + index, index + 1, 100, length, length === 1800 ? 1 : 0),
  );
  const model = progressOf(takes);
  assert.equal(model.tier, "Master");
  assert.deepEqual(
    model.gate.pills,
    seconds.map((length) => length === 120 || length === 180),
  );
  assert.equal(model.gate.passing, 4);
  assert.equal(
    model.gate.text,
    "4 of your last 10 takes pass. Flawless needs all 10: " + GATE_RULE,
  );
});

test("the gate counts one take in the singular and none in words", () => {
  const short = (index) => takeOf("s" + index, index + 1, 100, 110);
  const none = Array.from({ length: 10 }, (_, index) => short(index));
  assert.equal(
    progressOf(none).gate.text,
    "None of your last 10 takes pass. Flawless needs all 10: " + GATE_RULE,
  );
  const one = [...none.slice(0, 9), takeOf("long", 10, 100, 180)];
  assert.equal(
    progressOf(one).gate.text,
    "1 of your last 10 takes passes. Flawless needs all 10: " + GATE_RULE,
  );
});

test("Progress's foot is the streak, with the flame", () => {
  const days = (list) => list.map((day) => takeOf("d" + day, day, 80));
  const streak = (list, today) => progressOf(days(list), "2026-10-" + today + "T12:00:00").foot;
  assert.deepEqual(streak([1, 2, 3, 4, 5, 11, 12, 13], 13), {
    icon: "flame",
    text: "Current streak 3 days, longest 5",
  });
  assert.equal(streak([1, 2, 3, 4, 5, 13], 13).text, "Current streak 1 day, longest 5");
  assert.equal(streak([1, 2, 3, 4, 5], 13).text, "No current streak, longest 5 days");
  assert.equal(streak([13], 14).text, "Current streak 1 day, longest 1", "alive through today");
  assert.equal(streak([5], 13).text, "No current streak, longest 1 day");
});

test("the streak counts every take, not only the 10 the rating reads", () => {
  const twelve = Array.from({ length: 12 }, (_, index) => takeOf("d" + index, index + 1, 80));
  assert.equal(
    progressOf(twelve, "2026-10-12T20:00:00").foot.text,
    "Current streak 12 days, longest 12",
  );
});

test("Results is computed from the takes up to and including the take on screen", () => {
  const takes = [FIFTY, takeOf("sixty", 2, 60), takeOf("zero", 3, 0, 180)];
  const reopened = resultsOf(takes, "sixty");
  assert.equal(reopened.rating, 48.6, "what the 60 did then, not the 34.0 the three rate now");
  assert.equal(reopened.change.text, "Up 4.6");
  assert.equal(progressOf(takes).rating, 34);
  assert.equal(resultsOf(takes, "zero").change.text, "Down 14.6, now Novice");
});

test("samples never count, and a sample's own Results has no card", () => {
  const withSample = [FIFTY, sampleOf("sample", 2), takeOf("sixty", 3, 60)];
  assert.deepEqual(progressOf(withSample), progressOf([FIFTY, takeOf("sixty", 3, 60)]));
  assert.equal(resultsOf(withSample, "sixty").change.text, "Up 4.6", "the sample is skipped");
  assert.equal(resultsOf(withSample, "sample"), null);
  assert.equal(resultsOf(withSample, "unknown"), null, "a take the list does not hold");
});

test("the takes may come in any order; the store lists them newest first", () => {
  const takes = [FIFTY, takeOf("sixty", 2, 60)];
  assert.deepEqual(progressOf([...takes].reverse()), progressOf(takes));
  assert.deepEqual(resultsOf([...takes].reverse(), "sixty"), resultsOf(takes, "sixty"));
});

test("takes are scored through results.summarize: the 10 the rating reads, and one more", () => {
  const { card, summarized } = load();
  card.model(AFTER_A_72, { screen: "results", takeId: "seventy-two" });
  assert.deepEqual(
    summarized.map((take) => take.id),
    AFTER_A_72.map((take) => take.id),
    "Results also rates the speaker before this take: the 10 before it and the take, oldest first",
  );
  summarized.length = 0;
  const twelve = perfectTakes(12);
  card.model(twelve, { screen: "progress", today: "2026-10-12" });
  assert.deepEqual(
    summarized.map((take) => take.id),
    twelve.slice(2).map((take) => take.id),
  );
});

test("the model reads the rank only through takeScore, rating, tier, streak and TIERS", () => {
  const read = new Set();
  const { card } = load({
    wrapRank: (rank) =>
      new Proxy(rank, {
        get(target, name) {
          read.add(String(name));
          return target[name];
        },
      }),
  });
  card.model(AFTER_A_72, { screen: "results", takeId: "seventy-two" });
  card.model(perfectTakes(9), { screen: "progress", today: "2026-10-12" });
  const allowed = new Set(["takeScore", "rating", "tier", "streak", "TIERS"]);
  assert.deepEqual([...read].filter((name) => !allowed.has(name)), []);
  assert.ok(read.has("takeScore") && read.has("rating") && read.has("tier"));
  assert.ok(read.has("streak") && read.has("TIERS"));
});

test("the model is pure: the same takes give the same card and are left unchanged", () => {
  const takes = JSON.parse(JSON.stringify(AFTER_A_72));
  const copy = JSON.parse(JSON.stringify(takes));
  const first = resultsOf(takes, "seventy-two");
  assert.deepEqual(resultsOf(takes, "seventy-two"), first);
  assert.deepEqual(takes, copy);
});
