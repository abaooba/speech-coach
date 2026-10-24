// Tests for app.language.isReadTake in frontend/language.js: the one rule that tells a take read
// aloud from a take the speaker talked in their own words. The grammar check skips read takes;
// the rank (rankcard.js, results.js) and the Progress charts (screens/progress.js) split on the
// same rule, so all three always agree. passages.js and language.js run for real.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

function load() {
  const context = { app: { screens: {} } };
  vm.runInNewContext(read("passages.js"), context, { filename: "passages.js" });
  vm.runInNewContext(read("language.js"), context, { filename: "language.js" });
  return context.app.language;
}

function take(passageId, metrics) {
  return { id: "t", passageId, metrics: metrics || { pauses: [] }, transcript: [] };
}

// The script block the backend adds when a take follows the script it was sent.
const FOLLOWED_SCRIPT = { pauses: [], script: { restarts: [], skipped: [], misread: [] } };

test("a take on a passage read aloud is a read take, wherever the passage comes from", () => {
  const language = load();
  const passages = [
    "explainer-rainbows", // a Read tab passage
    "drill-st-clusters", // a Read tab drill
    "cold-read-school-start", // a Path cold read
    "benchmark-read", // the benchmark's read
    "rebuttal-uniforms", // a retired passage an old take still carries
  ];
  for (const passageId of passages) {
    assert.equal(language.isReadTake(take(passageId)), true, passageId);
  }
});

test("a take on a prompt is a talk take, unless it followed a pasted script", () => {
  const language = load();
  for (const passageId of ["free-talk", "explain-something", "benchmark-talk", "unknown-id"]) {
    assert.equal(language.isReadTake(take(passageId)), false, passageId);
  }
  assert.equal(language.isReadTake(take("free-talk", FOLLOWED_SCRIPT)), true, "a pasted script");
  assert.equal(language.isReadTake(take("explainer-rainbows", FOLLOWED_SCRIPT)), true);
});

test("a missing take, or one without metrics, is never read and never throws", () => {
  const language = load();
  assert.equal(language.isReadTake(null), false);
  assert.equal(language.isReadTake(undefined), false);
  assert.equal(language.isReadTake({ id: "t", passageId: "free-talk" }), false);
  assert.equal(language.isReadTake({ id: "t", passageId: "explainer-rainbows" }), true);
});
