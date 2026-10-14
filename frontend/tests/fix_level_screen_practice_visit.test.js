// Review fix tests for a visit to Practice in the middle of a level (frontend/screens/level.js,
// spec docs/superpowers/specs/2026-10-14-loop-path.md sections 7 and 8, "The run"). The run, and
// take 1's audio with it, lives on at #/practice only while Practice holds one of the run's
// requests (app.screens.practice.holdsLevelRequest): a take of this play is being recorded,
// uploaded or retried there. The nav's Practice item, tapped with no take asked for, opens
// Practice in normal mode, so the run ends there and the audio is released, as on any other
// screen. Practice is the harness's fake, given here the holding rules practice.js keeps (and
// fix_practice_holds_level_request.test.js tests): it holds a request from startLevelTake until
// it hands the take back, or lets it go on leaving the screen with no take held.
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
  findAll,
  textOf,
} = require("./level-harness");

// node --test runs each test file in a process of its own, so gc() is exposed to this file only.
v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc");

const AUDIO_GONE = "Take 1's audio is gone: it is kept only while this level is open.";

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Practice as practice.js holds a request: from startLevelTake (before it goes to #/practice)
// until it lets it go. `held` is the request it holds, or null.
function modelPractice(world) {
  const practice = world.practice;
  practice.held = null;
  practice.startLevelTake = function startLevelTake(request) {
    this.requests.push(request);
    this.held = request;
    world.router.go("practice");
  };
  practice.holdsLevelRequest = (request) => request !== null && request === practice.held;
  return practice;
}

// Practice's side of a take that uploaded: it lets the request go, then hands the take back.
function handBack(world, result, extra) {
  world.practice.held = null;
  return world.finishTake(result, extra);
}

async function stillHeld(watched) {
  await new Promise((resolve) => setImmediate(resolve));
  collectGarbage();
  await new Promise((resolve) => setImmediate(resolve));
  return watched.deref() !== undefined;
}

function heading(world) {
  return textOf(find(world.body, "level-heading"));
}

// Fillers level 3 in its review, take 1's recording watched and decoded by a Play tap.
async function inReview() {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  modelPractice(world);
  await world.open("fillers-3");
  world.tap("Record take 1");
  const recording = fakeBlob("take-1");
  const watched = new WeakRef(recording);
  await handBack(world, talkResult({ fillers: 10 }), { blob: recording });
  world.tap("Review 3 moments (30 s)");
  findAll(world.body, "level-play")[0].click();
  await world.settle();
  return { world, watched, context: world.contexts[0] };
}

test("the nav's Practice item, no take asked for, ends the run and releases take 1", async () => {
  const { world, watched, context } = await inReview();
  world.router.go("practice");
  assert.equal(world.practice.requests.length, 1, "Practice was asked for nothing new");
  assert.equal(context.closed, true, "the AudioContext is closed");
  assert.equal(context.sources[0].stopped, true);
  assert.equal(await stillHeld(watched), false, "the recording is let go");

  // Back on the level, a new run starts at its Goal and says why the review is gone.
  await world.open("fillers-3");
  assert.equal(heading(world), "Goal");
  assert.equal(textOf(find(world.body, "level-goal__gone")), AUDIO_GONE);
  assert.equal(findAll(world.body, "level-play").length, 0);
});

test("a take asked of Practice keeps the run and the audio while Practice holds it", async () => {
  const { world, watched, context } = await inReview();
  world.tap("Say it again");
  assert.equal(world.practice.held, world.request());
  assert.equal(context.closed, false);
  assert.equal(await stillHeld(watched), true);
  await world.open("fillers-3");
  assert.equal(heading(world), "Look at 3 moments", "the review is where it was");
  findAll(world.body, "level-play")[0].click();
  await world.settle();
  assert.equal(context.decodes.length, 1, "no second decode");
});

test("a request Practice let go keeps the run no more: the next visit ends it", async () => {
  const { world, context } = await inReview();
  world.tap("Say it again");
  // Back to the level with no take recorded: Practice's hide() lets the request go.
  world.practice.held = null;
  await world.open("fillers-3");
  assert.equal(heading(world), "Look at 3 moments", "this same play keeps the run");
  assert.equal(context.closed, false);
  world.router.go("practice");
  assert.equal(context.closed, true);
});

test("a take Practice still holds (a failed upload) keeps the run across visits", async () => {
  const { world, context } = await inReview();
  world.tap("Say it again");
  // The upload fails; Practice keeps the take and its request while the speaker looks back.
  await world.open("fillers-3");
  world.router.go("practice");
  assert.equal(context.closed, false, "Retry can still hand take 2 back to this run");
  await handBack(world, talkResult({ fillers: 8 }));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(context.closed, true, "the Result releases it");
});

test("another screen still ends the run, whatever Practice holds", async () => {
  const { world, context } = await inReview();
  world.tap("Say it again");
  world.router.go("history");
  assert.equal(context.closed, true);
});
