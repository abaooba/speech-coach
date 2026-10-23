// Tests for the reading material in frontend/passages.js
// (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 3): the Read tab holds
// 24 passages, six in each of its four groups, each group under the rules of section 3.1, and
// app.passages.coldReads() holds 30 cold reads, the old fifteen first, under the rules of 3.2.
// Ids and titles stay unique across everything passages.js hands out. The rules the other
// passage tests already run over every entry stay there: no exclamation mark
// (passages_content.test.js), a cold read's plain sentences (passages_cold.test.js) and clean
// words (passages_everyday.test.js). Modules load with vm.runInNewContext.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

// Each group's passages in the Read tab's order, as [id, title]: the six of before first, then
// the new ones.
const READ_PASSAGES = {
  explainer: [
    ["explainer-rainbows", "Explainer: how rainbows form"],
    ["explainer-cut-apples", "Explainer: why cut apples turn brown"],
    ["explainer-echoes", "Explainer: how an echo works"],
    ["explainer-floating-ice", "Explainer: why ice floats"],
    ["explainer-moon-phases", "Explainer: why the moon changes shape"],
    ["explainer-bicycles", "Explainer: how a bicycle stays up"],
  ],
  story: [
    ["story-wrong-train", "Story: the wrong train"],
    ["story-phone-call", "Story: the phone call"],
    ["story-name-i-forgot", "Story: the name I forgot"],
    ["story-corner-bakery", "Story: the corner bakery"],
    ["story-soup-next-door", "Story: the soup next door"],
    ["story-giving-directions", "Story: giving directions"],
  ],
  speech: [
    ["gettysburg-opening", "Gettysburg Address, opening"],
    ["liberty-or-death", "Patrick Henry, liberty or death"],
    ["fdr-fear-itself", "Franklin D. Roosevelt, fear itself"],
    ["jfk-ask-not", "John F. Kennedy, ask not"],
    ["tr-man-in-the-arena", "Theodore Roosevelt, man in the arena"],
    ["jfk-grace-and-beauty", "John F. Kennedy, grace and beauty"],
  ],
  drill: [
    ["drill-st-clusters", "Drill: st and str clusters"],
    ["drill-pl-bl-clusters", "Drill: pl, bl and cl clusters"],
    ["drill-th-sounds", "Drill: th as in think and this"],
    ["drill-r-and-l", "Drill: r and l sounds"],
    ["drill-v-and-w", "Drill: v and w sounds"],
    ["drill-word-endings", "Drill: word endings and -ed"],
  ],
};

// Section 3.1, per group: words, title, band, and whether the text is a sourced speech.
const GROUP_RULES = {
  explainer: { words: [80, 110], title: /^Explainer: \S/, band: [150, 170], sourced: false },
  story: { words: [80, 110], title: /^Story: \S/, band: [150, 170], sourced: false },
  speech: { words: [90, 130], title: null, band: [130, 150], sourced: true },
  drill: { words: [60, 80], title: /^Drill: \S/, band: [120, 140], sourced: false },
};

// Every speech's source, "Speaker, work, year", as checked against its transcript.
const SPEECH_SOURCES = {
  "gettysburg-opening": "Abraham Lincoln, Gettysburg Address, 1863",
  "liberty-or-death": "Patrick Henry, speech to the Virginia Convention, 1775",
  "fdr-fear-itself": "Franklin D. Roosevelt, First Inaugural Address, 1933",
  "jfk-ask-not": "John F. Kennedy, Inaugural Address, 1961",
  "tr-man-in-the-arena": "Theodore Roosevelt, Citizenship in a Republic, 1910",
  "jfk-grace-and-beauty": "John F. Kennedy, Remarks at Amherst College, 1963",
};
const SOURCE_FORMAT = /^[A-Z][^,]*, [^,]+, \d{4}$/;

const OLD_COLD_READ_IDS = [
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
];
const NEW_COLD_READ_IDS = [
  "cold-read-refrigerator",
  "cold-read-bread-dough",
  "cold-read-flat-tire",
  "cold-read-power-cut",
  "cold-read-repair-night",
  "cold-read-honey-bees",
  "cold-read-tides",
  "cold-read-clouds",
  "cold-read-butterfly",
  "cold-read-bean-jar",
  "cold-read-learning-to-swim",
  "cold-read-letter-journey",
  "cold-read-museum-guide",
  "cold-read-lost-and-found",
  "cold-read-window-cleaners",
];
const COLD_READ_WORDS = [142, 164];
const COLD_READ_BAND = [140, 160];

