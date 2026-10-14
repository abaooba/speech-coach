// Tests for how frontend/path.js judges a Loop Path take (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 2 to 5): evaluate(play, takeIndex,
// report, context) holds a take to its play's conditions and guards, says why in one sentence,
// names the one fix when it misses, and lists what a pass records, with the jump test, Pace
// level 2's pair of reads, check-back stages, checkpoints in the room, crowns and the benchmark.
// passages.js, delivery.js and path.js load into a vm in index.html's order; every report comes
// from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const LADDER_PASSAGE_ID = "rebuttal-uniforms";
const NO_SPEECH = "No speech was found in this take.";
const NOT_FOLLOWED =
  "This take did not follow the passage. Read it as written to clear this level.";

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const PATH = APP.path;

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// `count` words, one every `step` seconds from `start`, each `length` seconds long (80% of a
// step unless given). `say` swaps in other text by index.
function words({ count, step = 0.5, start = 1, say = {}, length }) {
  const spoken = length === undefined ? step * 0.8 : length;
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: start + index * step,
    end: start + index * step + spoken,
  }));
}

// `count` words spoken over exactly `seconds`, from 1 s.
function wordsOver(count, seconds, say = {}) {
  return words({ count, step: seconds / (count - 0.2), say });
}

// `count` words read at exactly `wpm`.
function wordsAt(count, wpm) {
  return wordsOver(count, (count * 60) / wpm);
}

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

// A stored take as app.store.list() hands it back.
function session({ transcript, repeats = [], pauses = [], script, passageId = "impromptu" }) {
  const metrics = { pauses, repeats, fillers: {} };
  if (script) {
    metrics.script = script;
  }
  return {
    id: "take",
    createdAt: "2026-10-14T10:00:00.000Z",
    passageId,
    passageTitle: "Practice",
    durationSeconds: 90,
    metrics,
    transcript,
  };
}

// A take read from a script: a script restart at each word index in `restartsAt`, a misread at
// each index in `misreadAt`, and for each [index, count] in `skipped`, `count` script words
// skipped right after that word.
function readTake({ transcript, restartsAt = [], misreadAt = [], skipped = [], passageId }) {
  const restarts = restartsAt.map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  const misread = misreadAt.map((index) => ({
    word: "script" + index,
    index,
    at: transcript[index].start,
    said: transcript[index].text,
  }));
  const skips = skipped.flatMap(([index, count]) =>
    Array.from({ length: count }, (_, offset) => ({
      word: "skipped" + index + "-" + offset,
      index: index + offset,
      at: transcript[index].end,
    })),
  );
  return session({
    transcript,
    repeats: restarts,
    script: { restarts, skipped: skips, misread },
    passageId: passageId || "cold-read-zoos",
  });
}

// `count` restarts in a talk, each repeating a word pair, spread through the take.
function restartsIn(transcript, count) {
  return Array.from({ length: count }, (_, n) => {
    const index = 10 + n * 20;
    const text = transcript[index].text + " " + transcript[index + 1].text;
    return { text, at: transcript[index].start };
  });
}

function reportOf(saved) {
  return APP.delivery.analyze(saved.transcript, saved.metrics);
}

// A baseline with every number at a steady speaker's, `overrides` on top.
function usual(overrides = {}) {
  const otherPerMinute = Object.assign(
    { restarts: 0, fillers: 0, "long-pauses": 0, pace: 0 },
    overrides.otherPerMinute,
  );
  return Object.assign(
    {
      takes: 5,
      minutes: 5,
      fillersPerMinute: 0,
      restartsPerMinute: 0,
      shortMidPerMinute: 0,
      longPausesPerMinute: 0,
      wpm: 150,
      cleanStretchSeconds: 20,
      weightedPerMinute: 0,
    },
    overrides,
    { otherPerMinute },
  );
}

function judge(playId, takeIndex, saved, context = { baseline: usual() }) {
  return plain(PATH.evaluate(playId, takeIndex, reportOf(saved), context));
}

function guardTexts(result) {
  return result.guards.map((guard) => [guard.id, guard.passed, guard.text]);
}

function cleared(...ids) {
  return ids.map((levelId) => ({ levelId, clearedAt: "2026-10-14T10:00:00.000Z" }));
}

// 80 s of talk with `count` ums (at most 13): 200 words, so a pace of 150 less what the ums
// take.
function fillersTake(count, seconds = 80) {
  const at = Array.from({ length: count }, (_, n) => 5 + n * 15);
  return session({ transcript: wordsOver(200, seconds, ums(...at)) });
}

// Talk at 0.25 s a word, each word 0.15 s long: 300 words speak for 74.9 s, and a stretch from
// the first word to a filler at index i is exactly i / 4 seconds.
function quickTalk({ count = 300, say = {}, start = 1 } = {}) {
  return words({ count, step: 0.25, start, say, length: 0.15 });
}

// --- the result ------------------------------------------------------------------------------

