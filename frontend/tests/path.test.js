// Tests for frontend/path.js (app.path), the Loop Path's data and rules
// (docs/superpowers/specs/2026-10-14-loop-path.md, which replaced docs/PLAN.md T42's challenge
// modes). Four units (Restarts, Fillers, Long pauses, Pace) of five levels, each level a loop
// whose scored take must meet its conditions and guards; sudden death and the speed ladder judge
// the Fillers and Pace crowns. evaluate() passes or fails a take from its app.delivery report,
// order() puts the weakest unit first by the advice ranking of backend/advice/select.py, a level
// unlocks once the one before it is cleared, and pickColdRead() hands out a cold read the speaker
// has never read. passages.js, delivery.js and path.js load into a vm in index.html's order;
// every report here comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures");

const UNIT_IDS = ["restarts", "fillers", "long-pauses", "pace"];
const NO_SPEECH = "No speech was found in this take.";
const LADDER_PASSAGE_ID = "explainer-rainbows";
// A cold read is read at the slow edge of its band at worst (passages.js gives 140 to 160).
const SLOW_EDGE_WPM = 140;

function source(file) {
  return fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
}

// The modules as index.html loads them; `withResults` adds screens/results.js for isSample.
function loadApp({ withResults = false } = {}) {
  const app = { screens: {} };
  const context = { app };
  const files = ["passages.js", "delivery.js", "path.js"];
  if (withResults) {
    files.push(path.join("screens", "results.js"));
  }
  files.forEach((file) => vm.runInNewContext(source(file), context, { filename: file }));
  return app;
}

const APP = loadApp();
const PATH = APP.path;

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function idsOf(list) {
  return Array.from(list, (item) => item.id);
}

function level(id) {
  const found = PATH.levelById(id);
  assert.ok(found, "no level " + id);
  return found;
}

function unit(id) {
  return PATH.UNITS.find((entry) => entry.id === id);
}

// A real 2026-10-11 take from backend/tests/fixtures, in clip seconds.
function realWords(file) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8")).words.map((word) => ({
    text: word.text,
    start: word.start / 1000,
    end: word.end / 1000,
  }));
}

const UNIFORMS_WORDS = realWords("take_2026_10_11_uniforms.json");
const UNIFORMS_REPEATS = [{ text: "the few decisions a", at: 33.41 }];
const NERVOUS_WORDS = realWords("take_2026_10_11_nervous.json");
const NERVOUS_REPEATS = [{ text: "I kinda ner", at: 27.379 }];

// `count` words, one every `step` seconds from `start`, each 80% of a step long, so the take
// speaks from `start` to start + step * (count - 0.2). `say` swaps in other text by index.
function words({ count, step = 0.5, start = 1, say = {} }) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: start + index * step,
    end: start + index * step + step * 0.8,
  }));
}

// `count` words read at exactly `wpm` (no hesitations among them).
function wordsAt(count, wpm, start = 1) {
  return words({ count, start, step: ((60 / wpm) * count) / (count - 0.2) });
}

// Talk at 0.25 s a word, each word 0.15 s long, from `start`: 300 words speak for 74.9 s, and a
// stretch from the first word to a filler at index i lasts exactly i / 4 seconds.
function quickTalk({ count = 300, say = {}, start = 1 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: start + index * 0.25,
    end: start + index * 0.25 + 0.15,
  }));
}

// A stored session as app.store.list() hands it back.
function session({
  transcript,
  repeats = [],
  pauses = [],
  script,
  passageId = "free-talk",
  passageTitle = "Your day",
  createdAt = "2026-10-12T10:00:00.000Z",
  id = "take-" + createdAt,
}) {
  const metrics = { pauses, repeats, fillers: {} };
  if (script) {
    metrics.script = script;
  }
  return { id, createdAt, passageId, passageTitle, durationSeconds: 60, metrics, transcript };
}

function reportOf(take) {
  return APP.delivery.analyze(take.transcript, take.metrics);
}

// A speaker's usual numbers from one clean minute at 150 wpm: no slips of any kind.
const STEADY = PATH.baseline([session({ transcript: words({ count: 150, step: 60 / 149.8 }) })]);

// How take `takeIndex` (0 for take 1) of a play went, against the steady baseline unless
// `context` gives another.
function judge(playId, takeIndex, take, context = { baseline: STEADY }) {
  return plain(PATH.evaluate(playId, takeIndex, reportOf(take), context));
}

// The verdict a crown gives a take at its tier `tier` (1 for the first), the tiers below it
// already earned.
function crownVerdict(take, tier = 1) {
  const earned = Array.from({ length: tier - 1 }, (_, index) => ({
    levelId: "fillers_crown-" + (index + 1),
    clearedAt: "2026-10-12T10:00:00.000Z",
  }));
  const result = judge("fillers_crown", 0, take, { cleared: earned });
  return { passed: result.passed, detail: result.sentence };
}

// A result's verdict and its sentence.
function pick(result) {
  return [result.passed, result.sentence];
}

function ladderVerdict(take) {
  const result = judge("pace_crown", 0, take, {});
  return { passed: result.passed, detail: result.sentence };
}

// A take read from a script: a script restart starting at each word index in `restartsAt`, a
// misread at each index in `misreadAt`, and for each [index, count] in `skipped`, `count`
// script words skipped right after that word.
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
    passageTitle: "Cold read",
  });
}

// --- the data --------------------------------------------------------------------------------

