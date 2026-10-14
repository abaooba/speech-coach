// Tests for the Loop Path's schedule in frontend/path.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 4 and 5): a level rests until tomorrow
// after 3 missed attempts in a day, a cleared level comes back as check-backs 2 and 7 days on
// (a pass fills half its ring, then all of it), crowns and checkpoints open beside the levels,
// the benchmark comes round every 14 days, and the week counts its practice days. Days are local
// calendar days ("YYYY-MM-DD") passed in, never read from a clock. passages.js, delivery.js and
// path.js load into a vm in index.html's order.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

function loadApp({ withResults = false } = {}) {
  const app = { screens: {} };
  const context = { app };
  const files = ["passages.js", "delivery.js", "path.js"];
  if (withResults) {
    files.push(path.join("screens", "results.js"));
  }
  files.forEach((file) => {
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

// An ISO time at `hour` local time on a local calendar day, so a test reads the same in any
// time zone.
function at(day, hour = 10, minute = 0) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

function record(levelId, day, hour) {
  return { levelId, clearedAt: at(day, hour) };
}

// `count` words, one every half second from 1 s, each 0.4 s long; `say` swaps in other text.
function words(count, say = {}) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * 0.5,
    end: 1 + index * 0.5 + 0.4,
  }));
}

// A saved take: a Path take when `pathFields` is given ({play, kind, take, scored, passed,
// stage, inRoom}), a plain one otherwise.
function take({
  day,
  hour = 10,
  minute = 0,
  pathFields,
  passageId = "impromptu",
  transcript,
  metrics,
}) {
  const saved = {
    id: "take-" + day + "-" + hour + "-" + minute,
    createdAt: at(day, hour, minute),
    passageId,
    passageTitle: "Impromptu",
    durationSeconds: 60,
    metrics: metrics || { pauses: [], repeats: [] },
    transcript: transcript || words(40),
  };
  if (pathFields) {
    saved.path = Object.assign(
      { take: 2, scored: true, passed: false, stage: null, inRoom: null },
      pathFields,
    );
  }
  return saved;
}

// A missed scored take of a loop on `day`.
function miss(levelId, day, extra = {}) {
  const pathFields = Object.assign({ play: levelId, kind: "loop" }, extra.path);
  return take({ day, ...extra, pathFields });
}

// --- days ------------------------------------------------------------------------------------

test("localDay turns a time into its local calendar day, and keeps a day as it is", () => {
  assert.equal(PATH.localDay(at("2026-10-14", 10)), "2026-10-14");
  assert.equal(PATH.localDay(at("2026-10-14", 23, 50)), "2026-10-14", "late evening");
  assert.equal(PATH.localDay(at("2026-10-15", 0, 10)), "2026-10-15");
  assert.equal(PATH.localDay(new Date(2026, 0, 31, 12)), "2026-01-31");
  assert.equal(PATH.localDay(vm.runInNewContext("new Date(2026, 1, 3, 9)")), "2026-02-03");
  assert.equal(PATH.localDay("2026-10-14"), "2026-10-14");
  for (const odd of ["2026-02-30", "2026-13-01", "not a day", "", undefined, null, 5, {}]) {
    assert.equal(PATH.localDay(odd), null, String(odd));
  }
});

