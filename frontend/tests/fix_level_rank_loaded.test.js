// Review fix for owner decision 3 (docs/superpowers/specs/2026-10-14-loop-path.md: the rank shows
// on Progress and Results only, "never ... on any step of a level"; section 8: "No rank, tier or
// rating appears on this screen"; section 7: a level's takes run in Practice's level mode).
// level-harness.js and practice-harness.js load neither rank.js nor rankcard.js, which index.html
// loads before both screens, so a rank card drawn behind `if (app.rankCard)`, as Results guards
// its own, did nothing in their tests and would draw a card in the app. path-screen-harness.js
// closed this hole for the Path. Here each harness builds its world as usual, except that rank.js,
// rankcard.js and screens/results.js run in the same vm context where index.html's script order
// puts them among the harness's own files, and app.rank and app.rankCard are watched: every look
// at either on app, and every property read through them, is logged. Every step of every kind of
// play, and Practice's level mode from its banner through an upload error, a retry and the save,
// must leave that log empty and name no tier.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const level = require("./level-harness");
const practice = require("./practice-harness");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

// index.html's script order, and the scripts the harnesses leave out that a level could reach the
// rank through.
const INDEX_ORDER = [...read("index.html").matchAll(/<script src="([^"]+)"><\/script>/g)].map(
  (match) => match[1],
);
const RANK_SCRIPTS = ["rank.js", "rankcard.js", "screens/results.js"];
const WATCHED = ["rank", "rankCard"];

// The tier names as rank.js holds them, read in a context of their own, so a renamed tier is
// still looked for.
function tierNames() {
  const context = { app: {} };
  vm.runInNewContext(read("rank.js"), context, { filename: "rank.js" });
  return Array.from(context.app.rank.TIERS, (tier) => tier.name);
}

const TIER_NAMES = tierNames();
const RANK_WORDS = new RegExp(
  "\\b(" + ["rank\\w*", "tiers?", "ratings?", "rated", ...TIER_NAMES].join("|") + ")\\b",
  "i",
);

// The index.html script a harness's file name stands for: its own path, or a screen's bare name
// (practice-harness.js runs screens/practice.js as "practice.js").
function indexEntry(filename) {
  const name = String(filename || "").split(path.sep).join("/");
  if (INDEX_ORDER.includes(name)) {
    return name;
  }
  return INDEX_ORDER.includes("screens/" + name) ? "screens/" + name : null;
}

// Makes app.rank and app.rankCard log every look: reading either from app logs "app.rank", and
// every property read through it logs "rank.<name>", calls included.
function watchRank(app, log) {
  WATCHED.forEach((name) => {
    const watched = new Proxy(app[name], {
      get(target, key, receiver) {
        if (typeof key === "string") {
          log.push(name + "." + key);
        }
        return Reflect.get(target, key, receiver);
      },
    });
    Object.defineProperty(app, name, {
      configurable: true,
      enumerable: true,
      get() {
        log.push("app." + name);
        return watched;
      },
    });
  });
}

// Builds a harness world with `build`, running each of RANK_SCRIPTS in the world's own vm context
// right before the first harness file index.html loads after it (or at the end), and watching the
// rank from the moment rankcard.js has run, before path.js, loop.js or a screen could keep it.
// Returns {world, rankLog}.
function withRankScripts(build) {
  const realRun = vm.runInNewContext;
  const rankLog = [];
  let pending = RANK_SCRIPTS.slice();
  let worldContext = null;
  const runRankScript = (script, context) => {
    realRun.call(vm, read(script), context, { filename: script });
    if (script === "rankcard.js") {
      watchRank(context.app, rankLog);
    }
  };
  vm.runInNewContext = function (code, context, options) {
    const entry = indexEntry(options && options.filename);
    // A harness's world has app.screens; practice-harness.js's realPassages() context does not.
    if (entry !== null && context && context.app && context.app.screens) {
      worldContext = context;
      const position = INDEX_ORDER.indexOf(entry);
      pending = pending.filter((script) => {
        if (INDEX_ORDER.indexOf(script) < position) {
          runRankScript(script, context);
          return false;
        }
        return true;
      });
    }
    return realRun.call(vm, code, context, options);
  };
  let world;
  try {
    world = build();
  } finally {
    vm.runInNewContext = realRun;
  }
  assert.ok(worldContext, "the harness ran its files through vm.runInNewContext");
  pending.forEach((script) => runRankScript(script, worldContext));
  return { world, rankLog };
}

function levelWorld(options) {
  return withRankScripts(() => level.createWorld(options));
}

function practiceWorld(options) {
  return withRankScripts(() => practice.setup(options));
}

// --- The Level screen ---------------------------------------------------------------------------

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: level.at(day) }));
}

