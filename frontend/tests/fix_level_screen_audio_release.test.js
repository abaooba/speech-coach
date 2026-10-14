// Review fix test for how long the Level screen holds take 1's recording (frontend/screens/
// level.js, spec docs/superpowers/specs/2026-10-14-loop-path.md section 8, "The run" and
// "Review"). Take 1 stays in memory only while its review can play it. When take 1 leaves no
// moment to look at, "Go to take 2" skips the review and nothing could ever play it, so the
// recording goes at once instead of waiting for the Result. Nothing on screen differs, so the
// test asks the garbage collector: a WeakRef to the recording is cleared once nothing holds it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const v8 = require("node:v8");
const vm = require("node:vm");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  fakeBlob,
  find,
  textOf,
  visibleText,
} = require("./level-harness");

// node --test runs each test file in a process of its own, so gc() is exposed to this file only.
v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc");

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Practice hands take 1 back with a recording that only the screen may hold on to; the test
// keeps a WeakRef to it and nothing else.
function handBackTakeOne(world, result) {
  const recording = fakeBlob("take-1");
  const watched = new WeakRef(recording);
  return world.finishTake(result, { blob: recording }).then(() => watched);
}

// Whether anything still holds the recording once the collector has run.
async function stillHeld(watched) {
  await new Promise((resolve) => setImmediate(resolve));
  collectGarbage();
  await new Promise((resolve) => setImmediate(resolve));
  return watched.deref() !== undefined;
}

async function fillersThreeAfter(take1) {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const watched = await handBackTakeOne(world, take1);
  return { world, watched };
}

test("take 1 with moments to look at stays in memory until the Result", async () => {
  const { world, watched } = await fillersThreeAfter(talkResult({ fillers: 10 }));
  assert.equal(visibleText(find(world.body, "btn--primary")).trim(), "Review 3 moments (30 s)");
  assert.equal(await stillHeld(watched), true, "the review can play it");
  world.tap("Review 3 moments (30 s)");
  world.tap("Say it again");
  assert.equal(await stillHeld(watched), true, "it stays while take 2 records");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(await stillHeld(watched), false, "the Result lets it go");
});

test("take 1 with no moment to look at is let go at once", async () => {
  const { world, watched } = await fillersThreeAfter(talkResult({ fillers: 0 }));
  assert.equal(textOf(find(world.body, "level-take__title")), "Take 1");
  assert.equal(visibleText(find(world.body, "btn--primary")).trim(), "Go to take 2");
  assert.equal(await stillHeld(watched), false, "nothing could play it");
  world.tap("Go to take 2");
  assert.equal(world.request().title, "Take 2 of 2");
});

test("a take 1 without speech has nothing to replay either", async () => {
  const { world, watched } = await fillersThreeAfter({
    transcript: [],
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 8,
  });
  assert.equal(textOf(find(world.body, "level-take__note")), "No speech was found in this take.");
  assert.equal(await stillHeld(watched), false);
});