test("a result says how the take went in every field the Level screen reads", () => {
  const result = judge("fillers-3", 1, fillersTake(8));
  assert.deepEqual(Object.keys(result).sort(), [
    "fix",
    "guards",
    "jumped",
    "passed",
    "records",
    "scored",
    "sentence",
    "stage",
    "targetText",
    "unitLabel",
    "value",
    "valueText",
  ]);
  assert.deepEqual(
    {
      scored: result.scored,
      passed: result.passed,
      value: result.value,
      valueText: result.valueText,
      unitLabel: result.unitLabel,
      targetText: result.targetText,
      sentence: result.sentence,
    },
    {
      scored: true,
      passed: true,
      value: 6,
      valueText: "6.0",
      unitLabel: "fillers a minute",
      targetText: "target 6",
      sentence: "6.0 fillers a minute on take 2. The target was 6.",
    },
  );
  assert.deepEqual(guardTexts(result), [
    ["talkShare", true, "Talked 80 s of 90"],
    ["minWpm", true, "144 wpm"],
    ["steadyOtherSlips", true, "Other slips steady"],
  ]);
  assert.deepEqual(
    [result.fix, result.jumped, result.records, result.stage],
    [null, [], ["fillers-3"], null],
  );
});

test("a rate is judged as it is shown: 6.04 a minute shows 6.0 and meets a target of 6", () => {
  // 8 ums in 79.47 s is 6.04 a minute; in 79.3 s, 6.05, which shows as 6.1.
  const shown = judge("fillers-3", 1, fillersTake(8, 79.47));
  assert.equal(shown.valueText, "6.0");
  assert.equal(shown.passed, true);
  const over = judge("fillers-3", 1, fillersTake(8, 79.3));
  assert.equal(over.valueText, "6.1");
  assert.equal(over.passed, false);
  assert.equal(over.sentence, "6.1 fillers a minute on take 2. The target is 6.");
});

test("a take short of the target misses with the value against the target", () => {
  const result = judge("fillers-3", 1, fillersTake(9));
  assert.equal(result.passed, false);
  assert.equal(result.valueText, "6.8");
  assert.equal(result.sentence, "6.8 fillers a minute on take 2. The target is 6.");
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.jumped, []);
});

test("take 1 is not scored: it is measured against the target but passes nothing", () => {
  const result = judge("fillers-3", 0, fillersTake(9));
  assert.equal(result.scored, false);
  assert.equal(result.passed, null);
  assert.equal(result.sentence, "6.8 fillers a minute on take 1. The target is 6.");
  assert.equal(result.fix, null);
  assert.deepEqual(result.records, []);
  assert.equal(judge("fillers-3", 0, fillersTake(2)).passed, null);
});

test("a take without speech fails a scored take and says so", () => {
  const silent = session({ transcript: [] });
  const result = judge("fillers-3", 1, silent);
  assert.deepEqual(
    [result.passed, result.value, result.valueText, result.sentence, result.guards],
    [false, null, "—", NO_SPEECH, []],
  );
  assert.equal(result.fix, "Pause instead of um");
  assert.equal(judge("fillers-3", 0, silent).passed, null);
  assert.equal(judge("restarts-1_checkback", 0, silent).sentence, NO_SPEECH);
  assert.equal(judge("long-pauses_checkpoint", 0, silent).passed, false);
  const withoutReport = PATH.evaluate("fillers-2", 1, undefined, { baseline: usual() });
  assert.equal(withoutReport.passed, false);
});

// --- guards ----------------------------------------------------------------------------------

test("talkShare: a talk take fills 80% of its set seconds, to a tenth of a second", () => {
  assert.deepEqual(guardTexts(judge("fillers-3", 1, fillersTake(0, 88)))[0], [
    "talkShare",
    true,
    "Talked 88 s of 90",
  ]);
  const short = judge("fillers-3", 1, session({ transcript: wordsOver(125, 50) }));
  assert.deepEqual(guardTexts(short)[0], [
    "talkShare",
    false,
    "You talked 50 s of 90. Keep going to at least 72 s.",
  ]);
  assert.equal(short.passed, false, "the rule alone is met, but not the guard");
  assert.equal(short.sentence, "0.0 fillers a minute on take 2. The target was 6.");
  assert.equal(judge("fillers-3", 1, fillersTake(0, 72)).guards[0].passed, true);
  assert.deepEqual(guardTexts(judge("fillers-3", 1, fillersTake(0, 71.9)))[0], [
    "talkShare",
    false,
    "You talked 71.9 s of 90. Keep going to at least 72 s.",
  ]);
});

test("minWpm: a talk keeps a pace of at least 120 wpm", () => {
  const slow = judge("fillers-3", 1, session({ transcript: wordsAt(156, 104) }));
  assert.deepEqual(guardTexts(slow)[1], ["minWpm", false, "104 wpm. Keep a pace of at least 120."]);
  assert.equal(slow.passed, false);
  const atPace = judge("fillers-3", 1, session({ transcript: wordsAt(180, 120) }));
  assert.deepEqual(guardTexts(atPace)[1], ["minWpm", true, "120 wpm"]);
});

