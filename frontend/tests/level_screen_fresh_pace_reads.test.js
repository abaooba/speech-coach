// Tests for the Level screen's fresh Pace reads (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 4, which builds section 3
// of docs/superpowers/specs/2026-10-18-fresh-reads-and-rehearsal-design.md): every read of Pace
// level 1, Pace level 2 and the Pace crown, retries included, hands Practice a cold read drawn
// over the run's own saved takes and then the store's, so no read repeats another while a cold
// read is unread; the draw is kept by take index, so a take asked for again, its set seconds and
// the coach's request all read the passage that take was read from; and the time bar lasts the
// passage's words at the read's pace. Restarts levels keep one passage a run and talk levels
// their topic. The screen runs for real through tests/level-harness.js; Practice is a fake that
// keeps each request, and the test plays Practice's part by calling judge and onSaved. One test
// hands a request to the real Practice screen (tests/practice-harness.js) for its time bar.
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
} = require("./level-harness");
const practiceHarness = require("./practice-harness");

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function steadyHistory() {
  return [
    savedTake({ id: "y2", createdAt: at("2026-10-13", 11), result: talkResult() }),
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult() }),
  ];
}

// The request's own fields, without its three callbacks.
function fieldsOf(request) {
  const { judge, onSaved, onLeave, ...fields } = request;
  assert.equal(typeof judge, "function");
  assert.equal(typeof onSaved, "function");
  assert.equal(typeof onLeave, "function");
  return plain(fields);
}

function primaryText(world) {
  return visibleText(find(world.body, "btn--primary")).trim();
}

function coldReadIds(world) {
  return Array.from(world.app.passages.coldReads(), (passage) => passage.id);
}

// A ladder read's set seconds: its passage's words at the read's target pace, rounded up.
function secondsAt(material, wpm) {
  return Math.ceil((material.text.trim().split(/\s+/).length * 60) / wpm);
}

// A read of 150 words that followed its script, at `wpm`.
function readAt(wpm) {
  const words = 150;
  return readResult({ words, seconds: (words * 60) / wpm });
}

// Read 1 of a two-read loop, its feedback, then the review's "Read it again": read 2's request.
async function toReadTwo(world, read1) {
  world.tap("Record read 1");
  await world.finishTake(read1);
  world.tap(primaryText(world));
  world.tap("Read it again");
}

// --- Pace level 1 -----------------------------------------------------------------------------

test("Pace level 1's read 1 is the cold read drawn at the Goal, timed at 150 wpm", async () => {
  const history = steadyHistory();
  const world = createWorld({ history, draws: [0.5] });
  await world.open("pace-1");
  world.tap("Record read 1");
  const read1 = fieldsOf(world.request());
  assert.deepEqual(
    read1.material,
    plain(world.app.path.materialFor("pace-1", history, () => 0.5, 0)),
  );
  assert.ok(coldReadIds(world).includes(read1.material.id), read1.material.id);
  assert.deepEqual(read1.material.targetWpm, [140, 160]);
  assert.equal(read1.seconds, secondsAt(read1.material, 150));
  assert.equal(read1.title, "Read 1 of 2");
  assert.equal(read1.body, "Read the passage at 140 to 160 wpm. Read 2 counts: 140 to 160 wpm.");
});

test("read 2 is a new cold read, never read 1's, even on the same draw", async () => {
  const world = createWorld({ history: steadyHistory(), draws: [0] });
  await world.open("pace-1");
  await toReadTwo(world, readAt(150));
  const [read1, read2] = world.practice.requests.map(fieldsOf);
  assert.notEqual(read2.material.id, read1.material.id);
  // The run's own read 1 comes first in the history the draw reads.
  assert.deepEqual(
    read2.material,
    plain(world.app.path.materialFor("pace-1", world.store.sessions, () => 0, 1)),
  );
  assert.ok(coldReadIds(world).includes(read2.material.id), read2.material.id);
  assert.deepEqual(read2.material.targetWpm, [140, 160]);
  assert.equal(read2.seconds, secondsAt(read2.material, 150));
  assert.equal(read2.title, "Read 2 of 2");
  assert.equal(read2.body, read1.body, "the banner's words stay");
});

