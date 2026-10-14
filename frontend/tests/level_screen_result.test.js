// Tests for the Level screen's Result (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 4, 5 and 8): a pass writes every
// record app.path.evaluate lists (jumped levels too) and shows the verdict, the guards, the jump
// line, the check-back dates and what is next; a miss shows the verdict, the failed guards and
// the one fix, then Try take 3 and 4 while today's attempts last, then the rest message;
// check-backs, crowns and checkpoints show their verdict lines and records; the benchmark ends
// on Done with this sitting's numbers and the change since the first. The screen runs for real
// through tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  wordsOver,
  ums,
  find,
  findAll,
  hasClass,
  textOf,
  visibleText,
  control,
} = require("./level-harness");

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

// Yesterday's take: 12 fillers in a minute and a half.
function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

const FILLER_LEVELS = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];

function primaryText(world) {
  return visibleText(find(world.body, "btn--primary")).trim();
}

// Fillers level 3 from its Goal to the Result of take 2, the fix chosen or not.
async function fillersThreeResult(take2, options = {}) {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2"]),
  });
  if (options.failMarks) {
    world.store.failMarks = true;
  }
  await world.open("fillers-3");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  world.tap(primaryText(world));
  if (options.fix) {
    world.tap(options.fix);
  }
  world.tap("Say it again");
  await world.finishTake(take2);
  return world;
}

function resultCard(world) {
  return find(world.body, "level-result");
}

function guardTexts(card) {
  return findAll(card, "level-guards__item").map((item) => visibleText(item).trim());
}

function hrefOf(world, text) {
  const link = control(world.body, text);
  assert.ok(link, "no control reads " + text);
  assert.equal(link.tagName, "a");
  return link.getAttribute("href");
}

// --- A pass ----------------------------------------------------------------------------------

test("a pass writes the level and every level it jumped, and says so", async () => {
  // 7 fillers in 90 s: 4.7 a minute, under level 3's 6 and level 4's 5 as well.
  const world = await fillersThreeResult(talkResult({ fillers: 7 }));
  assert.deepEqual(world.store.marks, ["fillers-3", "fillers-4"]);
  const card = resultCard(world);
  assert.ok(hasClass(card, "level-result--pass"));
  assert.equal(textOf(find(card, "level-result__title")), "Level cleared");
  assert.equal(
    textOf(find(card, "level-result__sentence")),
    "4.7 fillers a minute on take 2. The target was 6.",
  );
  assert.deepEqual(guardTexts(card), ["Talked 90 s of 90", "145 wpm", "Other slips steady"]);
  assert.ok(findAll(card, "level-guards__item--passed").length === 3);
  assert.equal(textOf(find(world.body, "level-jump")), "Your take also cleared level 4.");
  const steps = findAll(find(world.body, "level-steps"), "level-steps__item");
  assert.deepEqual(
    steps.map((item) => item.getAttribute("aria-current")),
    [null, null, null, null, "step"],
  );
  assert.equal(findAll(world.body, "level-steps__item--done").length, 4);
});

test("a pass shows when its check-backs fall: two dated rows, the second turning it gold", async () => {
  const world = await fillersThreeResult(talkResult({ fillers: 8 }));
  assert.deepEqual(world.store.marks, ["fillers-3"]);
  assert.equal(find(world.body, "level-jump"), null);
  const card = find(world.body, "level-checkback");
  assert.equal(textOf(find(card, "level-checkback__title")), "Check back");
  assert.equal(
    textOf(find(card, "level-checkback__lead")),
    "A level counts when it sticks. One quick take on a new topic:",
  );
  const rows = findAll(card, "level-dates__item");
  assert.deepEqual(
    rows.map((row) => visibleText(row).trim()),
    [
      "Friday, Oct 16: check-back 1",
      "Wednesday, Oct 21: check-back 2, turns the node gold",
    ],
  );
  assert.equal(textOf(find(rows[1], "level-dates__gold")), "gold");
});

test("a pass names the next level with a link to start it, beside Back to path", async () => {
  const world = await fillersThreeResult(talkResult({ fillers: 8 }));
  const next = find(world.body, "level-next");
  assert.equal(textOf(find(next, "level-next__label")), "Next");
  assert.equal(textOf(find(next, "level-next__title")), "Fillers, level 4");
  assert.equal(textOf(find(next, "level-next__goal")), "Pause instead, 5 or fewer fillers a minute");
  assert.equal(primaryText(world), "Start level 4");
  assert.equal(hrefOf(world, "Start level 4"), "#/level/fillers-4");
  assert.equal(hrefOf(world, "Back to path"), "#/path");
  assert.ok(hasClass(control(world.body, "Back to path"), "btn--secondary"));

  // After a jump the next level is the first one left.
  const jumped = await fillersThreeResult(talkResult({ fillers: 7 }));
  assert.equal(textOf(find(jumped.body, "level-next__title")), "Fillers, level 5");
  assert.equal(hrefOf(jumped, "Start level 5"), "#/level/fillers-5");
});

