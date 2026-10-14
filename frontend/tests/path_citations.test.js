// Tests that every cited line on the Loop Path matches backend/advice/library.json (spec
// docs/superpowers/specs/2026-10-14-loop-path.md, "Unit cards and tips"). Each level's tip shows
// a library entry's advice word for word, with the label backend/advice/__init__.py citation()
// builds and the entry's source url; each unit's "why this works" line links an entry's url. The
// unit tags each tip must match are the ones app.path.UNITS lists. passages.js, delivery.js and
// path.js load into a vm in index.html's order.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const LIBRARY_PATH = path.join(FRONTEND_DIR, "..", "backend", "advice", "library.json");
const LIBRARY = new Map(
  JSON.parse(fs.readFileSync(LIBRARY_PATH, "utf8")).map((entry) => [entry.id, entry]),
);

function loadPath() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app.path;
}

const PATH = loadPath();

// backend/advice/__init__.py citation(), line for line: "Author, Title (Year)"; with no author
// the publisher is credited and with no title the publisher stands in; undated is "n.d."; an
// empty part is left out with its comma.
function citation(entry) {
  const source = entry.source;
  const [credited, work] = source.author
    ? [source.author, source.title || source.publisher]
    : [source.publisher, source.title];
  const name = [credited, work].filter((part) => part).join(", ");
  const year = source.year === null ? "n.d." : String(source.year);
  return `${name} (${year})`;
}

function entryOf(id) {
  const entry = LIBRARY.get(id);
  assert.ok(entry, `library.json has no entry ${id}`);
  return entry;
}

test("the citation rule here matches backend citation() on sources with parts missing", () => {
  // Labels the backend's own citation() prints for these entries (run 2026-10-14).
  assert.equal(
    citation(entryOf("general-014")),
    "Mai Ngoc Tran, Kazuya Saito, Effects of the 4/3/2 Activity Revisited: Extending Boers " +
      "(2014) and Thai & Boers (2016) (n.d.)",
  );
  assert.equal(citation(entryOf("restart-060")), "David M. Cheshier, Rostrum (n.d.)");
  assert.equal(
    citation(entryOf("long-045")),
    "National Speech & Debate Association, Impromptu Starter Kit (n.d.)",
  );
  assert.equal(
    citation(entryOf("filler-085")),
    "Brittany Pawlik, Christopher J. Perrin, Reducing speech disfluencies during public " +
      "speaking using brief habit reversal (2020)",
  );
});

test("every level's tip is a library entry's advice word for word, labelled and linked", () => {
  const tips = PATH.UNITS.flatMap((unit) => Array.from(unit.levels, (level) => [level, unit]));
  assert.equal(tips.length, 20);
  for (const [level, unit] of tips) {
    const tip = level.tip;
    const entry = entryOf(tip.entry);
    assert.equal(tip.text, entry.advice, `${level.id}: the advice word for word`);
    assert.equal(tip.url, entry.source.url, `${level.id}: the source's url`);
    assert.equal(tip.label, citation(entry), `${level.id}: the label citation() builds`);
    const tags = Array.from(unit.tags);
    assert.ok(
      entry.targets.some((target) => tags.includes(target)),
      `${level.id}: ${tip.entry} is tagged ${entry.targets} but the unit trains ${tags}`,
    );
    assert.match(tip.url, /^https?:\/\//, `${level.id}: a web link`);
  }
});

test("no two levels of a unit share a tip", () => {
  for (const unit of PATH.UNITS) {
    const entries = Array.from(unit.levels, (level) => level.tip.entry);
    assert.equal(new Set(entries).size, entries.length, `${unit.id} repeats a tip`);
  }
});

test("every unit's why line links a library entry and carries its label", () => {
  const expected = {
    restarts: "restart-021",
    fillers: "filler-085",
    "long-pauses": "general-014",
    pace: "pause-029",
  };
  for (const unit of PATH.UNITS) {
    const why = unit.why;
    assert.equal(why.entry, expected[unit.id], unit.id);
    const entry = entryOf(why.entry);
    assert.equal(why.url, entry.source.url, `${unit.id}: the source's url`);
    assert.equal(why.label, citation(entry), `${unit.id}: the label citation() builds`);
    assert.ok(why.text.length > 20 && why.text.endsWith("."), `${unit.id}: a sentence`);
  }
});

test("the why lines say only what their entries say", () => {
  const byUnit = Object.fromEntries(Array.from(PATH.UNITS, (unit) => [unit.id, unit.why.text]));
  assert.equal(
    byUnit.restarts,
    "Restarts fade last: in one study they dropped only after the 4th repeat.",
  );
  assert.match(entryOf("restart-021").advice, /self-repairs only dropped after the fourth/);
  assert.equal(
    byUnit.fillers,
    "Noticing your fillers and pausing silently in their place cut disfluencies for all four " +
      "speakers in one study.",
  );
  assert.match(
    entryOf("filler-085").advice,
    /notice their disfluencies and were told to pause silently in their place, and all four cut/,
  );
  assert.equal(
    byUnit["long-pauses"],
    "Retelling a talk in less time on each repeat brought gains in speed and pausing that " +
      "lasted on a later test.",
  );
  assert.match(entryOf("general-014").advice, /Shrinking the time limit across repetitions/);
  assert.match(entryOf("general-014").advice, /gains in speed and pausing that lasted on a later/);
  assert.equal(
    byUnit.pace,
    "When untrained listeners rate fluency, pausing and speed explain most of their judgment.",
  );
  assert.match(
    entryOf("pause-029").advice,
    /^When untrained listeners rate fluency, pausing and speed explain most of their judgment/,
  );
});

test("every play carries its unit's why line; loops and check-backs their level's tip", () => {
  for (const unit of PATH.UNITS) {
    for (const level of unit.levels) {
      for (const id of [level.id, level.id + "_checkback"]) {
        const play = PATH.playById(id);
        assert.deepEqual(play.why, unit.why, id);
        assert.deepEqual(play.tip, level.tip, id);
      }
    }
    const checkpoint = PATH.playById(unit.id + "_checkpoint");
    assert.deepEqual(checkpoint.why, unit.why);
    assert.equal(checkpoint.tip, null);
  }
  assert.equal(PATH.playById("benchmark").why, null);
  assert.equal(PATH.playById("benchmark").tip, null);
});