test("index.html loads path.js after the passages and the delivery rules it reads", () => {
  const sources = [...source("index.html").matchAll(/<script src="([^"]+)"><\/script>/g)].map(
    (match) => match[1],
  );
  const at = sources.indexOf("path.js");
  assert.ok(at > sources.indexOf("passages.js"), "after passages.js");
  assert.ok(at > sources.indexOf("delivery.js"), "after delivery.js");
  assert.ok(at < sources.indexOf("screens/practice.js"), "before the screens");
});

test("the service worker caches path.js under a new cache name", () => {
  const worker = source("sw.js");
  const shell = [...worker.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)];
  assert.ok(shell.some((match) => match[1] === "path.js"), "path.js is in SHELL");
  assert.doesNotMatch(worker, /const CACHE_NAME = "speech-coach-shell-v1";/, "CACHE_NAME bumped");
});

test("path.js assigns exactly app.path", () => {
  assert.deepEqual(Object.keys(APP).sort(), ["delivery", "passages", "path", "screens"]);
  assert.deepEqual(Object.keys(PATH).sort(), [
    "UNITS",
    "addDays",
    "attemptsLeft",
    "baseline",
    "benchmarkState",
    "checkbacks",
    "checkpointState",
    "crownState",
    "currentLevel",
    "evaluate",
    "isUnlocked",
    "levelById",
    "localDay",
    "materialFor",
    "measure",
    "order",
    "ownTakes",
    "pickColdRead",
    "pickTopic",
    "playById",
    "ringOf",
    "statusOf",
    "takeAt",
    "topFillers",
    "weekDays",
  ]);
});

test("the path is four units of five levels, in the advice ranking's order of skills", () => {
  assert.deepEqual(idsOf(PATH.UNITS), UNIT_IDS);
  assert.deepEqual(Array.from(PATH.UNITS, (unit) => unit.title), [
    "Restarts",
    "Fillers",
    "Long pauses",
    "Pace",
  ]);
  assert.deepEqual(plain(Array.from(PATH.UNITS, (unit) => unit.tags)), [
    ["restart"],
    ["filler"],
    ["long_pause"],
    ["pace_fast", "pace_slow"],
  ]);
  PATH.UNITS.forEach((unit) => {
    assert.equal(unit.levels.length, 5, unit.id);
    unit.levels.forEach((entry, index) => {
      assert.equal(entry.id, unit.id + "-" + (index + 1));
      assert.equal(entry.unit, unit.id);
      assert.equal(entry.number, index + 1);
    });
  });
});

test("every level has the Loop Path's fields: a title, its material, takes and a rule", () => {
  PATH.UNITS.forEach((unit) => {
    unit.levels.forEach((entry) => {
      assert.deepEqual(Object.keys(entry).sort(), [
        "checkback",
        "conditions",
        "guards",
        "id",
        "listsTopFillers",
        "liveTap",
        "material",
        "number",
        "prepSeconds",
        "scoredInPairs",
        "spotIt",
        "takes",
        "tip",
        "title",
        "unit",
      ]);
      assert.equal(typeof entry.title, "string");
      assert.ok(entry.title.length >= 6, entry.id);
      assert.ok(entry.takes.length >= 2, entry.id);
      entry.takes.forEach((take) => {
        assert.ok(Number.isInteger(take.seconds) && take.seconds > 0, entry.id);
      });
      assert.ok(entry.conditions.length >= 1, entry.id);
      assert.ok(entry.guards.length >= 1, entry.id);
      assert.ok(
        ["your-day", "impromptu", "new-topic", "cold-read", "ladder"].includes(entry.material),
        entry.id,
      );
    });
  });
});

test("each unit trains its skill on reads, talks or both", () => {
  const kinds = Object.fromEntries(
    Array.from(PATH.UNITS, (unit) => [
      unit.id,
      Array.from(unit.levels, (entry) =>
        entry.takes.every((take) => take.read) ? "read" : "talk",
      ),
    ]),
  );
  assert.deepEqual(plain(kinds), {
    restarts: ["read", "read", "read", "read", "talk"],
    fillers: ["talk", "talk", "talk", "talk", "talk"],
    "long-pauses": ["talk", "talk", "talk", "talk", "talk"],
    pace: ["read", "read", "talk", "talk", "talk"],
  });
});

test("sudden death, the Fillers crown, asks for runs of 30, 45, 60, 90 and 120 seconds", () => {
  const crown = unit("fillers").crown;
  assert.deepEqual(
    Array.from(crown.tiers, (tier) => tier.seconds),
    [30, 45, 60, 90, 120],
  );
  const first = PATH.playById("fillers_crown");
  assert.deepEqual(
    [first.goal.headline, first.goal.unitLabel],
    ["0:30", "without a filler or restart"],
  );
  const last = PATH.playById("fillers_crown", {
    cleared: [1, 2, 3, 4].map((n) => ({ levelId: "fillers_crown-" + n, clearedAt: "x" })),
  });
  assert.deepEqual(
    [last.goal.headline, last.goal.unitLabel],
    ["2:00", "without a filler or restart"],
  );
});

