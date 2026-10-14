// Review fix for owner decision 2's promise on the Level screen (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8, "Review" and "The run"): only take
// 1's audio is replayed from memory, and the privacy line with its lock says so on every Review.
// Two parts of it were unpinned: the line was checked only while take 1's audio was there, so a
// Review that dropped it once the audio was gone passed; and nothing checked that a later take's
// recording is never kept, so keeping read 2's recording in memory through read 3 (and letting
// take 1's go early) passed. Nothing on screen shows what the run holds, so the second test asks
// the garbage collector, as fix_level_screen_audio_release.test.js does: a WeakRef to a
// recording is cleared once nothing holds it. The screen runs for real in tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const v8 = require("node:v8");
const vm = require("node:vm");

const {
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  fakeBlob,
  find,
  findAll,
  byTag,
  textOf,
  visibleText,
} = require("./level-harness");

// node --test runs each test file in a process of its own, so gc() is exposed to this file only.
v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc");

const PRIVACY =
  "Take 1's audio stays in this phone's memory for this level only, then it is deleted. " +
  "It is never saved.";
const AUDIO_GONE = "Take 1's audio is gone: it is kept only while this level is open.";

// Whether anything still holds the recording `watched` points at once the collector has run.
async function stillHeld(watched) {
  await new Promise((resolve) => setImmediate(resolve));
  collectGarbage();
  await new Promise((resolve) => setImmediate(resolve));
  return watched.deref() !== undefined;
}

// Practice hands a take back with a recording only the screen may hold on to; the test keeps a
// WeakRef to it and nothing else.
async function handBack(world, result, name) {
  const recording = fakeBlob(name);
  const watched = new WeakRef(recording);
  await world.finishTake(result, { blob: recording });
  return watched;
}

test("without take 1's audio the Review still says the privacy line, with its lock", async () => {
  const world = createWorld({
    history: [
      savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
    ],
    cleared: [{ levelId: "fillers-2", clearedAt: at("2026-10-10") }],
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }), { blob: null });
  world.tap("Review 3 moments (30 s)");
  assert.equal(textOf(find(world.body, "level-review__gone")), AUDIO_GONE);
  assert.equal(findAll(world.body, "level-play").length, 0, "the Play buttons gave way");
  const line = find(world.body, "level-privacy");
  assert.ok(line, "the privacy line stays");
  assert.equal(visibleText(line).trim(), PRIVACY);
  assert.equal(byTag(line, "svg")[0].getAttribute("data-icon"), "lock");
  assert.equal(visibleText(find(world.body, "btn--primary")).trim(), "Say it again");
});

test("a three-read level keeps read 1's recording until read 2 is saved, no other", async () => {
  const world = createWorld({ history: [] });
  await world.open("restarts-1");
  world.tap("Record read 1");
  await handBack(world, readResult({ restartsAt: [20, 60], misreadAt: [100] }), "read-1");
  world.tap("Review 3 moments (30 s)");
  findAll(world.body, "level-play")[0].click();
  await world.settle();
  assert.equal(world.contexts.length, 1, "the first Play tap decoded read 1");
  const takeOne = world.contexts[0];
  assert.deepEqual(takeOne.decodes, [{ bytesOf: "read-1" }]);

  world.tap("Read it again");
  assert.equal(takeOne.closed, false, "read 1's audio stays while read 2 records: Back still reviews");
  const readTwo = await handBack(world, readResult({ restartsAt: [20] }), "read-2");
  assert.equal(world.request().title, "Read 2 of 3", "the take handed back was read 2");
  assert.equal(await stillHeld(readTwo), false, "read 2's recording is never kept");
  assert.equal(takeOne.closed, true, "read 2 saved: the Review is past, so read 1's audio goes");
  assert.equal(world.contexts.length, 1);

  world.tap("Read it again");
  const readThree = await handBack(world, readResult({}), "read-3");
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(await stillHeld(readThree), false, "nor is read 3's");
  assert.equal(takeOne.closed, true, "read 1's audio is still gone at the Result");
  assert.deepEqual(takeOne.decodes, [{ bytesOf: "read-1" }], "only read 1 was ever decoded");
});
