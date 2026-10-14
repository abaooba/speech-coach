// Review fix tests for the Level screen's review with a keyboard or a screen reader
// (frontend/screens/level.js, spec docs/superpowers/specs/2026-10-14-loop-path.md section 8;
// DESIGN.md section 9, "Focus moves on purpose"). Spot it's Heard one goes quiet when take 1
// stops; with focus on it, focus moves to Play take 1 first rather than drop to the page. Each
// Play 3 s is named for its moment, so a list of the page's controls tells them apart, and its
// name starts with the words on the button. The fake DOM's focus log is the browser's focus.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  wordsOver,
  find,
  findAll,
  textOf,
  visibleText,
} = require("./level-harness");

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Fillers level 2's review with Spot it playing take 1, the take decoded.
async function spotItPlaying() {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-1"]) });
  await world.open("fillers-2");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ seconds: 60, words: 150, fillers: 6 }));
  world.tap("Review 3 moments (30 s)");
  const spot = find(world.body, "level-spot");
  const play = find(spot, "level-play");
  const tap = find(spot, "level-spot__tap");
  play.click();
  await world.settle();
  return Object.assign(world, {
    spot,
    playTake: play,
    heardOne: tap,
    whole: world.contexts[0].sources[0],
  });
}

// Whether `node` holds focus now. Elements are compared by identity: a failed deepEqual on two of
// them would print the whole fake page.
function focusIsOn(world, node) {
  return world.focusLog[world.focusLog.length - 1] === node;
}

function labelOf(button) {
  return visibleText(button).trim();
}

// --- Spot it ---------------------------------------------------------------------------------

test("take 1 ending with focus on Heard one hands focus to Play take 1", async () => {
  const world = await spotItPlaying();
  world.heardOne.focus();
  world.heardOne.click();
  world.whole.finish();
  assert.equal(world.heardOne.disabled, true);
  assert.ok(focusIsOn(world, world.playTake), "focus is not dropped with Heard one");
  assert.equal(labelOf(world.playTake), "Play take 1");
  assert.match(textOf(find(world.spot, "level-spot__score")), /^You caught \d of 6\.$/);
});

test("Spot it stopped with focus on Heard one hands focus to Play take 1 too", async () => {
  const world = await spotItPlaying();
  world.heardOne.focus();
  // Safari focuses no button on a tap, so focus stays on Heard one as a clip stops Spot it.
  find(findAll(world.body, "level-moment")[0], "level-play").click();
  assert.equal(world.whole.stopped, true);
  assert.equal(world.heardOne.disabled, true);
  assert.ok(focusIsOn(world, world.playTake));
});

test("Spot it leaves focus where it is when Heard one does not hold it", async () => {
  const world = await spotItPlaying();
  world.playTake.focus();
  const moves = world.focusLog.length;
  world.whole.finish();
  assert.equal(world.heardOne.disabled, true);
  assert.equal(world.focusLog.length, moves, "nothing is focused again");
});

// --- Play 3 s --------------------------------------------------------------------------------

test("each Play 3 s is named for its moment, and Stop playing it while it plays", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  const cards = findAll(world.body, "level-moment");
  const times = cards.map((card) => textOf(find(card, "level-moment__time")));
  const buttons = cards.map((card) => find(card, "level-play"));
  const names = () => buttons.map((button) => button.getAttribute("aria-label"));
  assert.deepEqual(
    names(),
    times.map((time) => "Play 3 s at " + time),
  );
  assert.equal(new Set(names()).size, 3, "no two moments share a name");
  assert.ok(buttons.every((button) => labelOf(button) === "Play 3 s"), "the words stay");

  buttons[0].click();
  await world.settle();
  assert.equal(labelOf(buttons[0]), "Stop");
  assert.equal(buttons[0].getAttribute("aria-label"), "Stop playing " + times[0]);
  buttons[1].click();
  await world.settle();
  assert.deepEqual(names(), [
    "Play 3 s at " + times[0],
    "Stop playing " + times[1],
    "Play 3 s at " + times[2],
  ]);
  world.contexts[0].sources[1].finish();
  assert.deepEqual(
    names(),
    times.map((time) => "Play 3 s at " + time),
  );
});

test("a pace third's Play 3 s is named for the stretch it starts", async () => {
  // 40 words in the first 10 s, then 50 over the next 20 s: three thirds of the read.
  const fast = wordsOver(40, 10);
  const steady = wordsOver(50, 20, {}, 11).map((word, index) =>
    Object.assign(word, { text: "steady" + index }),
  );
  const world = createWorld({ history: [] });
  await world.open("pace-1");
  world.tap("Record read 1");
  await world.finishTake({
    transcript: fast.concat(steady),
    metrics: {
      pauses: [],
      repeats: [],
      fillers: {},
      script: { restarts: [], skipped: [], misread: [] },
    },
    durationSeconds: 32,
  });
  world.tap("Review 3 moments (30 s)");
  const cards = findAll(world.body, "level-moment");
  const stretches = cards.map((card) => textOf(find(card, "level-moment__time")));
  assert.ok(stretches.every((stretch) => / to /.test(stretch)), stretches.join(", "));
  const buttons = cards.map((card) => find(card, "level-play"));
  assert.deepEqual(
    buttons.map((button) => button.getAttribute("aria-label")),
    stretches.map((stretch) => "Play 3 s of " + stretch),
  );
  buttons[2].click();
  await world.settle();
  assert.equal(buttons[2].getAttribute("aria-label"), "Stop playing " + stretches[2]);
});