test("the ladder reads 150 within 10, then 140 and 160, and crowns at 180, 1 restart", () => {
  const bands = (id) => plain(Array.from(level(id).takes, (take) => take.band));
  assert.deepEqual(bands("pace-1"), [
    [140, 160],
    [140, 160],
  ]);
  assert.deepEqual(bands("pace-2"), [
    [130, 150],
    [150, 170],
  ]);
  assert.deepEqual(plain(level("pace-2").conditions[1]), { measure: "restarts", max: 2 });
  assert.deepEqual(plain(unit("pace").crown.tiers), [
    { number: 1, wpm: 180, maxRestarts: 1, record: "pace_crown-1" },
  ]);
  assert.deepEqual(plain(PATH.playById("pace_crown").takes[0].band), [170, 190]);
  assert.equal(PATH.playById("pace_crown").goal.unitLabel, "wpm, at most 1 restart");
  assert.equal(
    PATH.playById("pace-2").goal.unitLabel,
    "wpm, give or take 10, at most 2 restarts each",
  );
});

test("cold reads allow 4, 3, 2, then 1 restart or misread, then a talk at 1 a minute", () => {
  assert.deepEqual(
    plain(Array.from(unit("restarts").levels, (entry) => entry.conditions[0])),
    [
      { measure: "readSlips", max: 4 },
      { measure: "readSlips", max: 3 },
      { measure: "readSlips", max: 2 },
      { measure: "readSlips", max: 1 },
      { measure: "restartsPerMinute", max: 1 },
    ],
  );
  assert.deepEqual(plain(PATH.playById("restarts-1").goal), {
    headline: "4 or fewer",
    unitLabel: "slips on read 3: restarts and misreads",
    length: "3 reads of a new passage",
    short: "4 slips or fewer",
  });
  assert.deepEqual(plain(PATH.playById("restarts-4").goal), {
    headline: "1 or fewer",
    unitLabel: "slips on read 2: restarts and misreads",
    length: "2 reads of a new passage",
    short: "1 slip or fewer",
  });
});

test("clean stretches grow from the 15 s beginners' practice target to a full minute", () => {
  assert.deepEqual(
    Array.from(unit("long-pauses").levels, (entry) => entry.conditions[0].min),
    [15, 20, 30, 45, 60],
  );
  assert.deepEqual(plain(PATH.playById("long-pauses-1").goal), {
    headline: "15 s",
    unitLabel: "clean stretch, at most 1 long pause",
    length: "90 s, two takes",
    short: "15 s clean",
  });
});

test("every level asks for no less than the level before it", () => {
  const main = (entry) => entry.conditions[0];
  unit("fillers").levels.slice(1).forEach((entry, index) => {
    assert.ok(main(entry).max <= main(unit("fillers").levels[index]).max, entry.id);
  });
  unit("restarts").levels.slice(1, 4).forEach((entry, index) => {
    assert.ok(main(entry).max < main(unit("restarts").levels[index]).max, entry.id);
  });
  unit("long-pauses").levels.slice(1).forEach((entry, index) => {
    const before = unit("long-pauses").levels[index];
    assert.ok(main(entry).min > main(before).min, entry.id);
    assert.ok(entry.conditions[1].max <= before.conditions[1].max, entry.id);
    assert.ok(entry.prepSeconds <= before.prepSeconds, entry.id);
  });
  // Pace holds the same band, on talks that grow longer, then on a new topic with every slip
  // held to the speaker's usual.
  const pace = unit("pace").levels;
  assert.ok(pace[3].takes[1].seconds > pace[2].takes[1].seconds);
  assert.equal(pace[4].material, "new-topic");
  assert.equal(pace[4].conditions.length, pace[3].conditions.length + 1);
});

test("a talk runs past its target, so the take has room to reach it", () => {
  assert.deepEqual(
    Array.from(unit("fillers").crown.tiers, (tier) => {
      const cleared = Array.from({ length: tier.number - 1 }, (_, n) => ({
        levelId: "fillers_crown-" + (n + 1),
        clearedAt: "x",
      }));
      return PATH.playById("fillers_crown", { cleared }).takes[0].seconds - tier.seconds;
    }),
    [15, 15, 15, 15, 15],
  );
  unit("long-pauses").levels.forEach((entry) => {
    entry.takes.forEach((take) => {
      assert.ok(take.seconds >= entry.conditions[0].min + 15, entry.id);
    });
    assert.ok(entry.checkback.take.seconds >= entry.conditions[0].min + 15, entry.id);
  });
});

test("a ladder read lasts as long as the passage takes at its pace, rounded up", () => {
  const passage = APP.passages.find((entry) => entry.id === LADDER_PASSAGE_ID);
  const passageWords = passage.text.trim().split(/\s+/).length;
  ["pace-1", "pace-2"].forEach((id) => {
    assert.equal(level(id).material, "ladder", id);
    level(id).takes.forEach((take) => {
      const target = (take.band[0] + take.band[1]) / 2;
      assert.equal(take.seconds, Math.ceil((passageWords * 60) / target), id);
    });
  });
  assert.deepEqual(
    [...level("pace-1").takes, ...level("pace-2").takes].map((take) => take.seconds),
    [44, 44, 47, 41],
  );
  assert.equal(PATH.playById("pace_crown").takes[0].seconds, 37);
});

test("every cold read fits in a cold-read level even at the slow edge of its band", () => {
  const longest = Math.max(
    ...APP.passages.coldReads().map((passage) => passage.text.trim().split(/\s+/).length),
  );
  unit("restarts").levels.slice(0, 4).forEach((entry) => {
    assert.equal(entry.material, "cold-read", "a cold read is picked per take");
    assert.equal(entry.checkback.material, "cold-read", entry.id);
    entry.takes.forEach((take) => {
      assert.ok(take.seconds >= (longest * 60) / SLOW_EDGE_WPM, entry.id);
    });
    assert.ok(entry.checkback.take.seconds >= (longest * 60) / SLOW_EDGE_WPM, entry.id);
  });
});

