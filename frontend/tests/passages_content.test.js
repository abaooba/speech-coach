// Content tests for frontend/passages.js: the exact set of readings and everyday prompts (the
// owner's rule of 2026-10-14: Speech Coach is for everyday fluency, not debate). The shape checks
// live in passages.test.js; this file pins what Task 3 promises, as that rule rewrote it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PASSAGES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "passages.js"), "utf8");

const EVERYDAY_IDS = ["explainer-rainbows", "story-wrong-train"];
const EXCERPT_IDS = ["gettysburg-opening", "liberty-or-death"];
const DRILL_IDS = ["drill-st-clusters", "drill-pl-bl-clusters"];
const PROMPT_LIMITS = {
  "free-talk": 60,
  impromptu: 120,
  "interview-answer": 90,
  "explain-something": 120,
  "tell-a-story": 120,
};

function loadPassages() {
  const context = { app: {} };
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  return context.app.passages;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function byId(passages, id) {
  const entry = passages.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing entry '${id}'`);
  return entry;
}

function assertWordBand(passages, ids, lo, hi) {
  for (const id of ids) {
    const count = wordCount(byId(passages, id).text);
    assert.ok(count >= lo && count <= hi, `${id} has ${count} words, wanted ${lo} to ${hi}`);
  }
}

test("there are exactly 29 entries: 24 passages and five prompts", () => {
  const passages = loadPassages();
  assert.equal(passages.length, 29);
  assert.equal(passages.filter((entry) => entry.kind === "passage").length, 24);
  assert.equal(passages.filter((entry) => entry.kind === "prompt").length, 5);
});

test("ids are unique lowercase slugs", () => {
  const passages = loadPassages();
  const ids = passages.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id '${id}' is not a lowercase slug`);
  }
});

test("every passage has 60 to 130 words", () => {
  for (const entry of loadPassages().filter((item) => item.kind === "passage")) {
    const count = wordCount(entry.text);
    assert.ok(count >= 60 && count <= 130, `${entry.id} has ${count} words`);
  }
});

test("the explainer and the story have 80 to 110 words and say what they are", () => {
  const passages = loadPassages();
  assertWordBand(passages, EVERYDAY_IDS, 80, 110);
  for (const id of EVERYDAY_IDS) {
    const entry = byId(passages, id);
    assert.equal(entry.kind, "passage");
    assert.deepEqual([...entry.targetWpm], [150, 170], `targetWpm of ${id}`);
    assert.ok(!Object.hasOwn(entry, "source"), `${id} is original, with no source`);
  }
  const explainer = byId(passages, "explainer-rainbows");
  assert.equal(explainer.title, "Explainer: how rainbows form");
  assert.match(explainer.text, /^A rainbow appears when/, "explainer opening");
  assert.match(explainer.text, /\bThat is why\b/, "the explainer gives its reason");
  const story = byId(passages, "story-wrong-train");
  assert.equal(story.title, "Story: the wrong train");
  assert.match(story.text, /^On my first morning/, "story opening");
  assert.match(story.text, /\bI arrived late, but I arrived\./, "the story turns on 'but'");
});

test("the two excerpts have 90 to 130 words and a non-empty source", () => {
  const passages = loadPassages();
  assertWordBand(passages, EXCERPT_IDS, 90, 130);
  for (const id of EXCERPT_IDS) {
    const entry = byId(passages, id);
    assert.equal(typeof entry.source, "string", `source of ${id}`);
    assert.ok(entry.source.trim().length > 0, `source of ${id} is empty`);
    assert.deepEqual([...entry.targetWpm], [130, 150], `targetWpm of ${id}`);
  }
});

test("the two clarity drills have 60 to 80 words and are titled as drills", () => {
  const passages = loadPassages();
  assertWordBand(passages, DRILL_IDS, 60, 80);
  for (const id of DRILL_IDS) {
    const entry = byId(passages, id);
    assert.equal(entry.kind, "passage");
    assert.match(entry.title, /^Drill/, `title of ${id}`);
    assert.deepEqual([...entry.targetWpm], [120, 140], `targetWpm of ${id}`);
  }
});

test("every prompt has text of at least ten words", () => {
  for (const entry of loadPassages().filter((item) => item.kind === "prompt")) {
    const count = wordCount(entry.text);
    assert.ok(count >= 10, `${entry.id} has ${count} words`);
  }
});

test("each targetWpm has lo below hi", () => {
  for (const entry of loadPassages()) {
    const [lo, hi] = entry.targetWpm;
    assert.ok(lo < hi, `targetWpm of ${entry.id}: ${lo} is not below ${hi}`);
  }
});

test("the five prompts are free-talk, impromptu and the three everyday prompts", () => {
  const passages = loadPassages();
  const prompts = Array.from(passages)
    .filter((entry) => entry.kind === "prompt")
    .map((entry) => entry.id);
  assert.deepEqual(prompts.sort(), [
    "explain-something",
    "free-talk",
    "impromptu",
    "interview-answer",
    "tell-a-story",
  ]);
  assert.deepEqual([...byId(passages, "free-talk").targetWpm], [140, 160]);
  assert.deepEqual([...byId(passages, "impromptu").targetWpm], [140, 160]);
  assert.deepEqual([...byId(passages, "interview-answer").targetWpm], [140, 160]);
  assert.deepEqual([...byId(passages, "explain-something").targetWpm], [130, 160]);
  assert.deepEqual([...byId(passages, "tell-a-story").targetWpm], [140, 160]);
  assert.equal(byId(passages, "interview-answer").title, "Interview answer");
  assert.equal(byId(passages, "explain-something").title, "Explain something");
  assert.equal(byId(passages, "tell-a-story").title, "Tell a story");
  assert.equal(
    byId(passages, "impromptu").text,
    "Explain one rule your school should change, and say why.",
  );
});

test("five prompts are timed at 60, 120, 90, 120 and 120; no entry carries a format", () => {
  const passages = loadPassages();
  const timed = Array.from(passages).filter((entry) => Object.hasOwn(entry, "timeLimitSeconds"));
  assert.deepEqual(timed.map((entry) => entry.id).sort(), Object.keys(PROMPT_LIMITS).sort());
  for (const entry of timed) {
    assert.ok(Number.isInteger(entry.timeLimitSeconds) && entry.timeLimitSeconds > 0);
    assert.equal(entry.timeLimitSeconds, PROMPT_LIMITS[entry.id], `limit of ${entry.id}`);
  }
  const formatted = Array.from(passages).filter((entry) => Object.hasOwn(entry, "format"));
  assert.deepEqual(
    formatted.map((entry) => entry.id),
    [],
    "no prompt names a contest format",
  );
});

test("titles stay under 40 characters", () => {
  for (const entry of loadPassages()) {
    assert.ok(entry.title.length < 40, `title of ${entry.id} is ${entry.title.length} long`);
  }
});

test("no exclamation mark appears anywhere in passages.js or its data", () => {
  assert.ok(!PASSAGES_SOURCE.includes("!"), "passages.js contains '!'");
  for (const entry of loadPassages()) {
    assert.ok(!JSON.stringify(entry).includes("!"), `${entry.id} contains '!'`);
  }
});