function fillersYesterday() {
  return [
    level.savedTake({
      id: "y1",
      createdAt: level.at("2026-10-13", 10),
      result: level.talkResult({ fillers: 12 }),
    }),
  ];
}

// Everything the Level screen says: its text (screen-reader text too), every aria-label, what it
// announced, and each banner it handed Practice.
function everythingSaid(world) {
  const nodes = [world.section, ...level.descendants(world.section)];
  const labels = nodes.map((node) => node.getAttribute("aria-label") || "");
  const banners = world.practice.requests.map((request) =>
    [request.eyebrow, request.title, request.body, request.material.title].join(" "),
  );
  return [level.textOf(world.section), ...labels, ...world.announcements, ...banners].join("\n");
}

// The step `where` never looked at the rank, drew no rank card and names no rank word.
function assertNoRank({ world, rankLog }, where) {
  assert.deepEqual(rankLog, [], where + " looked at the rank");
  const nodes = [world.section, ...level.descendants(world.section)];
  const rankClasses = nodes.map(level.classOf).filter((name) => /(^|\s)rank/.test(name));
  assert.deepEqual(rankClasses, [], where + " draws a rank card");
  const found = everythingSaid(world).match(RANK_WORDS);
  assert.equal(found && found[0], null, where + " names " + (found && found[0]));
}

test("the Level world runs the rank scripts where index.html does, and watches every look", () => {
  assert.ok(
    INDEX_ORDER.indexOf("rankcard.js") < INDEX_ORDER.indexOf("path.js") &&
      INDEX_ORDER.indexOf("screens/results.js") < INDEX_ORDER.indexOf("screens/level.js"),
    "index.html loads the rank and Results before the Level screen",
  );
  const { world, rankLog } = levelWorld();
  assert.equal(typeof world.app.screens.results.summarize, "function");
  assert.equal(typeof world.app.screens.level.show, "function");
  assert.deepEqual(rankLog, [], "loading the screens looks at nothing");
  assert.deepEqual(
    Array.from(world.app.rank.TIERS, (tier) => tier.name),
    TIER_NAMES,
  );
  assert.equal(typeof world.app.rankCard.model, "function");
  assert.deepEqual(rankLog, ["app.rank", "rank.TIERS", "app.rankCard", "rankCard.model"]);
});

test("every step of a loop, its review and both results leave the rank alone", async () => {
  const run = levelWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  const { world } = run;
  await world.open("fillers-3");
  assertNoRank(run, "Goal");
  world.tap("Record take 1");
  await world.finishTake(level.talkResult({ fillers: 10 }), { liveTaps: [3.5, 12] });
  assertNoRank(run, "Feedback");
  world.tap("Review 3 moments (30 s)");
  level.findAll(world.body, "level-play")[0].click();
  await world.settle();
  assertNoRank(run, "Review");
  world.tap("Pause instead of um");
  world.tap("Say it again");
  await world.finishTake(level.talkResult({ fillers: 10 }));
  assertNoRank(run, "Not yet");
  world.tap("Try take 3");
  await world.finishTake(level.talkResult({ fillers: 7 }));
  assert.match(level.textOf(world.body), /Level cleared/);
  assertNoRank(run, "Level cleared");
});

test("Spot it, a three-read level and a pair of reads leave the rank alone", async () => {
  const spotRun = levelWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-1"]) });
  const spot = spotRun.world;
  await spot.open("fillers-2");
  spot.tap("Record take 1");
  await spot.finishTake(level.talkResult({ seconds: 60, words: 150, fillers: 6 }));
  spot.tap("Review 3 moments (30 s)");
  level.find(spot.body, "level-spot").children.find((node) => node.tagName === "button").click();
  await spot.settle();
  spot.contexts[0].sources[0].finish();
  assertNoRank(spotRun, "Spot it");

  const readsRun = levelWorld({ history: [] });
  const reads = readsRun.world;
  await reads.open("restarts-1");
  reads.tap("Record read 1");
  await reads.finishTake(level.readResult({ restartsAt: [20, 60], misreadAt: [100] }));
  reads.tap("Review 3 moments (30 s)");
  reads.tap("Read it again");
  await reads.finishTake(level.readResult({ restartsAt: [20] }));
  assertNoRank(readsRun, "Read 3");
  reads.tap("Read it again");
  await reads.finishTake(level.readResult({}));
  assertNoRank(readsRun, "Restarts result");

  const paceRun = levelWorld({ history: [], cleared: clearedOn(["pace-1"]) });
  await paceRun.world.open("pace-2");
  assertNoRank(paceRun, "Pace level 2 Goal");
});

