// Review fix test for how long the Level screen holds take 1's recording once its review is over
// (frontend/screens/level.js, spec docs/superpowers/specs/2026-10-14-loop-path.md section 8, "The
// run" and "Review"). The Review after take 1 is the only step that plays take 1, and once a
// later take is saved the run never shows it again. Restarts levels 1 and 2 read three times, so
// after read 2 the run waits on read 3 with nothing left that could play take 1: the recording,
// its decoded buffer and its AudioContext go then, not at the Result. While read 2 records they
// stay, since the speaker can still come back to the review. The harness fakes the browser's
// audio; a WeakRef tells whether anything still holds the recording once the collector has run.
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
  textOf,
  visibleText,
} = require("./level-harness");

// node --test runs each test file in a process of its own, so gc() is exposed to this file only.
v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc");

function steadyHistory() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Whether anything still holds the recording once the collector has run.
async function stillHeld(watched) {
  await new Promise((resolve) => setImmediate(resolve));
  collectGarbage();
  await new Promise((resolve) => setImmediate(resolve));
  return watched.deref() !== undefined;
}

function heading(world) {
  return textOf(find(world.body, "level-heading"));
}

function primaryText(world) {
  return visibleText(find(world.body, "btn--primary")).trim();
}

// Restarts level 1 in its review, take 1's recording watched and decoded by a Play tap.
async function restartsOneReviewed() {
  const world = createWorld({ history: steadyHistory(), cleared: [] });
  await world.open("restarts-1");
  world.tap("Record read 1");
  const recording = fakeBlob("take-1");
  const watched = new WeakRef(recording);
  await world.finishTake(readResult({ restartsAt: [20, 60], misreadAt: [100] }), {
    blob: recording,
  });
  world.tap("Review 3 moments (30 s)");
  findAll(world.body, "level-play")[0].click();
  await world.settle();
  return { world, watched, context: world.contexts[0] };
}

test("take 1's audio stays while read 2 records: the review can still be reached", async () => {
  const { world, watched, context } = await restartsOneReviewed();
  assert.equal(context.decodes.length, 1, "take 1 was decoded for the review");
  world.tap("Read it again");
  assert.equal(world.request().title, "Read 2 of 3");
  assert.equal(context.closed, false);
  assert.equal(await stillHeld(watched), true);
});

test("once read 2 is saved, take 1's audio goes: read 3 has no review to play it", async () => {
  const { world, watched, context } = await restartsOneReviewed();
  world.tap("Read it again");
  await world.finishTake(readResult({ restartsAt: [20], misreadAt: [] }));
  assert.equal(heading(world), "Read 3", "the run waits on read 3");
  assert.equal(findAll(world.body, "level-play").length, 0, "nothing on screen plays take 1");
  assert.equal(context.closed, true, "the AudioContext is closed");
  assert.equal(context.sources[0].stopped, true);
  assert.equal(await stillHeld(watched), false, "the recording is let go");

  // Read 3 still counts and clears the level, with nothing left to release.
  assert.equal(primaryText(world), "Read it again");
  world.tap("Read it again");
  await world.finishTake(readResult({ restartsAt: [], misreadAt: [] }));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(world.contexts.length, 1, "no second context was ever made");
});

test("on Restarts level 2, a take 1 played through an <audio> element goes after read 2", async () => {
  // Restarts level 2 opens once level 1 is cleared; this recording cannot be decoded.
  const world = createWorld({
    history: steadyHistory(),
    cleared: [{ levelId: "restarts-1", clearedAt: at("2026-10-10") }],
    decodeFails: true,
  });
  await world.open("restarts-2");
  world.tap("Record read 1");
  await world.finishTake(readResult({ restartsAt: [20, 60], misreadAt: [100] }));
  world.tap("Review 3 moments (30 s)");
  findAll(world.body, "level-play")[0].click();
  await world.settle();
  const [element] = world.audioElements;
  const url = world.objectUrls.created[0].url;
  world.tap("Read it again");
  assert.deepEqual(world.objectUrls.revoked, [], "kept while read 2 records");
  await world.finishTake(readResult({ restartsAt: [20], misreadAt: [] }));
  assert.equal(heading(world), "Read 3");
  assert.deepEqual(world.objectUrls.revoked, [url], "the object URL is revoked");
  assert.equal(element.paused, true);
  assert.equal(element.hasAttribute("src"), false, "the element lets go of the recording");
});
