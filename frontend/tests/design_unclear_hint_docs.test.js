// Tests that DESIGN.md says what happens to an unclear-word hint (guided coach, final review
// finding 7): it is never counted, and no rule tip reads it, but it goes to the coach as a
// moment marked as a hint (as stumbles do), so a coach note may name it; the coach is told not to
// call it a mistake. how.html says the same to the speaker.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

function unclearParagraph() {
  const design = read("DESIGN.md");
  const start = design.indexOf("**Unclear word**");
  assert.ok(start !== -1);
  return design.slice(start, design.indexOf("\n", start));
}

test("DESIGN.md never claims no tip reads the unclear-word hint", () => {
  assert.doesNotMatch(unclearParagraph(), /no card, stat, clean stretch, tip/);
});

test("DESIGN.md says the coach gets it as a hint moment and may name it", () => {
  const paragraph = unclearParagraph();
  assert.match(paragraph, /no rule tip/);
  assert.match(paragraph, /goes to the coach as a moment marked as a hint/);
  assert.match(paragraph, /a coach note may name it/);
  assert.match(paragraph, /told not to call it a mistake/);
  const how = read("how.html").replace(/\s+/g, " ");
  assert.ok(how.includes("Moments marked as hints are guesses. The coach is told not to call them mistakes."));
});
