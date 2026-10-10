// Content tests for the timed topics in frontend/passages.js (DESIGN.md section 2): "Your day" and
// Impromptu each hold eight topics shown one at a time, every prompt has a time limit, and the
// prompts come first so Practice opens on the Talk tab with "Your day" selected.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PASSAGES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "passages.js"), "utf8");

const YOUR_DAY_TOPICS = [
  "Talk about the best part of your day and why it stood out.",
  "Walk through your morning, from waking up to your first class.",
  "Describe something you learned today and how you would teach it.",
  "Tell the story of a small problem you solved today.",
  "Describe a meal you ate today as if you were reviewing it.",
  "Explain what you plan to do after school and why.",
  "Talk about a conversation today that made you think.",
  "Describe a place you spent time today, using three senses.",
];

const IMPROMPTU_TOPICS = [
  "Explain one rule your school should change, and say why.",
  "Argue for or against school uniforms, with two clear reasons.",
  "Should every student learn a second language? Take a side.",
  "Argue whether homework should be optional in high school.",
  "Make the case for or against a four-day school week.",
  "Should phones be banned during the school day? Defend your answer.",
  "Argue whether voting should start at age sixteen.",
  "Make the case for one change that would improve your town.",
];

const ALL_IDS = [
  "free-talk",
  "impromptu",
  "congress-speech",
  "pf-constructive",
  "rebuttal-uniforms",
  "rebuttal-homework",
  "gettysburg-opening",
  "liberty-or-death",
  "drill-st-clusters",
  "drill-pl-bl-clusters",
];

function loadPassages() {
  const context = { app: {} };
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  return Array.from(context.app.passages);
}

function byId(passages, id) {
  const entry = passages.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing entry '${id}'`);
  return entry;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

test("free-talk is titled Your day, lasts one minute and holds its eight topics in order", () => {
  const entry = byId(loadPassages(), "free-talk");
  assert.equal(entry.kind, "prompt");
  assert.equal(entry.title, "Your day");
  assert.equal(entry.timeLimitSeconds, 60);
  assert.deepEqual(Array.from(entry.topics), YOUR_DAY_TOPICS);
  assert.equal(entry.text, entry.topics[0], "text repeats the first topic");
});

test("Impromptu lasts two minutes and holds its eight topics in order", () => {
  const entry = byId(loadPassages(), "impromptu");
  assert.equal(entry.title, "Impromptu");
  assert.equal(entry.timeLimitSeconds, 120);
  assert.deepEqual(Array.from(entry.topics), IMPROMPTU_TOPICS);
  assert.equal(entry.text, entry.topics[0], "text repeats the first topic");
});

test("every prompt has a time limit and only prompts carry topics", () => {
  for (const entry of loadPassages()) {
    if (entry.kind === "prompt") {
      assert.ok(Number.isInteger(entry.timeLimitSeconds), `${entry.id} has a time limit`);
    } else {
      assert.ok(!Object.hasOwn(entry, "timeLimitSeconds"), `${entry.id} is untimed`);
      assert.ok(!Object.hasOwn(entry, "topics"), `${entry.id} has no topics`);
    }
  }
});

// The ten-word floor on every prompt's text lives in passages_content.test.js; a topic only has to
// be a whole sentence of at least eight words, since it shows alone in the card.
test("every prompt's text and topics end a sentence; every topic has at least eight words", () => {
  for (const entry of loadPassages().filter((item) => item.kind === "prompt")) {
    for (const text of [entry.text, ...(entry.topics || [])]) {
      assert.match(text, /[.?]$/, `${entry.id}: "${text}" ends a sentence`);
    }
    for (const topic of entry.topics || []) {
      const count = wordCount(topic);
      assert.ok(count >= 8, `${entry.id}: "${topic}" has ${count} words`);
    }
  }
});

test("every topic is a distinct sentence under 15 words", () => {
  for (const entry of loadPassages().filter((item) => Object.hasOwn(item, "topics"))) {
    const topics = Array.from(entry.topics);
    assert.equal(new Set(topics).size, topics.length, `${entry.id} repeats a topic`);
    for (const topic of topics) {
      assert.ok(wordCount(topic) < 15, `"${topic}" has ${wordCount(topic)} words`);
    }
  }
});

test("all ten ids stay, prompts first, so Practice opens on Talk with Your day", () => {
  const passages = loadPassages();
  assert.deepEqual(
    passages.map((entry) => entry.id),
    ALL_IDS,
  );
  const firstPassage = passages.findIndex((entry) => entry.kind === "passage");
  assert.ok(
    passages.slice(firstPassage).every((entry) => entry.kind === "passage"),
    "no prompt after the first passage",
  );
  assert.equal(passages[0].title, "Your day");
});