test("steadyOtherSlips: the slips a unit does not train rise no more than 1 a minute", () => {
  // 73.2 s with 2 restarts (1.5 each) and 2 short mid-sentence pauses: 5 slips in 1.22 minutes
  // is 4.1 a minute, all of them "other" slips for the Fillers unit.
  const transcript = wordsOver(180, 73.2);
  const take = session({
    transcript,
    repeats: restartsIn(transcript, 2),
    pauses: [
      [transcript[100].end, 1],
      [transcript[140].end, 1],
    ],
  });
  assert.equal(PATH.measure(reportOf(take), 90).otherPerMinute.fillers, 4.1);
  const rose = judge("fillers-3", 1, take, { baseline: usual({ otherPerMinute: { fillers: 2 } }) });
  assert.deepEqual(guardTexts(rose)[2], [
    "steadyOtherSlips",
    false,
    "Other slips rose to 4.1 a minute from 2.0. Keep them within 1 of your usual.",
  ]);
  const within = judge("fillers-3", 1, take, {
    baseline: usual({ otherPerMinute: { fillers: 3.1 } }),
  });
  assert.deepEqual(guardTexts(within)[2], ["steadyOtherSlips", true, "Other slips steady"]);
  assert.equal(within.passed, true);
  // The same take's restarts are the Restarts unit's own skill: only its pauses are "other".
  assert.equal(PATH.measure(reportOf(take), 90).otherPerMinute.restarts, 1.6);
});

test("readThrough: a read follows its passage and skips no more than 8 words in one place", () => {
  const read = (options) => readTake(Object.assign({ transcript: wordsAt(170, 150) }, options));
  assert.deepEqual(guardTexts(judge("restarts-1", 2, read({})))[0], [
    "readThrough",
    true,
    "Read the passage through",
  ]);
  const stopped = judge("restarts-1", 2, read({ skipped: [[160, 9]] }));
  assert.deepEqual(guardTexts(stopped)[0], [
    "readThrough",
    false,
    "You left out 9 words of the passage in one place. Read all of it to clear this level.",
  ]);
  assert.equal(stopped.sentence, stopped.guards[0].text, "a read not read through says so");
  assert.equal(stopped.value, null);
  assert.equal(judge("restarts-1", 2, read({ skipped: [[160, 8]] })).passed, true);
  const talked = judge("restarts-1", 2, session({ transcript: wordsAt(170, 150) }));
  assert.deepEqual(
    [talked.passed, talked.sentence, talked.valueText],
    [false, NOT_FOLLOWED, "—"],
  );
});

test("each play checks only its own guards", () => {
  const ids = (playId, takeIndex, saved, context) =>
    judge(playId, takeIndex, saved, context).guards.map((guard) => guard.id);
  const talk = fillersTake(0, 100);
  const read = readTake({ transcript: wordsAt(109, 150), passageId: LADDER_PASSAGE_ID });
  assert.deepEqual(ids("fillers-2", 1, talk), ["talkShare", "minWpm", "steadyOtherSlips"]);
  assert.deepEqual(ids("restarts-2", 2, readTake({ transcript: wordsAt(170, 150) })), [
    "readThrough",
    "minWpm",
    "steadyOtherSlips",
  ]);
  assert.deepEqual(ids("pace-1", 1, read), ["readThrough"]);
  assert.deepEqual(ids("pace-4", 1, talk), ["talkShare", "steadyOtherSlips"]);
  assert.deepEqual(ids("pace-5", 1, talk), ["talkShare"]);
  assert.deepEqual(ids("fillers_checkpoint", 0, talk), ["talkShare", "minWpm"]);
  assert.deepEqual(ids("pace_checkpoint", 0, talk), ["talkShare"]);
  assert.deepEqual(ids("pace-3_checkback", 0, talk), ["talkShare", "steadyOtherSlips"]);
  assert.deepEqual(ids("fillers_crown", 0, talk), []);
  assert.deepEqual(ids("benchmark", 1, talk), []);
});

// --- the units' rules ------------------------------------------------------------------------

test("Fillers level 1 asks for halfway from the usual rate to 8, against the baseline", () => {
  const nine = fillersTake(9, 60);
  const atTwelve = { baseline: usual({ fillersPerMinute: 12 }) };
  const result = judge("fillers-1", 1, nine, atTwelve);
  assert.equal(result.passed, true);
  assert.equal(result.targetText, "target 10");
  assert.equal(result.sentence, "9.0 fillers a minute on take 2. The target was 10.");
  const atSix = judge("fillers-1", 1, nine, { baseline: usual({ fillersPerMinute: 6 }) });
  assert.equal(atSix.passed, false);
  assert.equal(atSix.sentence, "9.0 fillers a minute on take 2. The target is 8.");
});

