// Content tests for the timed topics in frontend/passages.js (DESIGN.md section 2): "About you",
// Impromptu and the three everyday prompts (an interview answer, an explanation and a story)
// hold their topics (About you 25, the rest eight each) shown one at a time, every prompt has a
// time limit, and the prompts come first so Practice opens on the Talk tab with "About you" selected. Since the owner's rule
// of 2026-10-14 the Impromptu topics are everyday opinion questions, never a side to argue.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PASSAGES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "passages.js"), "utf8");

const ABOUT_YOU_TOPICS = [
  "Talk about something you are looking forward to this week.",
  "Walk through a normal morning for you, from waking up to leaving.",
  "Describe the best thing that happened to you last week.",
  "Talk about what you have planned for the weekend, and why.",
  "Describe a friend or family member and what makes them special.",
  "Talk about a hobby you enjoy and how you got into it.",
  "Describe how your week is going, the good parts and the hard ones.",
  "Talk about a goal you are working toward right now.",
  "Describe your favorite room at home and what you do there.",
  "Talk about a book, show or film you enjoyed recently.",
  "Describe a habit you are trying to build or break.",
  "Talk about a song you keep listening to, and why.",
  "Describe the place where you grew up to someone who has never been.",
  "Talk about someone who taught you something important.",
  "Describe a skill you want to learn this year, and why.",
  "Talk about a place you would love to visit one day.",
  "Describe a typical evening for you, from dinner to bedtime.",
  "Talk about something that has changed in your life this year.",
  "Describe the people you spend most of your time with.",
  "Talk about what you do to relax after a long day.",
  "Describe something small that made you smile recently.",
  "Describe a gift you gave or got that meant a lot.",
  "Talk about a recent conversation that made you think.",
  "Describe a place you spend a lot of time, using three senses.",
  "Describe a meal you ate recently as if you were reviewing it.",
];

const IMPROMPTU_TOPICS = [
  "Explain one rule your school should change, and say why.",
  "Would you rather live in a big city or a small town? Why?",
  "Is it worth learning a second language as an adult? Why or why not?",
  "What is the best way to spend a free Saturday, and why?",
  "Which season of the year do you enjoy most, and why?",
  "Do phones bring friends closer or push them apart? Why?",
  "Is it better to save money or enjoy it now? Explain your view.",
  "What one change would make your neighborhood a better place to live?",
];

const INTERVIEW_TOPICS = [
  "Tell me about yourself: where you are now and what comes next.",
  "What is one strength you would bring to a new team?",
  "Describe a time you solved a problem at work or school.",
  "Why do you want this job, and what makes you a good fit?",
  "Tell me about a mistake you made and what you learned from it.",
  "Describe a time you worked with someone who saw things differently.",
  "Where do you see yourself in five years, and why?",
  "How do you stay calm and organized when things get busy?",
];

const EXPLAIN_TOPICS = [
  "Explain how to cook a dish you know well, step by step.",
  "Explain the rules of a game or sport you enjoy.",
  "Explain how to get around your city without a car.",
  "Explain how a tool or app you use every day works.",
  "Explain a tradition from your family or culture to a newcomer.",
  "Explain how to plan a trip on a small budget.",
  "Explain how to look after a plant or a pet.",
  "Explain something you are good at to a complete beginner.",
];

const STORY_TOPICS = [
  "Tell the story of a day that did not go as planned.",
  "Tell the story of the first time you visited a new place.",
  "Talk about a time a stranger was kind to you.",
  "Tell the story of how you learned something difficult.",
  "Describe a time you got lost, and how you found your way.",
  "Tell the story of a meal you will never forget.",
  "Talk about a moment when you felt proud of yourself.",
  "Tell the story of a small mistake that turned out well.",
];

// The three everyday prompts: [id, title, time limit in seconds, topics].
const EVERYDAY_PROMPTS = [
  ["interview-answer", "Interview answer", 90, INTERVIEW_TOPICS],
  ["explain-something", "Explain something", 120, EXPLAIN_TOPICS],
  ["tell-a-story", "Tell a story", 120, STORY_TOPICS],
];

const ALL_IDS = [
  "free-talk",
  "impromptu",
  "interview-answer",
  "explain-something",
  "tell-a-story",
  "explainer-rainbows",
  "story-wrong-train",
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

test("free-talk is titled About you, lasts one minute and holds its 25 topics in order", () => {
  const entry = byId(loadPassages(), "free-talk");
  assert.equal(entry.kind, "prompt");
  assert.equal(entry.title, "About you");
  assert.equal(entry.timeLimitSeconds, 60);
  assert.deepEqual(Array.from(entry.topics), ABOUT_YOU_TOPICS);
  assert.equal(entry.text, entry.topics[0], "text repeats the first topic");
});

test("Impromptu lasts two minutes and holds its eight topics in order", () => {
  const entry = byId(loadPassages(), "impromptu");
  assert.equal(entry.title, "Impromptu");
  assert.equal(entry.timeLimitSeconds, 120);
  assert.deepEqual(Array.from(entry.topics), IMPROMPTU_TOPICS);
  assert.equal(entry.text, entry.topics[0], "text repeats the first topic");
});

test("the interview, explain and story prompts each hold their eight topics in order", () => {
  const passages = loadPassages();
  for (const [id, title, limit, topics] of EVERYDAY_PROMPTS) {
    const entry = byId(passages, id);
    assert.equal(entry.kind, "prompt", id);
    assert.equal(entry.title, title, id);
    assert.equal(entry.timeLimitSeconds, limit, id);
    assert.deepEqual(Array.from(entry.topics), topics, id);
    assert.equal(entry.text, entry.topics[0], `${id}: text repeats the first topic`);
  }
});

test("no topic is shared between two prompts", () => {
  const topics = loadPassages().flatMap((entry) => Array.from(entry.topics || []));
  assert.equal(topics.length, 57, "25 About you topics and eight for each other prompt");
  assert.equal(new Set(topics).size, topics.length, "a topic in two prompts");
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

test("all eleven ids in order, prompts first, so Practice opens on Talk with About you", () => {
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
  assert.equal(passages[0].title, "About you");
});
