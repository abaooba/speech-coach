// A crown part of the way earned does not look complete (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 9: "When earned, the crown is filled
// --warn"). The Fillers crown has five sudden-death runs; with 2 of them earned it was filled
// --warn exactly like 5 of 5, and only its name and closed card said "2 of 5 earned". The crown
// is earned, and filled, once every run is, as its card's "Crown earned." says; part of the way,
// it keeps the open crown's look with a gold edge, and its count shows under its label.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  mountPath,
  record,
  find,
  hasClass,
  visible,
  unitTitled,
  crownNode,
  stateOf,
} = require("./path-screen-harness");

// The crown node of a unit, drawn with these records cleared.
async function crownOf(unitTitle, ids) {
  const mounted = mountPath({ cleared: ids.map((id) => record(id, "2026-10-12")) });
  await mounted.screen.show({});
  return crownNode(unitTitled(mounted.body, unitTitle));
}

const FILLERS_OPEN = ["fillers-1", "fillers-2", "fillers-3"];
const FILLERS_RUNS = [1, 2, 3, 4, 5].map((tier) => "fillers_crown-" + tier);
const PACE_OPEN = ["pace-1", "pace-2", "pace-3"];

test("a crown with 2 of its 5 runs earned is partial, and shows its count", async () => {
  const crown = await crownOf("Fillers", [...FILLERS_OPEN, ...FILLERS_RUNS.slice(0, 2)]);
  assert.equal(stateOf(crown), "earned");
  assert.ok(hasClass(crown, "path-node--partial"), "drawn part of the way, not filled");
  const note = find(crown, "path-node__note");
  assert.ok(note, "the count is shown, not only spoken");
  assert.equal(visible(note), "2 of 5 earned");
  assert.equal(note.getAttribute("aria-hidden"), "true", "the name already says it");
  assert.equal(
    crown.getAttribute("aria-label"),
    "Fillers crown, Sudden death, optional, 2 of 5 earned",
  );
});

test("each run earned short of all five keeps the crown partial with its count", async () => {
  for (let earned = 1; earned < 5; earned += 1) {
    const crown = await crownOf("Fillers", [...FILLERS_OPEN, ...FILLERS_RUNS.slice(0, earned)]);
    assert.ok(hasClass(crown, "path-node--partial"), earned + " of 5");
    assert.equal(visible(find(crown, "path-node__note")), earned + " of 5 earned");
  }
});

test("a crown with every run earned is complete: no partial look, no count", async () => {
  const fillers = await crownOf("Fillers", [...FILLERS_OPEN, ...FILLERS_RUNS]);
  assert.equal(stateOf(fillers), "earned");
  assert.ok(!hasClass(fillers, "path-node--partial"));
  assert.equal(find(fillers, "path-node__note"), null);
  assert.equal(
    fillers.getAttribute("aria-label"),
    "Fillers crown, Sudden death, optional, earned",
  );

  const pace = await crownOf("Pace", [...PACE_OPEN, "pace_crown-1"]);
  assert.equal(stateOf(pace), "earned");
  assert.ok(!hasClass(pace, "path-node--partial"), "the ladder's one run is all of it");
  assert.equal(find(pace, "path-node__note"), null);
});

test("an open crown with no run earned, and a locked one, have no count", async () => {
  const open = await crownOf("Fillers", FILLERS_OPEN);
  assert.equal(stateOf(open), "open");
  assert.ok(!hasClass(open, "path-node--partial"));
  assert.equal(find(open, "path-node__note"), null);
  const locked = await crownOf("Fillers", []);
  assert.equal(stateOf(locked), "locked");
  assert.equal(find(locked, "path-node__note"), null);
});

// --- the stylesheet ------------------------------------------------------------------------

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const PATH_SECTION = CSS.slice(CSS.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");

// The declarations of the one top-level rule in the Path section with exactly this selector.
function declarations(selector) {
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const found = [];
  let match = pattern.exec(PATH_SECTION);
  while (match) {
    if (match[1].replace(/\s+/g, " ").trim() === selector) {
      found.push(match[2]);
    }
    match = pattern.exec(PATH_SECTION);
  }
  assert.equal(found.length, 1, "one rule for " + selector);
  return Object.fromEntries(
    found[0]
      .split(";")
      .filter((part) => part.includes(":"))
      .map((part) => [
        part.slice(0, part.indexOf(":")).trim(),
        part.slice(part.indexOf(":") + 1).replace(/\s+/g, " ").trim(),
      ]),
  );
}

const EARNED = ".path-node--crown.path-node--earned .path-node__circle";
const PARTIAL = ".path-node--crown.path-node--earned.path-node--partial .path-node__circle";

test("only a complete crown is filled --warn; a partial one keeps --bg inside a gold edge", () => {
  const earned = declarations(EARNED);
  assert.equal(earned.background, "var(--warn)", "an earned crown is filled gold");
  assert.equal(earned["border-color"], "var(--warn)", "the gold edge a partial crown keeps");
  const partial = declarations(PARTIAL);
  assert.equal(partial.background, "var(--bg)", "part of the way, the circle is not filled");
  assert.equal(partial.color, "var(--warn)", "its crown is gold, as an open crown's is");
  assert.equal(partial["border-color"], undefined, "the edge stays the earned crown's gold");
  // Both selectors are classes only: the partial one names one more, so it wins.
  const classes = (selector) => selector.split(".").length - 1;
  assert.equal(classes(PARTIAL), classes(EARNED) + 1);
});
