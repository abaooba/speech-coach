// Tests that the privacy copy says what coach notes (docs/PLAN.md T41) send: tips.js
// adviceRequest puts the start of a take's transcript in the body of POST /api/advice, and the
// server passes it to Anthropic (backend/advice/coach.py). The first-launch privacy line names
// how much and to whom, measured from adviceRequest rather than written out here, and
// frontend/README.md's walkthrough quotes that line as the screen shows it. how.html's section
// 7 is checked in coach_notes_docs.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

// A transcript far longer than any excerpt: 1,000 words of "word" run to 4,999 characters, so
// the excerpt the request carries is as long as adviceRequest ever lets one be.
const LONG_TRANSCRIPT = Array.from({ length: 1000 }, (_, index) => ({
  text: "word",
  start: index,
  end: index + 0.5,
}));

// Loads one frontend file with no document, as the copy checks in onboarding.test.js do.
function load(file) {
  const app = { screens: {}, ui: {}, store: {}, router: {} };
  vm.runInNewContext(read(file), { app }, { filename: file });
  return app;
}

function onboardingCopy() {
  return load(path.join("screens", "onboarding.js")).screens.onboarding.COPY;
}

// How many characters of the transcript the advice request carries at most, written as the copy
// writes the number ("1,500").
function excerptLimit() {
  const { tips } = load("tips.js");
  const take = { id: "take-1", transcript: LONG_TRANSCRIPT };
  const length = tips.adviceRequest(take, {}, null, "", []).summary.transcript_excerpt.length;
  assert.ok(length > 0, "the advice request carries the start of the transcript");
  return length.toLocaleString("en-US");
}

// A document's text with every run of spaces and line breaks read as one space.
function flat(text) {
  return text.replace(/\s+/g, " ");
}

test("the first-launch privacy line says how much of the transcript goes to Anthropic", () => {
  const { privacy } = onboardingCopy();
  const sentence =
    "Coach notes send the first " + excerptLimit() + " characters of your transcript to Anthropic.";
  assert.ok(privacy.includes(sentence), JSON.stringify(privacy));
  assert.doesNotMatch(privacy, /stay on this device/);
});

test("frontend/README.md's Onboarding walkthrough quotes the privacy line the screen shows", () => {
  const { privacy } = onboardingCopy();
  const readme = flat(read("README.md"));
  assert.ok(readme.includes('the muted line "' + privacy + '"'), "walkthrough quotes " + privacy);
});
