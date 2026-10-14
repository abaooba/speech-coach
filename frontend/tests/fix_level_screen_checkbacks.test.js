// Review fix tests for check-backs on the Level screen (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 5, 8 and 9): a check-back starts only
// on the day app.path.checkbacks says it is due, as the Path offers it. Before that day the
// screen says when it is due and starts nothing; a level locked in gold has no check-back left.
// A due one starts at its Goal. The tests run on Wednesday 2026-10-14 (tests/level-harness.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  find,
  byTag,
  textOf,
} = require("./level-harness");

// Yesterday's take: 12 fillers in a minute and a half.
function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

function kept(levelId, day) {
  return { levelId, clearedAt: at(day) };
}

// The state a play that cannot start shows: its title, body and icon.
function stateOf(world) {
  const state = find(world.body, "state");
  assert.ok(state, "a state block shows");
  return {
    title: textOf(find(state, "state__title")),
    body: textOf(find(state, "state__body")),
    icon: byTag(state, "svg")[0].getAttribute("data-icon"),
  };
}

// Nothing was started: no stepper, no Goal, no request beyond the ones made before.
function assertNothingStarts(world, requestsBefore) {
  assert.equal(find(world.body, "level-steps"), null);
  assert.equal(world.practice.requests.length, requestsBefore);
  world.tap("Back to path");
  assert.deepEqual(world.router.gone.slice(-1), ["path"]);
}

test("a check-back due today starts at its Goal", async () => {
  // Cleared Monday: check-back 1 falls 2 days later, today.
  const world = createWorld({
    history: fillersYesterday(),
    cleared: [kept("fillers-3", "2026-10-12")],
  });
  await world.open("fillers-3_checkback");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
  world.tap("Record");
  assert.equal(world.practice.requests.length, 1);
});

test("a check-back not due yet says when it is due, and starts nothing", async () => {
  // Cleared yesterday: check-back 1 falls tomorrow.
  const world = createWorld({
    history: fillersYesterday(),
    cleared: [kept("fillers-3", "2026-10-13")],
  });
  await world.open("fillers-3_checkback");
  assert.equal(world.heading.textContent, "Fillers, level 3 check-back");
  assert.deepEqual(stateOf(world), {
    title: "Not due yet",
    body: "Check-back 1 is due Thursday, Oct 15.",
    icon: "calendar",
  });
  assertNothingStarts(world, 0);
});

test("check-back 2 waits for its own day after check-back 1 passes", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: [kept("fillers-3", "2026-10-12")],
  });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await world.finishTake(talkResult({ fillers: 5 }));
  assert.deepEqual(world.store.marks, ["fillers-3_cb1"]);

  // Back to path, then the browser's Back to the check-back: check-back 2 falls 7 days after
  // the level was cleared, on Monday.
  world.router.go("path");
  await world.open("fillers-3_checkback");
  assert.deepEqual(stateOf(world), {
    title: "Not due yet",
    body: "Check-back 2 is due Monday, Oct 19.",
    icon: "calendar",
  });
  assertNothingStarts(world, 1);
  assert.deepEqual(world.store.marks, ["fillers-3_cb1"], "no gold before its day");
});

test("a missed check-back comes back 2 days after the miss, not before", async () => {
  const miss = savedTake({
    id: "missed",
    createdAt: at("2026-10-13", 18),
    result: talkResult({ fillers: 12 }),
    path: {
      play: "fillers-3_checkback",
      kind: "checkback",
      take: 1,
      scored: true,
      passed: false,
      stage: 1,
      inRoom: null,
    },
  });
  const world = createWorld({
    history: [miss, ...fillersYesterday()],
    cleared: [kept("fillers-3", "2026-10-10")],
  });
  await world.open("fillers-3_checkback");
  assert.deepEqual(stateOf(world), {
    title: "Not due yet",
    body: "Check-back 1 is due Thursday, Oct 15.",
    icon: "calendar",
  });
  assertNothingStarts(world, 0);
});

test("a level locked in gold has no check-back left to start", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: [
      kept("fillers-3", "2026-10-01"),
      kept("fillers-3_cb1", "2026-10-03"),
      kept("fillers-3_cb2", "2026-10-08"),
    ],
  });
  await world.open("fillers-3_checkback");
  assert.deepEqual(stateOf(world), {
    title: "Locked in",
    body: "Both check-backs passed. Nothing is left to check.",
    icon: "check",
  });
  assertNothingStarts(world, 0);
  assert.deepEqual(world.store.marks, []);
});

test("a check-back of a level not cleared still asks for the level first", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: [kept("fillers-2", "2026-10-10")],
  });
  await world.open("fillers-3_checkback");
  assert.deepEqual(stateOf(world), {
    title: "Not open yet",
    body: "Clear level 3 first.",
    icon: "lock",
  });
  assertNothingStarts(world, 0);
});