test("a new speaker's take 1 becomes the baseline it is judged against", () => {
  // 12 fillers a minute on take 1: the target is halfway from 12 to 8.
  const result = judge("fillers-1", 0, fillersTake(12, 60), {});
  assert.equal(result.targetText, "target 10");
  assert.deepEqual(guardTexts(result)[2], ["steadyOtherSlips", true, "Other slips steady"]);
  assert.throws(
    () => PATH.evaluate("fillers-1", 1, reportOf(fillersTake(12, 60)), {}),
    /context\.baseline after take 1/,
  );
  assert.throws(() => PATH.evaluate("fillers-1", 1, reportOf(fillersTake(12, 60))), /baseline/);
});

test("Restarts reads count restarts and misreads in all on the scored read", () => {
  const transcript = wordsAt(170, 150);
  const four = readTake({ transcript, restartsAt: [5, 60], misreadAt: [20, 90] });
  const passed = judge("restarts-1", 2, four);
  assert.deepEqual(
    [passed.passed, passed.value, passed.valueText, passed.unitLabel, passed.targetText],
    [true, 4, "4", "slips", "target 4"],
  );
  assert.equal(passed.sentence, "4 slips (2 restarts and 2 misreads) on read 3. The target was 4.");
  const five = readTake({ transcript, restartsAt: [5, 60, 120], misreadAt: [20, 90] });
  assert.equal(
    judge("restarts-1", 2, five).sentence,
    "5 slips (3 restarts and 2 misreads) on read 3. The target is 4.",
  );
  assert.equal(judge("restarts-1", 2, five).passed, false);
  const first = judge("restarts-1", 0, four);
  assert.deepEqual([first.scored, first.passed], [false, null]);
  assert.equal(first.sentence, "4 slips (2 restarts and 2 misreads) on read 1. The target was 4.");
  assert.equal(judge("restarts-1", 1, four).scored, false, "read 2 is practice too");
});

test("the tightest read allows one slip, a restart or a misread, never none", () => {
  const transcript = wordsAt(170, 150);
  const clean = judge("restarts-4", 1, readTake({ transcript }));
  assert.equal(clean.passed, true);
  assert.equal(clean.sentence, "No slips on read 2. The target was 1.");
  const one = judge("restarts-4", 1, readTake({ transcript, misreadAt: [40] }));
  assert.equal(one.sentence, "1 slip (no restarts and 1 misread) on read 2. The target was 1.");
  assert.equal(one.unitLabel, "slip");
  assert.equal(judge("restarts-4", 1, readTake({ transcript, restartsAt: [40] })).passed, true);
  assert.equal(judge("restarts-4", 1, readTake({ transcript, misreadAt: [40, 80] })).passed, false);
  const twoRestarts = readTake({ transcript, restartsAt: [40, 80] });
  assert.equal(judge("restarts-4", 1, twoRestarts).passed, false);
  assert.equal(
    judge("restarts-4", 1, readTake({ transcript, restartsAt: [40], misreadAt: [80] })).sentence,
    "2 slips (1 restart and 1 misread) on read 2. The target is 1.",
  );
});

test("Restarts level 5 holds a talk to 1 restart a minute", () => {
  const transcript = wordsOver(190, 75);
  const once = judge("restarts-5", 1, session({ transcript, repeats: restartsIn(transcript, 1) }));
  assert.equal(once.sentence, "0.8 restarts a minute on take 2. The target was 1.");
  assert.equal(once.passed, true);
  const twice = judge("restarts-5", 1, session({ transcript, repeats: restartsIn(transcript, 2) }));
  assert.equal(twice.sentence, "1.6 restarts a minute on take 2. The target is 1.");
  assert.equal(twice.passed, false);
});

test("Long pauses levels hold a clean stretch with few enough long pauses", () => {
  // Ums at 70, 140, 210 and 280: the longest clean stretch is the 17.5 s before the first.
  const take = session({ transcript: quickTalk({ say: ums(70, 140, 210, 280) }) });
  const context = { baseline: PATH.measure(reportOf(take), 90) };
  const level1 = judge("long-pauses-1", 1, take, context);
  assert.deepEqual(
    [level1.passed, level1.valueText, level1.unitLabel, level1.targetText],
    [true, "17.5", "seconds clean", "target 15 s"],
  );
  assert.equal(
    level1.sentence,
    "17.5 seconds clean and no long pauses on take 2. The target was 15 seconds clean, with at " +
      "most 1 long pause.",
  );
  const level2 = judge("long-pauses-2", 1, take, context);
  assert.equal(level2.passed, false);
  assert.equal(
    level2.sentence,
    "17.5 seconds clean and no long pauses on take 2. The target is 20 seconds clean, with no " +
      "long pause.",
  );
});

