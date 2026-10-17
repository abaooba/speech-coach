// Tests for the coach in Path levels (guided coach, spec Phase 5 item 8): the coach line in the
// Review after take 1 (the rule takeaway at once, the AI headline in place when it arrives, the
// level tip kept under it), coach notes for the final take, and the sheet after a loop level's
// result with the pass or miss copy and app.nextMove's button. The screen runs for real through
// tests/level-harness.js with the real coach.js and nextmove.js; app.tips and app.sheet are fakes.
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
  savedTake,
  find,
  findAll,
  hasClass,
  textOf,
  control,
} = require("./level-harness");

const FRONTEND = path.join(__dirname, "..");
const load = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");

function clearedOn(ids) {
  return ids.map((levelId) => ({ levelId, clearedAt: at("2026-10-10") }));
}

function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// A level world with the coach's modules, a notes fake the test answers, and a sheet spy.
async function coached({ coach = true, notes = "pending" } = {}) {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-1", "fillers-2"]) });
  const app = world.app;
  const log = { notes: [], sheets: [], pending: [] };
  const context = { app, document: {} };
  if (coach) {
    // coach.js reads the speech map's helpers from the Results screen, as in the app.
    vm.runInNewContext(load("screens/results.js"), context, { filename: "results.js" });
    vm.runInNewContext(load("coach.js"), context, { filename: "coach.js" });
  }
  vm.runInNewContext(load("nextmove.js"), context, { filename: "nextmove.js" });
  vm.runInNewContext(load("sheet.js"), context, { filename: "sheet.js" });
  const quoteParts = app.sheet.quoteParts;
  app.sheet = {
    quoteParts,
    firstVisit: () => Promise.resolve(false),
    open(options) {
      const handle = { options, updates: [], cleared: 0, closed: 0 };
      handle.update = (line) => handle.updates.push(line);
      handle.clearStatus = () => (handle.cleared += 1);
      handle.close = () => (handle.closed += 1);
      log.sheets.push(handle);
      return handle;
    },
  };
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
  await world.open("fillers-3");
  world.tap("Record take 1");
  world.take1 = talkResult({ fillers: 10 });
  await world.finishTake(world.take1);
  return world;
}

function takeawayFor(world, result) {
  const report = world.app.delivery.analyze(result.transcript, result.metrics);
  const moments = world.app.coach.coachMoments(report, result.transcript);
  return world.app.coach.coachTakeaway(moments, report);
}

const HEADLINE = {
  text: "You said “um” twice in the first minute. Before take 2, pause instead.",
  momentId: null,
};

// --- The coach line in Review ----------------------------------------------------------------

test("after take 1 the Review shows the coach block with the rule takeaway at once", async () => {
  const world = await coached();
  const block = find(world.body, "level-coach");
  assert.ok(block, "a coach block");
  assert.ok(hasClass(block, "tip-card"));
  assert.ok(hasClass(block, "level-tip"));
  assert.equal(textOf(find(block, "level-coach__label")), "Coach");
  assert.equal(textOf(find(block, "level-coach__line")), takeawayFor(world, world.take1).text);
  assert.equal(findAll(world.body, "level-tip__text").length, 0, "the plain tip is replaced");
});

test("the level's tip stays under the coach line, with its source", async () => {
  const world = await coached();
  const block = find(world.body, "level-coach");
  const tip = textOf(find(block, "level-coach__tip"));
  assert.match(tip, /^Level tip: \S/);
  const play = world.app.path.playById("fillers-3", {});
  assert.equal(tip, "Level tip: " + play.tip.text);
  assert.ok(find(block, "level-source"));
});

test("the notes are asked for once, with the take's session, its report and the Novice tier", async () => {
  const world = await coached();
  assert.equal(world.log.notes.length, 1);
  const [session, report, target, tier] = world.log.notes[0];
  assert.equal(session.id, "saved-1");
  assert.equal(typeof report.wordsPerMinute, "number");
  assert.ok(Array.isArray(target) || target === undefined || target === null);
  assert.equal(tier, "Novice");
});

test("the AI headline replaces the rule line in place, without redrawing the step", async () => {
  const world = await coached();
  const lineBefore = find(world.body, "level-coach__line");
  world.log.pending[0]({ headline: HEADLINE, tips: [], source: "ai" });
  await world.settle();
  const line = find(world.body, "level-coach__line");
  assert.equal(line, lineBefore, "the same node");
  assert.equal(textOf(line), HEADLINE.text);
  const quote = find(line, "sheet__quote");
  assert.ok(quote, "the quoted word keeps a mark");
  assert.equal(textOf(quote), "“um”");
});