test("a check-back, a crown, a checkpoint and the benchmark leave the rank alone", async () => {
  const checkbackRun = levelWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-3"]),
  });
  await checkbackRun.world.open("fillers-3_checkback");
  assertNoRank(checkbackRun, "check-back Goal");
  checkbackRun.world.tap("Record");
  await checkbackRun.world.finishTake(level.talkResult({ fillers: 12 }));
  assertNoRank(checkbackRun, "check-back miss");

  const crownRun = levelWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await crownRun.world.open("fillers_crown");
  assertNoRank(crownRun, "crown Goal");
  crownRun.world.tap("Record");
  await crownRun.world.finishTake({
    transcript: level.wordsOver(110, 44),
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  });
  assertNoRank(crownRun, "crown earned");

  const fillers = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];
  const checkpointRun = levelWorld({ history: fillersYesterday(), cleared: clearedOn(fillers) });
  const checkpoint = checkpointRun.world;
  await checkpoint.open("fillers_checkpoint");
  level.find(checkpoint.body, "level-switch").click();
  assertNoRank(checkpointRun, "checkpoint Goal");
  checkpoint.tap("Record");
  await checkpoint.finishTake(level.talkResult({ seconds: 120, words: 300, fillers: 2 }));
  assertNoRank(checkpointRun, "checkpoint cleared");

  const benchmarkRun = levelWorld({ history: fillersYesterday() });
  const benchmark = benchmarkRun.world;
  await benchmark.open("benchmark");
  assertNoRank(benchmarkRun, "benchmark Intro");
  benchmark.tap("Start benchmark");
  await benchmark.finishTake(level.readResult({ words: 160, seconds: 64, restartsAt: [40] }));
  assertNoRank(benchmarkRun, "benchmark Talk");
  benchmark.tap("Record the talk");
  await benchmark.finishTake(level.talkResult({ fillers: 3 }));
  assertNoRank(benchmarkRun, "benchmark Done");
});

test("a play that cannot start, or one left for the Path, leaves the rank alone", async () => {
  const lockedRun = levelWorld({ history: fillersYesterday() });
  await lockedRun.world.open("fillers-3");
  assertNoRank(lockedRun, "locked");

  const leftRun = levelWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await leftRun.world.open("fillers-3");
  leftRun.world.tap("Record take 1");
  await leftRun.world.finishTake(level.talkResult({ fillers: 10 }));
  leftRun.world.router.go("path");
  await leftRun.world.settle();
  assertNoRank(leftRun, "left for the Path");
});

// --- Practice's level mode ----------------------------------------------------------------------

// Everything Practice says while a level's take is held: its body's text and every aria-label,
// and what it announced.
function practiceSaid(t) {
  const all = (node) => [node, ...(node.children || []).flatMap(all)];
  const nodes = all(t.root).filter((node) => typeof node.getAttribute === "function");
  const text = nodes.map((node) => node.textContent || "").join("\n");
  const labels = nodes.map((node) => node.getAttribute("aria-label") || "");
  return [text, ...labels, ...t.calls.announce].join("\n");
}

function assertPracticeNoRank({ world: t, rankLog }, where) {
  assert.deepEqual(rankLog, [], where + " looked at the rank");
  const found = practiceSaid(t).match(RANK_WORDS);
  assert.equal(found && found[0], null, where + " names " + (found && found[0]));
}

test("the Practice world runs the rank scripts where index.html does", () => {
  const { world: t, rankLog } = practiceWorld();
  assert.equal(typeof t.app.screens.results.summarize, "function");
  assert.equal(typeof t.app.screens.practice.startLevelTake, "function");
  assert.deepEqual(rankLog, []);
  assert.equal(typeof t.app.rankCard.build, "function");
  assert.deepEqual(rankLog, ["app.rankCard", "rankCard.build"]);
});

test("Practice's level mode leaves the rank alone from the banner to the save", async () => {
  const run = practiceWorld();
  const t = run.world;
  assertPracticeNoRank(run, "normal idle");
  const { request, log } = practice.levelRequest({ liveTap: true });
  t.startLevel(request);
  assert.ok(practice.parts(t).banner, "the level banner shows");
  assertPracticeNoRank(run, "level idle");
  await t.startRecording();
  practice.parts(t).liveTapButton.click();
  assertPracticeNoRank(run, "recording with the live tap");
  t.clock.advance(8000);
  await t.stopRecording();
  assertPracticeNoRank(run, "uploading");
  t.rejectUpload("network");
  await practice.flush();
  assert.equal(t.practice.state, "error");
  assertPracticeNoRank(run, "upload failed");
  practice.stateBlock(t).action.click();
  await practice.flush();
  assert.equal(t.practice.state, "uploading", "Retry upload sends the take again");
  t.resolveUpload();
  for (let round = 0; round < 4; round += 1) {
    await practice.flush();
  }
  assert.equal(log.onSaved.length, 1, "the take was saved and handed back");
  assertPracticeNoRank(run, "saved");
});
