// Review fix tests for a take that comes back after its run ended (frontend/screens/level.js,
// spec docs/superpowers/specs/2026-10-14-loop-path.md sections 7 and 8). Practice keeps a take
// whose upload failed, with its request, while the speaker visits another screen, and that visit
// ends the run. When Retry saves the take later, the take is judged and kept all the same, so the
// run comes back to show what it did: the Result, or after take 1 its feedback, without take 1's
// audio, which went with the run. A run of another play started meanwhile is left on screen.
// Practice's side (judge, save, onSaved) is played by tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  find,
  findAll,
  textOf,
  control,
} = require("./level-harness");

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

// Yesterday's take: 12 fillers in a minute and a half.
function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Fillers level 3 with take 2 asked of Practice, then a visit to `screen` and back to Practice,
// where the take's failed upload waits for Retry. The visit ends the run.
async function takeTwoLeftWaiting(screen) {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2"]),
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  world.tap("Say it again");
  world.router.go(screen);
  world.router.go("practice");
  return world;
}

function resultTitle(world) {
  return textOf(find(world.body, "level-result__title"));
}

test("take 2 retried after the speaker left and came back shows its Result", async () => {
  const world = await takeTwoLeftWaiting("history");
  const { pathField } = await world.finishTake(talkResult({ fillers: 10 }));
  assert.equal(pathField.passed, false);
  assert.deepEqual(world.router.gone.slice(-1), ["level/fillers-3"], "back to the level");
  assert.equal(world.heading.textContent, "Fillers, level 3");
  assert.equal(resultTitle(world), "Not yet");
  assert.equal(
    textOf(find(world.body, "level-result__sentence")),
    "6.7 fillers a minute on take 2. The target is 6.",
  );
  const current = find(world.body, "level-steps__item--current");
  assert.equal(textOf(find(current, "level-steps__label")), "Result");
  const focused = world.focusLog[world.focusLog.length - 1];
  assert.ok(focused === find(world.body, "level-heading"), "focus goes to the Result's heading");

  // The run carries on from there: take 3 is asked for, and its pass clears the level.
  world.tap("Try take 3");
  assert.equal(world.request().title, "Take 3");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(resultTitle(world), "Level cleared");
  assert.deepEqual(world.store.marks, ["fillers-3"]);
});

test("a pass retried after the run ended clears the level and says so", async () => {
  const world = await takeTwoLeftWaiting("progress");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.deepEqual(world.store.marks, ["fillers-3"]);
  assert.deepEqual(world.router.gone.slice(-1), ["level/fillers-3"]);
  assert.equal(resultTitle(world), "Level cleared");
  assert.ok(find(world.body, "level-checkback"), "with the check-back dates");
  assert.ok(control(world.body, "Start level 4"));
});

test("take 1 retried after the run ended opens its feedback, without its audio", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  world.router.go("history");
  world.router.go("practice");
  await world.finishTake(talkResult({ fillers: 10 }));
  assert.deepEqual(world.router.gone.slice(-1), ["level/fillers-3"]);
  assert.equal(textOf(find(world.body, "level-take__title")), "Take 1");
  world.tap("Review 3 moments (30 s)");
  assert.equal(
    textOf(find(world.body, "level-review__gone")),
    "Take 1's audio is gone: it is kept only while this level is open.",
  );
  assert.equal(findAll(world.body, "level-play").length, 0);
  assert.equal(world.contexts.length, 0);
  world.tap("Say it again");
  assert.equal(world.request().title, "Take 2 of 2");
});

test("a take that comes back after another play started leaves that play on screen", async () => {
  const world = await takeTwoLeftWaiting("path");
  await world.open("fillers-2");
  const gone = world.router.gone.length;
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.deepEqual(world.store.marks, ["fillers-3"], "the pass is still kept");
  assert.equal(world.router.gone.length, gone, "no route away from the play on screen");
  assert.equal(world.heading.textContent, "Fillers, level 2");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
});

test("a take that comes back as its play opens again shows the take, not a Goal", async () => {
  const world = await takeTwoLeftWaiting("path");
  // The speaker opens the level again from the Path as the take comes back.
  world.router.go("level", { id: "fillers-3" });
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(resultTitle(world), "Level cleared");
  assert.deepEqual(world.store.marks, ["fillers-3"]);
});

test("a take that comes back to a fresh Goal of its play shows the take there", async () => {
  const world = await takeTwoLeftWaiting("path");
  await world.open("fillers-3");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal", "a fresh run, nothing asked");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(resultTitle(world), "Level cleared");
  assert.deepEqual(world.store.marks, ["fillers-3"]);
});

test("a fresh run that already asked Practice for a take is left alone", async () => {
  const world = await takeTwoLeftWaiting("path");
  const waiting = world.request();
  await world.open("fillers-3");
  world.tap("Record take 1");
  const fresh = world.request();
  assert.ok(fresh !== waiting, "the fresh run asked for its own take 1");
  // The old take's upload, still out, comes back: it is kept, and the fresh run stays.
  world.practice.requests.push(waiting);
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.deepEqual(world.store.marks, ["fillers-3"]);
  world.practice.requests.push(fresh);
  await world.finishTake(talkResult({ fillers: 10 }));
  assert.deepEqual(world.router.gone.slice(-1), ["level/fillers-3"]);
  assert.equal(textOf(find(world.body, "level-take__title")), "Take 1");
});
