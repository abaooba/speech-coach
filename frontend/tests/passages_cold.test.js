// Tests for the cold-read passages in frontend/passages.js (docs/PLAN.md T44): original
// everyday readings (explainers, short stories and news-style pieces) for the skill path's
// coldRead mode, which hands a speaker a text they have never read. app.passages.coldReads()
// hands them out; they are not entries of app.passages, so Practice's Read tab keeps its 24
// passages. Modules load with vm.runInNewContext.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");

const MIN_COLD_READS = 12;
const MIN_WORDS = 120;
const MAX_WORDS = 200;
// app.passages beside the cold reads: five timed prompts, then 24 passages.
const PROMPT_COUNT = 5;
const PASSAGE_COUNT = 24;
const MAX_TITLE_LENGTH = 40;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// A transcript may write a number or a symbol either way ("20%" or "twenty percent"), so a
// script that holds one could mark a word read correctly as a misread.
const DIGIT_OR_SYMBOL = /[0-9%$&@#+=<>\/\\]/;
// Original text quotes nobody, so no quotation marks.
const QUOTATION_MARK = /["“”]/;

function source(file) {
  return fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
}

function loadPassages() {
  const context = { app: {} };
  vm.runInNewContext(source("passages.js"), context, { filename: "passages.js" });
  return context.app.passages;
}

function loadColdReads() {
  return Array.from(loadPassages().coldReads());
}

function loadHabitWords() {
  const context = { app: {} };
  vm.runInNewContext(source("delivery.js"), context, { filename: "delivery.js" });
  return Array.from(context.app.delivery.HABIT_WORDS);
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

// The real Practice screen on the real passages, loaded as index.html loads them.
function mountPractice() {
  const app = { screens: {}, ui: {}, store: {}, api: { messages: {} }, router: {} };
  const context = { app, document: fakeDocument() };
  for (const file of ["ui.js", "passages.js", "screens/practice.js"]) {
    vm.runInNewContext(source(file), context, { filename: file });
  }
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.practice.mount(root);
  return {
    app,
    modeOptions: byClass(body, "segmented").children,
    chips: byClass(body, "chip-row").children,
  };
}

test("app.passages.coldReads() hands out at least twelve passages flagged coldRead", () => {
  assert.equal(typeof loadPassages().coldReads, "function");
  const coldReads = loadColdReads();
  assert.ok(coldReads.length >= MIN_COLD_READS, `only ${coldReads.length} cold reads`);
  for (const entry of coldReads) {
    assert.equal(entry.coldRead, true, `${entry.id} is flagged coldRead`);
    assert.equal(entry.kind, "passage", `${entry.id} is read word for word`);
  }
});

test("every cold read has 120 to 200 words", () => {
  for (const entry of loadColdReads()) {
    const count = wordCount(entry.text);
    assert.ok(
      count >= MIN_WORDS && count <= MAX_WORDS,
      `${entry.id} has ${count} words, wanted ${MIN_WORDS} to ${MAX_WORDS}`,
    );
  }
});

test("cold reads take the passage shape: slug id, short title, band, untimed, no source", () => {
  for (const entry of loadColdReads()) {
    assert.match(entry.id, SLUG, `id '${entry.id}' is a lowercase slug`);
    assert.equal(typeof entry.title, "string", `title of ${entry.id}`);
    assert.ok(entry.title.trim().length > 0, `title of ${entry.id} is empty`);
    assert.ok(entry.title.length < MAX_TITLE_LENGTH, `title of ${entry.id} is too long`);
    assert.equal(typeof entry.text, "string", `text of ${entry.id}`);
    assert.ok(Array.isArray(entry.targetWpm), `targetWpm of ${entry.id}`);
    assert.equal(entry.targetWpm.length, 2, `targetWpm of ${entry.id} needs [lo, hi]`);
    const [lo, hi] = entry.targetWpm;
    assert.ok(Number.isFinite(lo) && Number.isFinite(hi), `targetWpm of ${entry.id}`);
    assert.ok(lo < hi, `targetWpm of ${entry.id}: ${lo} is not below ${hi}`);
    for (const field of ["timeLimitSeconds", "topics", "format", "source"]) {
      assert.ok(!Object.hasOwn(entry, field), `${entry.id} has no ${field}`);
    }
  }
});

test("cold-read ids and titles are unique and never repeat an app.passages entry's", () => {
  const coldReads = loadColdReads();
  const practice = Array.from(loadPassages());
  for (const field of ["id", "title"]) {
    const values = coldReads.map((entry) => entry[field]);
    assert.equal(new Set(values).size, values.length, `duplicate ${field}s in ${values}`);
    const taken = new Set(practice.map((entry) => entry[field]));
    const clashes = values.filter((value) => taken.has(value));
    assert.deepEqual(clashes, [], `cold-read ${field}s already used by app.passages`);
  }
});

test("app.passages keeps its 29 entries, five prompts, 24 passages, none a cold read", () => {
  const practice = Array.from(loadPassages());
  assert.equal(practice.length, PROMPT_COUNT + PASSAGE_COUNT);
  assert.equal(practice.filter((entry) => entry.kind === "prompt").length, PROMPT_COUNT);
  assert.equal(practice.filter((entry) => entry.kind === "passage").length, PASSAGE_COUNT);
  const flagged = practice.filter((entry) => Object.hasOwn(entry, "coldRead"));
  assert.deepEqual(
    flagged.map((entry) => entry.id),
    [],
    "no app.passages entry is a cold read",
  );
});

test("coldReads() returns a new list on every call, so a caller may shuffle or trim it", () => {
  const passages = loadPassages();
  const first = passages.coldReads();
  const ids = Array.from(first, (entry) => entry.id);
  first.reverse();
  first.pop();
  const second = passages.coldReads();
  assert.notEqual(second, first);
  assert.deepEqual(
    Array.from(second, (entry) => entry.id),
    ids,
  );
});

test("each cold read is plain sentences: a capital first, a stop or question mark last", () => {
  for (const entry of loadColdReads()) {
    assert.match(entry.text, /^[A-Z]/, `${entry.id} starts a sentence`);
    assert.match(entry.text, /[.?]$/, `${entry.id} ends a sentence`);
    assert.doesNotMatch(entry.text, /\s{2}/, `${entry.id} has a doubled space`);
  }
});

test("cold reads hold no digits, symbols or quotation marks", () => {
  for (const entry of loadColdReads()) {
    assert.doesNotMatch(entry.text, DIGIT_OR_SYMBOL, `${entry.id} has a digit or a symbol`);
    assert.doesNotMatch(entry.text, QUOTATION_MARK, `${entry.id} has a quotation mark`);
  }
});

test("read as written, a cold read says none of the habit words delivery.js counts", () => {
  const habitWords = loadHabitWords();
  assert.ok(habitWords.includes("like") && habitWords.includes("you know"), "habit words load");
  for (const entry of loadColdReads()) {
    const words = tokens(entry.text);
    const said = habitWords.filter((habit) => says(words, habit));
    assert.deepEqual(said, [], `${entry.id} says ${said.join(", ")}`);
  }
});

// The Read tab shows one chip per group (tester feedback spec, section 2.3), and a group's chip
// draws one of the group's passages on every tap.
test("Practice's Read tab lists only the 24 practice passages, by group, never a cold read", () => {
  const { app, modeOptions, chips } = mountPractice();
  const read = modeOptions.find((option) => option.textContent === "Read");
  read.click();
  const shown = chips.filter((chip) => !chip.hidden);
  const groups = Array.from(app.passages.groups());
  assert.deepEqual(
    shown.map((chip) => chip.dataset.group),
    groups.map((group) => group.id),
  );
  assert.deepEqual(
    shown.map((chip) => chip.textContent),
    groups.map((group) => group.label),
  );
  const practicePassages = Array.from(app.passages).filter((entry) => entry.kind === "passage");
  const practicePassageIds = practicePassages.map((entry) => entry.id);
  assert.equal(practicePassageIds.length, PASSAGE_COUNT);
  assert.deepEqual(
    [...new Set(practicePassages.map((entry) => entry.group))],
    groups.map((group) => group.id),
    "each practice passage sits in a group with a chip",
  );
  assert.equal(chips.length, PROMPT_COUNT + groups.length, "one chip per prompt and per group");
  const coldIds = new Set(Array.from(app.passages.coldReads(), (entry) => entry.id));
  const coldChips = chips.filter((chip) => coldIds.has(chip.dataset.passageId));
  assert.deepEqual(coldChips, [], "no chip for a cold read");
  // Every tap on a group's chip shows one of that group's practice passages, so the chips show
  // the 24 and nothing else.
  for (const chip of shown) {
    const members = practicePassages
      .filter((entry) => entry.group === chip.dataset.group)
      .map((entry) => entry.id);
    for (let tap = 0; tap < 3; tap += 1) {
      chip.click();
      const passage = app.screens.practice.selectedPassage();
      assert.ok(members.includes(passage.id), `${passage.id} under ${chip.textContent}`);
    }
  }
});
