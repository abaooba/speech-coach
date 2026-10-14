// Tests for the benchmark material in frontend/passages.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 5): app.passages.benchmark() hands out
// one held-out passage to read and one held-out prompt to talk on, the same at every sitting,
// and listed nowhere else, so no other take ever practises them. The read keeps the cold reads'
// rules: original everyday prose, no digits, symbols, quotation marks or habit words. Modules
// load with vm.runInNewContext.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

// A transcript may write a number or a symbol either way ("20%" or "twenty percent"), so a
// script that holds one could mark a word read correctly as a misread.
const DIGIT_OR_SYMBOL = /[0-9%$&@#+=<>/\\]/;
const QUOTATION_MARK = /["“”]/;

function source(file) {
  return fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
}

function loadApp(files) {
  const app = { screens: {} };
  const context = { app };
  files.forEach((file) => vm.runInNewContext(source(file), context, { filename: file }));
  return app;
}

const APP = loadApp(["passages.js", "delivery.js", "path.js"]);

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
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

// Every sentence of a text, trimmed: what a passage must not share with another.
function sentences(text) {
  return text
    .split(/(?<=[.?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const BENCHMARK = plain(APP.passages.benchmark());

test("app.passages.benchmark() hands out a read and a talk; app.passages is still the list", () => {
  const app = loadApp(["passages.js"]);
  assert.deepEqual(Object.keys(app).sort(), ["passages", "screens"]);
  assert.equal(typeof app.passages.benchmark, "function");
  assert.ok(Array.isArray(app.passages));
  assert.deepEqual(Object.keys(BENCHMARK).sort(), ["read", "talk"]);
});

test("the benchmark read is a passage of its own at the steady band", () => {
  const { read } = BENCHMARK;
  assert.deepEqual(
    { id: read.id, kind: read.kind, title: read.title, targetWpm: read.targetWpm },
    { id: "benchmark-read", kind: "passage", title: "Benchmark read", targetWpm: [140, 160] },
  );
  const count = wordCount(read.text);
  assert.ok(count >= 140 && count <= 180, `the benchmark read has ${count} words`);
  assert.match(read.text, /^[A-Z]/, "it starts a sentence");
  assert.match(read.text, /[.?]$/, "it ends a sentence");
  assert.doesNotMatch(read.text, /\s{2}/, "no doubled space");
  for (const field of ["timeLimitSeconds", "topics", "format", "source", "coldRead"]) {
    assert.ok(!Object.hasOwn(read, field), `the read has no ${field}`);
  }
});

test("read as written, the benchmark read holds nothing a transcript could mark as a slip", () => {
  const { text } = BENCHMARK.read;
  assert.doesNotMatch(text, DIGIT_OR_SYMBOL, "no digit or symbol");
  assert.doesNotMatch(text, QUOTATION_MARK, "no quotation mark");
  assert.ok(!text.includes("!"), "no exclamation mark");
  const words = tokens(text);
  const habits = Array.from(APP.delivery.HABIT_WORDS).filter((habit) => says(words, habit));
  assert.deepEqual(habits, [], `it says ${habits.join(", ")}`);
  assert.deepEqual(words.filter((word) => APP.delivery.isHesitation(word)), [], "no hesitation");
  const transcript = text.split(" ").map((word, index) => ({
    text: word,
    start: 1 + index * 0.4,
    end: 1 + index * 0.4 + 0.3,
  }));
  assert.equal(APP.delivery.analyze(transcript, {}).fillerCount, 0, "no filler, read as written");
});

test("the benchmark read shares no sentence with any other passage, prompt or cold read", () => {
  const others = Array.from(APP.passages)
    .flatMap((entry) => [entry.text, ...(entry.topics || [])])
    .concat(Array.from(APP.passages.coldReads(), (entry) => entry.text));
  const taken = new Set(others.flatMap(sentences));
  const shared = sentences(BENCHMARK.read.text).filter((sentence) => taken.has(sentence));
  assert.deepEqual(shared, []);
  assert.ok(sentences(BENCHMARK.read.text).length >= 8, "read in sentences");
});

test("the benchmark talk is a 90 s prompt on one topic that no other prompt has", () => {
  const { talk } = BENCHMARK;
  assert.deepEqual(
    {
      id: talk.id,
      kind: talk.kind,
      title: talk.title,
      targetWpm: talk.targetWpm,
      timeLimitSeconds: talk.timeLimitSeconds,
    },
    {
      id: "benchmark-talk",
      kind: "prompt",
      title: "Benchmark talk",
      targetWpm: [140, 160],
      timeLimitSeconds: 90,
    },
  );
  assert.equal(talk.topics.length, 1);
  const [topic] = talk.topics;
  assert.equal(talk.text, topic, "its text is its topic");
  assert.match(topic, /^[A-Z].*[.?]$/, "a whole sentence");
  const count = wordCount(topic);
  assert.ok(count >= 8 && count < 15, `"${topic}" has ${count} words`);
  const elsewhere = Array.from(APP.passages)
    .flatMap((entry) => [entry.text, ...(entry.topics || [])]);
  assert.ok(!elsewhere.includes(topic), "in no other prompt");
  assert.ok(!talk.text.includes("!"));
});

test("neither benchmark entry is listed in app.passages or among the cold reads", () => {
  const listed = Array.from(APP.passages, (entry) => entry.id);
  const coldReads = Array.from(APP.passages.coldReads(), (entry) => entry.id);
  for (const id of ["benchmark-read", "benchmark-talk"]) {
    assert.ok(!listed.includes(id), `${id} is not on Practice`);
    assert.ok(!coldReads.includes(id), `${id} is not a cold read`);
  }
  const titles = Array.from(APP.passages, (entry) => entry.title);
  assert.ok(!titles.includes("Benchmark read") && !titles.includes("Benchmark talk"));
});

test("benchmark() is the same material every time; a caller cannot change the next copy", () => {
  const first = APP.passages.benchmark();
  first.read.text = "changed";
  first.read.targetWpm.push(200);
  first.talk.topics.push("another");
  assert.deepEqual(plain(APP.passages.benchmark()), BENCHMARK);
});

test("the Path hands out the benchmark's read for take 1 and its talk for take 2", () => {
  assert.deepEqual(plain(APP.path.materialFor("benchmark", [], () => 0, 0)), {
    kind: "passage",
    id: "benchmark-read",
    title: "Benchmark read",
    text: BENCHMARK.read.text,
    targetWpm: [140, 160],
    topic: null,
  });
  assert.deepEqual(plain(APP.path.materialFor("benchmark", [], () => 0, 1)), {
    kind: "prompt",
    id: "benchmark-talk",
    title: "Benchmark talk",
    text: BENCHMARK.talk.topics[0],
    targetWpm: [140, 160],
    topic: BENCHMARK.talk.topics[0],
  });
  const read = APP.passages.benchmark().read;
  assert.ok(
    APP.passages.coldReads().every((entry) => entry.text !== read.text),
    "a cold read is never the benchmark",
  );
});
