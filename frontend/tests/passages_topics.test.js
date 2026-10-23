// Content tests for the timed topics in frontend/passages.js (DESIGN.md section 2): "About you",
// Impromptu and the three everyday prompts (an interview answer, an explanation and a story)
// hold their topics (About you 29, the rest 25 each) shown one at a time, every prompt has a
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
  "Talk about a small win you had recently and what it meant.",
  "Talk about a place you would love to visit one day.",
  "Describe a typical evening for you, from dinner to bedtime.",
  "Talk about something that has changed in your life this year.",
  "Describe the people you spend most of your time with.",
  "Talk about what you do to relax after a long day.",
  "Describe something small that made you smile recently.",
  "Describe a gift you gave or got that meant a lot.",
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
  "Would you rather live in a big city or a small town? Why?",
  "Is it worth learning a second language as an adult? Why or why not?",
  "What is the best way to spend a free Saturday, and why?",
  "Which season of the year do you enjoy most, and why?",
  "Do phones bring friends closer or push them apart? Why?",
  "Is it better to save money or enjoy it now? Explain your view.",
  "What one change would make your neighborhood a better place to live?",
  "Is it better to have a few close friends or many friends? Why?",
  "What makes a good teacher, in your experience, and why?",
  "Would you rather travel to the past or the future? Why?",
  "What is one invention you could not live without, and why?",
  "Is breakfast really the most important meal of the day? Why?",
  "What makes a movie worth watching a second time, in your view?",
  "Would you rather have more free time or more money? Why?",
  "What is the most useful thing you have learned outside of school?",
  "Is it better to plan a trip carefully or just go? Why?",
  "What makes someone a good neighbor, in your opinion?",
  "Would you rather be a morning person or a night person? Why?",
  "Which is better for learning, books or videos? Explain your view.",
  "What is one skill everyone should learn before they leave home?",
  "Is it more fun to watch sports or to play them? Why?",
  "What would you change about the way people use social media?",
  "Would you rather live near the ocean or the mountains? Why?",
  "What is the best advice you have ever been given, and why?",
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
  "What are you most proud of so far, and why?",
  "How do you handle feedback that you do not agree with?",
  "Tell me about a time you had to learn something quickly.",
  "What kind of work environment helps you do your best?",
  "Describe a goal you set for yourself and how you reached it.",
  "How do you decide what to do first when everything feels urgent?",
  "Tell me about a time you helped someone who was struggling.",
  "What is one weakness you are working on, and how?",
  "Describe a project you are proud of, from start to finish.",
  "How would your friends or classmates describe you, and why?",
  "Tell me about a time you had to speak up for an idea.",
  "What do you do when you do not know the answer?",
  "Describe a time you led a group, even an informal one.",
  "Why are you interested in this field, and how did it start?",
  "Tell me about a time you missed a deadline and what happened.",
  "What would you want to learn in your first month here?",
  "How do you keep yourself motivated on a long, slow project?",
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
  "Explain how to make a good first impression at a new job.",
  "Explain how to ride a bike to someone who has never tried.",
  "Explain how to set up a new phone for an older relative.",
  "Explain how to make your favorite drink, hot or cold.",
  "Explain how to study for a big test without cramming.",
  "Explain how to pack a suitcase so that everything fits.",
  "Explain how the seasons change in the place where you live.",
  "Explain how to get from your home to a shop nearby.",
  "Explain how to take care of a pair of shoes so they last.",
  "Explain how your family gets ready for a holiday you celebrate.",
  "Explain how to make a simple budget for one month.",
  "Explain how to start a conversation with someone you just met.",
  "Explain how to keep a room tidy in ten minutes a day.",
  "Explain the plot of a favorite movie without giving away the ending.",
  "Explain how to choose good fruit or vegetables at the market.",
  "Explain how to fix a small problem around the house.",
  "Explain how to get better sleep, one step at a time.",
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
  "Tell the story of a time you laughed so hard you could not stop.",
  "Tell the story of your first day at a new school or job.",
  "Talk about a time you helped a friend through something hard.",
  "Tell the story of a trip that changed how you see things.",
  "Tell the story of a time you were really nervous, and what happened.",
  "Tell the story of a birthday or celebration you remember well.",
  "Talk about a time you tried something new and loved it.",
  "Tell the story of a time you lost something important.",
  "Tell the story of how you met one of your closest friends.",
  "Tell the story of a time the weather ruined your plans.",
  "Talk about a time you had to make a hard choice quickly.",
  "Tell the story of a funny misunderstanding you were part of.",
  "Tell the story of a game or match you will always remember.",
  "Talk about a time you surprised yourself by doing something brave.",
  "Tell the story of a time you taught someone something new.",
  "Tell the story of a family trip, from the start to the end.",
  "Tell the story of something you waited a long time for.",
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
  "explainer-cut-apples",
  "explainer-echoes",
  "explainer-floating-ice",
  "explainer-moon-phases",
  "explainer-bicycles",
  "story-phone-call",
  "story-name-i-forgot",
  "story-corner-bakery",
  "story-soup-next-door",
  "story-giving-directions",
  "fdr-happiness",
  "jfk-to-the-moon",
  "tr-man-in-the-arena",
  "jfk-grace-and-beauty",
  "drill-th-sounds",
  "drill-r-and-l",
  "drill-v-and-w",
  "drill-word-endings",
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

test("free-talk is titled About you, lasts one minute and holds its 29 topics in order", () => {
  const entry = byId(loadPassages(), "free-talk");
  assert.equal(entry.kind, "prompt");
  assert.equal(entry.title, "About you");
  assert.equal(entry.timeLimitSeconds, 60);
  assert.deepEqual(Array.from(entry.topics), ABOUT_YOU_TOPICS);
  assert.equal(entry.text, entry.topics[0], "text repeats the first topic");
});

test("Impromptu lasts two minutes and holds its 25 topics in order", () => {
  const entry = byId(loadPassages(), "impromptu");
  assert.equal(entry.title, "Impromptu");
  assert.equal(entry.timeLimitSeconds, 120);
  assert.deepEqual(Array.from(entry.topics), IMPROMPTU_TOPICS);
  assert.equal(entry.text, entry.topics[0], "text repeats the first topic");
});

test("the interview, explain and story prompts each hold their 25 topics in order", () => {
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
  assert.equal(topics.length, 129, "29 About you topics and 25 for each other prompt");
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

test("all 29 ids in order, prompts first, so Practice opens on Talk with About you", () => {
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