// Each new text's words, split on whitespace as the word ranges count them. The script
// alignment (backend/script_align.py) reads a dash-joined word as two, so it reads 108 words in
// fdr-fear-itself ("itself--nameless") and in jfk-ask-not (three such words).
const NEW_TEXT_WORDS = {
  "explainer-cut-apples": 105,
  "explainer-echoes": 109,
  "explainer-floating-ice": 103,
  "explainer-moon-phases": 109,
  "explainer-bicycles": 102,
  "story-phone-call": 108,
  "story-name-i-forgot": 108,
  "story-corner-bakery": 104,
  "story-soup-next-door": 107,
  "story-giving-directions": 99,
  "fdr-fear-itself": 107,
  "jfk-ask-not": 105,
  "tr-man-in-the-arena": 112,
  "jfk-grace-and-beauty": 123,
  "drill-th-sounds": 74,
  "drill-r-and-l": 75,
  "drill-v-and-w": 76,
  "drill-word-endings": 75,
  "cold-read-refrigerator": 163,
  "cold-read-bread-dough": 161,
  "cold-read-flat-tire": 162,
  "cold-read-power-cut": 160,
  "cold-read-repair-night": 161,
  "cold-read-honey-bees": 155,
  "cold-read-tides": 162,
  "cold-read-clouds": 159,
  "cold-read-butterfly": 161,
  "cold-read-bean-jar": 158,
  "cold-read-learning-to-swim": 161,
  "cold-read-letter-journey": 164,
  "cold-read-museum-guide": 164,
  "cold-read-lost-and-found": 162,
  "cold-read-window-cleaners": 159,
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_TITLE_LENGTH = 40;
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

function readPassages() {
  return Array.from(APP.passages).filter((entry) => entry.kind === "passage");
}

function coldReads() {
  return Array.from(APP.passages.coldReads());
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

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

test("each of the Read tab's four groups holds its six passages, in order", () => {
  assert.deepEqual(
    Array.from(APP.passages.groups(), (group) => group.id),
    Object.keys(READ_PASSAGES),
    "groups() lists exactly these four",
  );
  for (const [group, passages] of Object.entries(READ_PASSAGES)) {
    assert.deepEqual(
      readPassages()
        .filter((entry) => entry.group === group)
        .map((entry) => [entry.id, entry.title]),
      passages,
      group,
    );
  }
});

test("every Read passage keeps its group's words, title and band", () => {
  for (const entry of readPassages()) {
    const rule = GROUP_RULES[entry.group];
    assert.ok(rule, `${entry.id} has the group ${entry.group}`);
    const count = wordCount(entry.text);
    const [lo, hi] = rule.words;
    assert.ok(count >= lo && count <= hi, `${entry.id} has ${count} words, wanted ${lo} to ${hi}`);
    if (rule.title) {
      assert.match(entry.title, rule.title, `title of ${entry.id}`);
    }
    assert.deepEqual([...entry.targetWpm], rule.band, `targetWpm of ${entry.id}`);
  }
});

test("only speeches carry a source, each 'Speaker, work, year' as checked", () => {
  for (const entry of readPassages()) {
    const sourced = GROUP_RULES[entry.group].sourced;
    assert.equal(Object.hasOwn(entry, "source"), sourced, `${entry.id} has a source: ${sourced}`);
  }
  const sourced = readPassages().filter((entry) => Object.hasOwn(entry, "source"));
  assert.deepEqual(
    Object.fromEntries(sourced.map((entry) => [entry.id, entry.source])),
    SPEECH_SOURCES,
  );
  for (const entry of sourced) {
    assert.match(entry.source, SOURCE_FORMAT, `source of ${entry.id}`);
  }
});

test("every explainer and story reads cleanly, as written", () => {
  const everyday = readPassages().filter((entry) => ["explainer", "story"].includes(entry.group));
  assert.equal(everyday.length, 12, "six explainers and six stories");
  for (const { id, text } of everyday) {
    assert.doesNotMatch(text, DIGIT_OR_SYMBOL, `${id} has a digit or a symbol`);
    assert.doesNotMatch(text, QUOTATION_MARK, `${id} has a quotation mark`);
    assert.doesNotMatch(text, NUMBER_WORD, `${id} has a number word`);
    const words = tokens(text);
    const habits = Array.from(APP.delivery.HABIT_WORDS).filter((habit) => says(words, habit));
    assert.deepEqual(habits, [], `${id} says ${habits.join(", ")}`);
    const sounds = words.filter((word) => APP.delivery.isHesitation(word));
    assert.deepEqual(sounds, [], `${id} says ${sounds.join(", ")}`);
  }
});

test("coldReads() lists the old fifteen in their order, then the fifteen new ones", () => {
  assert.deepEqual(
    coldReads().map((entry) => entry.id),
    [...OLD_COLD_READ_IDS, ...NEW_COLD_READ_IDS],
  );
});

test("every cold read has 142 to 164 words, the 140 to 160 band and a Cold read title", () => {
  const [lo, hi] = COLD_READ_WORDS;
  for (const entry of coldReads()) {
    const count = wordCount(entry.text);
    assert.ok(count >= lo && count <= hi, `${entry.id} has ${count} words, wanted ${lo} to ${hi}`);
    assert.deepEqual([...entry.targetWpm], COLD_READ_BAND, `targetWpm of ${entry.id}`);
    assert.match(entry.title, /^Cold read: \S/, `title of ${entry.id}`);
  }
});

test("ids and titles are unique across prompts, passages, cold reads, benchmark and retired", () => {
  const benchmark = APP.passages.benchmark();
  const retired = Array.from(APP.passages.retired());
  const everything = [
    ...Array.from(APP.passages),
    ...coldReads(),
    benchmark.read,
    benchmark.talk,
    ...retired,
  ];
  const ids = everything.map((entry) => entry.id);
  for (const id of ids) {
    assert.match(id, SLUG, `id '${id}' is a lowercase slug`);
  }
  assert.equal(new Set(ids).size, ids.length, "an id is used twice");
  // A retired id keeps no title: nothing shows it.
  const titled = everything.filter((entry) => Object.hasOwn(entry, "title"));
  assert.equal(titled.length, everything.length - retired.length);
  const titles = titled.map((entry) => entry.title);
  for (const title of titles) {
    assert.ok(title.length < MAX_TITLE_LENGTH, `"${title}" is ${title.length} long`);
  }
  assert.equal(new Set(titles).size, titles.length, "a title is used twice");
});

test("each new text keeps its exact word count", () => {
  const byId = new Map([...readPassages(), ...coldReads()].map((entry) => [entry.id, entry]));
  for (const [id, words] of Object.entries(NEW_TEXT_WORDS)) {
    assert.ok(byId.has(id), `missing entry '${id}'`);
    assert.equal(wordCount(byId.get(id).text), words, id);
  }
});
