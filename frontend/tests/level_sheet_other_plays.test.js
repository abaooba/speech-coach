// Tests for the coach and the next-step sheet after a Path play that is not a level loop (guided
// coach, final review finding 1): the owner decided the sheet follows EVERY Path level result, so
// a check-back, a crown, a checkpoint and the benchmark get it too, with the coach's line for the
// final take (or the result's own verdict sentence), a pass or "Not yet" pill, and the one move
// app.nextMove picks. The screen runs for real through tests/level-harness.js with the real
// coach.js and nextmove.js; app.tips and app.sheet.open are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  wordsOver,
  ums,
  find,
  textOf,
  visibleText,
} = require("./level-harness");

const FRONTEND = path.join(__dirname, "..");
const load = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");
const FILLER_LEVELS = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// A level world with the coach's modules, a notes fake answering `notes`, and a sheet spy.
function coachedWorld({ cleared, coach = true, notes = null }) {
  const world = createWorld({ history: fillersYesterday(), cleared });
  const app = world.app;
  const log = { notes: [], sheets: [], pending: [] };
  const context = { app, document: {} };
  if (coach) {
    vm.runInNewContext(load("screens/results.js"), context, { filename: "results.js" });
    vm.runInNewContext(load("coach.js"), context, { filename: "coach.js" });
  }
  vm.runInNewContext(load("nextmove.js"), context, { filename: "nextmove.js" });
  vm.runInNewContext(load("sheet.js"), context, { filename: "sheet.js" });
  app.sheet = Object.assign({}, app.sheet, {
    firstVisit: () => Promise.resolve(false),
    open(options) {
      const handle = { options, updates: [], cleared: 0 };
      handle.update = (line) => handle.updates.push(line);
      handle.clearStatus = () => (handle.cleared += 1);
      handle.close = () => {};
      log.sheets.push(handle);
      return handle;
    },
  });
  app.tips = {
    coachNotes(...args) {
      log.notes.push(args);
      if (notes !== "pending") {
        return Promise.resolve(notes);
      }
      return new Promise((resolve) => log.pending.push(resolve));
    },
  };
  world.log = log;
  return world;
}

function lineText(line) {
  return Array.isArray(line)
    ? line.map((part) => (part.quote ? "“" + part.text + "”" : part.text)).join("")
    : String(line);
}

function takeawayFor(world, result) {
  const report = world.app.delivery.analyze(result.transcript, result.metrics);
  const moments = world.app.coach.coachMoments(report, result.transcript);
  return world.app.coach.coachTakeaway(moments, report);
}

function onlySheet(world) {
  assert.equal(world.log.sheets.length, 1, "one sheet for the result");
  return world.log.sheets[0];
}

const HEADLINE = {
  text: "You said “um” once in the last minute. Next time, pause instead.",
  momentId: null,
};

// --- Check-backs -------------------------------------------------------------------------------

test("a passed check-back opens the sheet: its coach line, the pass pill and the next move", async () => {
  const world = coachedWorld({ cleared: clearedOn(["fillers-3"]) });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  const result = talkResult({ fillers: 5 });
  await world.finishTake(result);
  const { options } = onlySheet(world);
  assert.equal(options.label, "Coach");
  assert.deepEqual(plain(options.status), { kind: "ok", text: "Check-back 1 passed" });
  assert.equal(lineText(options.line), takeawayFor(world, result).text);
  assert.equal(options.primary.label, "Start: Fillers level 1");
  assert.equal(options.primary.icon, "arrow-right");
  assert.equal(options.why, "Next in Fillers.");
  assert.deepEqual(plain(options.secondary), { label: "See full results" });
  assert.equal(textOf(find(world.body, "level-result__title")), "Check-back 1", "result stays");
  options.primary.onSelect();
  assert.equal(world.router.gone[world.router.gone.length - 1], "level/fillers-1");
});

test("a check-back's take asks for coach notes once, at the Novice tier, and they upgrade the line", async () => {
  const world = coachedWorld({ cleared: clearedOn(["fillers-3"]), notes: "pending" });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await world.finishTake(talkResult({ fillers: 5 }));
  assert.equal(world.log.notes.length, 1);
  assert.equal(world.log.notes[0][0].id, "saved-1");
  assert.equal(world.log.notes[0][3], "Novice");
  world.log.pending[0]({ headline: HEADLINE, tips: [], source: "ai" });
  await world.settle();
  const handle = onlySheet(world);
  assert.equal(handle.updates.length, 1);
  assert.equal(lineText(handle.updates[0]), HEADLINE.text);
});

