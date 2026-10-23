// The live pace's words (spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md section
// 7): how.html says, word for word and once each, that a live pace shows under the clock while
// you record, that the phone estimates it and sends nothing, and that it tunes itself once for
// Talk and once for Read, so it starts after the first take of 30 seconds or more in each. Those
// paragraphs get a section of their own just before "Your audio", whose privacy sentences stay
// as they were. The row's fixed sentence lives in one string literal, in practice.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");
const HOW = read("how.html");

const FIRST_PARAGRAPH = [
  "While you record, a live pace shows under the clock.",
  "Your phone estimates it from the beats of your syllables.",
  "Results counts your real words, so the two can differ.",
  "The live pace runs on your phone and sends nothing.",
];
const SECOND_PARAGRAPH = [
  "It tunes itself to your voice, once for Talk and once for Read.",
  "It starts after your first take of 30 seconds or more in each.",
];

// Text as a reader sees it: no tags, no comments, one space between words.
function flat(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The paragraphs of the section headed `heading`, as text.
function paragraphsOf(heading) {
  const start = HOW.indexOf("<h2>" + heading + "</h2>");
  assert.notEqual(start, -1, "how.html has a section headed " + heading);
  const section = HOW.slice(start, HOW.indexOf("</section>", start));
  return [...section.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) => flat(match[1]));
}

test("how.html's Live pace section says the spec's two paragraphs, word for word", () => {
  assert.deepEqual(paragraphsOf("Live pace"), [
    FIRST_PARAGRAPH.join(" "),
    SECOND_PARAGRAPH.join(" "),
  ]);
});

test("each live pace sentence is on the page once, with no exclamation mark", () => {
  const text = flat(HOW);
  for (const sentence of [...FIRST_PARAGRAPH, ...SECOND_PARAGRAPH]) {
    assert.equal(text.split(sentence).length - 1, 1, sentence);
    assert.ok(!sentence.includes("!"));
  }
});

test("the Live pace section sits after rule 8 and right before Your audio", () => {
  const rule8 = HOW.indexOf("<h2>8. ");
  const live = HOW.indexOf("<h2>Live pace</h2>");
  const audio = HOW.indexOf('<section class="how__section" id="your-audio">');
  assert.ok(rule8 !== -1 && rule8 < live && live < audio);
  const between = HOW.slice(HOW.indexOf("</section>", live) + "</section>".length, audio);
  assert.equal(between.trim(), "", "nothing between the two sections");
  assert.match(
    HOW.slice(0, live),
    /<section class="how__section">\s*$/,
    "a section of its own, in the page's pattern",
  );
});

test("the privacy sentences stay as they were", () => {
  const text = flat(HOW);
  for (const sentence of [
    "Your recording goes to AssemblyAI once, to be turned into words.",
    "As soon as the words are back, the app asks AssemblyAI to delete it.",
    "The app never keeps audio of its own.",
    "There is no account and no sign-in.",
    "Takes are saved in this browser on your phone.",
    "Clearing site data deletes them. There is no backup.",
  ]) {
    assert.equal(text.split(sentence).length - 1, 1, sentence);
  }
});

test("the row's waiting sentence lives in one string literal, in practice.js", () => {
  const sentence = "Your pace shows after a few seconds.";
  const sources = [
    "api.js",
    ...fs.readdirSync(path.join(FRONTEND, "screens")).map((file) => path.join("screens", file)),
  ];
  const counts = Object.fromEntries(
    sources.map((file) => [file, read(file).split(sentence).length - 1]),
  );
  assert.equal(counts[path.join("screens", "practice.js")], 1);
  assert.equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    1,
    JSON.stringify(counts),
  );
});