test("clearing a unit's last level leads on to its checkpoint", async () => {
  const world = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-1", "fillers-2", "fillers-3", "fillers-4"]),
  });
  await world.open("fillers-5");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ seconds: 120, words: 300, fillers: 4 }));
  world.tap(primaryText(world));
  world.tap("Say it again");
  await world.finishTake(talkResult({ seconds: 120, words: 300, fillers: 4 }));
  assert.deepEqual(world.store.marks, ["fillers-5"]);
  assert.equal(textOf(find(world.body, "level-next__title")), "Fillers checkpoint");
  assert.equal(hrefOf(world, "Start checkpoint"), "#/level/fillers_checkpoint");
});

test("a failed write still shows the pass, and says the progress was not saved", async () => {
  const world = await fillersThreeResult(talkResult({ fillers: 8 }), { failMarks: true });
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(
    visibleText(find(world.body, "level-save-failed")).trim(),
    "Could not save your progress on this device.",
  );
});

// --- Not yet ---------------------------------------------------------------------------------

test("not yet: the value against the target and the one fix, then Try take 3", async () => {
  const world = await fillersThreeResult(talkResult({ fillers: 10 }));
  assert.deepEqual(world.store.marks, []);
  const card = resultCard(world);
  assert.ok(hasClass(card, "level-result--miss"));
  assert.equal(textOf(find(card, "level-result__title")), "Not yet");
  assert.equal(
    textOf(find(card, "level-result__sentence")),
    "6.7 fillers a minute on take 2. The target is 6.",
  );
  assert.deepEqual(guardTexts(card), [], "every guard held");
  assert.equal(textOf(find(card, "level-result__fix")), "The one fix: Pause instead of um.");
  assert.equal(primaryText(world), "Try take 3");
  assert.equal(hrefOf(world, "Back to path"), "#/path");
});

test("the one fix is the chosen fix, else the first failed guard's", async () => {
  const chosen = await fillersThreeResult(talkResult({ fillers: 10 }), {
    fix: "Jot 3 points first",
  });
  assert.equal(textOf(find(chosen.body, "level-result__fix")), "The one fix: Jot 3 points first.");

  // 60 s of the 90: short of the 72 s talkShare asks for.
  const short = await fillersThreeResult(talkResult({ seconds: 60, words: 150, fillers: 2 }));
  const card = resultCard(short);
  assert.deepEqual(guardTexts(card), ["You talked 60 s of 90. Keep going to at least 72 s."]);
  assert.ok(findAll(card, "level-guards__item--failed").length === 1);
  assert.equal(
    textOf(find(card, "level-result__fix")),
    "The one fix: Keep talking until the time bar fills.",
  );
});

test("Try take 3, then Try take 4, then the level rests until tomorrow", async () => {
  const world = await fillersThreeResult(talkResult({ fillers: 10 }));
  world.tap("Try take 3");
  const third = world.request();
  assert.deepEqual(
    [third.title, third.body, third.seconds],
    ["Take 3", "Talk for 90 s. Take 3 counts: 6 or fewer fillers a minute.", 90],
  );
  await world.finishTake(talkResult({ fillers: 11 }));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  const labels = findAll(find(world.body, "level-steps"), "level-steps__label").map(textOf);
  assert.deepEqual(labels, ["Goal", "Take 1", "Review", "Take 3", "Result"]);
  assert.equal(primaryText(world), "Try take 4");

  world.tap("Try take 4");
  assert.equal(world.request().title, "Take 4");
  await world.finishTake(talkResult({ fillers: 12 }));
  assert.equal(textOf(find(world.body, "level-rest")), "This level opens again tomorrow.");
  assert.equal(control(world.body, "Try take 5"), null);
  assert.equal(primaryText(world), "Back to path");
  assert.equal(hrefOf(world, "Back to path"), "#/path");
  assert.deepEqual(world.store.marks, []);
});

test("a retry that passes clears the level", async () => {
  const world = await fillersThreeResult(talkResult({ fillers: 10 }));
  world.tap("Try take 3");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.equal(
    textOf(find(world.body, "level-result__sentence")),
    "5.3 fillers a minute on take 3. The target was 6.",
  );
  assert.deepEqual(world.store.marks, ["fillers-3"]);
});

