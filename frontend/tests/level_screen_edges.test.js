// Edge cases of the Level screen's run (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 2, 7 and 8): a brand-new speaker whose
// take 1 holds no speech, a pass Practice hands back after the run has ended, Leave level, the
// h1 set before the store answers, and a visit left before its load finishes. The screen runs for
// real through tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  find,
  textOf,
  visibleText,
} = require("./level-harness");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

const SILENT = {
  transcript: [],
  metrics: { pauses: [], repeats: [], fillers: {} },
  durationSeconds: 6,
};

test("a new speaker's take 1 without speech: take 2 is still judged, on its own numbers", async () => {
  const world = createWorld({ history: [] });
  await world.open("fillers-1");
  world.tap("Record take 1");
  const first = await world.finishTake(SILENT);
  assert.deepEqual(plain(first.pathField), {
    play: "fillers-1",
    kind: "loop",
    take: 1,
    scored: false,
    passed: null,
    stage: null,
    inRoom: null,
  });
  assert.equal(textOf(find(world.body, "level-take__note")), "No speech was found in this take.");
  assert.equal(visibleText(find(world.body, "btn--primary")).trim(), "Go to take 2");
  world.tap("Go to take 2");
  assert.equal(
    world.request().body,
    "Talk for 60 s. Take 2 counts: 8 or fewer fillers a minute, or halfway there from take 1.",
  );
  // 3 fillers in a minute: under the 8 a take standing in for its own baseline is held to.
  const second = await world.finishTake(talkResult({ seconds: 60, words: 150, fillers: 3 }));
  assert.equal(second.pathField.passed, true);
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.ok(world.store.marks.includes("fillers-1"));
});

// A take that answers an ended run is judged and saved all the same, so the speaker sees it
// (review fix: fix_level_screen_ended_run.test.js covers the ways back in).
test("a pass handed back after the run ended writes its records and shows them", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2"]),
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  world.tap("Say it again");
  world.router.go("path");
  const gone = world.router.gone.length;
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.deepEqual(world.store.marks, ["fillers-3"]);
  assert.deepEqual(world.router.gone.slice(gone), ["level/fillers-3"], "one route, to the run");
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
});

test("Leave level during take 1 ends the run: the level starts again at a fresh Goal", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2"]),
    draws: [0, 0.99],
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const firstTopic = world.request().material.topic;
  world.request().onLeave();
  assert.deepEqual(world.router.gone.slice(-1), ["practice"], "Leave level stays on Practice");
  await world.open("fillers-3");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
  world.tap("Record take 1");
  assert.notEqual(world.request().material.topic, firstTopic, "a fresh run, fresh material");
});

test("the h1 names the play before the store answers, so the tab's title does too", () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  world.router.go("level", { id: "fillers-3" });
  assert.equal(world.heading.textContent, "Fillers, level 3");
  assert.equal(textOf(find(world.body, "state__title")), "Loading your level");
});

test("a visit left before its load finishes draws nothing", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  world.router.go("level", { id: "fillers-3" });
  world.router.go("history");
  await world.settle();
  assert.equal(find(world.body, "level-steps"), null);
  // Coming back starts the play properly.
  await world.open("fillers-3");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
});