test("talk levels open on Practice prompts that exist: Your day and Impromptu", () => {
  const prompts = APP.passages.filter((entry) => entry.kind === "prompt").map((entry) => entry.id);
  assert.ok(prompts.includes("free-talk") && prompts.includes("impromptu"));
  PATH.UNITS.forEach((unit) => {
    unit.levels.forEach((entry) => {
      const material = PATH.materialFor(entry.id, [], () => 0);
      if (entry.material === "your-day") {
        assert.equal(material.id, "free-talk", entry.id);
      } else if (entry.material === "impromptu" || entry.material === "new-topic") {
        assert.equal(material.id, "impromptu", entry.id);
      }
      assert.ok(prompts.includes(material.id) || material.kind === "passage", entry.id);
    });
  });
  const ladder = APP.passages.find((entry) => entry.id === LADDER_PASSAGE_ID);
  assert.equal(ladder.kind, "passage", "the ladder is read on the Read tab");
});

test("the path data cannot be changed by a caller", () => {
  const first = PATH.UNITS[0].levels[0];
  assert.ok(Object.isFrozen(PATH.UNITS));
  assert.ok(Object.isFrozen(PATH.UNITS[0]));
  assert.ok(Object.isFrozen(PATH.UNITS[0].levels));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.conditions));
  assert.ok(Object.isFrozen(first.conditions[0]));
  assert.ok(Object.isFrozen(first.takes[0]));
  assert.ok(Object.isFrozen(PATH.UNITS[1].crown.tiers[0]));
});

test("levelById finds every level and returns null for anything else", () => {
  PATH.UNITS.forEach((unit) => {
    unit.levels.forEach((entry) => assert.equal(PATH.levelById(entry.id), entry));
  });
  for (const unknown of ["fillers-6", "fillers", "", undefined, null, 3]) {
    assert.equal(PATH.levelById(unknown), null, String(unknown));
  }
});

// --- evaluate: no speech, unknown plays ------------------------------------------------------

test("a take with no words fails every scored take, whatever the play", () => {
  const silent = APP.delivery.analyze([], {});
  PATH.UNITS.forEach((unit) => {
    unit.levels.forEach((entry) => {
      const scoredIndex = entry.takes.length - 1;
      for (const [id, index] of [[entry.id, scoredIndex], [entry.id + "_checkback", 0]]) {
        const result = plain(PATH.evaluate(id, index, silent, { baseline: STEADY }));
        assert.deepEqual([result.passed, result.sentence], [false, NO_SPEECH], id);
      }
    });
  });
  for (const id of ["fillers_crown", "pace_crown", "pace_checkpoint"]) {
    const result = plain(PATH.evaluate(id, 0, silent, { baseline: STEADY }));
    assert.deepEqual([result.passed, result.sentence], [false, NO_SPEECH], id);
  }
  assert.deepEqual(
    plain(PATH.evaluate("restarts-4", 1, undefined, { baseline: STEADY })).sentence,
    NO_SPEECH,
  );
});

test("evaluate refuses a play the path does not know", () => {
  const report = reportOf(session({ transcript: words({ count: 10 }) }));
  assert.throws(() => PATH.evaluate("fillers-freestyle", 0, report, {}), {
    message: /fillers-freestyle/,
  });
  assert.throws(() => PATH.evaluate(undefined, 0, report, {}), /play/);
});

// --- evaluate: sudden death, the Fillers crown --------------------------------------------------

test("sudden death passes when the run before the first filler reaches the target", () => {
  // From 2 s, a word every half second: the um at index 94 starts 47 s after the first word.
  const take = session({ transcript: words({ count: 120, start: 2, say: { 94: "um" } }) });
  assert.deepEqual(crownVerdict(take, 2), {
    passed: true,
    detail: "Your run lasted 0:47 before “um”. Crown earned: the target was 0:45.",
  });
});

test("sudden death fails when a filler ends the run short of the target", () => {
  const take = session({ transcript: words({ count: 120, start: 2, say: { 94: "um" } }) });
  assert.deepEqual(crownVerdict(take, 3), {
    passed: false,
    detail: "Your run lasted 0:47 before “um”. Reach 1:00 to earn this crown.",
  });
});

test("a verbal habit ends the run as an um does", () => {
  // "like," set off by a comma is a habit (delivery.js); index 40 is 20 s in.
  const take = session({ transcript: words({ count: 80, say: { 40: "like," } }) });
  assert.deepEqual(crownVerdict(take), {
    passed: false,
    detail: "Your run lasted 0:20 before “like”. Reach 0:30 to earn this crown.",
  });
});

test("the run starts at the first word, not when the recording starts", () => {
  // Ten silent seconds, then an um 25 s after the first word, at 0:35 on the recording.
  const take = session({ transcript: words({ count: 80, start: 10, say: { 50: "um" } }) });
  assert.deepEqual(crownVerdict(take), {
    passed: false,
    detail: "Your run lasted 0:25 before “um”. Reach 0:30 to earn this crown.",
  });
});