test("each retry of Pace level 1 reads another new cold read: read 3, then 4", async () => {
  const world = createWorld({ history: steadyHistory(), draws: [0] });
  await world.open("pace-1");
  await toReadTwo(world, readAt(150));
  await world.finishTake(readAt(190));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  world.tap("Try read 3");
  await world.finishTake(readAt(190));
  world.tap("Try read 4");
  const reads = world.practice.requests.map(fieldsOf);
  assert.deepEqual(
    reads.map((read) => read.title),
    ["Read 1 of 2", "Read 2 of 2", "Read 3", "Read 4"],
  );
  const ids = reads.map((read) => read.material.id);
  assert.equal(new Set(ids).size, 4, ids.join(", "));
  reads.forEach((read) => {
    assert.ok(coldReadIds(world).includes(read.material.id), read.material.id);
    assert.deepEqual(read.material.targetWpm, [140, 160], read.title);
    assert.equal(read.seconds, secondsAt(read.material, 150), read.title);
  });
});

test("a take keeps its draw: read 2 asked for again reads the same passage", async () => {
  // A second draw for read 2 would take 0, and with it another passage than 0.99 took.
  const world = createWorld({ history: steadyHistory(), draws: [0, 0.99, 0] });
  await world.open("pace-1");
  await toReadTwo(world, readAt(150));
  const first = fieldsOf(world.request());
  // Back from Practice without recording: the run still stands on its Review.
  await world.open("pace-1");
  world.tap("Read it again");
  assert.equal(world.practice.requests.length, 3);
  assert.deepEqual(fieldsOf(world.request()), first);
});

test("Pace level 1's Goal says 2 reads of a new passage", async () => {
  const world = createWorld({ history: steadyHistory() });
  await world.open("pace-1");
  assert.equal(textOf(find(world.body, "level-target__length")), "2 reads of a new passage");
});

// --- Pace level 2 -----------------------------------------------------------------------------

test("Pace level 2 reads a new cold read each read, retried pair too, at its band", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["pace-1"]),
    draws: [0],
  });
  await world.open("pace-2");
  await toReadTwo(world, readAt(140));
  // Read 2 at 140 is out of its 150 to 170 band: the pair misses.
  await world.finishTake(readAt(140));
  world.tap("Try read 3");
  await world.finishTake(readAt(140));
  world.tap("Read it again");
  const reads = world.practice.requests.map(fieldsOf);
  assert.deepEqual(
    reads.map((read) => read.title),
    ["Read 1 of 2", "Read 2 of 2", "Read 3", "Read 4"],
  );
  assert.deepEqual(
    reads.map((read) => read.material.targetWpm),
    [
      [130, 150],
      [150, 170],
      [130, 150],
      [150, 170],
    ],
  );
  [140, 160, 140, 160].forEach((wpm, index) => {
    assert.equal(reads[index].seconds, secondsAt(reads[index].material, wpm), reads[index].title);
  });
  const ids = reads.map((read) => read.material.id);
  assert.equal(new Set(ids).size, 4, ids.join(", "));
  ids.forEach((id) => assert.ok(coldReadIds(world).includes(id), id));
});

test("the coach is asked about each read with the passage it read and its own band", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["pace-1"]),
    draws: [0],
  });
  const asked = [];
  world.app.coach = { coachMoments: () => [], coachTakeaway: () => null };
  world.app.tips = {
    DEFAULT_TIER: "default",
    coachNotes(session, report, targetWpm) {
      asked.push({ passageId: session.passageId, targetWpm: Array.from(targetWpm) });
      return Promise.resolve(null);
    },
  };
  await world.open("pace-2");
  await toReadTwo(world, readAt(140));
  await world.finishTake(readAt(160));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  const reads = world.practice.requests.map(fieldsOf);
  assert.deepEqual(
    asked,
    reads.map((read) => ({ passageId: read.material.id, targetWpm: read.material.targetWpm })),
  );
  assert.notEqual(asked[0].passageId, asked[1].passageId);
});

// --- The Pace crown ---------------------------------------------------------------------------

test("the Pace crown reads an unread cold read at 180 wpm; a new run, another", async () => {
  const world = createWorld({ draws: [0] });
  const readBefore = coldReadIds(world)[0];
  world.store.sessions = [
    savedTake({
      id: "r1",
      createdAt: at("2026-10-13", 9),
      passageId: readBefore,
      result: readResult({ words: 150, seconds: 60 }),
    }),
    ...steadyHistory(),
  ];
  world.store.cleared = clearedOn(["pace-1", "pace-2", "pace-3"]);
  await world.open("pace_crown");
  assert.equal(textOf(find(world.body, "level-target__length")), "One read of a new passage");
  world.tap("Read it");
  const crown = fieldsOf(world.request());
  assert.equal(crown.title, "One read");
  assert.ok(coldReadIds(world).includes(crown.material.id), crown.material.id);
  assert.notEqual(crown.material.id, readBefore);
  assert.deepEqual(crown.material.targetWpm, [170, 190]);
  assert.equal(crown.seconds, secondsAt(crown.material, 180));
  // 150 wpm misses the 170 to 190 band; the next run of the crown starts on another passage.
  await world.finishTake(readAt(150));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  world.router.go("path");
  await world.open("pace_crown");
  world.tap("Read it");
  const again = fieldsOf(world.request());
  assert.ok(![readBefore, crown.material.id].includes(again.material.id), again.material.id);
  assert.ok(coldReadIds(world).includes(again.material.id), again.material.id);
  assert.equal(again.seconds, secondsAt(again.material, 180));
});