test("a clean stretch of exactly the target clears the level, a tenth short does not", () => {
  // An um 15.0 s after the first word, then one every 60 words: the longest stretch is 15.0 s.
  const say = ums(60, 120, 180, 240);
  const exact = session({ transcript: quickTalk({ say }) });
  const context = { baseline: PATH.measure(reportOf(exact), 90) };
  assert.equal(judge("long-pauses-1", 1, exact, context).passed, true);
  assert.equal(judge("long-pauses-1", 1, exact, context).valueText, "15");
  const late = session({ transcript: quickTalk({ say }) });
  late.transcript[0].start += 0.1;
  const short = judge("long-pauses-1", 1, late, context);
  assert.equal(short.passed, false);
  assert.equal(
    short.sentence,
    "14.9 seconds clean and no long pauses on take 2. The target is 15 seconds clean, with at " +
      "most 1 long pause.",
  );
});

test("a long pause breaks the clean stretch even after a full stop, and counts as long", () => {
  // "end." ends at 14.9 s, then 6 s of silence; ums every 56 words after it.
  const transcript = quickTalk({ say: Object.assign({ 55: "end." }, ums(111, 167, 223, 279)) });
  transcript.slice(56).forEach((word) => {
    word.start += 6;
    word.end += 6;
  });
  const frozen = session({ transcript, pauses: [[transcript[55].end, 6]] });
  const unbroken = session({ transcript });
  const context = { baseline: PATH.measure(reportOf(unbroken), 90) };
  const result = judge("long-pauses-1", 1, frozen, context);
  assert.equal(result.passed, false);
  assert.equal(
    result.sentence,
    "13.9 seconds clean and 1 long pause on take 2. The target is 15 seconds clean, with at most " +
      "1 long pause.",
  );
  assert.equal(judge("long-pauses-1", 1, unbroken, context).passed, true, "no freeze, no break");
  assert.match(judge("long-pauses-2", 1, frozen, context).sentence, /with no long pause\.$/);
});

test("Long pauses level 4 keeps mid-sentence pauses at or under the usual rate", () => {
  // 50.4 clean seconds, then 2 short mid-sentence pauses: 1.6 a minute.
  const transcript = quickTalk();
  const take = session({
    transcript,
    pauses: [
      [transcript[201].end, 1],
      [transcript[251].end, 1],
    ],
  });
  const atUsual = judge("long-pauses-4", 1, take, { baseline: usual({ shortMidPerMinute: 1.6 }) });
  assert.equal(atUsual.passed, true);
  const over = judge("long-pauses-4", 1, take, { baseline: usual({ shortMidPerMinute: 1.5 }) });
  assert.equal(over.passed, false);
  assert.equal(
    over.sentence,
    "50.4 seconds clean, no long pauses and 1.6 mid-sentence pauses a minute on take 2. The " +
      "target is 45 seconds clean, with no long pause and no more than 1.5 mid-sentence pauses " +
      "a minute, your usual.",
  );
});

test("Pace level 1 lands read 2 in 140 to 160, edges included", () => {
  const read = (wpm) => readTake({ transcript: wordsAt(109, wpm), passageId: LADDER_PASSAGE_ID });
  for (const wpm of [140, 160]) {
    assert.equal(judge("pace-1", 1, read(wpm)).passed, true, String(wpm));
  }
  const fast = judge("pace-1", 1, read(161));
  assert.deepEqual([fast.passed, fast.valueText, fast.unitLabel, fast.targetText], [
    false,
    "161",
    "wpm",
    "target 140 to 160",
  ]);
  assert.equal(fast.sentence, "161 wpm on read 2. The target is 140 to 160.");
  assert.equal(judge("pace-1", 1, read(139)).passed, false);
  assert.equal(
    judge("pace-1", 1, read(150)).sentence,
    "150 wpm on read 2. The target was 140 to 160.",
  );
});

