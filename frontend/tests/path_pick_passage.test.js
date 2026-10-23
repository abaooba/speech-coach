// Tests for app.path.pickPassage (frontend/path.js), the draw Practice's Read tab makes on every
// tap (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 2.1): from a list of
// passages, one no take has read, drawn with the random source; once every one has been read, the
// one read longest ago; `exclude`, an id or a list of ids, passed over while another is left.
// pickColdRead is pickPassage over app.passages.coldReads(), with the same results it always had.
// passages.js, delivery.js and path.js load into a vm in index.html's order.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  for (const file of ["passages.js", "delivery.js", "path.js"]) {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  }
  return app;
}

const APP = loadApp();
const PATH = APP.path;

// Four passages of one Read group, shaped like app.passages entries.
const GROUP = ["first", "second", "third", "fourth"].map((name) => ({
  id: "story-" + name,
  kind: "passage",
  title: "Story: the " + name + " one",
  text: "A short story, the " + name + " of four.",
  targetWpm: [150, 170],
  group: "story",
}));

function ids(list) {
  return list.map((passage) => passage.id);
}

// A take that read `passageId` at `createdAt`.
function readOn(passageId, createdAt = "2026-10-22T10:00:00.000Z") {
  return { id: "take-" + passageId + "-" + createdAt, createdAt, passageId, passageTitle: "" };
}

// The time `minute` minutes past ten on the day of these takes.
function atMinute(minute) {
  return `2026-10-22T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

// A random source that always returns `value` and counts how often it was asked.
function drawOf(value) {
  const draw = () => {
    draw.calls += 1;
    return value;
  };
  draw.calls = 0;
  return draw;
}

test("app.path exports pickPassage beside pickColdRead", () => {
  assert.equal(typeof PATH.pickPassage, "function");
  assert.equal(typeof PATH.pickColdRead, "function");
});

test("with nothing read, the draw picks the passage: the same draw, the same passage", () => {
  GROUP.forEach((passage, index) => {
    const draw = (index + 0.5) / GROUP.length;
    assert.equal(PATH.pickPassage([], GROUP, () => draw), passage, String(draw));
    assert.equal(PATH.pickPassage([], GROUP, () => draw), passage, "again");
  });
});

test("a passage any take has read is passed over while an unread one is left", () => {
  const history = [readOn("story-first"), readOn("story-second"), readOn("story-fourth")];
  for (const draw of [0, 0.25, 0.5, 0.999]) {
    assert.equal(PATH.pickPassage(history, GROUP, () => draw).id, "story-third", String(draw));
  }
});

test("the draw runs over the unread passages only, in the list's order", () => {
  const history = [readOn("story-second")];
  assert.equal(PATH.pickPassage(history, GROUP, () => 0).id, "story-first");
  assert.equal(PATH.pickPassage(history, GROUP, () => 0.5).id, "story-third");
  assert.equal(PATH.pickPassage(history, GROUP, () => 0.9).id, "story-fourth");
});

test("once every passage is read, the one whose latest read is oldest comes back", () => {
  const history = [
    readOn("story-first", "2026-10-22T09:00:00.000Z"),
    readOn("story-second", "2026-10-22T09:30:00.000Z"),
    readOn("story-third", "2026-10-22T09:10:00.000Z"),
    readOn("story-fourth", "2026-10-22T09:20:00.000Z"),
    // Read first of all, and again last: its latest read counts.
    readOn("story-first", "2026-10-22T11:00:00.000Z"),
  ];
  const draw = drawOf(0.99);
  assert.equal(PATH.pickPassage(history, GROUP, draw).id, "story-third");
  assert.equal(draw.calls, 0, "no draw is made once every passage is read");
});

test("a tie between passages read equally long ago goes to the one listed first", () => {
  const history = ids(GROUP).map((id) => readOn(id, "2026-10-22T10:00:00.000Z"));
  assert.equal(PATH.pickPassage(history, GROUP, () => 0.99).id, "story-first");
});

test("with an unread passage left, the random source is asked exactly once", () => {
  const draw = drawOf(0.3);
  PATH.pickPassage([readOn("story-first")], GROUP, draw);
  assert.equal(draw.calls, 1);
});

test("exclude, an id or a list of ids, is passed over while another passage is left", () => {
  assert.equal(PATH.pickPassage([], GROUP, () => 0, "story-first").id, "story-second");
  assert.equal(
    PATH.pickPassage([], GROUP, () => 0, ["story-first", "story-second"]).id,
    "story-third",
  );
  assert.equal(PATH.pickPassage([], GROUP, () => 0, ids(GROUP)).id, "story-first", "all of them");
  assert.equal(PATH.pickPassage([], GROUP, () => 0, "not-listed").id, "story-first");
});

test("an excluded passage stays out even when it is the only one unread", () => {
  const history = [
    readOn("story-second", "2026-10-22T09:00:00.000Z"),
    readOn("story-third", "2026-10-22T08:00:00.000Z"),
    readOn("story-fourth", "2026-10-22T10:00:00.000Z"),
  ];
  assert.equal(PATH.pickPassage(history, GROUP, () => 0, "story-first").id, "story-third");
});

test("a list of one gives that one, excluded or not; an empty list gives null", () => {
  const [only] = GROUP;
  assert.equal(PATH.pickPassage([], [only], () => 0.7), only);
  assert.equal(PATH.pickPassage([], [only], () => 0.7, only.id), only);
  assert.equal(PATH.pickPassage([readOn(only.id)], [only], () => 0.7, only.id), only);
  assert.equal(PATH.pickPassage([], [], () => 0.7), null);
  assert.equal(PATH.pickPassage([], undefined, () => 0.7), null);
});

test("pickPassage needs a random source and keeps an odd draw inside the list", () => {
  assert.throws(() => PATH.pickPassage([], GROUP), /random/);
  assert.equal(PATH.pickPassage([], GROUP, () => 1).id, "story-fourth");
  assert.equal(PATH.pickPassage([], GROUP, () => -0.5).id, "story-first");
  assert.equal(PATH.pickPassage([], GROUP, () => Number.NaN).id, "story-first");
});

test("pickPassage reads only object takes and changes neither of its lists", () => {
  const passages = Object.freeze(GROUP.map((passage) => Object.freeze({ ...passage })));
  const history = Object.freeze([null, 3, "story-first", Object.freeze(readOn("story-second"))]);
  assert.equal(PATH.pickPassage(history, passages, () => 0).id, "story-first");
  assert.equal(PATH.pickPassage(undefined, passages, () => 0).id, "story-first");
});

// pickColdRead keeps its results: it is pickPassage over the cold reads, nothing excluded.
test("pickColdRead gives what pickPassage gives over the cold reads, for every draw", () => {
  const coldReads = Array.from(APP.passages.coldReads());
  const coldIds = ids(coldReads);
  const histories = [
    [],
    coldIds.slice(0, 5).map((id) => readOn(id)),
    coldIds.slice(0, -1).map((id) => readOn(id)),
    coldIds.map((id, index) => readOn(id, atMinute(59 - index))),
    [readOn("explainer-rainbows"), readOn(coldIds[3]), null],
  ];
  for (const history of histories) {
    for (const draw of [0, 0.13, 0.5, 0.77, 0.999]) {
      const cold = PATH.pickColdRead(history, () => draw);
      const picked = PATH.pickPassage(history, coldReads, () => draw);
      assert.equal(cold.id, picked.id, `${history.length} takes, draw ${draw}`);
    }
  }
});

test("pickColdRead still names itself when it has no random source", () => {
  assert.throws(() => PATH.pickColdRead([]), /pickColdRead needs a random source/);
});
