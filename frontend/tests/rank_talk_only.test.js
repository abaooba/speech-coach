// Tests for the talk-only rank in frontend/rankcard.js (owner decision 2026-10-22: one rank, from
// Talk takes only). A read take (app.language.isReadTake: a passage, a cold read, the benchmark
// read, or a pasted script the take followed) reads someone else's words, which hold no filler
// words to say, so it never moves the rating; it still counts toward the streak. rank.js,
// passages.js and language.js run for real; app.screens.results is a stub, as in
// rankcard_model.test.js: summarize hands back each take's report, so a clean take whose pace
// sits (100 - score) x 5 wpm above the default band scores exactly the score a test names.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

const DEFAULT_BAND = [140, 160];
const WPM_PER_POINT = 5;

const PROGRESS_NOTE = "Only Talk takes count for your rating. Read takes count for your streak.";
const UNRATED_NOTE =
  "No rating yet: it starts with your first Talk take. Read takes count for your streak.";
const READ_FOOT = "Read takes don't change your rating. Only Talk takes count.";
const READ_UNRATED_FOOT = "Read takes don't change your rating. It starts with your first Talk take.";

// A stored take on `day` of October 2026 at `hour` local time that scores `score` over
// `seconds`. `passageId` "free-talk" is a Talk prompt; "explainer-rainbows" a Read passage.
function takeOf(id, day, score, options) {
  const settings = { seconds: 120, hour: 12, passageId: "free-talk", ...(options || {}) };
  return {
    id,
    createdAt:
      "2026-10-" + String(day).padStart(2, "0") + "T" + String(settings.hour).padStart(2, "0") +
      ":00:00",
    passageId: settings.passageId,
    passageTitle: "A take",
    metrics: settings.metrics || { pauses: [] },
    report: {
      speakingSeconds: settings.seconds,
      fillerCount: 0,
      repeatCount: 0,
      midSentencePauseCount: 0,
      longPauseCount: 0,
      misreads: [],
      skips: [],
      wordsPerMinute: DEFAULT_BAND[1] + (100 - score) * WPM_PER_POINT,
    },
  };
}

function readOf(id, day, score, options) {
  return takeOf(id, day, score, { passageId: "explainer-rainbows", ...(options || {}) });
}

// One 2-minute 50 rates 44.0, a Contender: (3 imaginary minutes x 40 + 2 x 50) / 5.
const FIFTY = takeOf("fifty", 1, 50);
// Two perfect 3-minute reads. Rated like talk, FIFTY and these two would make 74.5, an Elite.
const PERFECT_READS = [
  readOf("read-a", 2, 100, { seconds: 180 }),
  readOf("read-b", 3, 100, { seconds: 180 }),
];

// Ten 2-minute talk takes that rate 38.1 (Novice): 381.2 points over ten equal takes.
const TEN_SCORES = [41, 30, 35, 41, 38, 33, 44, 36, 40, 43.2];
const TEN_TALKS = TEN_SCORES.map((score, index) => takeOf("talk" + index, index + 2, score));

// Loads passages.js, language.js (unless `withoutLanguage`), rank.js, rankcard.js and ui.js
// against the stub results. `summarized` records every take summarize is handed.
function load(options) {
  const settings = options || {};
  const summarized = [];
  const results = {
    summarize: (take) => {
      summarized.push(take.id);
      return { report: take.report, target: [...DEFAULT_BAND] };
    },
    isSample: (take) => take.passageTitle.startsWith("Sample: "),
  };
  const context = { app: { screens: { results } }, document: fakeDocument() };
  const files = ["ui.js", "passages.js", "language.js", "rank.js", "rankcard.js"];
  for (const file of files) {
    if (!(settings.withoutLanguage && file === "language.js")) {
      vm.runInNewContext(read(file), context, { filename: file });
    }
  }
  return { card: context.app.rankCard, summarized };
}

// The model as plain data: objects built inside the vm context carry its own prototypes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function progressOf(takes, today = "2026-10-20T12:00:00") {
  return plain(load().card.model(takes, { screen: "progress", today }));
}

function resultsOf(takes, takeId) {
  return plain(load().card.model(takes, { screen: "results", takeId }));
}

// --- Progress ---

test("read takes never move the Progress rating or tier", () => {
  const card = progressOf([FIFTY, ...PERFECT_READS]);
  assert.equal(card.rating, 44);
  assert.equal(card.tier, "Contender");
  assert.equal(card.next.text, "16.0 to Varsity");
});

test("a pasted script the take followed counts as read, on any prompt", () => {
  const scripted = takeOf("scripted", 2, 100, {
    seconds: 180,
    metrics: { pauses: [], script: { restarts: [], skipped: [], misread: [] } },
  });
  assert.equal(progressOf([FIFTY, scripted]).rating, 44);
});

test("the newest 10 talk takes are rated, however many reads come between them", () => {
  // An old perfect talk take falls out of the window only if the reads are left out first.
  const oldPerfect = takeOf("old-perfect", 1, 100);
  const reads = TEN_TALKS.map((talk, index) => readOf("r" + index, index + 2, 100, { hour: 18 }));
  const card = progressOf([oldPerfect, ...TEN_TALKS, ...reads]);
  assert.equal(card.rating, 38.1);
  assert.equal(card.tier, "Novice");
});

