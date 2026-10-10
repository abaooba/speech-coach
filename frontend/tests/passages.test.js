// Tests for frontend/passages.js (app.passages). The module is loaded with vm.runInNewContext
// with a bare `app` object. The assertions describe the shape of every entry rather than
// the exact list, so later tasks can add passages without editing this file.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PASSAGES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "passages.js"), "utf8");

const MIN_PASSAGE_WORDS = 60;
const FREE_TALK_ID = "free-talk";

function loadPassages() {
  const context = { app: {} };
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  return { app: context.app, passages: context.app.passages };
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

test("passages.js assigns exactly app.passages as an array of at least four entries", () => {
  const { app, passages } = loadPassages();
  assert.deepEqual(Object.keys(app), ["passages"]);
  assert.ok(Array.isArray(passages));
  assert.ok(passages.length >= 4, `expected at least 4 entries, got ${passages.length}`);
});

test("every entry has id, kind, title, text and a targetWpm range with lo < hi", () => {
  const { passages } = loadPassages();
  for (const entry of passages) {
    assert.equal(typeof entry.id, "string", `id of ${JSON.stringify(entry)}`);
    assert.ok(entry.id.length > 0, "id is empty");
    assert.ok(["passage", "prompt"].includes(entry.kind), `kind of ${entry.id}: ${entry.kind}`);
    assert.equal(typeof entry.title, "string", `title of ${entry.id}`);
    assert.ok(entry.title.length > 0, `title of ${entry.id} is empty`);
    assert.equal(typeof entry.text, "string", `text of ${entry.id}`);
    assert.ok(Array.isArray(entry.targetWpm), `targetWpm of ${entry.id}`);
    assert.equal(entry.targetWpm.length, 2, `targetWpm of ${entry.id} needs [lo, hi]`);
    const [lo, hi] = entry.targetWpm;
    assert.ok(Number.isFinite(lo) && Number.isFinite(hi), `targetWpm of ${entry.id}`);
    assert.ok(lo < hi, `targetWpm of ${entry.id}: ${lo} is not below ${hi}`);
  }
});

test("ids are unique", () => {
  const { passages } = loadPassages();
  const ids = passages.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids}`);
});

test("at least one entry is a prompt and 'free-talk' is present", () => {
  const { passages } = loadPassages();
  assert.ok(passages.some((entry) => entry.kind === "prompt"), "no entry of kind 'prompt'");
  assert.ok(passages.some((entry) => entry.id === FREE_TALK_ID), "no 'free-talk' entry");
});

test("every passage (not prompt) has at least 60 words of text", () => {
  const { passages } = loadPassages();
  const readings = passages.filter((entry) => entry.kind === "passage");
  assert.ok(readings.length > 0, "no entry of kind 'passage'");
  for (const entry of readings) {
    const count = wordCount(entry.text);
    assert.ok(count >= MIN_PASSAGE_WORDS, `${entry.id} has ${count} words`);
  }
});

test("every entry that carries a source has a non-empty string source", () => {
  const { passages } = loadPassages();
  const sourced = passages.filter((entry) => Object.hasOwn(entry, "source"));
  for (const entry of sourced) {
    assert.equal(typeof entry.source, "string", `source of ${entry.id}`);
    assert.ok(entry.source.trim().length > 0, `source of ${entry.id} is empty`);
  }
});