test("a restart ends the run: the real nervous take restarts before its first um", () => {
  // "I kinda ner— I'm kinda nervous" at 27.4 s; the first um is at 31.6 s; speech starts at 0.9.
  const take = session({ transcript: NERVOUS_WORDS, repeats: NERVOUS_REPEATS });
  assert.deepEqual(crownVerdict(take), {
    passed: false,
    detail: "Your run lasted 0:26 before you restarted “I kinda ner”. " +
      "Reach 0:30 to earn this crown.",
  });
});

test("the real uniforms take's run ends on its first uh, 13.7 s in", () => {
  const take = session({
    transcript: UNIFORMS_WORDS,
    repeats: UNIFORMS_REPEATS,
    passageId: LADDER_PASSAGE_ID,
  });
  assert.deepEqual(crownVerdict(take), {
    passed: false,
    detail: "Your run lasted 0:13 before “uh”. Reach 0:30 to earn this crown.",
  });
});

test("a take with no filler or restart runs to its last word", () => {
  // 100 words from 1 s: the last ends at 50.9 s, 49.9 s after the first began.
  const take = session({ transcript: words({ count: 100 }) });
  assert.deepEqual(crownVerdict(take, 2), {
    passed: true,
    detail: "No filler or restart in 0:49 of speech. Crown earned: the target was 0:45.",
  });
  assert.deepEqual(crownVerdict(take, 3), {
    passed: false,
    detail: "No filler or restart, but you spoke for only 0:49. " +
      "Keep going to 1:00 to earn this crown.",
  });
});

test("a run that reaches the target to the tenth of a second passes", () => {
  // The um starts exactly 30 s after the first word.
  const take = session({ transcript: words({ count: 80, say: { 60: "um" } }) });
  assert.equal(crownVerdict(take).passed, true);
  const short = session({ transcript: words({ count: 80, say: { 59: "um" } }) });
  assert.equal(crownVerdict(short).passed, false);
});

// --- evaluate: the speed ladder, the Pace crown --------------------------------------------------

test("the speed ladder passes on pace with few enough restarts", () => {
  const transcript = wordsAt(109, 185);
  const take = readTake({ transcript, restartsAt: [50], passageId: LADDER_PASSAGE_ID });
  assert.deepEqual(ladderVerdict(take), {
    passed: true,
    detail: "You read at 185 wpm with 1 restart. Crown earned: the target was 170 to 190 wpm.",
  });
});

test("the speed ladder's window includes both its edges", () => {
  for (const wpm of [170, 190]) {
    const take = readTake({ transcript: wordsAt(109, wpm), passageId: LADDER_PASSAGE_ID });
    assert.equal(ladderVerdict(take).passed, true, String(wpm));
  }
});

test("reading too fast or too slow fails the crown with the way back to it", () => {
  const fast = readTake({ transcript: wordsAt(109, 191), passageId: LADDER_PASSAGE_ID });
  assert.deepEqual(ladderVerdict(fast), {
    passed: false,
    detail: "You read at 191 wpm with no restarts. " +
      "Slow down to 170 to 190 wpm to earn this crown.",
  });
  const slow = readTake({ transcript: wordsAt(109, 169), passageId: LADDER_PASSAGE_ID });
  assert.deepEqual(ladderVerdict(slow), {
    passed: false,
    detail: "You read at 169 wpm with no restarts. Speed up to 170 to 190 wpm to earn this crown.",
  });
});

test("too many restarts fail the crown even on pace", () => {
  const take = readTake({
    transcript: wordsAt(109, 180),
    restartsAt: [10, 50],
    passageId: LADDER_PASSAGE_ID,
  });
  assert.deepEqual(ladderVerdict(take), {
    passed: false,
    detail: "You read at 180 wpm with 2 restarts. Keep restarts to 1 or fewer to earn this crown.",
  });
  const one = readTake({
    transcript: wordsAt(109, 175),
    restartsAt: [30],
    passageId: LADDER_PASSAGE_ID,
  });
  assert.deepEqual(ladderVerdict(one), {
    passed: true,
    detail: "You read at 175 wpm with 1 restart. Crown earned: the target was 170 to 190 wpm.",
  });
});

test("off pace with too many restarts names both fixes", () => {
  const take = readTake({
    transcript: wordsAt(109, 200),
    restartsAt: [10, 30, 50],
    passageId: LADDER_PASSAGE_ID,
  });
  assert.deepEqual(ladderVerdict(take), {
    passed: false,
    detail: "You read at 200 wpm with 3 restarts. " +
      "Slow down to 170 to 190 wpm and keep restarts to 1 or fewer to earn this crown.",
  });
});

// --- evaluate: cold reads, the Restarts levels ----------------------------------------------

test("a cold read passes with restarts and misreads in all at the level's limit", () => {
  const take = readTake({
    transcript: wordsAt(170, 150),
    restartsAt: [5, 60],
    misreadAt: [20, 90],
  });
  const result = judge("restarts-1", 2, take);
  assert.deepEqual([result.passed, result.sentence], [
    true,
    "4 slips (2 restarts and 2 misreads) on read 3. The target was 4.",
  ]);
});

test("a cold read fails once restarts and misreads together pass the limit", () => {
  const take = readTake({
    transcript: wordsAt(170, 150),
    restartsAt: [5, 60, 120],
    misreadAt: [20, 90],
  });
  const result = judge("restarts-1", 2, take);
  assert.deepEqual([result.passed, result.sentence], [
    false,
    "5 slips (3 restarts and 2 misreads) on read 3. The target is 4.",
  ]);
});