test("Pace level 2 retries a pair: Try read 3, then read 4 before the Result", async () => {
  const world = createWorld({ history: [], cleared: clearedOn(["pace-1"]) });
  await world.open("pace-2");
  const read = (wpm) => {
    const words = 120;
    return readResult({ words, seconds: (words * 60) / wpm });
  };
  world.tap("Record read 1");
  await world.finishTake(read(140));
  world.tap(primaryText(world));
  world.tap("Read it again");
  // Read 2 at 140 is out of its 150 to 170 band: the pair misses.
  await world.finishTake(read(140));
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  assert.equal(primaryText(world), "Try read 3");
  world.tap("Try read 3");
  assert.deepEqual(Array.from(world.request().material.targetWpm), [130, 150]);
  await world.finishTake(read(140));
  assert.equal(textOf(find(world.body, "level-heading")), "Read 4");
  const current = find(world.body, "level-steps__item--current");
  assert.equal(textOf(find(current, "level-steps__label")), "Read 4");
  world.tap("Read it again");
  assert.deepEqual(Array.from(world.request().material.targetWpm), [150, 170]);
  await world.finishTake(read(160));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.deepEqual(world.store.marks, ["pace-2"]);
});

test("Restarts level 1 reads three times: read 3 waits behind its own step", async () => {
  const world = createWorld({ history: [] });
  await world.open("restarts-1");
  world.tap("Record read 1");
  await world.finishTake(readResult({ restartsAt: [20, 60], misreadAt: [100] }));
  world.tap(primaryText(world));
  world.tap("Read it again");
  await world.finishTake(readResult({ restartsAt: [20] }));
  assert.equal(textOf(find(world.body, "level-heading")), "Read 3");
  assert.equal(textOf(find(world.body, "level-summary__label")), "Read 2");
  assert.equal(
    textOf(find(world.body, "level-summary__sentence")),
    "1 slip (1 restart and no misreads) on read 2. The target was 4.",
  );
  world.tap("Read it again");
  assert.equal(world.request().title, "Read 3 of 3");
  await world.finishTake(readResult({}));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  const lead = textOf(find(world.body, "level-checkback__lead"));
  assert.equal(lead, "A level counts when it sticks. One quick read of a new passage:");
});

// --- Check-backs, crowns and checkpoints -----------------------------------------------------

test("a check-back pass keeps its record: a half ring, then gold", async () => {
  const first = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await first.open("fillers-3_checkback");
  first.tap("Record");
  await first.finishTake(talkResult({ fillers: 5 }));
  assert.deepEqual(first.store.marks, ["fillers-3_cb1"]);
  const card = resultCard(first);
  assert.equal(textOf(find(card, "level-result__title")), "Check-back 1");
  assert.equal(textOf(find(card, "level-result__verdict")), "Check-back passed: half ring");
  assert.equal(primaryText(first), "Back to path");

  const second = createWorld({
    history: fillersYesterday(),
    cleared: clearedOn(["fillers-3", "fillers-3_cb1"]),
  });
  await second.open("fillers-3_checkback");
  second.tap("Record");
  await second.finishTake(talkResult({ fillers: 5 }));
  assert.deepEqual(second.store.marks, ["fillers-3_cb2"]);
  assert.equal(textOf(find(second.body, "level-result__title")), "Check-back 2");
  assert.equal(
    textOf(find(second.body, "level-result__verdict")),
    "Locked in: the node turns gold",
  );
});

test("a check-back miss says when it comes back, and that nothing locks", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await world.finishTake(talkResult({ fillers: 12 }));
  assert.deepEqual(world.store.marks, []);
  const card = resultCard(world);
  assert.ok(hasClass(card, "level-result--miss"));
  assert.equal(textOf(find(card, "level-result__title")), "Check-back 1");
  assert.equal(
    textOf(find(card, "level-result__verdict")),
    "Missed. It comes back on Friday, Oct 16. Nothing locks.",
  );
  assert.equal(
    textOf(find(card, "level-result__sentence")),
    "8.0 fillers a minute. The target is 6.",
  );
});

test("a crown earned keeps its tier's record; a run cut short earns nothing", async () => {
  const earned = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await earned.open("fillers_crown");
  earned.tap("Record");
  await earned.finishTake({
    transcript: wordsOver(110, 44),
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  });
  assert.deepEqual(earned.store.marks, ["fillers_crown-1"]);
  const card = resultCard(earned);
  assert.equal(textOf(find(card, "level-result__title")), "Crown earned");
  assert.equal(
    textOf(find(card, "level-result__sentence")),
    "No filler or restart in 0:44 of speech. Crown earned: the target was 0:30.",
  );

  const cut = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await cut.open("fillers_crown");
  cut.tap("Record");
  await cut.finishTake({
    transcript: wordsOver(110, 44, ums(25)),
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  });
  assert.deepEqual(cut.store.marks, []);
  assert.equal(textOf(find(cut.body, "level-result__title")), "Not yet");
  assert.match(textOf(find(cut.body, "level-result__sentence")), /^Your run lasted 0:10 before/);
  assert.equal(find(cut.body, "level-result__fix"), null);
});