test("when the notes fail or have no headline the rule line stays", async () => {
  for (const notes of [null, { headline: null, tips: [], source: "library" }]) {
    const world = await coached({ notes });
    await world.settle();
    assert.equal(
      textOf(find(world.body, "level-coach__line")),
      takeawayFor(world, world.take1).text,
    );
  }
});

test("without app.coach the Review keeps its plain tip card", async () => {
  const world = await coached({ coach: false });
  assert.equal(find(world.body, "level-coach"), null);
  assert.ok(find(world.body, "level-tip__text"));
  assert.equal(world.log.notes.length, 0, "nothing is asked for without moments");
});

// --- After the level result ------------------------------------------------------------------

async function reachTake2(world) {
  world.tap("Review 3 moments (30 s)");
  world.tap("Say it again");
}

test("a passed level opens the sheet with the pass copy and the next level", async () => {
  const world = await coached({ notes: null });
  await reachTake2(world);
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(world.log.sheets.length, 1);
  const { options } = world.log.sheets[0];
  assert.equal(options.label, "Coach");
  assert.deepEqual(JSON.parse(JSON.stringify(options.status)), {
    kind: "ok",
    text: "Level 3 cleared",
  });
  assert.equal(options.why, "Next in Fillers.");
  assert.equal(options.primary.label, "Start: Fillers level 4");
  assert.deepEqual(JSON.parse(JSON.stringify(options.secondary)), { label: "See full results" });
  assert.equal(options.extra, undefined, "no grammar link in a level");
  assert.equal(textOf(world.body).includes("Level cleared"), true, "the result stays on the page");
  options.primary.onSelect();
  assert.equal(world.router.gone[world.router.gone.length - 1], "level/fillers-4");
});

test("a missed level opens the sheet with the miss copy and Try again", async () => {
  const world = await coached({ notes: null });
  await reachTake2(world);
  await world.finishTake(talkResult({ fillers: 12 }));
  assert.equal(world.log.sheets.length, 1);
  const { options } = world.log.sheets[0];
  const left = world.app.path.attemptsLeft("fillers-3", world.store.sessions, "2026-10-14");
  assert.ok(left > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(options.status)), {
    kind: "pill",
    text: "Not yet · " + left + (left === 1 ? " try left" : " tries left"),
  });
  assert.equal(options.why, "One clean take 2 clears the level.");
  assert.equal(options.primary.label, "Try again");
  assert.equal(options.primary.icon, "rotate-ccw");
  assert.equal(options.extra, undefined);
  const before = world.practice.requests.length;
  options.primary.onSelect();
  assert.equal(world.practice.requests.length, before + 1, "the retry is handed to Practice");
});

test("the sheet's line is the final take's rule takeaway, then its AI headline", async () => {
  const world = await coached({ notes: "pending" });
  await reachTake2(world);
  const final = talkResult({ fillers: 8 });
  await world.finishTake(final);
  const handle = world.log.sheets[0];
  const expected = takeawayFor(world, final);
  const lineText = handle.options.line.map((part) => part.text).join("");
  assert.equal(lineText, expected.text);
  assert.equal(world.log.notes.length, 2, "notes asked for take 1 and for the final take");
  assert.equal(world.log.notes[1][0].id, "saved-2");
  world.log.pending[1]({ headline: HEADLINE, tips: [], source: "ai" });
  await world.settle();
  assert.equal(handle.updates.length, 1);
  const shown = handle.updates[0].map((part) => (part.quote ? "“" + part.text + "”" : part.text));
  assert.equal(shown.join(""), HEADLINE.text);
});

test("without an AI headline the pill and rule line stay and the spinner is not left", async () => {
  const world = await coached({ notes: null });
  await reachTake2(world);
  await world.finishTake(talkResult({ fillers: 0 }));
  const handle = world.log.sheets[0];
  assert.equal(handle.updates.length, 0);
});

test("the sheet opens once for a result, not again when the screen redraws", async () => {
  const world = await coached({ notes: null });
  await reachTake2(world);
  await world.finishTake(talkResult({ fillers: 0 }));
  await world.open("fillers-3");
  assert.equal(world.log.sheets.length, 1);
});

test("without sheet.js a result is just the page", async () => {
  const world = await coached({ notes: null });
  delete world.app.sheet;
  await reachTake2(world);
  await assert.doesNotReject(world.finishTake(talkResult({ fillers: 0 })));
  assert.equal(world.log.sheets.length, 0);
});
