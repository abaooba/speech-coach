// Review fix tests for what a pass offers next when its records fail to save (frontend/screens/
// level.js, spec docs/superpowers/specs/2026-10-14-loop-path.md sections 4 and 8). A pass still
// shows "Level cleared", its check-back dates and "Could not save your progress on this device."
// (level_screen_result.test.js and fix_level_screen_records.test.js pin those). Its Next card,
// though, is worked out from the records the store actually kept, so its Start link never opens a
// level the store still has locked: when the level's own record was lost there is no next level
// to offer, only Back to path; when only a jumped level's record was lost, the Next card offers
// that level, which the store has open. app.store is the fake in tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  find,
  hasClass,
  textOf,
  visibleText,
  control,
} = require("./level-harness");

const SAVE_FAILED = "Could not save your progress on this device.";

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

function primaryText(world) {
  return visibleText(find(world.body, "btn--primary")).trim();
}

// Whether the screen shows a node of this class, or a control reading this text. A failed check
// then reports a boolean, never the fake DOM node, whose graph is too large to print.
function shows(world, className) {
  return find(world.body, className) !== null;
}

function offers(world, text) {
  return control(world.body, text) !== null;
}

// The store's markLevelCleared, failing for the ids `fails` says.
function failWritesOf(world, fails) {
  const keep = world.store.markLevelCleared;
  world.store.markLevelCleared = function markLevelCleared(levelId, clearedAt) {
    if (fails(levelId)) {
      return Promise.reject(new Error("Close other Speech Coach tabs to finish updating."));
    }
    return keep.call(this, levelId, clearedAt);
  };
}

// A loop of Fillers from its Goal to the Result of take 2, levels before it already cleared.
async function fillersResult(number, take2, fails) {
  const before = ["fillers-1", "fillers-2", "fillers-3", "fillers-4"].slice(0, number - 1);
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(before) });
  failWritesOf(world, fails);
  await world.open("fillers-" + number);
  world.tap("Record take 1");
  const seconds = number === 5 ? 120 : 90;
  await world.finishTake(talkResult({ seconds, words: seconds * 2.5, fillers: 10 }));
  world.tap(primaryText(world));
  world.tap("Say it again");
  await world.finishTake(take2);
  return world;
}

test("a pass whose record was lost offers no next level, only Back to path", async () => {
  // 8 fillers in 90 s: 5.3 a minute clears level 3, and no write reaches the store.
  const world = await fillersResult(3, talkResult({ fillers: 8 }), () => true);
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(visibleText(find(world.body, "level-save-failed")).trim(), SAVE_FAILED);
  assert.equal(shows(world, "level-next"), false, "no Next card");
  assert.equal(offers(world, "Start level 4"), false);
  assert.equal(primaryText(world), "Back to path");
  assert.equal(control(world.body, "Back to path").getAttribute("href"), "#/path");
  assert.equal(shows(world, "level-checkback"), true, "the check-back dates still show");
});

test("a pass that jumped levels, every write lost, offers no next level either", async () => {
  // 7 fillers in 90 s: 4.7 a minute clears level 3 and jumps level 4.
  const world = await fillersResult(3, talkResult({ fillers: 7 }), () => true);
  assert.equal(textOf(find(world.body, "level-jump")), "Your take also cleared level 4.");
  assert.equal(shows(world, "level-next"), false);
  assert.equal(offers(world, "Start level 5"), false);
  assert.equal(primaryText(world), "Back to path");
});

test("a lost checkpoint-opening pass does not offer the checkpoint", async () => {
  const take2 = talkResult({ seconds: 120, words: 300, fillers: 4 });
  const world = await fillersResult(5, take2, () => true);
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(offers(world, "Start checkpoint"), false);
  assert.equal(primaryText(world), "Back to path");
});

test("when only a jumped level's record was lost, Next offers that level, open in the store",
  async () => {
    const world = await fillersResult(
      3,
      talkResult({ fillers: 7 }),
      (levelId) => levelId === "fillers-4",
    );
    assert.equal(visibleText(find(world.body, "level-save-failed")).trim(), SAVE_FAILED);
    const next = find(world.body, "level-next");
    assert.equal(textOf(find(next, "level-next__title")), "Fillers, level 4");
    assert.equal(primaryText(world), "Start level 4");
    const start = control(world.body, "Start level 4");
    assert.equal(hasClass(start, "btn--primary"), true);
    assert.equal(start.getAttribute("href"), "#/level/fillers-4");

    // The level it offers opens on its Goal: the store kept level 3.
    await world.open("fillers-4");
    assert.equal(textOf(find(world.body, "level-heading")), "Goal");
  });

test("every record kept: the Next card is as before", async () => {
  const world = await fillersResult(3, talkResult({ fillers: 7 }), () => false);
  assert.equal(shows(world, "level-save-failed"), false);
  assert.equal(textOf(find(find(world.body, "level-next"), "level-next__title")),
    "Fillers, level 5");
  assert.equal(primaryText(world), "Start level 5");
});
