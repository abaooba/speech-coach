// Tests for the coach helpers each file used to copy (guided coach, final review finding 2): the
// coach line's parts and how they are drawn (app.sheet.lineParts, app.sheet.fillLine), opening a
// move's route (app.nextMove.go), the tier a speaker with no rank is coached at
// (app.tips.DEFAULT_TIER) and the m:ss clock (app.ui.formatClock). Each lives in one place, and
// Results, the Coach card, the Level screen and coach.js use it instead of a copy.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSheet() {
  const app = {};
  const document = {
    body: null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeTextNode(text),
  };
  vm.runInNewContext(read("sheet.js"), { app, document }, { filename: "sheet.js" });
  return app;
}

const MOMENTS = [
  { id: "filler-1", kind: "filler" },
  { id: "restart-1", kind: "restart" },
  { id: "long-pause-1", kind: "long-pause" },
];

// --- app.sheet.lineParts and fillLine --------------------------------------------------------

test("lineParts marks the quoted words with the kind of the moment the headline names", () => {
  const { sheet } = loadSheet();
  const text = "You said “um” at 0:08. Pause instead.";
  assert.deepEqual(plain(sheet.lineParts({ text, momentId: "filler-1" }, MOMENTS)), [
    { text: "You said " },
    { text: "um", quote: "filler" },
    { text: " at 0:08. Pause instead." },
  ]);
  const restart = sheet.lineParts({ text: "“I went, I went” restarted.", momentId: "restart-1" }, MOMENTS);
  assert.deepEqual(plain(restart), [
    { text: "I went, I went", quote: "restart" },
    { text: " restarted." },
  ]);
});

test("lineParts keeps a pause's words, an unknown moment's and a missing one's plain", () => {
  const { sheet } = loadSheet();
  const text = "After “so” you froze.";
  ["long-pause-1", "nope", null, undefined].forEach((momentId) => {
    const parts = plain(sheet.lineParts({ text, momentId }, MOMENTS));
    assert.equal(parts[1].quote, "pause", String(momentId));
  });
  assert.deepEqual(plain(sheet.lineParts({ text, momentId: "filler-1" }, null))[1].quote, "pause");
  assert.deepEqual(plain(sheet.lineParts({ text: "No quote here.", momentId: null }, MOMENTS)), [
    { text: "No quote here." },
  ]);
  assert.deepEqual(plain(sheet.lineParts(null, MOMENTS)), [{ text: "" }]);
});

test("fillLine draws the parts node by node, in the class asked for", () => {
  const { sheet } = loadSheet();
  const node = new FakeElement("p");
  node.textContent = "old";
  const parts = sheet.lineParts({ text: "You said “um”.", momentId: "filler-1" }, MOMENTS);
  sheet.fillLine(node, parts);
  assert.equal(node.textContent, "");
  assert.equal(node.children.length, 3);
  assert.equal(node.children[0].textContent, "You said ");
  assert.equal(node.children[1].className, "sheet__quote sheet__quote--filler");
  assert.equal(node.children[1].textContent, "“um”");
  sheet.fillLine(node, parts, "coach-card__quote");
  assert.equal(node.children.length, 3, "a second fill replaces the first");
  assert.equal(node.children[1].className, "coach-card__quote coach-card__quote--filler");
  sheet.fillLine(node, [{ text: "x", quote: "<b>" }]);
  assert.equal(node.children[0].className, "sheet__quote sheet__quote--pause", "unknown kinds plain");
});

test("Results, the Coach card and the Level screen build the coach line with app.sheet only", () => {
  ["screens/results.js", "screens/coachcard.js", "screens/level.js"].forEach((file) => {
    const source = read(file);
    assert.match(source, /\.lineParts\(/, file + " uses lineParts");
    assert.doesNotMatch(source, /QUOTE_KINDS|PLAIN_QUOTE/, file + " keeps no quote-kind map");
    assert.doesNotMatch(source, /\[“"\]\(\[\^”"\]\+\)\[”"\]/, file + " keeps no quote pattern");
  });
  assert.match(read("screens/coachcard.js"), /sheet\.fillLine\(/);
  assert.match(read("screens/level.js"), /app\.sheet\.fillLine\(/);
  assert.doesNotMatch(read("screens/level.js"), /"sheet__quote sheet__quote--"/, "no own spans");
  assert.doesNotMatch(read("screens/coachcard.js"), /QUOTED\.exec/);
});

// --- app.nextMove.go -------------------------------------------------------------------------

function loadNextMove() {
  const gone = [];
  const app = {
    router: {
      go(name, params) {
        gone.push(params === undefined ? [name] : [name, params]);
      },
    },
  };
  vm.runInNewContext(read("nextmove.js"), { app }, { filename: "nextmove.js" });
  return { app, gone };
}

test("app.nextMove.go opens the hash route a move names", () => {
  const { app, gone } = loadNextMove();
  app.nextMove.go("#/level/fillers-2_checkback");
  app.nextMove.go("#/practice");
  app.nextMove.go("#/level/a%20b");
  app.nextMove.go("");
  app.nextMove.go(undefined);
  assert.deepEqual(plain(gone), [
    ["level", { id: "fillers-2_checkback" }],
    ["practice"],
    ["level", { id: "a b" }],
    ["practice"],
    ["practice"],
  ]);
});

test("Results and the Level screen open a move's route with app.nextMove.go", () => {
  ["screens/results.js", "screens/level.js"].forEach((file) => {
    const source = read(file);
    assert.match(source, /app\.nextMove\.go\(/, file);
    assert.doesNotMatch(source, /replace\(\/\^#\\\/\?\/, ""\)/, file + " parses no href itself");
  });
});

// --- app.tips.DEFAULT_TIER -------------------------------------------------------------------

test("app.tips.DEFAULT_TIER is the server's default tier, named in one place", () => {
  const app = {};
  vm.runInNewContext(read("tips.js"), { app }, { filename: "tips.js" });
  assert.equal(app.tips.DEFAULT_TIER, "Novice");
  ["screens/results.js", "screens/level.js"].forEach((file) => {
    const source = read(file);
    assert.doesNotMatch(source, /"Novice"/, file + " names no tier of its own");
    assert.match(source, /app\.tips\.DEFAULT_TIER/, file);
  });
});

// --- coach.js's clock ------------------------------------------------------------------------

test("coach.js writes a moment's clock with app.ui.formatClock", () => {
  const source = read("coach.js");
  assert.match(source, /app\.ui\.formatClock\(/);
  assert.doesNotMatch(source, /function clockText/);
});
