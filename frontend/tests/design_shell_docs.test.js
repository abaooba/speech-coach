// Tests that DESIGN.md sections 1 and 2 describe the shell index.html is: a row in the screen
// table for every <section class="screen">, the number of those sections in the file layout, and
// every <script src> in the layout and in the script order. DESIGN.md's own rule says a new file
// "joins this list, that test, SHELL in sw.js ... and index.html together"; T49 added auth.js and
// screens/account.js (the #/account screen) to the other three.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const INDEX_HTML = read("index.html");
const DESIGN = read("DESIGN.md");

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
];

const SCREENS = [...INDEX_HTML.matchAll(/<section class="screen" id="screen-([a-z]+)"/g)].map(
  (match) => match[1],
);
const SCRIPTS = [...INDEX_HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const SCREEN_SCRIPTS = SCRIPTS.filter((file) => file.startsWith("screens/"));
const HELPER_SCRIPTS = SCRIPTS.filter((file) => !file.startsWith("screens/"));

// The text of DESIGN.md's section `number`, up to the next "## " heading.
function section(number) {
  const start = DESIGN.indexOf("\n## " + number + ". ");
  assert.ok(start !== -1, "DESIGN.md has section " + number);
  const end = DESIGN.indexOf("\n## ", start + 1);
  return DESIGN.slice(start, end === -1 ? undefined : end);
}

test("index.html has the account screen and loads auth.js and screens/account.js", () => {
  assert.ok(SCREENS.includes("account"));
  assert.ok(HELPER_SCRIPTS.includes("auth.js"));
  assert.ok(SCREEN_SCRIPTS.includes("screens/account.js"));
});

test("DESIGN.md's screen table has a row for every screen index.html holds", () => {
  const rows = section(1)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Screen") && !/^\|-/.test(line));
  SCREENS.forEach((name) => {
    const row = rows.find((line) => line.includes("| `#/" + name));
    assert.ok(row, "a row routes to #/" + name);
  });
  assert.equal(rows.length, SCREENS.length, "one row a screen");
});

test("DESIGN.md's file layout counts the sections and names every script", () => {
  const layout = section(2).match(/```\n([\s\S]*?)```/)[1];
  const count = NUMBER_WORDS[SCREENS.length];
  assert.ok(layout.includes("index.html          " + count + ' <section class="screen">'), count);
  HELPER_SCRIPTS.forEach((file) => {
    assert.match(layout, new RegExp("^  " + file.replace(".", "\\.") + " ", "m"), file);
  });
  const screensLine = layout.split("\n").find((line) => line.startsWith("  screens/"));
  assert.equal(
    screensLine.trim(),
    "screens/" + SCREEN_SCRIPTS.map((file) => file.slice("screens/".length)).join(" "),
  );
});

test("DESIGN.md's script order is index.html's", () => {
  const sentence = section(2)
    .split("\n")
    .find((line) => line.startsWith("Script order: "));
  assert.ok(sentence, "DESIGN.md states the script order");
  const order = sentence.slice(0, sentence.indexOf(", then the "));
  assert.deepEqual(
    [...order.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
    HELPER_SCRIPTS,
  );
  assert.ok(
    sentence.includes(", then the " + NUMBER_WORDS[SCREEN_SCRIPTS.length] + " screens."),
    "then the screens, as many as index.html loads",
  );
});