test("Pace level 2 scores both reads, and the pair passes only when both land", () => {
  const read = (wpm, restartsAt = []) =>
    readTake({ transcript: wordsAt(109, wpm), restartsAt, passageId: LADDER_PASSAGE_ID });
  // Pace trains speed, so its restarts are "other" slips: this speaker usually has 2 a minute.
  const steady = usual({ otherPerMinute: { pace: 2 } });
  const first = judge("pace-2", 0, read(140, [30]), { baseline: steady });
  assert.deepEqual([first.scored, first.passed, first.records], [true, true, []]);
  assert.equal(
    first.sentence,
    "140 wpm and 1 restart on read 1. The target was 130 to 150, with at most 2 restarts.",
  );
  const both = judge("pace-2", 1, read(160), { baseline: steady, earlier: [first] });
  assert.equal(both.passed, true);
  assert.equal(
    both.sentence,
    "160 wpm and no restarts on read 2. The target was 150 to 170, with at most 2 restarts. " +
      "Both reads landed.",
  );
  assert.deepEqual(both.records, ["pace-2"]);
  const missed = judge("pace-2", 0, read(155), { baseline: steady });
  assert.equal(missed.passed, false);
  const after = judge("pace-2", 1, read(160), { baseline: steady, earlier: [missed] });
  assert.equal(after.passed, false);
  assert.equal(
    after.sentence,
    "160 wpm and no restarts on read 2. The target was 150 to 170, with at most 2 restarts. " +
      "Read 1 did not land, and both reads must land.",
  );
  assert.equal(after.fix, "Match the time bar");
  const restarted = judge("pace-2", 1, read(160, [10, 40, 70]), {
    baseline: usual({ otherPerMinute: { pace: 9 } }),
    earlier: [first],
  });
  assert.equal(
    restarted.sentence,
    "160 wpm and 3 restarts on read 2. The target is 150 to 170, with at most 2 restarts.",
  );
  assert.throws(
    () => PATH.evaluate("pace-2", 1, reportOf(read(160)), { baseline: usual() }),
    /context\.earlier\[0\]/,
  );
  // A retry is another pair: reads 3 and 4, read 4 closing it with read 3 as its partner.
  const third = judge("pace-2", 2, read(140), { baseline: steady });
  const fourth = judge("pace-2", 3, read(160), {
    baseline: steady,
    earlier: [first, after, third],
  });
  assert.match(fourth.sentence, /on read 4\. .* Both reads landed\.$/);
  assert.deepEqual(fourth.records, ["pace-2"]);
});

test("Pace level 3's take 2 is held to the length the frozen baseline set", () => {
  const sixtySeconds = session({ transcript: wordsOver(150, 60) });
  const under = judge("pace-3", 1, sixtySeconds, { baseline: usual({ wpm: 130 }) });
  assert.deepEqual(guardTexts(under)[0], ["talkShare", true, "Talked 60 s of 70"]);
  assert.equal(under.passed, true);
  const inBand = judge("pace-3", 1, sixtySeconds, { baseline: usual({ wpm: 150 }) });
  assert.deepEqual(guardTexts(inBand)[0], [
    "talkShare",
    false,
    "You talked 60 s of 90. Keep going to at least 72 s.",
  ]);
});

test("Pace level 5 also holds every weighted slip at or under the usual rate", () => {
  // 100 s at 150 words a minute with 2 ums: 1.2 slips a minute in all, 149 wpm.
  const take = session({ transcript: wordsOver(250, 100, ums(50, 150)) });
  const atUsual = judge("pace-5", 1, take, { baseline: usual({ weightedPerMinute: 1.2 }) });
  assert.equal(atUsual.passed, true);
  const over = judge("pace-5", 1, take, { baseline: usual({ weightedPerMinute: 1.1 }) });
  assert.equal(over.passed, false);
  assert.equal(
    over.sentence,
    "149 wpm and 1.2 slips a minute in all on take 2. The target is 140 to 160, with no more " +
      "than 1.1 slips a minute in all, your usual.",
  );
});

// --- check-backs, checkpoints, crowns and the benchmark ---------------------------------------

test("a check-back is one take at the level's own limit, never Fillers level 1's halfway", () => {
  const nine = fillersTake(9, 60);
  const atTwelve = { baseline: usual({ fillersPerMinute: 12 }) };
  assert.equal(judge("fillers-1", 1, nine, atTwelve).passed, true, "the loop: halfway to 8 is 10");
  const result = judge("fillers-1_checkback", 0, nine, atTwelve);
  assert.equal(result.passed, false);
  assert.equal(result.sentence, "9.0 fillers a minute. The target is 8.");
  assert.deepEqual(result.records, []);
});

test("a passed check-back records its stage: 1, then 2 once stage 1 has passed", () => {
  const take = fillersTake(4, 80);
  const first = judge("fillers-3_checkback", 0, take, {
    baseline: usual(),
    cleared: cleared("fillers-3"),
  });
  assert.deepEqual([first.passed, first.stage, first.records], [true, 1, ["fillers-3_cb1"]]);
  assert.equal(first.sentence, "3.0 fillers a minute. The target was 6.");
  const second = judge("fillers-3_checkback", 0, take, {
    baseline: usual(),
    cleared: cleared("fillers-3", "fillers-3_cb1"),
  });
  assert.deepEqual([second.stage, second.records], [2, ["fillers-3_cb2"]]);
  assert.deepEqual(second.jumped, [], "a check-back never jumps");
  const missed = judge("fillers-3_checkback", 0, fillersTake(9, 80), {
    baseline: usual(),
    cleared: cleared("fillers-3", "fillers-3_cb1"),
  });
  assert.deepEqual([missed.passed, missed.stage, missed.records], [false, 2, []]);
  assert.equal(judge("fillers-3", 1, take).stage, null, "only check-backs have a stage");
});