test("addDays counts calendar days across months, years and leap days", () => {
  assert.equal(PATH.addDays("2026-10-14", 2), "2026-10-16");
  assert.equal(PATH.addDays("2026-10-14", 7), "2026-10-21");
  assert.equal(PATH.addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(PATH.addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(PATH.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(PATH.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(PATH.addDays("2026-10-14", 0), "2026-10-14");
  assert.equal(PATH.addDays("nope", 2), null);
  assert.equal(PATH.addDays("2026-10-14", 1.5), null);
});

// --- rest days -------------------------------------------------------------------------------

test("a loop allows 3 scored attempts a day: the first, then take 3, then take 4", () => {
  const today = "2026-10-14";
  const history = [];
  assert.equal(PATH.attemptsLeft("fillers-3", history, today), 3);
  [2, 3, 4].forEach((takeNumber, index) => {
    history.push(miss("fillers-3", today, { hour: 9 + index, path: { take: takeNumber } }));
    assert.equal(PATH.attemptsLeft("fillers-3", history, today), 2 - index);
  });
  history.push(miss("fillers-3", today, { hour: 15, path: { take: 5 } }));
  assert.equal(PATH.attemptsLeft("fillers-3", history, today), 0, "never below none");
});

test("only today's missed scored takes of this loop use up an attempt", () => {
  const today = "2026-10-14";
  const history = [
    miss("fillers-3", "2026-10-13", { hour: 9 }),
    miss("fillers-3", "2026-10-13", { hour: 10 }),
    miss("fillers-3", "2026-10-13", { hour: 11 }),
    miss("fillers-3", today, { hour: 9, path: { passed: true } }),
    miss("fillers-3", today, { hour: 10, path: { take: 1, scored: false, passed: null } }),
    miss("fillers-4", today, { hour: 11 }),
    take({
      day: today,
      pathFields: { play: "fillers-3_checkback", kind: "checkback", take: 1, stage: 1 },
    }),
    take({ day: today, hour: 12 }),
  ];
  assert.equal(PATH.attemptsLeft("fillers-3", history, today), 3);
  assert.equal(PATH.attemptsLeft("fillers-4", history, today), 2);
});

test("a missed day ends just before local midnight", () => {
  const history = [9, 10, 11].map((hour) => miss("pace-4", "2026-10-14", { hour }));
  history.push(miss("pace-4", "2026-10-14", { hour: 23, minute: 59 }));
  assert.equal(PATH.attemptsLeft("pace-4", history, "2026-10-14"), 0);
  assert.equal(PATH.attemptsLeft("pace-4", history, "2026-10-15"), 3);
});

test("for Pace level 2 an attempt is a pair of reads, counted on its second read", () => {
  const today = "2026-10-14";
  const reads = (first, takeNumbers) =>
    takeNumbers.map((takeNumber, index) =>
      miss("pace-2", today, { hour: first + index, path: { take: takeNumber } }),
    );
  // Reads 1 and 2 missed, and read 3 missed with read 4 not yet taken: one attempt so far.
  assert.equal(PATH.attemptsLeft("pace-2", reads(9, [1, 2, 3]), today), 2);
  assert.equal(PATH.attemptsLeft("pace-2", reads(9, [1, 2, 3, 4, 5, 6]), today), 0);
  // A first read that missed and a second that passed: the pair, closed by read 2, missed.
  const pair = [
    miss("pace-2", today, { hour: 9, path: { take: 1 } }),
    miss("pace-2", today, { hour: 10, path: { take: 2 } }),
  ];
  assert.equal(PATH.attemptsLeft("pace-2", pair, today), 2);
});

test("statusOf reads cleared, current, locked and resting", () => {
  const today = "2026-10-14";
  const cleared = [record("fillers-1", "2026-10-12"), record("fillers-2", "2026-10-13")];
  const level = (id) => PATH.levelById(id);
  const resting = [9, 10, 11].map((hour) => miss("fillers-3", today, { hour }));
  assert.deepEqual(
    ["fillers-1", "fillers-2", "fillers-3", "fillers-4"].map((id) =>
      PATH.statusOf(level(id), cleared, resting, today),
    ),
    ["cleared", "cleared", "resting", "locked"],
  );
  assert.equal(PATH.statusOf(level("fillers-3"), cleared, resting, "2026-10-15"), "current");
  assert.equal(PATH.statusOf(level("fillers-3"), cleared, resting.slice(1), today), "current");
  assert.equal(PATH.statusOf("fillers-3", cleared, resting, today), "resting", "an id works too");
  assert.equal(PATH.statusOf(level("fillers-3"), cleared), "current", "no day, no rest");
  assert.throws(() => PATH.statusOf("fillers-9", cleared, [], today), /fillers-9/);
});

// --- check-backs -----------------------------------------------------------------------------

test("a cleared level's first check-back is due 2 days after it was cleared", () => {
  const cleared = [record("fillers-3", "2026-10-14", 18)];
  assert.deepEqual(plain(PATH.checkbacks(cleared, [], "2026-10-14")), [
    { levelId: "fillers-3", stage: 1, dueOn: "2026-10-16", due: false },
  ]);
  assert.equal(PATH.checkbacks(cleared, [], "2026-10-16")[0].due, true);
  assert.equal(PATH.checkbacks(cleared, [], "2026-10-19")[0].due, true, "and stays due");
  assert.deepEqual(plain(PATH.checkbacks([], [], "2026-10-14")), []);
});

test("check-back 2 is due 7 days after clearing, or 2 days after check-back 1 if later", () => {
  const onTime = [record("fillers-3", "2026-10-14"), record("fillers-3_cb1", "2026-10-16")];
  assert.deepEqual(plain(PATH.checkbacks(onTime, [], "2026-10-16")), [
    { levelId: "fillers-3", stage: 2, dueOn: "2026-10-21", due: false },
  ]);
  const late = [record("fillers-3", "2026-10-14"), record("fillers-3_cb1", "2026-10-25")];
  assert.deepEqual(plain(PATH.checkbacks(late, [], "2026-10-26")), [
    { levelId: "fillers-3", stage: 2, dueOn: "2026-10-27", due: false },
  ]);
});

test("a gold level has no check-back left", () => {
  const gold = [
    record("fillers-3", "2026-10-14"),
    record("fillers-3_cb1", "2026-10-16"),
    record("fillers-3_cb2", "2026-10-21"),
  ];
  assert.deepEqual(plain(PATH.checkbacks(gold, [], "2026-11-30")), []);
});

test("a missed check-back is due again 2 days after the miss, and nothing locks", () => {
  const cleared = [record("restarts-2", "2026-10-14")];
  const missOn = (day, stage = 1) =>
    take({ day, pathFields: { play: "restarts-2_checkback", kind: "checkback", take: 1, stage } });
  const once = PATH.checkbacks(cleared, [missOn("2026-10-16")], "2026-10-16");
  assert.equal(once[0].dueOn, "2026-10-18");
  const twice = [missOn("2026-10-16"), missOn("2026-10-19")];
  assert.deepEqual(plain(PATH.checkbacks(cleared, twice, "2026-10-19")), [
    { levelId: "restarts-2", stage: 1, dueOn: "2026-10-21", due: false },
  ]);
  // A stage 1 miss says nothing about stage 2.
  const passed = cleared.concat(record("restarts-2_cb1", "2026-10-18"));
  assert.equal(PATH.checkbacks(passed, twice, "2026-10-19")[0].dueOn, "2026-10-21");
  const stage2 = PATH.checkbacks(passed, [missOn("2026-10-22", 2)], "2026-10-22")[0];
  assert.deepEqual(plain(stage2), {
    levelId: "restarts-2",
    stage: 2,
    dueOn: "2026-10-24",
    due: false,
  });
  // A passed check-back take is not a miss.
  const passedTake = missOn("2026-10-16");
  passedTake.path.passed = true;
  assert.equal(PATH.checkbacks(cleared, [passedTake], "2026-10-16")[0].dueOn, "2026-10-16");
});

test("due check-backs come first, by date, then unit order; later ones the same way", () => {
  const cleared = [
    record("pace-1", "2026-10-10"),
    record("fillers-2", "2026-10-11"),
    record("restarts-1", "2026-10-11"),
    record("long-pauses-1", "2026-10-13"),
    record("fillers-1", "2026-10-13"),
  ];
  assert.deepEqual(
    plain(PATH.checkbacks(cleared, [], "2026-10-13")).map((entry) => [entry.levelId, entry.due]),
    [
      ["pace-1", true],
      ["restarts-1", true],
      ["fillers-2", true],
      ["fillers-1", false],
      ["long-pauses-1", false],
    ],
  );
});

test("check-backs skip records they cannot read", () => {
  const cleared = [null, "fillers-1", { levelId: 7 }, { levelId: "fillers-2", clearedAt: "x" }];
  assert.deepEqual(plain(PATH.checkbacks(cleared, [], "2026-10-14")), []);
  assert.deepEqual(plain(PATH.checkbacks(undefined, undefined, "2026-10-14")), []);
});

test("ringOf: none until check-back 1 passes, half after it, gold after check-back 2", () => {
  const cleared = [record("pace-3", "2026-10-01")];
  assert.equal(PATH.ringOf("pace-3", cleared), "none");
  cleared.push(record("pace-3_cb1", "2026-10-03"));
  assert.equal(PATH.ringOf("pace-3", cleared), "half");
  cleared.push(record("pace-3_cb2", "2026-10-08"));
  assert.equal(PATH.ringOf("pace-3", cleared), "gold");
  assert.equal(PATH.ringOf("pace-4", cleared), "none");
});

// --- crowns and checkpoints ------------------------------------------------------------------

test("a crown opens once level 3 is cleared and counts the tiers earned", () => {
  const locked = plain(PATH.crownState("fillers", [record("fillers-2", "2026-10-10")]));
  assert.deepEqual(
    [locked.id, locked.unit, locked.label, locked.open, locked.earned, locked.complete],
    ["fillers_crown", "fillers", "Sudden death, optional", false, 0, false],
  );
  assert.deepEqual(locked.next, {
    number: 1,
    seconds: 30,
    record: "fillers_crown-1",
    earned: false,
  });
  const cleared = [
    record("fillers-3", "2026-10-10"),
    record("fillers_crown-1", "2026-10-11"),
    record("fillers_crown-2", "2026-10-12"),
  ];
  const twoEarned = plain(PATH.crownState("fillers", cleared));
  assert.deepEqual([twoEarned.open, twoEarned.earned, twoEarned.next.number], [true, 2, 3]);
  assert.deepEqual(
    twoEarned.tiers.map((tier) => [tier.seconds, tier.earned]),
    [
      [30, true],
      [45, true],
      [60, false],
      [90, false],
      [120, false],
    ],
  );
  const paceCleared = [record("pace-3", "2026-10-10"), record("pace_crown-1", "2026-10-11")];
  const pace = plain(PATH.crownState("pace", paceCleared));
  assert.deepEqual(
    [pace.label, pace.open, pace.earned, pace.complete, pace.next],
    ["180 wpm ladder, optional", true, 1, true, null],
  );
  assert.equal(PATH.crownState("restarts", []), null);
  assert.equal(PATH.crownState("long-pauses", []), null);
  assert.equal(PATH.crownState("nothing", []), null);
});

test("a checkpoint opens after level 5 and remembers a clear in the room", () => {
  const four = [record("long-pauses-4", "2026-10-10")];
  const before = plain(PATH.checkpointState("long-pauses", four));
  assert.deepEqual(before, {
    id: "long-pauses_checkpoint",
    unit: "long-pauses",
    label: "Checkpoint: 2-minute new topic",
    open: false,
    cleared: false,
    inRoom: false,
  });
  const cleared = [
    record("long-pauses-5", "2026-10-11"),
    record("long-pauses_checkpoint", "2026-10-12"),
  ];
  assert.deepEqual(
    plain(PATH.checkpointState("long-pauses", cleared)),
    Object.assign({}, before, { open: true, cleared: true }),
  );
  cleared.push(record("long-pauses_checkpoint_room", "2026-10-12"));
  assert.equal(PATH.checkpointState("long-pauses", cleared).inRoom, true);
  assert.equal(PATH.checkpointState("nothing", cleared), null);
});

// --- the benchmark ---------------------------------------------------------------------------

// A benchmark sitting's read (its slips set by `restartsAt`) and talk (with `ums` fillers).
function sitting(day, { restartsAt = [], umsAt = [], read = true, talk = true } = {}) {
  const takes = [];
  if (read) {
    const transcript = words(120);
    const restarts = restartsAt.map((index) => ({
      text: transcript[index].text + " " + transcript[index + 1].text,
      at: transcript[index].start,
    }));
    takes.push(
      take({
        day,
        hour: 9,
        passageId: "benchmark-read",
        transcript,
        metrics: { pauses: [], repeats: restarts, script: { restarts, skipped: [], misread: [] } },
        pathFields: { play: "benchmark", kind: "benchmark", take: 1, scored: false, passed: null },
      }),
    );
  }
  if (talk) {
    takes.push(
      take({
        day,
        hour: 9,
        minute: 5,
        passageId: "benchmark-talk",
        transcript: words(120, Object.fromEntries(umsAt.map((index) => [index, "um"]))),
        pathFields: { play: "benchmark", kind: "benchmark", take: 2, scored: false, passed: null },
      }),
    );
  }
  return takes;
}

test("the benchmark is due with no sitting yet", () => {
  assert.deepEqual(plain(PATH.benchmarkState([], "2026-10-14")), {
    due: true,
    nextOn: "2026-10-14",
    sittings: [],
  });
  const plainTakes = [take({ day: "2026-10-13" }), take({ day: "2026-10-14" })];
  assert.equal(
    PATH.benchmarkState(plainTakes, "2026-10-14").due,
    true,
    "practice is not a sitting",
  );
});

test("a sitting reads the read's slips and pace and the talk's fillers, slips and pace", () => {
  // 120 words over 59.9 s: the read has 2 restarts; the talk has 3 ums.
  const one = sitting("2026-10-01", { restartsAt: [10, 50], umsAt: [5, 25, 45] });
  const state = plain(PATH.benchmarkState(one, "2026-10-05"));
  assert.equal(state.sittings.length, 1);
  assert.deepEqual(state.sittings[0], {
    on: "2026-10-01",
    readSlips: 2,
    readWpm: 120,
    fillersPerMinute: 3,
    weightedPerMinute: 3,
    wpm: 117,
  });
  assert.deepEqual([state.due, state.nextOn], [false, "2026-10-15"]);
});

test("the benchmark comes round 14 days after the latest sitting", () => {
  const history = sitting("2026-10-01").concat(sitting("2026-10-15", { umsAt: [5] }));
  assert.deepEqual(
    plain(PATH.benchmarkState(history, "2026-10-28")).sittings.map((entry) => entry.on),
    ["2026-10-01", "2026-10-15"],
  );
  const dayBefore = PATH.benchmarkState(history, "2026-10-28");
  assert.deepEqual([dayBefore.due, dayBefore.nextOn], [false, "2026-10-29"]);
  assert.equal(PATH.benchmarkState(history, "2026-10-29").due, true);
  assert.equal(PATH.benchmarkState(history, "2026-11-20").due, true);
});

test("a sitting left half done keeps what it has, and a read off the passage has no slips", () => {
  const readOnly = plain(PATH.benchmarkState(sitting("2026-10-01", { talk: false }), "2026-10-02"));
  assert.deepEqual(readOnly.sittings[0], {
    on: "2026-10-01",
    readSlips: 0,
    readWpm: 120,
    fillersPerMinute: null,
    weightedPerMinute: null,
    wpm: null,
  });
  const strayed = sitting("2026-10-01", { talk: false });
  delete strayed[0].metrics.script;
  assert.equal(plain(PATH.benchmarkState(strayed, "2026-10-02")).sittings[0].readSlips, null);
});

// --- the week --------------------------------------------------------------------------------

test("the week counts the days, Monday to Sunday, with at least one own take", () => {
  // 2026-10-12 is a Monday; 2026-10-11 the Sunday before it.
  const history = [
    take({ day: "2026-10-11" }),
    take({ day: "2026-10-12", hour: 9 }),
    take({ day: "2026-10-12", hour: 20 }),
    take({ day: "2026-10-14" }),
    take({ day: "2026-10-18", hour: 23, minute: 30 }),
  ];
  assert.deepEqual(plain(PATH.weekDays(history, "2026-10-14")), { days: 3, goal: 4 });
  assert.deepEqual(plain(PATH.weekDays(history, "2026-10-18")), { days: 3, goal: 4 });
  assert.deepEqual(plain(PATH.weekDays(history, "2026-10-11")), { days: 1, goal: 4 });
  assert.deepEqual(plain(PATH.weekDays(history, "2026-10-19")), { days: 0, goal: 4 });
  assert.deepEqual(plain(PATH.weekDays([], "2026-10-14")), { days: 0, goal: 4 });
});

test("the sample a visitor opens is not a practice day", () => {
  const app = loadApp({ withResults: true });
  const sample = take({ day: "2026-10-14" });
  sample.passageTitle = "Sample: Congress speech";
  assert.equal(app.path.weekDays([sample], "2026-10-14").days, 0);
});
