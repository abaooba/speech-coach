// Tests that the everyday texts in frontend/passages.js read cleanly (the owner's rule of
// 2026-10-14: Speech Coach is for everyday fluency, not debate). The Read tab's explainer and
// story, the Path's cold reads (explainers, short stories and news-style pieces) and the
// benchmark read are read word for word and scored against their script, so they hold no digit,
// symbol or quotation mark, no number word a transcript could write as digits ("twelve" or
// "12"), no habit word delivery.js counts and no hesitation sound: a take that reads one as
// written shows no misread and no filler. The cold reads keep the ids they had before they were
// rewritten, so a take saved on one still counts as read. Modules load with vm.runInNewContext.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

const EVERYDAY_IDS = ["explainer-rainbows", "story-wrong-train"];
// A transcript may write a number or a symbol either way ("20%" or "twenty percent").
const DIGIT_OR_SYMBOL = /[0-9%$&@#+=<>/\\]/;
const QUOTATION_MARK = /["“”]/;
// Number words a transcript may write as digits. Plurals ("millions") and ordinals ("first")
// stay words.
const NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "million", "billion",
];
const NUMBER_WORD = new RegExp("\\b(?:" + NUMBERS.join("|") + ")\\b", "i");

function loadApp() {
  const context = { app: {} };
  ["passages.js", "delivery.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return context.app;
}

const APP = loadApp();

// The words as delivery.js compares them: lower case, punctuation off both ends.
function tokens(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, ""))
    .filter(Boolean);
}

// Whether `phrase` ("so", "you know") is said as whole words anywhere in `words`.
function says(words, phrase) {
  const parts = phrase.split(" ");
  return words.some((_, start) => parts.every((part, offset) => words[start + offset] === part));
}

function everydayPassages() {
  return EVERYDAY_IDS.map((id) => {
    const entry = Array.from(APP.passages).find((candidate) => candidate.id === id);
    assert.ok(entry, `missing entry '${id}'`);
    return entry;
  });
}

// The rules a text read word for word keeps, so a take that reads it as written is clean.
function assertReadsCleanly(entry) {
  const { id, text } = entry;
  assert.match(text, /^[A-Z]/, `${id} starts a sentence`);
  assert.match(text, /[.?]$/, `${id} ends a sentence`);
  assert.doesNotMatch(text, /\s{2}/, `${id} has a doubled space`);
  assert.doesNotMatch(text, DIGIT_OR_SYMBOL, `${id} has a digit or a symbol`);
  assert.doesNotMatch(text, QUOTATION_MARK, `${id} has a quotation mark`);
  assert.doesNotMatch(text, NUMBER_WORD, `${id} has a number word`);
  const words = tokens(text);
  const habits = Array.from(APP.delivery.HABIT_WORDS).filter((habit) => says(words, habit));
  assert.deepEqual(habits, [], `${id} says ${habits.join(", ")}`);
  const sounds = words.filter((word) => APP.delivery.isHesitation(word));
  assert.deepEqual(sounds, [], `${id} says ${sounds.join(", ")}`);
}

test("the Read tab's explainer and story read cleanly, as written", () => {
  everydayPassages().forEach(assertReadsCleanly);
});

test("the explainer keeps its 109 words, as the rebuttal it replaced", () => {
  const [explainer] = everydayPassages();
  assert.equal(explainer.text.trim().split(/\s+/).length, 109);
});

test("every cold read and the benchmark read read cleanly, as written", () => {
  Array.from(APP.passages.coldReads()).forEach(assertReadsCleanly);
  assertReadsCleanly(APP.passages.benchmark().read);
});

test("the cold reads keep their ids, so a take saved on one still counts as read", () => {
  assert.deepEqual(
    Array.from(APP.passages.coldReads(), (entry) => entry.id),
    [
      "cold-read-school-start",
      "cold-read-free-transit",
      "cold-read-nuclear-power",
      "cold-read-space-funding",
      "cold-read-plastic-bags",
      "cold-read-social-media-ages",
      "cold-read-compulsory-voting",
      "cold-read-zoos",
      "cold-read-car-free-centers",
      "cold-read-ai-tools",
      "cold-read-service-hours",
      "cold-read-clock-changes",
      "cold-read-local-news",
      "cold-read-rent-control",
      "cold-read-organ-donors",
    ],
  );
});

test("the cold reads' titles name what each one is about", () => {
  assert.deepEqual(
    Array.from(APP.passages.coldReads(), (entry) => entry.title),
    [
      "Cold read: the teenage body clock",
      "Cold read: a week of free buses",
      "Cold read: how a power plant works",
      "Cold read: satellites at work",
      "Cold read: the bag by the door",
      "Cold read: why feeds keep us scrolling",
      "Cold read: election day at the library",
      "Cold read: a morning at the zoo",
      "Cold read: a street without cars",
      "Cold read: how chatbots write",
      "Cold read: a first day volunteering",
      "Cold read: when the clocks change",
      "Cold read: a day at the local paper",
      "Cold read: a first apartment",
      "Cold read: giving blood",
    ],
  );
});