test("a cold-read check-back reads one unseen passage at the level's slip limit", () => {
  const transcript = wordsAt(170, 150);
  const threeRestarts = readTake({ transcript, restartsAt: [5, 50, 90] });
  const result = judge("restarts-2_checkback", 0, threeRestarts);
  assert.equal(result.passed, true);
  assert.equal(result.sentence, "3 slips (3 restarts and no misreads). The target was 3.");
  assert.deepEqual(result.records, ["restarts-2_cb1"]);
});

test("a checkpoint passes at the unit's target with every slip at or under the usual", () => {
  // 100 s with 4 ums: 2.4 fillers a minute, and 2.4 slips a minute in all.
  const take = session({ transcript: wordsOver(250, 100, ums(20, 80, 140, 200)) });
  const result = judge("fillers_checkpoint", 0, take, {
    baseline: usual({ weightedPerMinute: 2.4 }),
  });
  assert.equal(result.passed, true);
  assert.equal(
    result.sentence,
    "2.4 fillers a minute and 2.4 slips a minute in all. The target was 3, with no more than " +
      "2.4 slips a minute in all, your usual.",
  );
  assert.deepEqual(result.records, ["fillers_checkpoint"]);
  const inRoom = judge("fillers_checkpoint", 0, take, {
    baseline: usual({ weightedPerMinute: 2.4 }),
    inRoom: true,
  });
  assert.deepEqual(inRoom.records, ["fillers_checkpoint", "fillers_checkpoint_room"]);
  const over = judge("fillers_checkpoint", 0, take, {
    baseline: usual({ weightedPerMinute: 2.3 }),
  });
  assert.equal(over.passed, false);
  assert.match(over.sentence, /The target is 3, with no more than 2\.3 slips a minute in all/);
  assert.deepEqual(over.records, []);
});

test("the Long pauses checkpoint allows no long pause at all", () => {
  const transcript = wordsOver(250, 100);
  const frozen = session({ transcript, pauses: [[transcript[120].end, 6]] });
  const result = judge("long-pauses_checkpoint", 0, frozen, {
    baseline: usual({ weightedPerMinute: 2 }),
  });
  assert.equal(result.passed, false);
  assert.equal(
    result.sentence,
    "1 long pause and 1.8 slips a minute in all. The target is no long pause, with no more " +
      "than 2.0 slips a minute in all, your usual.",
  );
  const clean = judge("long-pauses_checkpoint", 0, session({ transcript }), { baseline: usual() });
  assert.equal(clean.passed, true);
  assert.equal(clean.valueText, "0");
});

test("a crown is judged by its own rule at the next tier and records that tier", () => {
  // From 2 s, a word every half second: the um at index 94 starts 47 s after the first word.
  const take = session({ transcript: words({ count: 120, start: 2, say: { 94: "um" } }) });
  const tier2 = judge("fillers_crown", 0, take, { cleared: cleared("fillers_crown-1") });
  assert.deepEqual(
    [tier2.scored, tier2.passed, tier2.value, tier2.valueText, tier2.targetText, tier2.records],
    [true, true, 47, "0:47", "target 0:45", ["fillers_crown-2"]],
  );
  assert.equal(tier2.unitLabel, "before the first filler or restart");
  assert.deepEqual(tier2.guards, []);
  const tier3 = judge("fillers_crown", 0, take, {
    cleared: cleared("fillers_crown-1", "fillers_crown-2"),
  });
  assert.deepEqual([tier3.passed, tier3.records, tier3.fix], [false, [], "Pause instead of um"]);
  const ladder = judge(
    "pace_crown",
    0,
    readTake({ transcript: wordsAt(109, 180), restartsAt: [30], passageId: LADDER_PASSAGE_ID }),
  );
  assert.deepEqual([ladder.passed, ladder.valueText, ladder.targetText, ladder.records], [
    true,
    "180",
    "target 170 to 190",
    ["pace_crown-1"],
  ]);
});

test("a benchmark take is measured, never scored: the read's slips and the talk's fillers", () => {
  const read = readTake({
    transcript: wordsAt(150, 150),
    restartsAt: [40],
    misreadAt: [90],
    passageId: "benchmark-read",
  });
  const result = judge("benchmark", 0, read, {});
  assert.deepEqual(
    [result.scored, result.passed, result.value, result.unitLabel, result.records],
    [false, null, 2, "slips", []],
  );
  assert.equal(result.sentence, "2 slips (1 restart and 1 misread) at 150 wpm.");
  const talked = session({ transcript: wordsOver(250, 100, ums(20, 80, 140, 200)) });
  const talk = judge("benchmark", 1, talked);
  assert.deepEqual([talk.value, talk.valueText, talk.unitLabel], [2.4, "2.4", "fillers a minute"]);
  assert.equal(talk.sentence, "2.4 fillers a minute at 148 wpm.");
  const strayed = judge("benchmark", 0, session({ transcript: wordsAt(150, 150) }));
  assert.deepEqual([strayed.value, strayed.sentence], [null, NOT_FOLLOWED]);
  assert.throws(() => PATH.evaluate("benchmark", 2, reportOf(read), {}), /two takes/);
});