test("a checkpoint cleared with someone listening keeps its room record and says so", async () => {
  const room = createWorld({ history: fillersYesterday(), cleared: clearedOn(FILLER_LEVELS) });
  await room.open("fillers_checkpoint");
  find(room.body, "level-switch").click();
  room.tap("Record");
  await room.finishTake(talkResult({ seconds: 120, words: 300, fillers: 2 }));
  assert.deepEqual(room.store.marks, ["fillers_checkpoint", "fillers_checkpoint_room"]);
  assert.equal(textOf(find(room.body, "level-result__title")), "Checkpoint cleared");
  assert.equal(textOf(find(room.body, "level-result__room")), "Cleared in the room");

  const alone = createWorld({ history: fillersYesterday(), cleared: clearedOn(FILLER_LEVELS) });
  await alone.open("fillers_checkpoint");
  alone.tap("Record");
  await alone.finishTake(talkResult({ seconds: 120, words: 300, fillers: 2 }));
  assert.deepEqual(alone.store.marks, ["fillers_checkpoint"]);
  assert.equal(find(alone.body, "level-result__room"), null);
});

test("a checkpoint miss names the one fix", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(FILLER_LEVELS) });
  await world.open("fillers_checkpoint");
  world.tap("Record");
  await world.finishTake(talkResult({ seconds: 120, words: 300, fillers: 9 }));
  assert.deepEqual(world.store.marks, []);
  assert.equal(textOf(find(world.body, "level-result__title")), "Not yet");
  assert.equal(
    textOf(find(world.body, "level-result__fix")),
    "The one fix: Pause instead of um.",
  );
});

// --- The benchmark ---------------------------------------------------------------------------

function benchmarkTake(id, createdAt, passageId, result) {
  return savedTake({
    id,
    createdAt,
    passageId,
    result,
    path: {
      play: "benchmark",
      kind: "benchmark",
      take: passageId === "benchmark-read" ? 1 : 2,
      scored: false,
      passed: null,
      stage: null,
      inRoom: null,
    },
  });
}

test("the benchmark ends on Done: this sitting's numbers and when the next is due", async () => {
  const world = createWorld({ history: fillersYesterday() });
  await world.open("benchmark");
  world.tap("Start benchmark");
  const read = await world.finishTake(readResult({ words: 160, seconds: 64, restartsAt: [40] }));
  assert.equal(textOf(find(world.body, "level-heading")), "Talk");
  assert.equal(textOf(find(world.body, "level-summary__label")), "Read");
  world.tap("Record the talk");
  await world.finishTake(talkResult({ fillers: 3 }));
  assert.deepEqual(world.store.marks, [], "a benchmark clears nothing");
  const card = find(world.body, "level-done");
  assert.equal(textOf(find(card, "level-result__title")), "Benchmark done");
  const lines = findAll(card, "level-done__line").map(textOf);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Read: 1 slip \(1 restart and no misreads\) at \d+ wpm\.$/);
  assert.match(lines[1], /^Talk: 2\.0 fillers a minute at \d+ wpm\.$/);
  assert.equal(find(card, "level-done__since"), null, "one sitting has nothing to compare");
  assert.equal(textOf(find(card, "level-done__next")), "Next benchmark: Wed, Oct 28.");
  assert.equal(primaryText(world), "Back to path");
  const steps = findAll(find(world.body, "level-steps"), "level-steps__label").map(textOf);
  assert.deepEqual(steps, ["Intro", "Read", "Talk", "Done"]);
  assert.equal(read.pathField.kind, "benchmark");
});

test("a second benchmark sitting shows the change since the first", async () => {
  const before = "2026-09-30";
  const history = [
    benchmarkTake(
      "b-talk",
      at(before, 10),
      "benchmark-talk",
      talkResult({ fillers: 6 }),
    ),
    benchmarkTake(
      "b-read",
      at(before, 9),
      "benchmark-read",
      readResult({ words: 160, seconds: 64, restartsAt: [20, 60], misreadAt: [100] }),
    ),
  ];
  const world = createWorld({ history });
  await world.open("benchmark");
  world.tap("Start benchmark");
  await world.finishTake(readResult({ words: 160, seconds: 64, restartsAt: [40] }));
  world.tap("Record the talk");
  await world.finishTake(talkResult({ fillers: 3 }));
  assert.equal(
    textOf(find(world.body, "level-done__since")),
    "Since your first: read slips 3 → 1, fillers 4.0 → 2.0 a minute",
  );
});
