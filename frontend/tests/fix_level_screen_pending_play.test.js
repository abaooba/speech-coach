// Review fix tests for take 1's replay on the Level screen (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8, "Nothing plays on its own"). The
// first Play tap decodes take 1, and a tap still waiting on that decode when the speaker moves
// on (Say it again, the browser's Back to Practice, the review drawn again) plays nothing once
// the decode ends, on Practice or anywhere else. The run keeps its decoded audio for the review,
// where the next tap plays at once. The browser's audio is faked in tests/level-harness.js.
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
  visibleText,
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

// Fillers level 3's review, after a take 1 with ten fillers: three moments to play, each clip
// from 1 s before its moment.
async function fillersThreeReview() {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const take1 = talkResult({ fillers: 10 });
  await world.finishTake(take1);
  world.tap("Review 3 moments (30 s)");
  const report = world.app.delivery.analyze(take1.transcript, take1.metrics);
  const moments = world.app.loop.momentsFor("fillers-3", report, take1.transcript, 0);
  const offsets = Array.from(moments, (moment) => Math.round((moment.at - 1) * 1000) / 1000);
  return Object.assign(world, { offsets });
}

// Fillers level 2's review, Spot it first.
async function fillersTwoReview() {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-1"]) });
  await world.open("fillers-2");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ seconds: 60, words: 150, fillers: 6 }));
  world.tap("Review 3 moments (30 s)");
  return world;
}

function playButtons(world) {
  return findAll(world.body, "level-play");
}

function labelOf(button) {
  return visibleText(button).trim();
}

test("a clip still decoding when Say it again asks for take 2 plays nothing", async () => {
  const world = await fillersThreeReview();
  playButtons(world)[0].click();
  world.tap("Say it again");
  await world.settle();
  assert.deepEqual(world.router.gone.slice(-1), ["practice"]);
  const [context] = world.contexts;
  assert.equal(context.decodes.length, 1, "the decode itself still finishes");
  assert.equal(context.sources.length, 0, "no clip starts once it does");
  assert.equal(context.closed, false, "take 1's audio stays while take 2 records");

  // Back in the review, a tap plays at once from the take already decoded.
  await world.open("fillers-3");
  const [button] = playButtons(world);
  assert.equal(labelOf(button), "Play 3 s");
  button.click();
  await world.settle();
  assert.equal(context.decodes.length, 1, "no second decode");
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].started.duration, 3);
  assert.equal(labelOf(button), "Stop");
});

test("Spot it still decoding when Say it again starts take 2 never plays the take", async () => {
  const world = await fillersTwoReview();
  const spot = find(world.body, "level-spot");
  find(spot, "level-play").click();
  world.tap("Say it again");
  await world.settle();
  const [context] = world.contexts;
  assert.equal(context.decodes.length, 1);
  assert.equal(context.sources.length, 0, "the whole take never starts");
  assert.equal(find(spot, "level-spot__tap").disabled, true, "Heard one never goes live");
  assert.equal(context.closed, false);
});

test("a clip still decoding when the browser goes Back to Practice plays nothing", async () => {
  const world = await fillersThreeReview();
  playButtons(world)[0].click();
  world.router.go("practice");
  await world.settle();
  const [context] = world.contexts;
  assert.equal(context.sources.length, 0);
  assert.equal(context.closed, false, "Practice keeps the run and its audio");
});

test("a clip still decoding when the review is drawn again plays nothing", async () => {
  const world = await fillersThreeReview();
  playButtons(world)[0].click();
  world.router.go("practice");
  world.router.go("level", { id: "fillers-3" });
  await world.settle();
  assert.equal(world.contexts[0].sources.length, 0);
  assert.deepEqual(playButtons(world).map(labelOf), ["Play 3 s", "Play 3 s", "Play 3 s"]);
});

test("a decode that fails over to <audio> still plays nothing once left", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-2"]),
    decodeFails: true,
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  playButtons(world)[0].click();
  world.tap("Say it again");
  await world.settle();
  const [element] = world.audioElements;
  assert.ok(element, "the <audio> element stands by for the review");
  assert.deepEqual(element.plays, [], "it plays nothing on Practice");
  assert.equal(world.activeTimers("timeout"), 0, "no clip timer runs");
});

test("two taps while take 1 decodes: only the latest plays, its own clip", async () => {
  const world = await fillersThreeReview();
  const [first, second] = playButtons(world);
  first.click();
  second.click();
  await world.settle();
  const [context] = world.contexts;
  assert.equal(context.decodes.length, 1);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(context.sources[0].started, { when: 0, offset: world.offsets[1], duration: 3 });
  assert.equal(labelOf(first), "Play 3 s");
  assert.equal(labelOf(second), "Stop");
});
