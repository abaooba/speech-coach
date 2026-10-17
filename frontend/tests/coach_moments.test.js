// Tests for app.coach.coachMoments (guided coach, spec Phase 5 item 3): the take's moments in the
// shape POST /api/advice takes, found with the words and clock the speech map uses.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadCoach, spoken, plain } = require("./coach-harness");

const app = loadCoach();
const ID_PATTERN = /^(restart|filler|pause|long-pause|misread|skip|stumble|unclear)-[0-9]{1,3}$/;
const CLOCK_PATTERN = /^[0-9]{1,3}:[0-5][0-9]$/;

// A take that starts at 2 s, with an um, a restart, a mid-sentence pause and a long pause.
const WORDS = [
  ...spoken("So today I want to talk about um the few decisions", 2),
  { text: "the", start: 8, end: 8.3 },
  { text: "few", start: 8.4, end: 8.7 },
  { text: "decisions", start: 8.8, end: 9.3 },
  { text: "we", start: 10.5, end: 10.7 },
  { text: "make", start: 10.8, end: 11 },
  { text: "every", start: 18, end: 18.3 },
  { text: "day.", start: 18.4, end: 18.7 },
];
const METRICS = {
  pauses: [[11, 7]],
  repeats: [{ text: "the few decisions", at: 6 }],
};

function momentsOf(words, metrics) {
  const report = app.delivery.analyze(words, metrics);
  return { report, moments: plain(app.coach.coachMoments(report, words)) };
}

test("a take with no words has no moments", () => {
  assert.deepEqual(plain(app.coach.coachMoments(app.delivery.analyze([], {}), [])), []);
  assert.deepEqual(plain(app.coach.coachMoments(null, null)), []);
});

