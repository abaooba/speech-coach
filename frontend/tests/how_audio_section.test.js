// how.html has a "Your audio" section that says the recording is deleted at AssemblyAI as soon
// as the words are back, in sentences a phone can read (under 15 words, no exclamation).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HOW = fs.readFileSync(path.join(__dirname, "..", "how.html"), "utf8");
const MAX_SENTENCE_WORDS = 15;

function audioSection() {
  const start = HOW.indexOf("<h2>Your audio</h2>");
  assert.notEqual(start, -1, "how.html has a Your audio section");
  const end = HOW.indexOf("</section>", start);
  return HOW.slice(start, end)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("how.html's Your audio section says the recording is deleted at AssemblyAI", () => {
  const text = audioSection();
  [
    "Your recording goes to AssemblyAI once, to be turned into words.",
    "As soon as the words are back, the app asks AssemblyAI to delete it.",
    "The app never keeps audio of its own.",
  ].forEach((sentence) => assert.ok(text.includes(sentence), sentence));
});

test("the Your audio section comes after rule 8 and before The Path", () => {
  const rule8 = HOW.indexOf("<h2>8. ");
  const audio = HOW.indexOf("<h2>Your audio</h2>");
  const thePath = HOW.indexOf("<h2>The Path</h2>");
  assert.ok(rule8 < audio && audio < thePath);
});

test("every sentence of the Your audio section is under 15 words, with no exclamation", () => {
  const text = audioSection();
  assert.ok(!text.includes("!"));
  text
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => sentence.trim() !== "")
    .forEach((sentence) => {
      const words = sentence.trim().split(" ").length;
      assert.ok(words < MAX_SENTENCE_WORDS, words + " words: " + sentence);
    });
});
