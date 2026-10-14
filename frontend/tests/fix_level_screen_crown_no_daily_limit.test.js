// Review fix for spec docs/superpowers/specs/2026-10-14-loop-path.md section 5: crowns "are never
// required, and have no daily limit." A loop rests after 3 misses in a day (section 4), but
// nothing pinned that a crown never does, so a Level screen that turned a crown away with "Back
// tomorrow" after 3 missed crown takes today passed every test. Here three missed takes of each
// crown, saved today, still leave its Goal offering a take, and a fourth miss on the screen
// leaves it open again; the same three misses on a loop do rest it, so the misses are counted
// where a rest is due. The screen runs for real in tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TODAY,
  at,
  createWorld,
  talkResult,
  savedTake,
  wordsOver,
  find,
  textOf,
  visibleText,
  control,
} = require("./level-harness");

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

// A take of `play` saved today at `hour` that missed: a crown's one take, or a loop's take 2.
function missToday(play, kind, hour) {
  return savedTake({
    id: play + "-miss-" + hour,
    createdAt: at(TODAY, hour),
    result: talkResult({ fillers: 12 }),
    path: {
      play,
      kind,
      take: kind === "loop" ? 2 : 1,
      scored: true,
      passed: false,
      stage: null,
      inRoom: null,
    },
  });
}

function threeMisses(play, kind) {
  return [missToday(play, kind, 9), missToday(play, kind, 8), missToday(play, kind, 7)];
}

const FILLERS_TO_THREE = ["fillers-1", "fillers-2", "fillers-3"];
const PACE_TO_THREE = ["pace-1", "pace-2", "pace-3"];

function primaryText(world) {
  const primary = find(world.body, "btn--primary");
  return primary ? visibleText(primary).trim() : null;
}

test("three misses today rest a loop, so this history is a real day of misses", async () => {
  const world = createWorld({
    history: threeMisses("fillers-3", "loop"),
    cleared: clearedOn(["fillers-2"]),
  });
  await world.open("fillers-3");
  assert.equal(textOf(find(world.body, "state__title")), "Back tomorrow");
});

test("three missed sudden-death takes today leave the Fillers crown open at its Goal", async () => {
  const world = createWorld({
    history: threeMisses("fillers_crown", "crown"),
    cleared: clearedOn(FILLERS_TO_THREE),
  });
  await world.open("fillers_crown");
  assert.equal(find(world.body, "state__title"), null, "no Back tomorrow, no lock");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
  assert.equal(primaryText(world), "Record");
});

test("three missed ladder reads today leave the Pace crown open at its Goal", async () => {
  const world = createWorld({
    history: threeMisses("pace_crown", "crown"),
    cleared: clearedOn(PACE_TO_THREE),
  });
  await world.open("pace_crown");
  assert.equal(find(world.body, "state__title"), null, "no Back tomorrow, no lock");
  assert.equal(primaryText(world), "Read it");
});

test("a fourth miss on the screen still leaves the crown open for a fifth", async () => {
  const world = createWorld({
    history: threeMisses("fillers_crown", "crown"),
    cleared: clearedOn(FILLERS_TO_THREE),
  });
  await world.open("fillers_crown");
  world.tap("Record");
  // An um 2 s in: far short of the first tier's 30 s run.
  await world.finishTake({
    transcript: wordsOver(110, 44, { 4: "um" }),
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  });
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  assert.equal(
    world.store.sessions.filter((take) => take.path && take.path.play === "fillers_crown").length,
    4,
    "four missed crown takes today",
  );
  assert.ok(control(world.body, "Back to path"));
  assert.equal(find(world.body, "level-rest"), null, "no rest line on a crown's Result");
  world.router.go("path");
  await world.open("fillers_crown");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal", "a new run, from the store");
  assert.equal(find(world.body, "state__title"), null);
  assert.equal(primaryText(world), "Record");
});