test("every moment has the wire shape and a valid id and clock", () => {
  const { moments } = momentsOf(WORDS, METRICS);
  assert.ok(moments.length >= 3);
  moments.forEach((moment) => {
    assert.deepEqual(
      Object.keys(moment).sort(),
      ["after", "at", "before", "clock", "expected", "hint", "id", "kind", "seconds", "text"],
    );
    assert.match(moment.id, ID_PATTERN);
    assert.equal(moment.id.replace(/-[0-9]+$/, ""), moment.kind);
    assert.match(moment.clock, CLOCK_PATTERN);
    assert.ok(moment.at >= 0);
    assert.equal(typeof moment.hint, "boolean");
  });
  const ids = moments.map((moment) => moment.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("moments come in time order with the speech map's clock (seconds from the first word)", () => {
  const { moments, report } = momentsOf(WORDS, METRICS);
  const times = moments.map((moment) => moment.at);
  assert.deepEqual(times, times.slice().sort((a, b) => a - b));
  const filler = moments.find((moment) => moment.kind === "filler");
  const rows = app.screens.results.speechMapRows(report, WORDS).rows;
  const row = rows.find((entry) => entry.kind === "filler");
  assert.equal(filler.at, row.at);
  assert.equal(filler.clock, app.ui.formatClock(row.at));
  assert.equal(filler.at, 3.5); // um is said at 5.5 s; the first word starts at 2 s
  assert.equal(filler.clock, "0:03");
});

test("a filler quotes its own word and the words around it", () => {
  const filler = momentsOf(WORDS, METRICS).moments.find((moment) => moment.kind === "filler");
  assert.equal(filler.id, "filler-1");
  assert.equal(filler.text, "um");
  assert.equal(filler.before, "to talk about");
  assert.equal(filler.after, "the few decisions");
  assert.equal(filler.seconds, null);
  assert.equal(filler.expected, null);
  assert.equal(filler.hint, false);
});

test("a pause carries its length and no text; a 5 s pause is a long-pause", () => {
  const { moments } = momentsOf(WORDS, METRICS);
  const long = moments.find((moment) => moment.kind === "long-pause");
  assert.equal(long.id, "long-pause-1");
  assert.equal(long.seconds, 7);
  assert.equal(long.text, "");
  assert.equal(long.before, "decisions we make");
  assert.equal(long.after, "every day.");
  assert.equal(long.at, 9);
  assert.equal(long.clock, "0:09");
});

test("a restart quotes the phrase from the first copy through the second", () => {
  const restart = momentsOf(WORDS, METRICS).moments.find((moment) => moment.kind === "restart");
  assert.equal(restart.id, "restart-1");
  assert.equal(restart.text, "the few decisions the few decisions");
  assert.equal(restart.seconds, null);
  assert.equal(restart.hint, false);
});

test("a short mid-sentence pause is a pause moment", () => {
  const words = spoken("we make a plan", 0).concat(spoken("and then go", 4));
  const { moments } = momentsOf(words, { pauses: [[1.9, 2.1]] });
  const pause = moments.find((moment) => moment.kind === "pause");
  assert.equal(pause.id, "pause-1");
  assert.equal(pause.seconds, 2.1);
  assert.equal(pause.text, "");
});

test("misreads and skips of a script take, with the script word expected", () => {
  const words = spoken("the cat sat on a mat today", 1);
  const metrics = {
    script: {
      misread: [{ at: 1.5, word: "dog", said: "cat" }],
      skipped: [{ at: 4, word: "quickly" }],
      restarts: [],
    },
  };
  const { moments } = momentsOf(words, metrics);
  const misread = moments.find((moment) => moment.kind === "misread");
  assert.equal(misread.id, "misread-1");
  assert.equal(misread.text, "cat");
  assert.equal(misread.expected, "dog");
  assert.equal(misread.hint, false);
  assert.equal(misread.before, "the");
  const skip = moments.find((moment) => moment.kind === "skip");
  assert.equal(skip.id, "skip-1");
  assert.equal(skip.text, "quickly");
  assert.equal(skip.expected, null);
});

test("unclear words and stumbles are hints", () => {
  const words = spoken("The weather this morning was surprisingly pleasant for the whole village");
  words[5].confidence = 0.2;
  const { moments } = momentsOf(words, {});
  const unclear = moments.filter((moment) => moment.kind === "unclear");
  assert.equal(unclear.length, 1);
  assert.equal(unclear[0].id, "unclear-1");
  assert.equal(unclear[0].text, "surprisingly");
  assert.equal(unclear[0].hint, true);
  assert.equal(unclear[0].before, "this morning was");
});

test("text fields are cut to the server's caps", () => {
  const long = "word".repeat(60);
  const words = [
    { text: long, start: 0, end: 0.4 },
    { text: "um", start: 0.5, end: 0.8 },
    { text: long, start: 0.9, end: 1.3 },
  ];
  const report = { ...app.delivery.analyze(words, {}) };
  report.misreads = [{ at: 0, word: "x".repeat(90), said: "y".repeat(200), wordIndex: 0 }];
  const moments = plain(app.coach.coachMoments(report, words));
  moments.forEach((moment) => {
    assert.ok(moment.text.length <= 120);
    assert.ok(moment.before.length <= 60);
    assert.ok(moment.after.length <= 60);
    assert.ok(moment.expected === null || moment.expected.length <= 40);
  });
  const misread = moments.find((moment) => moment.kind === "misread");
  assert.equal(misread.text.length, 120);
  assert.equal(misread.expected.length, 40);
  const filler = moments.find((moment) => moment.kind === "filler");
  assert.equal(filler.before.length, 60);
  assert.equal(filler.after.length, 60);
});

test("at most 40 moments are kept, the costliest kinds first, ids unchanged", () => {
  const words = [];
  for (let i = 0; i < 60; i += 1) {
    words.push({ text: "um", start: i * 2, end: i * 2 + 0.3 });
    words.push({ text: "plan", start: i * 2 + 0.5, end: i * 2 + 0.9 });
  }
  const metrics = { pauses: [[1.5, 5.5], [20, 6]] };
  const moments = plain(app.coach.coachMoments(app.delivery.analyze(words, metrics), words));
  assert.equal(moments.length, 40);
  assert.equal(moments.filter((moment) => moment.kind === "long-pause").length, 2);
  const fillers = moments.filter((moment) => moment.kind === "filler");
  assert.equal(fillers.length, 38);
  assert.equal(new Set(moments.map((moment) => moment.id)).size, 40);
  assert.equal(fillers[0].id, "filler-1");
  const times = moments.map((moment) => moment.at);
  assert.deepEqual(times, times.slice().sort((a, b) => a - b));
});

test("hints never change the counted moments or the report", () => {
  const words = spoken("The weather this morning was surprisingly pleasant for the whole village");
  const before = JSON.stringify(app.delivery.analyze(words, {}));
  words.forEach((word, index) => {
    word.confidence = index % 2 === 0 ? 0.1 : 0.9;
  });
  assert.equal(JSON.stringify(app.delivery.analyze(words, {})), before);
});
