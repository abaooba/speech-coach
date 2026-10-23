// The Path's two sentences on how.html that the tester feedback changed (spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md sections 4 and 5), word for word
// and once each. The Path opens on the unit that holds the screen's primary Start: the weakest
// whose current level, or once all five are cleared its checkpoint, can start today
// (screens/path.js buildPath; path_screen_unit_switch.test.js). A unit whose level rests until
// tomorrow is passed over, even with a check-back due or its crown open, so the page says the
// weakest unit "where you can move ahead today", never just the weakest. Take 2 is take 1's
// topic or passage again, except on Pace levels 1 and 2, where every read draws a new cold read
// (path.js materialFor; path_fresh_pace_reads.test.js). Without this file either sentence could
// go back to its old, now false, wording with every test still passing.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HOW = fs.readFileSync(path.join(__dirname, "..", "how.html"), "utf8");

const FIRST_PARAGRAPH = [
  "The Path has four units: Restarts, Fillers, Long pauses and Pace.",
  "Each trains one skill over 5 levels.",
  "The Path opens on the weakest unit where you can move ahead today.",
];
const TAKE_2_CELL = [
  "The same topic or passage again, or a new passage on Pace levels 1 and 2.",
  "This is the take that counts.",
];

// Text as a reader sees it: no tags, no comments, one space between words.
function flat(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The HTML of the section headed "The Path".
function pathSection() {
  const start = HOW.indexOf("<h2>The Path</h2>");
  assert.notEqual(start, -1, "how.html has a section headed The Path");
  return HOW.slice(start, HOW.indexOf("</section>", start));
}

// The rows of the Path's loop table, each [step, what happens] as text.
function loopRows() {
  const rows = pathSection().matchAll(/<th scope="row">([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g);
  return [...rows].map((match) => [flat(match[1]), flat(match[2])]);
}

test("the Path section's first paragraph says where the Path opens, word for word", () => {
  const first = pathSection().match(/<p>([\s\S]*?)<\/p>/);
  assert.ok(first, "the Path section has a paragraph");
  assert.equal(flat(first[1]), FIRST_PARAGRAPH.join(" "));
});

test("the loop table's Take 2 row says what take 2 is said or read on, word for word", () => {
  const take2 = loopRows().filter(([step]) => step === "Take 2");
  assert.deepEqual(take2, [["Take 2", TAKE_2_CELL.join(" ")]]);
});

test("each of these sentences is on the page once, with no exclamation mark", () => {
  const text = flat(HOW);
  for (const sentence of [...FIRST_PARAGRAPH, ...TAKE_2_CELL]) {
    assert.equal(text.split(sentence).length - 1, 1, sentence);
    assert.ok(!sentence.includes("!"));
  }
});