test("the sheet's Try again after a missed Pace crown reads another new cold read", async () => {
  // The same draw every time: only the missed read, saved by this run, keeps it from coming back.
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["pace-1", "pace-2", "pace-3"]),
    draws: [0],
  });
  const sheets = [];
  world.app.sheet = {
    open(options) {
      sheets.push(options);
      return { update() {}, close() {} };
    },
  };
  // What app.nextMove picks after a missed crown: a new run of it.
  world.app.nextMove = () => ({
    kind: "retry",
    label: "Try again",
    why: "",
    href: "#/level/pace_crown",
  });
  await world.open("pace_crown");
  world.tap("Read it");
  const missed = fieldsOf(world.request());
  await world.finishTake(readAt(150));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  assert.equal(sheets.length, 1, "the sheet follows the result");
  assert.equal(sheets[0].primary.label, "Try again");
  sheets[0].primary.onSelect();
  await world.settle();
  assert.equal(textOf(find(world.body, "level-heading")), "Goal", "a new run");
  world.tap("Read it");
  assert.equal(world.practice.requests.length, 2);
  const again = fieldsOf(world.request());
  assert.notEqual(again.material.id, missed.material.id);
  assert.ok(coldReadIds(world).includes(again.material.id), again.material.id);
  assert.deepEqual(again.material.targetWpm, [170, 190]);
  assert.equal(again.seconds, secondsAt(again.material, 180));
});

// --- Practice's time bar ----------------------------------------------------------------------

test("Practice's time bar lasts the drawn passage's seconds, full at its end", async () => {
  const world = createWorld({ history: steadyHistory(), draws: [0] });
  await world.open("pace-1");
  world.tap("Record read 1");
  const request = world.request();
  const seconds = secondsAt(request.material, 150);
  assert.equal(request.seconds, seconds);
  const t = practiceHarness.setup();
  t.startLevel(request);
  const p = practiceHarness.parts(t);
  const clock = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  assert.equal(p.limit.textContent, "/ " + clock);
  assert.equal(p.limit.hidden, false);
  await t.startRecording();
  t.clock.advance(seconds * 500);
  assert.equal(p.limitFill.getAttribute("style"), "transform: scaleX(0.5)");
  assert.ok(!p.limitBar.classList.contains("practice__limit-bar--over"));
  t.clock.advance(seconds * 500);
  assert.ok(p.limitBar.classList.contains("practice__limit-bar--over"), "full at " + clock);
});

// --- What keeps its material ------------------------------------------------------------------

test("Restarts level 1 keeps one cold read for every read of a run, retries included", async () => {
  const world = createWorld({ history: steadyHistory(), draws: [0, 0.99, 0.5] });
  await world.open("restarts-1");
  const slips = () => readResult({ restartsAt: [10, 30, 50, 70, 90, 110] });
  world.tap("Record read 1");
  await world.finishTake(slips());
  world.tap(primaryText(world));
  world.tap("Read it again");
  await world.finishTake(slips());
  world.tap("Read it again");
  await world.finishTake(slips());
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  world.tap("Try read 4");
  const reads = world.practice.requests.map(fieldsOf);
  assert.deepEqual(
    reads.map((read) => read.title),
    ["Read 1 of 3", "Read 2 of 3", "Read 3 of 3", "Read 4"],
  );
  reads.forEach((read) => {
    assert.deepEqual(read.material, reads[0].material, read.title);
    assert.equal(read.seconds, 90, read.title);
  });
  assert.ok(coldReadIds(world).includes(reads[0].material.id), reads[0].material.id);
});

test("a talk level keeps its topic for take 2 and its retries", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["fillers-2"]),
    draws: [0, 0.99, 0.5],
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 12 }));
  world.tap(primaryText(world));
  world.tap("Say it again");
  await world.finishTake(talkResult({ fillers: 12 }));
  world.tap("Try take 3");
  const takes = world.practice.requests.map(fieldsOf);
  assert.equal(takes.length, 3);
  takes.forEach((take) => assert.deepEqual(take.material, takes[0].material, take.title));
  assert.equal(takes[0].material.kind, "prompt");
});
