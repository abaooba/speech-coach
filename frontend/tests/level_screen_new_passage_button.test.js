// Tests for the words on the button that starts a later take on the Level screen
// (frontend/screens/level.js, spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md
// section 4). Every read of Pace level 1 and Pace level 2 draws a new cold read, so the button
// that starts the next one reads "Read a new passage": on the Review, and on the step before the
// second read of a retried Pace level 2 pair. Restarts rereads its one passage and keeps "Read it
// again", a talk keeps "Say it again" and the benchmark's talk "Record the talk". The Pace crown
// is one read, started from its Goal, so it has no such button. The screen runs for real through
// tests/level-harness.js; Practice is a fake that keeps each request, and the test plays
// Practice's part by calling judge and onSaved.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  find,
  textOf,
  visibleText,
  controlsOf,
} = require("./level-harness");

// What the button that starts a later take of a loop can say.
const NEW_PASSAGE = "Read a new passage";
const READ_AGAIN = "Read it again";
const SAY_AGAIN = "Say it again";
const LATER_TAKE_LABELS = [NEW_PASSAGE, READ_AGAIN, SAY_AGAIN];

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function steadyHistory() {
  return [
    savedTake({ id: "y2", createdAt: at("2026-10-13", 11), result: talkResult() }),
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult() }),
  ];
}

function heading(world) {
  return textOf(find(world.body, "level-heading"));
}

function primaryText(world) {
  return visibleText(find(world.body, "btn--primary")).trim();
}

// The words on every button and link in the screen's body.
function labels(world) {
  return controlsOf(world.body).map((each) => each.text);
}

// The step's primary button reads `label`, and no other control says another later take's words.
function assertStartsWith(world, label) {
  assert.equal(primaryText(world), label);
  const shown = labels(world);
  LATER_TAKE_LABELS.filter((each) => each !== label).forEach((other) => {
    assert.ok(!shown.includes(other), other + " in " + shown.join(", "));
  });
}

// A read of 150 words that followed its script, at `wpm`.
function readAt(wpm) {
  const words = 150;
  return readResult({ words, seconds: (words * 60) / wpm });
}

// --- Pace: a new passage for every read --------------------------------------------------------

test("Pace level 1's Review reads Read a new passage, never Read it again", async () => {
  const world = createWorld({ history: steadyHistory(), draws: [0] });
  await world.open("pace-1");
  world.tap("Record read 1");
  await world.finishTake(readAt(150));
  world.tap("Review 3 moments (30 s)");
  assert.equal(heading(world), "Look at 3 moments");
  assertStartsWith(world, NEW_PASSAGE);
  world.tap(NEW_PASSAGE);
  const [read1, read2] = world.practice.requests;
  assert.equal(read2.title, "Read 2 of 2");
  assert.notEqual(read2.material.id, read1.material.id, "the button keeps its word");
});

test("Pace level 2's Review reads Read a new passage", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["pace-1"]) });
  await world.open("pace-2");
  world.tap("Record read 1");
  await world.finishTake(readAt(140));
  world.tap("Review 3 moments (30 s)");
  assertStartsWith(world, NEW_PASSAGE);
  world.tap(NEW_PASSAGE);
  assert.equal(world.request().title, "Read 2 of 2");
});

test("Pace level 2's retried pair: read 4's step reads Read a new passage", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["pace-1"]),
    draws: [0],
  });
  await world.open("pace-2");
  world.tap("Record read 1");
  await world.finishTake(readAt(140));
  world.tap("Review 3 moments (30 s)");
  world.tap(NEW_PASSAGE);
  // Read 2 at 140 is out of its 150 to 170 band: the pair misses.
  await world.finishTake(readAt(140));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  world.tap("Try read 3");
  await world.finishTake(readAt(140));
  assert.equal(heading(world), "Read 4");
  assertStartsWith(world, NEW_PASSAGE);
  world.tap(NEW_PASSAGE);
  const reads = world.practice.requests;
  assert.equal(reads[3].title, "Read 4");
  assert.notEqual(reads[3].material.id, reads[2].material.id, "read 4 is not read 3's passage");
});

// --- What keeps its words ----------------------------------------------------------------------

test("Restarts level 1 keeps Read it again for read 2 and read 3, on its one passage", async () => {
  const world = createWorld({ history: steadyHistory() });
  await world.open("restarts-1");
  world.tap("Record read 1");
  await world.finishTake(readResult({ restartsAt: [20, 60], misreadAt: [100] }));
  world.tap("Review 3 moments (30 s)");
  assertStartsWith(world, READ_AGAIN);
  world.tap(READ_AGAIN);
  await world.finishTake(readResult({ restartsAt: [20] }));
  assert.equal(heading(world), "Read 3");
  assertStartsWith(world, READ_AGAIN);
  world.tap(READ_AGAIN);
  const reads = world.practice.requests;
  assert.deepEqual(
    reads.map((read) => read.title),
    ["Read 1 of 3", "Read 2 of 3", "Read 3 of 3"],
  );
  reads.forEach((read) => assert.equal(read.material.id, reads[0].material.id, read.title));
});

test("a talk keeps Say it again: Fillers level 3's Review", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 12 }));
  world.tap("Review 3 moments (30 s)");
  assertStartsWith(world, SAY_AGAIN);
  world.tap(SAY_AGAIN);
  assert.equal(world.request().title, "Take 2 of 2");
});

test("the benchmark's talk step keeps Record the talk", async () => {
  const world = createWorld({ history: steadyHistory() });
  await world.open("benchmark");
  world.tap("Start benchmark");
  await world.finishTake(readResult({ words: 160, seconds: 64 }));
  assert.equal(heading(world), "Talk");
  assertStartsWith(world, "Record the talk");
});

test("the Pace crown's one read starts from its Goal, and its Result offers no read", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["pace-1", "pace-2", "pace-3"]),
  });
  await world.open("pace_crown");
  assert.equal(primaryText(world), "Read it");
  world.tap("Read it");
  // 150 wpm misses the 170 to 190 band.
  await world.finishTake(readAt(150));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  assert.deepEqual(labels(world), ["Back to path"]);
});