test("a missed check-back says Not yet and never offers Try again", async () => {
  const world = coachedWorld({ cleared: clearedOn(["fillers-3"]) });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await world.finishTake(talkResult({ fillers: 12 }));
  const { options } = onlySheet(world);
  assert.deepEqual(plain(options.status), { kind: "pill", text: "Not yet" });
  assert.notEqual(options.primary.label, "Try again");
  assert.equal(options.primary.icon, "arrow-right");
});

test("without coach.js the sheet's line is the result's own verdict sentence", async () => {
  const world = coachedWorld({ cleared: clearedOn(["fillers-3"]), coach: false });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await world.finishTake(talkResult({ fillers: 12 }));
  const { options } = onlySheet(world);
  assert.equal(lineText(options.line), "8.0 fillers a minute. The target is 6.");
  assert.equal(world.log.notes.length, 0, "nothing is asked for without moments");
});

// --- Crowns ------------------------------------------------------------------------------------

function crownRun(spoken) {
  return {
    transcript: spoken,
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  };
}

test("an earned crown opens the sheet with the crown pill and its unit's next level", async () => {
  const world = coachedWorld({ cleared: clearedOn(["fillers-1", "fillers-2", "fillers-3"]) });
  await world.open("fillers_crown");
  world.tap("Record");
  await world.finishTake(crownRun(wordsOver(110, 44)));
  const { options } = onlySheet(world);
  assert.deepEqual(plain(options.status), { kind: "ok", text: "Crown earned" });
  assert.equal(options.primary.label, "Start: Fillers level 4");
});

test("a missed crown offers Try again, which starts a new run at its Goal", async () => {
  const world = coachedWorld({ cleared: clearedOn(["fillers-1", "fillers-2", "fillers-3"]) });
  await world.open("fillers_crown");
  world.tap("Record");
  await world.finishTake(crownRun(wordsOver(110, 44, ums(25))));
  const { options } = onlySheet(world);
  assert.deepEqual(plain(options.status), { kind: "pill", text: "Not yet" });
  assert.equal(options.primary.label, "Try again");
  assert.equal(options.primary.icon, "rotate-ccw");
  assert.equal(options.why, "A crown has no daily limit. One clean run earns it.");
  options.primary.onSelect();
  await world.settle();
  assert.equal(textOf(find(world.body, "level-heading")), "Goal", "a new run");
  assert.equal(visibleText(find(world.body, "btn--primary")).trim(), "Record");
});

// --- Checkpoints -------------------------------------------------------------------------------

test("a cleared checkpoint opens the sheet with its pill and the weakest other unit", async () => {
  const world = coachedWorld({ cleared: clearedOn(FILLER_LEVELS) });
  await world.open("fillers_checkpoint");
  world.tap("Record");
  await world.finishTake(talkResult({ seconds: 120, words: 300, fillers: 2 }));
  const { options } = onlySheet(world);
  assert.deepEqual(plain(options.status), { kind: "ok", text: "Checkpoint cleared" });
  assert.notEqual(options.primary.label, "Start: Fillers checkpoint");
  assert.match(options.primary.label, /^Start: (Restarts|Long pauses|Pace) level 1$/);
});

test("a missed checkpoint offers Try again", async () => {
  const world = coachedWorld({ cleared: clearedOn(FILLER_LEVELS) });
  await world.open("fillers_checkpoint");
  world.tap("Record");
  await world.finishTake(talkResult({ seconds: 120, words: 300, fillers: 9 }));
  const { options } = onlySheet(world);
  assert.deepEqual(plain(options.status), { kind: "pill", text: "Not yet" });
  assert.equal(options.primary.label, "Try again");
  options.primary.onSelect();
  await world.settle();
  assert.equal(textOf(find(world.body, "level-heading")), "Goal", "a new run");
});

// --- The benchmark -----------------------------------------------------------------------------

test("the benchmark's Done opens the sheet, coached on the talk only", async () => {
  const world = coachedWorld({ cleared: [] });
  await world.open("benchmark");
  world.tap("Start benchmark");
  await world.finishTake(readResult({ words: 160, seconds: 64, restartsAt: [40] }));
  assert.equal(world.log.sheets.length, 0, "no sheet between the read and the talk");
  world.tap("Record the talk");
  const talk = talkResult({ fillers: 3 });
  await world.finishTake(talk);
  const { options } = onlySheet(world);
  assert.deepEqual(plain(options.status), { kind: "ok", text: "Benchmark done" });
  assert.equal(lineText(options.line), takeawayFor(world, talk).text);
  assert.equal(world.log.notes.length, 1, "notes for the talk, not the read");
  assert.equal(world.log.notes[0][0].id, "saved-2");
  assert.match(options.primary.label, /^Start: .+ level 1$/);
  assert.equal(textOf(find(world.body, "level-result__title")), "Benchmark done");
});
