// Review fix for Spot it's scoring on the Level screen (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8): its taps are matched with
// matchTaps(taps, eventTimes, {before: 0.5, after: 2.0}), and only live taps get
// {before: 0.5, after: 2.5}. loop.test.js pins both windows in app.loop, but the screen's one
// scoring test tapped 0.6 s after four fillers and 6 s after the last, well inside or outside
// either window, so the screen could score with the live tap's window, or keep its taps to the
// whole second, and still read "You caught 4 of 6." Here one play of take 1 holds a tap 2.2 s
// after a filler, which Spot it must not count and the live window would; another holds a tap
// 0.45 s before a filler, which counts when the tap is kept to a tenth of a second, as the screen
// keeps it, and not when it is rounded to the whole second. The screen runs for real in
// tests/level-harness.js, its audio faked there.
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

// Spot it's window and the live tap's, as the spec gives them.
const SPOT_IT_AFTER = 2;
const LIVE_TAP_AFTER = 2.5;
const BEFORE = 0.5;

// Fillers level 2 in its review, after a minute of take 1 with six fillers about 9 s apart.
async function spotItReview() {
  const steady = savedTake({
    id: "y1",
    createdAt: at("2026-10-13", 10),
    result: talkResult({ fillers: 12 }),
  });
  const world = createWorld({
    history: [steady],
    cleared: [{ levelId: "fillers-1", clearedAt: at("2026-10-10") }],
  });
  await world.open("fillers-2");
  world.tap("Record take 1");
  const take1 = talkResult({ seconds: 60, words: 150, fillers: 6 });
  await world.finishTake(take1);
  world.tap("Review 3 moments (30 s)");
  const report = world.app.delivery.analyze(take1.transcript, take1.metrics);
  const fillers = Array.from(world.app.loop.fillerTimes(report));
  const spot = find(world.body, "level-spot");
  return Object.assign(world, {
    fillers,
    spot,
    play: find(spot, "level-play"),
    heardOne: find(spot, "level-spot__tap"),
  });
}

// Plays take 1 through once from its start, tapping Heard one at each of `taps` seconds into the
// take, and returns the score Spot it shows at the end.
async function playThrough(world, taps) {
  const context = world.contexts[0];
  if (context) {
    context.currentTime = 0;
  }
  world.play.click();
  await world.settle();
  const audio = world.contexts[0];
  const source = audio.sources[audio.sources.length - 1];
  taps.forEach((seconds) => {
    audio.currentTime = seconds;
    world.heardOne.click();
  });
  source.finish();
  assert.equal(visibleText(world.play).trim(), "Play take 1", "take 1 played to its end");
  return textOf(find(world.spot, "level-spot__score"));
}

test("the fillers sit so far apart that a tap can only catch the one beside it", async () => {
  const world = await spotItReview();
  assert.equal(world.fillers.length, 6);
  world.fillers.slice(1).forEach((time, index) => {
    const gap = time - world.fillers[index];
    assert.ok(gap > LIVE_TAP_AFTER + BEFORE, "fillers " + gap.toFixed(1) + " s apart");
  });
});

test("Spot it leaves out a tap 2.2 s after a filler, which a live tap would count", async () => {
  const world = await spotItReview();
  const filler = world.fillers[1];
  const tap = filler + 2.2;
  assert.ok(tap > filler + SPOT_IT_AFTER && tap <= filler + LIVE_TAP_AFTER);
  assert.equal(await playThrough(world, [tap]), "You caught 0 of 6.");
  assert.equal(world.announcements[world.announcements.length - 1], "You caught 0 of 6.");
});

test("Spot it keeps a tap to a tenth of a second: 0.45 s early still catches", async () => {
  const world = await spotItReview();
  // A filler whose tap 0.45 s early, rounded to the whole second, would fall out of the window:
  // rounded to a tenth, as the screen keeps a tap, it stays in.
  const filler = world.fillers.find((time) => Math.round(time - 0.45) < time - BEFORE);
  assert.ok(filler !== undefined, "one filler's early tap rounds out at whole seconds");
  const tap = filler - 0.45;
  assert.ok(Math.round(tap * 10) / 10 >= filler - BEFORE, "to a tenth it stays in the window");
  assert.equal(await playThrough(world, [tap]), "You caught 1 of 6.");
});

test("each play of take 1 is scored on its own taps, with both kinds side by side", async () => {
  const world = await spotItReview();
  const early = world.fillers.find((time) => Math.round(time - 0.45) < time - BEFORE);
  assert.ok(![world.fillers[1], world.fillers[4]].includes(early), "three different fillers");
  const late = world.fillers[1] + 2.2;
  const inside = world.fillers[4] + 0.6;
  assert.equal(await playThrough(world, [late, early - 0.45, inside]), "You caught 2 of 6.");
  assert.equal(await playThrough(world, [inside]), "You caught 1 of 6.", "a replay starts over");
});