// --- the jump test ---------------------------------------------------------------------------

test("a read that meets later levels' limits clears them too, up to the first it misses", () => {
  const transcript = wordsAt(170, 150);
  const oneSlip = judge("restarts-1", 2, readTake({ transcript, misreadAt: [30] }));
  assert.deepEqual(oneSlip.jumped, ["restarts-2", "restarts-3", "restarts-4"]);
  assert.deepEqual(oneSlip.records, ["restarts-1", "restarts-2", "restarts-3", "restarts-4"]);
  const threeSlips = judge("restarts-1", 2, readTake({ transcript, misreadAt: [30, 60, 90] }));
  assert.deepEqual(threeSlips.jumped, ["restarts-2"], "level 3 allows 2: the jump stops there");
});

test("a jump never reaches a level whose scored take is longer or of the other kind", () => {
  // Fillers level 3's 90 s take meets level 4's rate, but level 5's take is 120 s.
  assert.deepEqual(judge("fillers-3", 1, fillersTake(3)).jumped, ["fillers-4"]);
  // Fillers level 1 is 60 s: level 2 is 60 s too, level 3 is 90 s.
  assert.deepEqual(judge("fillers-1", 1, fillersTake(0, 60)).jumped, ["fillers-2"]);
  // Restarts level 4 is a read; level 5 is a talk.
  const clean = readTake({ transcript: wordsAt(170, 150) });
  assert.deepEqual(judge("restarts-4", 1, clean).jumped, []);
  // Pace level 2 scores two reads, so nothing jumps to it.
  const read = readTake({ transcript: wordsAt(109, 150), passageId: LADDER_PASSAGE_ID });
  assert.deepEqual(judge("pace-1", 1, read).jumped, []);
});

test("a jump is judged on the same take and baseline, conditions and guards alike", () => {
  // 50.4 clean seconds, no long pause, 2 short mid-sentence pauses (1.6 a minute).
  const transcript = quickTalk();
  const take = session({
    transcript,
    pauses: [
      [transcript[201].end, 1],
      [transcript[251].end, 1],
    ],
  });
  const steady = judge("long-pauses-1", 1, take, { baseline: usual({ shortMidPerMinute: 2 }) });
  assert.deepEqual(steady.jumped, ["long-pauses-2", "long-pauses-3", "long-pauses-4"]);
  const busier = judge("long-pauses-1", 1, take, { baseline: usual({ shortMidPerMinute: 1 }) });
  assert.deepEqual(
    busier.jumped,
    ["long-pauses-2", "long-pauses-3"],
    "level 4 holds pauses to the usual rate",
  );
});

test("a level already cleared is passed over, not listed again", () => {
  const transcript = wordsAt(170, 150);
  const result = judge("restarts-1", 2, readTake({ transcript }), {
    baseline: usual(),
    cleared: cleared("restarts-2"),
  });
  assert.deepEqual(result.jumped, ["restarts-3", "restarts-4"]);
});

// --- the one fix -----------------------------------------------------------------------------

test("a missed take names one fix: the one chosen, else the failed guard's, else the first", () => {
  const short = session({ transcript: wordsOver(125, 50, ums(10, 30, 50, 70, 90, 110)) });
  const chosen = judge("fillers-3", 1, short, { baseline: usual(), fix: "Jot 3 points first" });
  assert.equal(chosen.fix, "Jot 3 points first");
  assert.equal(judge("fillers-3", 1, short).fix, "Keep talking until the time bar fills");
  assert.equal(judge("fillers-3", 1, fillersTake(9)).fix, "Pause instead of um");
  assert.equal(
    judge("fillers-3", 1, session({ transcript: wordsAt(156, 104) })).fix,
    "Keep a pace of at least 120 wpm",
  );
  assert.equal(
    judge("restarts-1", 2, session({ transcript: wordsAt(170, 150) })).fix,
    "Read every word, as written",
  );
  assert.equal(judge("fillers-3", 1, fillersTake(2)).fix, null, "no fix on a pass");
  assert.equal(judge("fillers-3", 1, fillersTake(9), { baseline: usual(), fix: "  " }).fix,
    "Pause instead of um");
});

// --- what evaluate refuses -------------------------------------------------------------------

test("evaluate refuses a play it does not know and a take index that is not one", () => {
  const report = reportOf(fillersTake(2));
  assert.throws(() => PATH.evaluate("fillers-6", 0, report, {}), /Unknown path play: fillers-6/);
  assert.throws(() => PATH.evaluate(undefined, 0, report, {}), /Unknown path play/);
  assert.throws(() => PATH.evaluate("fillers-1", -1, report, {}), /take index/);
  assert.throws(() => PATH.evaluate("fillers-1", "1", report, {}), /take index/);
  const asPlay = plain(PATH.evaluate(PATH.playById("fillers-3"), 1, report, { baseline: usual() }));
  assert.equal(asPlay.passed, true, "a play works as well as its id");
});
