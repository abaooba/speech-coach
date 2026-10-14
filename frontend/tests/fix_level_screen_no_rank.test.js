// Review fix test for owner decision 3 (docs/superpowers/specs/2026-10-14-loop-path.md: the rank
// shows on Progress and Results only, never on any step of a level; section 8: "No rank, tier or
// rating appears on this screen"). Every step of every kind of play is walked here, with the
// states for a play that cannot start, and none of them names a rank, a tier, a rating or one
// of rank.js's tier names: not on screen, not for a screen reader, not in what is announced and
// not in the banner a take hands Practice. The screen runs for real in tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  TODAY,
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  wordsOver,
  find,
  findAll,
  classOf,
  descendants,
  textOf,
} = require("./level-harness");

// The tier names as rank.js holds them, so a renamed tier is still looked for.
function tierNames() {
  const app = {};
  const source = fs.readFileSync(path.join(__dirname, "..", "rank.js"), "utf8");
  vm.runInNewContext(source, { app }, { filename: "rank.js" });
  return app.rank.TIERS.map((tier) => tier.name);
}

const RANK_WORDS = new RegExp(
  "\\b(" +
    ["rank\\w*", "tiers?", "ratings?", "rated", ...tierNames()].join("|") +
    ")\\b",
  "i",
);

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

const FILLER_LEVELS = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];

// Everything the screen says at this moment: its text (screen-reader-only text included), every
// aria-label, what it announced, and each banner it handed Practice.
function everythingSaid(world) {
  const nodes = [world.section, ...descendants(world.section)];
  const labels = nodes.map((node) => node.getAttribute("aria-label") || "");
  const banners = world.practice.requests.map((request) =>
    [request.eyebrow, request.title, request.body, request.material.title].join(" "),
  );
  return [textOf(world.section), ...labels, ...world.announcements, ...banners].join("\n");
}

function assertNoRank(world, where) {
  const found = everythingSaid(world).match(RANK_WORDS);
  assert.equal(found && found[0], null, where + " names " + (found && found[0]));
  const nodes = [world.section, ...descendants(world.section)];
  const rankClasses = nodes.map(classOf).filter((name) => /(^|\s)rank/.test(name));
  assert.deepEqual(rankClasses, [], where + " draws a rank card");
}

test("the rank words are read from rank.js", () => {
  assert.ok(RANK_WORDS.test("Contender"));
  assert.ok(RANK_WORDS.test("your rating"));
  assert.ok(RANK_WORDS.test("Ranked"));
  assert.ok(!RANK_WORDS.test("Catch it live"));
});

test("a loop names no rank on any step, its review and both results", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  assertNoRank(world, "Goal");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }), { liveTaps: [3.5, 12] });
  assertNoRank(world, "Feedback");
  world.tap("Review 3 moments (30 s)");
  findAll(world.body, "level-play")[0].click();
  await world.settle();
  assertNoRank(world, "Review");
  world.tap("Pause instead of um");
  world.tap("Say it again");
  await world.finishTake(talkResult({ fillers: 10 }));
  assertNoRank(world, "Not yet");
  world.tap("Try take 3");
  await world.finishTake(talkResult({ fillers: 7 }));
  assertNoRank(world, "Level cleared");
});

test("Spot it, a three-read level and a pair of reads name no rank", async () => {
  const spot = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-1"]) });
  await spot.open("fillers-2");
  spot.tap("Record take 1");
  await spot.finishTake(talkResult({ seconds: 60, words: 150, fillers: 6 }));
  spot.tap("Review 3 moments (30 s)");
  find(spot.body, "level-spot").children.find((node) => node.tagName === "button").click();
  await spot.settle();
  spot.contexts[0].sources[0].finish();
  assertNoRank(spot, "Spot it");

  const reads = createWorld({ history: [] });
  await reads.open("restarts-1");
  reads.tap("Record read 1");
  await reads.finishTake(readResult({ restartsAt: [20, 60], misreadAt: [100] }));
  reads.tap("Review 3 moments (30 s)");
  reads.tap("Read it again");
  await reads.finishTake(readResult({ restartsAt: [20] }));
  assertNoRank(reads, "Read 3");
  reads.tap("Read it again");
  await reads.finishTake(readResult({}));
  assertNoRank(reads, "Restarts result");

  const pace = createWorld({ history: [], cleared: clearedOn(["pace-1"]) });
  await pace.open("pace-2");
  assertNoRank(pace, "Pace level 2 Goal");
});

test("a check-back, a crown, a checkpoint and the benchmark name no rank", async () => {
  const checkback = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await checkback.open("fillers-3_checkback");
  assertNoRank(checkback, "check-back Goal");
  checkback.tap("Record");
  await checkback.finishTake(talkResult({ fillers: 12 }));
  assertNoRank(checkback, "check-back miss");

  const crown = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await crown.open("fillers_crown");
  assertNoRank(crown, "crown Goal");
  crown.tap("Record");
  await crown.finishTake({
    transcript: wordsOver(110, 44),
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  });
  assertNoRank(crown, "crown earned");

  const ladder = createWorld({ history: fillersYesterday(), cleared: clearedOn(["pace-3"]) });
  await ladder.open("pace_crown");
  assertNoRank(ladder, "ladder crown Goal");

  const allFillers = clearedOn(FILLER_LEVELS);
  const checkpoint = createWorld({ history: fillersYesterday(), cleared: allFillers });
  await checkpoint.open("fillers_checkpoint");
  find(checkpoint.body, "level-switch").click();
  assertNoRank(checkpoint, "checkpoint Goal");
  checkpoint.tap("Record");
  await checkpoint.finishTake(talkResult({ seconds: 120, words: 300, fillers: 2 }));
  assertNoRank(checkpoint, "checkpoint cleared");

  const benchmark = createWorld({ history: fillersYesterday() });
  await benchmark.open("benchmark");
  assertNoRank(benchmark, "benchmark Intro");
  benchmark.tap("Start benchmark");
  await benchmark.finishTake(readResult({ words: 160, seconds: 64, restartsAt: [40] }));
  assertNoRank(benchmark, "benchmark Talk");
  benchmark.tap("Record the talk");
  await benchmark.finishTake(talkResult({ fillers: 3 }));
  assertNoRank(benchmark, "benchmark Done");
});

test("a play that cannot start names no rank either", async () => {
  const miss = (id, hour) =>
    savedTake({
      id,
      createdAt: at(TODAY, hour),
      result: talkResult({ fillers: 12 }),
      path: {
        play: "fillers-3",
        kind: "loop",
        take: 2,
        scored: true,
        passed: false,
        stage: null,
        inRoom: null,
      },
    });
  const cases = [
    ["fillers-9", []],
    ["fillers-3", []],
    ["fillers-3_checkback", clearedOn(["fillers-3"], "2026-10-13")],
    ["fillers-3_checkback", clearedOn(["fillers-3", "fillers-3_cb1", "fillers-3_cb2"])],
  ];
  for (const [playId, cleared] of cases) {
    const world = createWorld({ history: fillersYesterday(), cleared });
    await world.open(playId);
    assertNoRank(world, playId);
  }
  const resting = createWorld({
    history: [miss("m3", 9), miss("m2", 8), miss("m1", 7), ...fillersYesterday()],
    cleared: clearedOn(["fillers-2"]),
  });
  await resting.open("fillers-3");
  assert.equal(textOf(find(resting.body, "state__title")), "Back tomorrow");
  assertNoRank(resting, "resting");
});
