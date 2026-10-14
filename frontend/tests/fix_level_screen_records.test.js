// Review fix tests for the records a pass keeps (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 4 and 8): every record one take writes
// goes to app.store.markLevelCleared with the same clearedAt, the time the take passed, so
// "Jump-cleared levels get the same clearedAt and their own check-backs", even when the writes
// straddle midnight. app.store is the fake in tests/level-harness.js, watched here.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NOW_ISO,
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

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Each markLevelCleared call the screen makes, as {levelId, clearedAt}, before the fake keeps it.
function watchWrites(world) {
  const writes = [];
  const keep = world.store.markLevelCleared;
  world.store.markLevelCleared = function markLevelCleared(levelId, clearedAt) {
    writes.push({ levelId, clearedAt });
    return keep.call(this, levelId, clearedAt);
  };
  return writes;
}

test("a pass and every level it jumped are kept with one clearedAt", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2"]),
  });
  const writes = watchWrites(world);
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  world.tap("Say it again");
  // 7 fillers in 90 s: 4.7 a minute, which clears level 3 and jumps level 4.
  await world.finishTake(talkResult({ fillers: 7 }));
  assert.deepEqual(
    writes.map((write) => write.levelId),
    ["fillers-3", "fillers-4"],
  );
  assert.equal(writes[0].clearedAt, NOW_ISO, "the time the take passed");
  assert.equal(writes[1].clearedAt, writes[0].clearedAt, "the jumped level shares it");
  // Both check-backs fall on the same day.
  const rows = findAll(find(world.body, "level-checkback"), "level-dates__item");
  assert.equal(visibleText(rows[0]).trim(), "Friday, Oct 16: check-back 1");
});

test("a checkpoint cleared in the room keeps both its records with one clearedAt", async () => {
  const levels = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(levels) });
  const writes = watchWrites(world);
  await world.open("fillers_checkpoint");
  find(world.body, "level-switch").click();
  world.tap("Record");
  await world.finishTake(talkResult({ seconds: 120, words: 300, fillers: 2 }));
  assert.deepEqual(
    writes.map((write) => write.levelId),
    ["fillers_checkpoint", "fillers_checkpoint_room"],
  );
  assert.equal(typeof writes[0].clearedAt, "string");
  assert.equal(writes[1].clearedAt, writes[0].clearedAt);
});

test("records that fail to save count from the same clearedAt for the dates shown", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2"]),
  });
  world.store.failMarks = true;
  const writes = watchWrites(world);
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  world.tap("Say it again");
  await world.finishTake(talkResult({ fillers: 7 }));
  assert.deepEqual(
    writes.map((write) => [write.levelId, write.clearedAt]),
    [
      ["fillers-3", NOW_ISO],
      ["fillers-4", NOW_ISO],
    ],
  );
  const rows = findAll(find(world.body, "level-checkback"), "level-dates__item");
  assert.equal(visibleText(rows[0]).trim(), "Friday, Oct 16: check-back 1");
});