test("the last cold-read level allows one slip, a restart or a misread", () => {
  const clean = readTake({ transcript: wordsAt(170, 150) });
  assert.deepEqual(
    [judge("restarts-4", 1, clean).passed, judge("restarts-4", 1, clean).sentence],
    [true, "No slips on read 2. The target was 1."],
  );
  const misreads = readTake({ transcript: wordsAt(170, 150), misreadAt: [40, 80] });
  assert.deepEqual(
    [judge("restarts-4", 1, misreads).passed, judge("restarts-4", 1, misreads).sentence],
    [false, "2 slips (no restarts and 2 misreads) on read 2. The target is 1."],
  );
  const restarts = readTake({ transcript: wordsAt(170, 150), restartsAt: [40, 80] });
  assert.equal(
    judge("restarts-4", 1, restarts).sentence,
    "2 slips (2 restarts and no misreads) on read 2. The target is 1.",
  );
});

test("a skipped word here and there is not a cold-read slip", () => {
  const take = readTake({ transcript: wordsAt(170, 150), skipped: [[10, 1], [50, 2], [100, 1]] });
  assert.equal(judge("restarts-4", 1, take).passed, true);
  assert.equal(judge("restarts-4", 1, take).value, 0);
});

test("a reading level fails a take that leaves out more than 8 words in one place", () => {
  // Stopping early or starting partway in leaves a long run of the passage unread.
  const stoppedEarly = readTake({ transcript: wordsAt(150, 150), skipped: [[149, 25]] });
  assert.deepEqual(
    [judge("restarts-1", 2, stoppedEarly).passed, judge("restarts-1", 2, stoppedEarly).sentence],
    [
      false,
      "You left out 25 words of the passage in one place. Read all of it to clear this level.",
    ],
  );
  const ladder = readTake({
    transcript: wordsAt(100, 150),
    skipped: [[50, 9]],
    passageId: LADDER_PASSAGE_ID,
  });
  assert.equal(judge("pace-1", 1, ladder).passed, false);
  const eight = readTake({
    transcript: wordsAt(100, 150),
    skipped: [[50, 8]],
    passageId: LADDER_PASSAGE_ID,
  });
  assert.equal(judge("pace-1", 1, eight).passed, true, "a skipped line of 8 words is a slip");
});

// --- evaluate: clean stretches, the Long pauses levels --------------------------------------

test("a clean stretch passes at the target and fails short of it", () => {
  // An um at index 70 (18.5 s): 17.5 clean seconds before it, and an um every 70 words after.
  const take = session({
    transcript: quickTalk({ say: { 70: "um", 140: "um", 210: "um", 280: "um" } }),
    passageId: "impromptu",
  });
  const context = { baseline: PATH.measure(reportOf(take), 90) };
  assert.deepEqual(
    pick(judge("long-pauses-1", 1, take, context)),
    [
      true,
      "17.5 seconds clean and no long pauses on take 2. The target was 15 seconds clean, with " +
        "at most 1 long pause.",
    ],
  );
  assert.deepEqual(
    pick(judge("long-pauses-2", 1, take, context)),
    [
      false,
      "17.5 seconds clean and no long pauses on take 2. The target is 20 seconds clean, with " +
        "no long pause.",
    ],
  );
});

test("a long pause breaks the clean stretch, even after a full stop", () => {
  // "end." ends at 14.9 s, then a 6 s freeze: 13.9 clean seconds before it, an um every 56
  // words after it.
  const say = { 55: "end.", 111: "um", 167: "um", 223: "um", 279: "um" };
  const transcript = quickTalk({ say });
  transcript.slice(56).forEach((word) => {
    word.start += 6;
    word.end += 6;
  });
  const frozen = session({ transcript, pauses: [[14.9, 6]], passageId: "impromptu" });
  const unbroken = session({ transcript, passageId: "impromptu" });
  const context = { baseline: PATH.measure(reportOf(unbroken), 90) };
  assert.deepEqual(
    pick(judge("long-pauses-1", 1, frozen, context)),
    [
      false,
      "13.9 seconds clean and 1 long pause on take 2. The target is 15 seconds clean, with at " +
        "most 1 long pause.",
    ],
  );
  assert.equal(
    judge("long-pauses-1", 1, unbroken, context).passed,
    true,
    "the same words, no freeze",
  );
});

// --- unlocking ---------------------------------------------------------------------------------

test("with nothing cleared, every unit opens on level 1 and locks the other four", () => {
  PATH.UNITS.forEach((unit) => {
    assert.deepEqual(
      Array.from(unit.levels, (entry) => PATH.statusOf(entry, [])),
      ["current", "locked", "locked", "locked", "locked"],
    );
    assert.equal(PATH.isUnlocked(unit.levels[0], []), true);
    assert.equal(PATH.isUnlocked(unit.levels[1], []), false);
    assert.equal(PATH.currentLevel(unit, []), unit.levels[0]);
  });
});

test("clearing level n unlocks level n + 1 of that unit and nothing else", () => {
  const cleared = [{ levelId: "fillers-1", clearedAt: "2026-10-12T10:00:00.000Z" }];
  const fillers = PATH.UNITS[1];
  assert.deepEqual(
    Array.from(fillers.levels, (entry) => PATH.statusOf(entry, cleared)),
    ["cleared", "current", "locked", "locked", "locked"],
  );
  assert.equal(PATH.currentLevel(fillers, cleared), level("fillers-2"));
  [PATH.UNITS[0], PATH.UNITS[2], PATH.UNITS[3]].forEach((unit) => {
    assert.equal(PATH.isUnlocked(unit.levels[1], cleared), false, unit.id);
  });
});