test("the streak still counts a day with only a read take", () => {
  const card = progressOf([FIFTY, ...PERFECT_READS], "2026-10-03T20:00:00");
  assert.equal(card.foot.text, "Current streak 3 days, longest 3");
});

test("with read takes the card says what the rating counts; with none it says nothing new", () => {
  assert.equal(progressOf([FIFTY, ...PERFECT_READS]).note, PROGRESS_NOTE);
  assert.equal(progressOf([FIFTY]).note, null);
});

test("with read takes only, the card has no rating yet: the note and the streak", () => {
  const card = progressOf(PERFECT_READS, "2026-10-03T20:00:00");
  assert.equal(card.tier, null);
  assert.equal(card.rating, null);
  assert.equal(card.ladder, null);
  assert.equal(card.note, UNRATED_NOTE);
  assert.equal(card.foot.text, "Current streak 2 days, longest 2");
  assert.equal(progressOf([]), null, "no take at all still has no card");
});

test("only the talk takes the rating reads are summarized", () => {
  const { card, summarized } = load();
  const reads = TEN_TALKS.map((talk, index) => readOf("r" + index, index + 2, 100, { hour: 18 }));
  card.model([takeOf("old", 1, 100), ...TEN_TALKS, ...reads], {
    screen: "progress",
    today: "2026-10-20T12:00:00",
  });
  assert.deepEqual(
    summarized,
    TEN_TALKS.map((talk) => talk.id),
  );
});

// --- Results ---

test("a talk take's change is measured against the talk takes before it, reads left out", () => {
  const seventyTwo = takeOf("seventy-two", 12, 72);
  const reads = TEN_TALKS.map((talk, index) => readOf("r" + index, index + 2, 100, { hour: 18 }));
  const card = resultsOf([...TEN_TALKS, ...reads, seventyTwo], "seventy-two");
  assert.equal(card.change.text, "Up 3.1, now Contender");
  assert.equal(card.rating, 41.2);
  assert.ok(card.foot.text.startsWith("This take scored 72."), card.foot.text);
});

test("a read take's card shows the rating as it stood, with no change line", () => {
  const card = resultsOf([FIFTY, ...PERFECT_READS], "read-a");
  assert.equal(card.tier, "Contender");
  assert.equal(card.rating, 44);
  assert.equal(card.change, null);
  assert.equal(card.notch, null);
  assert.equal(card.foot.text, READ_FOOT);
  assert.equal(card.foot.icon, null);
});

test("a read take before any talk take gets the card with no rating yet", () => {
  const card = resultsOf([readOf("first-read", 1, 100), FIFTY], "first-read");
  assert.equal(card.tier, null);
  assert.equal(card.rating, null);
  assert.equal(card.change, null);
  assert.equal(card.note, null);
  assert.equal(card.foot.text, READ_UNRATED_FOOT);
});

test("a read take's card summarizes only the talk takes before it", () => {
  const { card, summarized } = load();
  card.model([FIFTY, ...PERFECT_READS, takeOf("later-talk", 4, 60)], {
    screen: "results",
    takeId: "read-b",
  });
  assert.deepEqual(summarized, ["fifty"]);
});

// --- The drawn card ---

function classesOf(section) {
  return section.children.map((child) => child.className);
}

test("Progress draws the note between the ladder and the streak", () => {
  const { card } = load();
  const model = card.model([FIFTY, ...PERFECT_READS], {
    screen: "progress",
    today: "2026-10-03T20:00:00",
  });
  const section = card.build(model, { screen: "progress" });
  assert.deepEqual(classesOf(section), [
    "sr-only",
    "rank-card__body",
    "rank-card__note",
    "rank-card__foot",
  ]);
  assert.equal(section.children[2].textContent, PROGRESS_NOTE);
});

test("the card with no rating yet draws only its heading, the note and the streak", () => {
  const { card } = load();
  const model = card.model(PERFECT_READS, { screen: "progress", today: "2026-10-03T20:00:00" });
  const section = card.build(model, { screen: "progress" });
  assert.equal(section.className, "rank-card rank-card--unrated");
  assert.deepEqual(classesOf(section), ["sr-only", "rank-card__note", "rank-card__foot"]);
  assert.equal(section.children[0].textContent, "Your rank");
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

test("the note reads like the gate's sentence: small, muted, a step above the foot", () => {
  assert.deepEqual(declarations(".rank-card__note"), {
    margin: "var(--s-3) 0 0",
    "font-size": "var(--fs-small)",
    "line-height": "1.4",
    color: "var(--muted)",
  });
});

test("with no rating yet the first line under the hidden heading sits flush with the padding", () => {
  assert.deepEqual(declarations(".rank-card--unrated > :nth-child(2)"), { "margin-top": "0" });
});

test("a read take on Results draws the rating as it stood and the read sentence", () => {
  const { card } = load();
  const model = card.model([FIFTY, ...PERFECT_READS], { screen: "results", takeId: "read-a" });
  const section = card.build(model, { screen: "results" });
  assert.deepEqual(classesOf(section), ["sr-only", "rank-card__body", "rank-card__foot"]);
  const stats = section.children[1].children[0];
  assert.ok(
    !stats.children.some((child) => child.className.startsWith("rank-card__change")),
    "no change line",
  );
});
