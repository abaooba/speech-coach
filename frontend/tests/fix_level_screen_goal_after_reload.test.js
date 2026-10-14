// Review fix tests for a loop whose run was cut off after take 1 (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8, "The run" and "Review"). After a
// reload, a level always starts again at Goal, and take 1's audio, kept only in memory, is gone;
// the Review that would say so ("Take 1's audio is gone: it is kept only while this level is
// open.") can no longer be reached. So when the play's newest saved take is a loop's take 1 from
// today, the Goal says it, right above the button that records take 1 again. The same holds when
// the speaker left the level after take 1. Any other history leaves the Goal as it was. The
// harness's store stands in for IndexedDB: a fresh world over the same takes is the reload.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TODAY,
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  find,
  findAll,
  textOf,
  visibleText,
} = require("./level-harness");

const AUDIO_GONE = "Take 1's audio is gone: it is kept only while this level is open.";

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function yesterdaysTake() {
  return savedTake({
    id: "y1",
    createdAt: at("2026-10-13", 10),
    result: talkResult({ fillers: 12 }),
  });
}

// A take of `play` saved at `createdAt`, as the Level screen's judge marks it.
function playTake(id, play, take, createdAt, kind = "loop") {
  return savedTake({
    id,
    createdAt,
    passageId: "cold-read-1",
    result: readResult({ restartsAt: [20, 60], misreadAt: [100] }),
    path: { play, kind, take, scored: false, passed: null, stage: null, inRoom: null },
  });
}

// The Goal's line about take 1's audio, or null; a failed check reports a boolean or a string,
// never the fake DOM node, whose graph is too large to print.
function goneLine(world) {
  const line = find(find(world.body, "level-step"), "level-goal__gone");
  return line === null ? null : visibleText(line).trim();
}

function heading(world) {
  return textOf(find(world.body, "level-heading"));
}

test("after a reload cut a run off after read 1, the Goal says its audio is gone", async () => {
  const history = [playTake("r1", "restarts-1", 1, at(TODAY, 9)), yesterdaysTake()];
  const world = createWorld({ history });
  await world.open("restarts-1");
  assert.equal(heading(world), "Goal", "a level always starts again at Goal");
  assert.equal(goneLine(world), AUDIO_GONE);
  const step = find(world.body, "level-step");
  const line = find(step, "level-goal__gone");
  const actions = find(step, "level-actions");
  assert.equal(
    step.children.indexOf(line) === step.children.indexOf(actions) - 1,
    true,
    "the line sits right above the button that records read 1 again",
  );
  assert.equal(visibleText(find(actions, "btn--primary")).trim(), "Record read 1");
});

test("leaving the level after take 1 says the same when the speaker comes back", async () => {
  const world = createWorld({ history: [yesterdaysTake()], cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  assert.equal(goneLine(world), null, "nothing was cut off yet");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.router.go("path");
  await world.open("fillers-3");
  assert.equal(heading(world), "Goal");
  assert.equal(goneLine(world), AUDIO_GONE);
  // Recording take 1 again moves the run on; its review has the new take 1's audio.
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap("Review 3 moments (30 s)");
  assert.equal(findAll(world.body, "level-play").length, 3);
  assert.equal(find(world.body, "level-review__gone") === null, true);
});

test("the line stays on the Goal while the new run has not recorded take 1", async () => {
  const history = [playTake("r1", "restarts-1", 1, at(TODAY, 9)), yesterdaysTake()];
  const world = createWorld({ history });
  await world.open("restarts-1");
  world.tap("Record read 1");
  await world.open("restarts-1");
  assert.equal(heading(world), "Goal");
  assert.equal(goneLine(world), AUDIO_GONE);
});

test("no line when nothing of this play was cut off today", async () => {
  const cases = [
    ["a new speaker", [], "restarts-1", []],
    ["take 1 was yesterday", [playTake("r1", "restarts-1", 1, at("2026-10-13", 9))], "restarts-1",
      []],
    [
      "the run went on past take 1",
      [
        playTake("r2", "restarts-1", 2, at(TODAY, 9)),
        playTake("r1", "restarts-1", 1, at(TODAY, 8)),
      ],
      "restarts-1",
      [],
    ],
    ["take 1 of another play", [playTake("f1", "fillers-3", 1, at(TODAY, 9))], "restarts-1", []],
    [
      "a check-back of this level, which has no review",
      [playTake("c1", "fillers-3_checkback", 1, at(TODAY, 9), "checkback")],
      "fillers-3",
      clearedOn(["fillers-2"]),
    ],
  ];
  for (const [name, takes, playId, cleared] of cases) {
    const world = createWorld({ history: takes.concat([yesterdaysTake()]), cleared });
    await world.open(playId);
    assert.equal(heading(world), "Goal", name);
    assert.equal(goneLine(world), null, name);
  }
});

test("one-take plays never say it: they keep no take 1 audio", async () => {
  const history = [
    playTake("c1", "fillers-3_checkback", 1, at(TODAY, 9), "checkback"),
    yesterdaysTake(),
  ];
  const cleared = clearedOn(["fillers-1", "fillers-2", "fillers-3"]);
  const world = createWorld({ history, cleared });
  await world.open("fillers_crown");
  assert.equal(goneLine(world), null);
});

// --- Its style (styles.css section 8b) --------------------------------------------------------

// Every declaration the rules of section 8b give `selector`, rule by rule, comments left out.
function declarationsFor(selector) {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const start = css.indexOf("/* 8b. Level screen");
  const end = css.indexOf("/* 9. History screen");
  const section = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const found = {};
  for (const match of section.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((each) => each.trim());
    if (selectors.includes(selector)) {
      for (const part of match[2].split(";")) {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          found[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      }
    }
  }
  return found;
}

test("the Goal's line reads as the review's: small and muted, with no margin of its own", () => {
  const goal = declarationsFor(".level-goal__gone");
  assert.deepEqual(goal, declarationsFor(".level-review__gone"));
  assert.equal(goal["font-size"], "var(--fs-small)");
  assert.equal(goal.color, "var(--muted)");
  assert.equal(goal.margin, "0");
});