test("a unit cleared to the end has no current level", () => {
  const cleared = Array.from(PATH.UNITS[3].levels, (entry) => ({ levelId: entry.id }));
  assert.deepEqual(
    Array.from(PATH.UNITS[3].levels, (entry) => PATH.statusOf(entry, cleared)),
    ["cleared", "cleared", "cleared", "cleared", "cleared"],
  );
  assert.equal(PATH.currentLevel(PATH.UNITS[3], cleared), null);
});

test("a level unlocks from the level right before it, whatever else is cleared", () => {
  // Level 3 cleared without level 2: level 2 is still the one to play, and level 4 is open.
  const cleared = ["restarts-1", "restarts-3"].map((levelId) => ({ levelId, clearedAt: "x" }));
  assert.deepEqual(
    Array.from(PATH.UNITS[0].levels, (entry) => PATH.statusOf(entry, cleared)),
    ["cleared", "current", "cleared", "current", "locked"],
  );
  assert.equal(PATH.currentLevel(PATH.UNITS[0], cleared), level("restarts-2"));
});

test("unlocking reads the store's records and skips any it cannot read", () => {
  const cleared = [null, "fillers-1", { clearedAt: "x" }, { levelId: 7 }];
  assert.equal(PATH.statusOf(level("fillers-1"), cleared), "current");
  assert.equal(PATH.statusOf(level("fillers-2"), undefined), "locked");
});

// --- order: weakest unit first ----------------------------------------------------------------

// A one-minute take of 150 words on Your day (band 140 to 160) with `say` swapped in.
function minuteTake({ say = {}, repeats = [], pauses = [], createdAt, passageId, wpm = 150 }) {
  const transcript = words({ count: wpm, step: 60 / (wpm - 0.2), say });
  return session({ transcript, repeats, pauses, createdAt, passageId });
}

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

test("with no takes the path keeps the advice ranking's order of skills", () => {
  assert.deepEqual(idsOf(PATH.order([])), UNIT_IDS);
  assert.deepEqual(idsOf(PATH.order(undefined)), UNIT_IDS);
});

test("order returns the path's own units and leaves UNITS as it was", () => {
  const ordered = PATH.order([minuteTake({ say: ums(10, 20, 30, 40, 50, 60, 70, 80, 90) })]);
  assert.equal(ordered.find((unit) => unit.id === "fillers"), PATH.UNITS[1]);
  assert.deepEqual(idsOf(PATH.UNITS), UNIT_IDS);
});

test("nine fillers a minute put Fillers first, then the skills nearest their targets", () => {
  // Fillers 9/min: 2.0 past target. Pace 141 wpm: 0.05 of the band inside its bottom edge.
  const take = minuteTake({ say: ums(10, 20, 30, 40, 50, 60, 70, 80, 90) });
  assert.deepEqual(idsOf(PATH.order([take])), ["fillers", "pace", "restarts", "long-pauses"]);
});

test("one long pause outranks fillers a little over their target", () => {
  // As backend test_one_long_pause_outranks_fillers_a_little_over_their_target: a long pause is
  // a full step past a target of none (1.0), 4 fillers a minute a third of one.
  const take = minuteTake({ say: ums(10, 20, 30, 40), pauses: [[30.2, 6]] });
  assert.deepEqual(idsOf(PATH.order([take])), ["long-pauses", "fillers", "pace", "restarts"]);
});

test("a pace two band widths too fast puts Pace first", () => {
  const take = minuteTake({ wpm: 200 });
  assert.equal(idsOf(PATH.order([take]))[0], "pace");
});

test("tied skills keep the advice ranking's order: restarts before fillers", () => {
  // 2 restarts and 6 fillers a minute are each twice their targets.
  const take = minuteTake({
    say: ums(10, 20, 30, 40, 50, 60),
    repeats: [{ text: "word100 word101", at: 40.2 }, { text: "word120 word121", at: 48.2 }],
  });
  assert.deepEqual(idsOf(PATH.order([take])).slice(0, 2), ["restarts", "fillers"]);
});

test("rates exactly as far from their targets tie, whatever the float division leaves", () => {
  // As backend test_rates_exactly_as_far_from_their_targets_tie_whatever_the_float_division_leaves:
  // one restart and three fillers in 30.012 s are both 60/30.012 times their targets, but the
  // division leaves the filler a last digit ahead. The long pause (1.0) leads; restarts win the
  // tie, as select.py's MEASURED_SKILLS lists them first.
  const transcript = words({ count: 76, step: 30.012 / 75.8, say: ums(10, 30, 50) });
  const take = session({
    transcript,
    repeats: [{ text: "word20 word21", at: transcript[20].start }],
    pauses: [[transcript[40].end, 6]],
  });
  assert.equal(reportOf(take).speakingSeconds, 30.012);
  assert.deepEqual(idsOf(PATH.order([take])), ["long-pauses", "restarts", "fillers", "pace"]);
});

test("the real uniforms take, judged on its own band, is weakest in restarts then fillers", () => {
  // As backend test_the_uniforms_take_against_its_passage_band_is_weakest_in_restarts_then_fillers.
  const take = session({
    transcript: UNIFORMS_WORDS,
    repeats: UNIFORMS_REPEATS,
    passageId: LADDER_PASSAGE_ID,
  });
  assert.deepEqual(idsOf(PATH.order([take])).slice(0, 2), ["restarts", "fillers"]);
});

