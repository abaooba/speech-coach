// Tests that every text Speech Coach hands a speaker to read word for word shows no filler when
// it is read as written (how.html: "A passage has no filler words to say"): the Read tab's 24
// passages (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 3.1), the 30
// cold reads (section 3.2) and the benchmark read. app.delivery.analyze finds fillers in the
// spoken words alone, never against the script, so a word the text holds still counts as a habit
// when a reader sets it off: a "so" right before a comma, with the pause a careful reader makes
// there (delivery.js SO_HANG_SECONDS), is counted as a "so" the speaker hung on. Each text is
// read here as a careful reader says it, word for word with a pause at every mark, and run
// through analyze. Modules load with vm.runInNewContext.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

// The careful reader: each word lasts WORD_SECONDS with a short gap after it, a comma, semicolon,
// colon or dash adds a pause over delivery.js's half second for a "so" (SO_HANG_SECONDS) and its
// quarter second for a "like" (SET_OFF_PAUSE_SECONDS), and a sentence's end a longer one.
const WORD_SECONDS = 0.3;
const GAP_SECONDS = 0.05;
const CLAUSE_PAUSE_SECONDS = 0.6;
const SENTENCE_PAUSE_SECONDS = 1;
const SENTENCE_END = /[.?!]["')\]]*$/;
const CLAUSE_END = /[,;:]["')\]]*$/;
// A dash between two words ("responsibility--I"): the reader pauses there, and a transcript
// writes the pause as a comma.
const DASH_BETWEEN_WORDS = /(?<=[\p{L}\p{N}])(?:--|[—–])(?=[\p{L}\p{N}])/u;

// The Read passages, the cold reads and the benchmark read.
const READ_TEXT_COUNT = 24 + 30 + 1;

function loadApp() {
  const context = { app: {} };
  ["passages.js", "delivery.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return context.app;
}

const APP = loadApp();

// The words of `text` as a transcript of the careful reader would hold them: {text, start, end}.
function readAloud(text) {
  const said = text
    .trim()
    .split(/\s+/)
    .flatMap((word) => {
      const parts = word.split(DASH_BETWEEN_WORDS);
      return parts.map((part, index) => (index < parts.length - 1 ? part + "," : part));
    });
  let clock = 0;
  return said.map((word) => {
    const timed = { text: word, start: clock, end: clock + WORD_SECONDS };
    let pause = GAP_SECONDS;
    if (SENTENCE_END.test(word)) {
      pause = SENTENCE_PAUSE_SECONDS;
    } else if (CLAUSE_END.test(word)) {
      pause = CLAUSE_PAUSE_SECONDS;
    }
    clock = timed.end + pause;
    return timed;
  });
}

// Each filler the reading shows, as `"so" at word 74`.
function fillersWhenRead(text) {
  const report = APP.delivery.analyze(readAloud(text), {});
  return Array.from(report.fillers, (event) => `"${event.text}" at word ${event.index + 1}`);
}

function readTexts() {
  return [
    ...Array.from(APP.passages).filter((entry) => entry.kind === "passage"),
    ...Array.from(APP.passages.coldReads()),
    APP.passages.benchmark().read,
  ];
}

test("the careful reading counts a so set off by a comma, and no so said straight on", () => {
  assert.deepEqual(fillersWhenRead("So, first of all, let me begin."), ['"so" at word 1']);
  assert.deepEqual(fillersWhenRead("And so, my friends: we begin."), ['"so" at word 2']);
  assert.deepEqual(fillersWhenRead("So the plan works, and so far we agree."), []);
  assert.deepEqual(fillersWhenRead("It was the best--so we stayed."), []);
});

test("every text read word for word, pausing at each mark, shows no filler", () => {
  const texts = readTexts();
  assert.equal(texts.length, READ_TEXT_COUNT, "every Read passage, cold read and benchmark read");
  const withFillers = {};
  for (const { id, text } of texts) {
    const fillers = fillersWhenRead(text);
    if (fillers.length > 0) {
      withFillers[id] = fillers;
    }
  }
  assert.deepEqual(withFillers, {});
});
