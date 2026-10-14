// Tests for the repeats tip in frontend/tips.js (review fix A6). It fires at 3 restarts or more
// but always said "three times"; it now names the take's real count, and still keeps every
// sentence under 15 words. The module is pure and loads into a bare vm context.
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

test("5 restarts read '5 times'", () => {
  assert.deepEqual(plain(load().select(reportWith({ repeatCount: 5 }))), [
    { id: "repeats", text: "You restarted phrases 5 times. Finish the sentence, then fix it." },
  ]);
});

test("3 restarts, where the tip starts firing, read '3 times'", () => {
  assert.deepEqual(plain(load().select(reportWith({ repeatCount: 3 }))), [
    { id: "repeats", text: "You restarted phrases 3 times. Finish the sentence, then fix it." },
  ]);
});

test("whatever the count, every sentence stays under 15 words with no exclamation", () => {
  const tips = load();
  for (const repeatCount of [3, 4, 12, 140]) {
    const [tip] = tips.select(reportWith({ repeatCount }));
    assert.equal(tip.id, "repeats");
    assert.ok(tip.text.includes(" " + repeatCount + " times. "), tip.text);
    assert.ok(!tip.text.includes("!"), tip.text);
    for (const sentence of tip.text.split(/(?<=\.)\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      assert.ok(words < MAX_SENTENCE_WORDS, sentence + " has " + words + " words");
    }
  }
});
