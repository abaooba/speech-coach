// Tests for frontend/tips.js: which coaching tips a take gets and what they say. select()
// reads an app.delivery report, so every case starts from a neutral report that fires no rule
// and changes one field. The module is pure and loads into a bare vm context.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TIPS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "tips.js"), "utf8");

// In-target pace, no fillers, no habit, no long break, no restarts.
const NEUTRAL = {
  wordsPerMinute: 150,
  fillersPerMinute: 0,
  fillers: [],
  topHabit: null,
  longestMidSentencePause: 0,
  repeatCount: 0,
};
const CLEAN_TIP = { id: "clean", text: "Clean run. Push the pace a little next time." };
const MAX_SENTENCE_WORDS = 15;

function load() {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  return app.tips;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function reportWith(overrides) {
  return { ...NEUTRAL, ...overrides };
}

function fillerAt(start) {
  return { index: 0, text: "um", kind: "hesitation", start, end: start + 0.2 };
}

function ids(tips) {
  return plain(tips).map((tip) => tip.id);
}

test("tips.js assigns exactly app.tips with a select function", () => {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  assert.deepEqual(Object.keys(app), ["tips"]);
  assert.equal(typeof app.tips.select, "function");
});

test("a neutral report gets exactly the clean tip, with or without options", () => {
  const tips = load();
  assert.deepEqual(plain(tips.select(NEUTRAL, { targetWpm: [140, 160] })), [CLEAN_TIP]);
  assert.deepEqual(plain(tips.select(NEUTRAL)), [CLEAN_TIP]);
});

test("pace-fast needs more than hi + 15 and pace-slow less than lo - 15", () => {
  const tips = load();
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 175 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 175.6 }))), ["pace-fast"]);
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 125 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 124 }))), ["pace-slow"]);
  const congress = { targetWpm: [130, 160] };
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 114 }), congress)), [
    "pace-slow",
  ]);
});

test("fillers fires above 3 a minute and names the first three moments", () => {
  const tips = load();
  assert.deepEqual(ids(tips.select(reportWith({ fillersPerMinute: 3 }))), ["clean"]);
  const report = reportWith({
    fillersPerMinute: 3.1,
    fillers: [2.4, 5, 10.35, 16.1, 19.8].map(fillerAt),
  });
  assert.deepEqual(plain(tips.select(report)), [
    {
      id: "fillers",
      text:
        "Fillers at 0:02, 0:05, 0:10 and 2 more. " +
        "Next take, close your mouth and pause instead.",
    },
  ]);
  const two = reportWith({ fillersPerMinute: 4, fillers: [62, 75].map(fillerAt) });
  assert.equal(tips.select(two)[0].text.split(". ")[0], "Fillers at 1:02 and 1:15");
});

test("a take saved without words still gets the fillers advice, without moments", () => {
  const tips = load();
  assert.deepEqual(plain(tips.select(reportWith({ fillersPerMinute: 25.2, fillers: [] }))), [
    {
      id: "fillers",
      text: "Replace um with a silent beat. Next take, close your mouth and pause instead.",
    },
  ]);
});

test("habit fires at three of the top habit and names it", () => {
  const tips = load();
  const twice = reportWith({ topHabit: { text: "like", count: 2 } });
  assert.deepEqual(ids(tips.select(twice)), ["clean"]);
  const report = reportWith({ topHabit: { text: "you know", count: 3 } });
  assert.deepEqual(plain(tips.select(report)), [
    { id: "habit", text: "You said “you know” 3 times. Drop it and let the sentence land." },
  ]);
});

test("break-long reads the longest mid-sentence pause; repeats needs three", () => {
  const tips = load();
  assert.deepEqual(ids(tips.select(reportWith({ longestMidSentencePause: 3 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ longestMidSentencePause: 3.2 }))), [
    "break-long",
  ]);
  assert.deepEqual(ids(tips.select(reportWith({ repeatCount: 2 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ repeatCount: 3 }))), ["repeats"]);
});

test("at most two tips, in priority order", () => {
  const tips = load();
  const everything = reportWith({
    wordsPerMinute: 190,
    fillersPerMinute: 9,
    fillers: [fillerAt(1)],
    topHabit: { text: "like", count: 5 },
    longestMidSentencePause: 4,
    repeatCount: 4,
  });
  assert.deepEqual(ids(tips.select(everything)), ["pace-fast", "fillers"]);
  const lower = reportWith({ longestMidSentencePause: 4, repeatCount: 4 });
  assert.deepEqual(ids(tips.select(lower)), ["break-long", "repeats"]);
});

test("every tip is short second-person copy: under 15 words a sentence, no exclamation", () => {
  const tips = load();
  const reports = [
    reportWith({ wordsPerMinute: 190 }),
    reportWith({ wordsPerMinute: 100 }),
    reportWith({ fillersPerMinute: 9, fillers: [1, 2, 3, 4].map(fillerAt) }),
    reportWith({ fillersPerMinute: 9 }),
    reportWith({ topHabit: { text: "basically", count: 7 } }),
    reportWith({ longestMidSentencePause: 5 }),
    reportWith({ repeatCount: 5 }),
    NEUTRAL,
  ];
  for (const report of reports) {
    for (const tip of tips.select(report)) {
      assert.ok(!tip.text.includes("!"), tip.text);
      for (const sentence of tip.text.split(/(?<=\.)\s+/)) {
        const words = sentence.split(/\s+/).filter(Boolean).length;
        assert.ok(words < MAX_SENTENCE_WORDS, sentence + " has " + words + " words");
      }
    }
  }
});

test("select never changes the report and survives junk", () => {
  const tips = load();
  const report = reportWith({ fillersPerMinute: 9, fillers: [fillerAt(3)] });
  const before = JSON.stringify(report);
  tips.select(report, { targetWpm: [130, 150] });
  assert.equal(JSON.stringify(report), before);
  for (const junk of [undefined, null, {}, { wordsPerMinute: "fast", fillers: "many" }]) {
    const result = tips.select(junk, { targetWpm: ["x", 3] });
    assert.ok(result.length >= 1 && result.length <= 2);
  }
  const badHabit = reportWith({ topHabit: { text: 5, count: "lots" } });
  assert.deepEqual(ids(tips.select(badHabit)), ["clean"]);
});