test("the order follows the average of the five latest takes, not only the last one", () => {
  // The latest take is heavy in fillers; the four before it in restarts (3 a minute each).
  const restarts = [10, 20, 30].map((index) => ({ text: "word" + index, at: 1 + index * 0.4 }));
  const history = [
    minuteTake({
      say: ums(10, 20, 30, 40, 50, 60, 70, 80, 90),
      createdAt: "2026-10-12T05:00:00.000Z",
    }),
    ...[1, 2, 3, 4].map((day) =>
      minuteTake({ repeats: restarts, createdAt: `2026-10-0${day}T05:00:00.000Z` }),
    ),
  ];
  assert.equal(idsOf(PATH.order(history))[0], "restarts");
});

test("takes older than the five latest leave the order alone", () => {
  // The old take: 60 fillers a minute (19.0 past target). The recent ones: 190 wpm (1.5).
  const old = minuteTake({
    say: ums(...Array.from({ length: 60 }, (_, index) => index * 2)),
    createdAt: "2026-09-01T05:00:00.000Z",
  });
  const recent = [1, 2, 3, 4, 5].map((day) =>
    minuteTake({ wpm: 190, createdAt: `2026-10-0${day}T05:00:00.000Z` }),
  );
  assert.equal(idsOf(PATH.order([old, ...recent.slice(1)]))[0], "fillers", "one of five");
  // Newest first, as app.store.list() returns them, or shuffled: the five latest decide.
  assert.equal(idsOf(PATH.order([...recent].reverse().concat(old)))[0], "pace");
  const shuffled = [old, recent[2], recent[0], recent[4], recent[1], recent[3]];
  assert.equal(idsOf(PATH.order(shuffled))[0], "pace");
});

test("a take with no speaking time says nothing about any skill", () => {
  const empty = session({ transcript: [], createdAt: "2026-10-12T11:00:00.000Z" });
  assert.deepEqual(idsOf(PATH.order([empty])), UNIT_IDS);
});

test("the sample take a visitor opens never moves the order", () => {
  const app = loadApp({ withResults: true });
  const sample = minuteTake({ say: ums(10, 20, 30, 40, 50, 60, 70, 80, 90) });
  sample.passageTitle = "Sample: Congress speech";
  assert.deepEqual(idsOf(app.path.order([sample])), UNIT_IDS);
  sample.passageTitle = "Your day";
  assert.equal(idsOf(app.path.order([sample]))[0], "fillers");
});

// --- pickColdRead ------------------------------------------------------------------------------

function coldReadIds() {
  return APP.passages.coldReads().map((passage) => passage.id);
}

function readOn(passageId, createdAt = "2026-10-12T10:00:00.000Z") {
  return session({ transcript: words({ count: 5 }), passageId, createdAt });
}

test("a cold read is one of the cold-read passages", () => {
  const picked = PATH.pickColdRead([], () => 0.5);
  assert.ok(coldReadIds().includes(picked.id), picked.id);
  assert.equal(picked.coldRead, true);
});

test("the pick is decided by the random source: the same draw, the same passage", () => {
  const ids = coldReadIds();
  ids.forEach((id, index) => {
    const draw = (index + 0.5) / ids.length;
    assert.equal(PATH.pickColdRead([], () => draw).id, id);
    assert.equal(PATH.pickColdRead([], () => draw).id, id, "again");
  });
});

test("a cold read never repeats a passage the speaker has read", () => {
  const ids = coldReadIds();
  const history = ids.slice(0, -1).map((id) => readOn(id));
  for (const draw of [0, 0.25, 0.5, 0.999]) {
    assert.equal(PATH.pickColdRead(history, () => draw).id, ids[ids.length - 1], String(draw));
  }
});

test("picking one cold read after another reads every passage once before any repeats", () => {
  const history = [];
  const picked = [];
  const draws = [0.9, 0.1, 0.5, 0.3, 0.7];
  coldReadIds().forEach((_, take) => {
    const passage = PATH.pickColdRead(history, () => draws[take % draws.length]);
    picked.push(passage.id);
    history.unshift(readOn(passage.id, `2026-10-12T10:${String(take).padStart(2, "0")}:00.000Z`));
  });
  assert.deepEqual([...picked].sort(), [...coldReadIds()].sort());
});

test("once every cold read is read, the one read longest ago comes back", () => {
  const ids = coldReadIds();
  const history = ids.map((id, index) =>
    readOn(id, `2026-10-12T10:${String(59 - index).padStart(2, "0")}:00.000Z`),
  );
  // The last id was read at 10:45, before every other one.
  history.push(readOn(ids[0], "2026-10-12T11:00:00.000Z"));
  assert.equal(PATH.pickColdRead(history, () => 0).id, ids[ids.length - 1]);
});

test("pickColdRead needs a random source and keeps an odd draw inside the list", () => {
  assert.throws(() => PATH.pickColdRead([]), /random/);
  const ids = coldReadIds();
  assert.equal(PATH.pickColdRead([], () => 1).id, ids[ids.length - 1]);
  assert.equal(PATH.pickColdRead([], () => -0.5).id, ids[0]);
  assert.equal(PATH.pickColdRead([], () => Number.NaN).id, ids[0]);
});
