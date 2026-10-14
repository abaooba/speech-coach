// Tests for frontend/loop.js (app.loop), the Level screen's pure helpers for one play (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8): the steps a play walks through, the
// feedback after take 1 with its change line, the moments to review with the words around them,
// tap matching for Spot it and the live tap, the clip each moment plays, the review choices, and
// local days in words. passages.js, delivery.js, path.js and loop.js load into a vm in
// index.html's order; every report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures");

function loadApp({ withResults = false } = {}) {
  const app = { screens: {} };
  const context = { app };
  const files = ["passages.js", "delivery.js", "path.js", "loop.js"];
  if (withResults) {
    files.splice(3, 0, path.join("screens", "results.js"));
  }
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const LOOP = APP.loop;

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// The real 2026-10-11 nervous take, in clip seconds.
const NERVOUS_WORDS = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "take_2026_10_11_nervous.json"), "utf8"),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));
const NERVOUS_REPEATS = [{ text: "I kinda ner", at: 27.379 }];

// `count` words, one every `step` seconds from `start`, each 80% of a step long; `say` swaps in
// other text by index.
function words({ count, step = 0.5, start = 1, say = {} }) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: start + index * step,
    end: start + index * step + step * 0.8,
  }));
}

// An ISO time at `hour` local time on a local calendar day.
function at(day, hour = 10) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour).toISOString();
}

// A stored take as app.store.list() hands it back.
function take({ transcript, repeats = [], pauses = [], script, createdAt, id, passageTitle }) {
  const metrics = { pauses, repeats };
  if (script) {
    metrics.script = script;
  }
  return {
    id: id || "take-" + createdAt,
    createdAt: createdAt || at("2026-10-14"),
    passageId: "impromptu",
    passageTitle: passageTitle || "Impromptu",
    durationSeconds: 90,
    metrics,
    transcript,
  };
}

function reportOf(saved) {
  return APP.delivery.analyze(saved.transcript, saved.metrics);
}

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

// --- the module ------------------------------------------------------------------------------

test("loop.js assigns exactly app.loop", () => {
  assert.deepEqual(Object.keys(APP).sort(), ["delivery", "loop", "passages", "path", "screens"]);
  assert.deepEqual(Object.keys(LOOP).sort(), [
    "LIVE_TAP_WINDOW",
    "SPOT_IT_WINDOW",
    "WHAT_HAPPENED",
    "clipFor",
    "dateText",
    "feedbackFor",
    "fillerTimes",
    "matchTaps",
    "momentsFor",
    "stepsFor",
    "whenText",
  ]);
});

test("the review's choices of what happened, and the tap windows, are fixed", () => {
  assert.deepEqual(Array.from(LOOP.WHAT_HAPPENED), [
    "Lost my point",
    "Searching for a word",
    "Nerves",
    "Planned breath",
  ]);
  assert.ok(Object.isFrozen(LOOP.WHAT_HAPPENED));
  assert.deepEqual(plain(LOOP.SPOT_IT_WINDOW), { before: 0.5, after: 2 });
  assert.deepEqual(plain(LOOP.LIVE_TAP_WINDOW), { before: 0.5, after: 2.5 });
  assert.ok(Object.isFrozen(LOOP.SPOT_IT_WINDOW) && Object.isFrozen(LOOP.LIVE_TAP_WINDOW));
});

// --- steps -----------------------------------------------------------------------------------

function labels(playId) {
  return plain(LOOP.stepsFor(playId)).map((step) => step.label);
}

test("a loop's steps: goal, take 1, review, the takes after it, result", () => {
  assert.deepEqual(labels("fillers-3"), ["Goal", "Take 1", "Review", "Take 2", "Result"]);
  assert.deepEqual(labels("restarts-1"), [
    "Goal",
    "Read 1",
    "Review",
    "Read 2",
    "Read 3",
    "Result",
  ]);
  assert.deepEqual(labels("pace-2"), ["Goal", "Read 1", "Review", "Read 2", "Result"]);
  assert.deepEqual(plain(LOOP.stepsFor("fillers-3")), [
    { step: "goal", label: "Goal", takeIndex: null },
    { step: "take", label: "Take 1", takeIndex: 0 },
    { step: "review", label: "Review", takeIndex: null },
    { step: "take", label: "Take 2", takeIndex: 1 },
    { step: "result", label: "Result", takeIndex: null },
  ]);
});

test("a one-take play's steps: goal, take, result; the benchmark's: intro to done", () => {
  const oneTake = [
    "fillers-3_checkback",
    "restarts-1_checkback",
    "fillers_crown",
    "pace_checkpoint",
  ];
  for (const id of oneTake) {
    assert.deepEqual(labels(id), ["Goal", "Take", "Result"], id);
  }
  assert.deepEqual(plain(LOOP.stepsFor("benchmark")), [
    { step: "intro", label: "Intro", takeIndex: null },
    { step: "take", label: "Read", takeIndex: 0 },
    { step: "take", label: "Talk", takeIndex: 1 },
    { step: "done", label: "Done", takeIndex: null },
  ]);
  assert.deepEqual(labels(APP.path.playById("pace-1")), [
    "Goal",
    "Read 1",
    "Review",
    "Read 2",
    "Result",
  ]);
  assert.throws(() => LOOP.stepsFor("fillers-9"), /fillers-9/);
});

// --- moments ---------------------------------------------------------------------------------

test("a filler moment shows the filler marked, with 2 words before and 2 after", () => {
  const report = APP.delivery.analyze(NERVOUS_WORDS, { pauses: [], repeats: NERVOUS_REPEATS });
  const [first] = plain(LOOP.momentsFor("fillers-3", report, NERVOUS_WORDS));
  assert.deepEqual(first, {
    kind: "filler",
    at: 31.647,
    time: "0:31",
    text: "judging because, um, I put",
    parts: [
      { text: "judging because, ", marked: false },
      { text: "um", marked: true },
      { text: ", I put", marked: false },
    ],
    flagged: false,
  });
});

test("filler moments are the first three, earliest first, a two-word habit marked whole", () => {
  const transcript = words({
    count: 40,
    say: { 0: "Um", 6: "you", 7: "know,", 15: "uh", 30: "um" },
  });
  const report = reportOf(take({ transcript }));
  const moments = plain(LOOP.momentsFor("fillers-1", report, transcript));
  assert.equal(moments.length, 3);
  assert.deepEqual(
    moments.map((moment) => [moment.time, moment.text]),
    [
      ["0:01", "Um word1 word2"],
      ["0:04", "word4 word5 you know, word8 word9"],
      ["0:08", "word13 word14 uh word16 word17"],
    ],
  );
  assert.deepEqual(moments[0].parts, [
    { text: "Um", marked: true },
    { text: " word1 word2", marked: false },
  ]);
  assert.deepEqual(moments[1].parts[1], { text: "you know", marked: true });
  assert.deepEqual(moments[1].parts[2], { text: ", word8 word9", marked: false });
});

test("a restart moment marks the words gone back over and shows the next two", () => {
  const report = APP.delivery.analyze(NERVOUS_WORDS, { pauses: [], repeats: NERVOUS_REPEATS });
  assert.deepEqual(plain(LOOP.momentsFor("restarts-5", report, NERVOUS_WORDS)), [
    {
      kind: "restart",
      at: 27.379,
      time: "0:27",
      text: "I kinda ner— I'm kinda",
      parts: [
        { text: "I kinda ner—", marked: true },
        { text: " I'm kinda", marked: false },
      ],
      flagged: false,
    },
  ]);
});

test("a misread moment sets the word said against the script's, among the restarts by time", () => {
  const transcript = words({ count: 60, say: { 20: "choices" } });
  const restarts = [
    { text: "word5 word6", at: transcript[5].start },
    { text: "word40 word41", at: transcript[40].start },
    { text: "word50 word51", at: transcript[50].start },
  ];
  const misread = [{ word: "decisions", index: 20, at: transcript[20].start, said: "choices" }];
  const script = { restarts, skipped: [], misread };
  const report = reportOf(take({ transcript, repeats: restarts, script }));
  const moments = plain(LOOP.momentsFor("restarts-1", report, transcript));
  assert.deepEqual(
    moments.map((moment) => [moment.kind, moment.time, moment.text]),
    [
      ["restart", "0:03", "word5 word6 word7 word8"],
      ["misread", "0:11", "choices for “decisions”"],
      ["restart", "0:21", "word40 word41 word42 word43"],
    ],
  );
  assert.deepEqual(moments[1].parts, [
    { text: "choices", marked: true },
    { text: " for “decisions”", marked: false },
  ]);
});

test("pause moments: long pauses first, then the longest short mid-sentence ones, by time", () => {
  const say = { 8: "we", 9: "need", 10: "to", 11: "the", 12: "plan", 29: "end." };
  const transcript = words({ count: 60, say });
  const pauses = [
    [transcript[3].end, 1.2],
    [transcript[10].end, 5.2],
    [transcript[20].end, 2.4],
    [transcript[29].end, 1.8],
    [transcript[40].end, 0.9],
    [transcript[45].end, 1.6],
  ];
  const report = reportOf(take({ transcript, pauses }));
  const moments = plain(LOOP.momentsFor("long-pauses-1", report, transcript));
  assert.deepEqual(
    moments.map((moment) => [moment.kind, moment.text]),
    [
      ["long-pause", "we need to [5.2 s] the plan"],
      ["pause", "word18 word19 word20 [2.4 s] word21 word22"],
      ["pause", "word43 word44 word45 [1.6 s] word46 word47"],
    ],
    "the 1.8 s pause follows a full stop; the 1.2 s and 0.9 s ones are shorter",
  );
  assert.deepEqual(moments[0].parts, [
    { text: "we need to ", marked: false },
    { text: "[5.2 s]", marked: true },
    { text: " the plan", marked: false },
  ]);
  assert.equal(moments[0].at, transcript[10].end);
  assert.equal(moments[0].time, "0:06");
});

test("pace moments are the take's thirds, each flagged outside the band", () => {
  // 90 s of talk: 75 words in the first 30 s (150 wpm), 90 in the next (180), 65 in the last.
  const transcript = [
    ...words({ count: 75, step: 30 / 75, start: 0 }),
    ...words({ count: 90, step: 30 / 90, start: 30 }),
    ...words({ count: 65, step: 30 / 65, start: 60 }),
  ];
  transcript[transcript.length - 1].end = 90;
  const report = reportOf(take({ transcript }));
  const moments = plain(LOOP.momentsFor("pace-3", report, transcript, 1));
  assert.deepEqual(
    moments.map((moment) => [moment.time, moment.text, moment.flagged]),
    [
      ["0:00 to 0:30", "0:00 to 0:30, 150 wpm", false],
      ["0:30 to 1:00", "0:30 to 1:00, 180 wpm", true],
      ["1:00 to 1:30", "1:00 to 1:30, 130 wpm", true],
    ],
  );
  assert.deepEqual(moments[1].parts, [{ text: "180 wpm", marked: true }]);
  assert.deepEqual(plain(LOOP.momentsFor("pace-3", reportOf(take({ transcript: [] })), [])), []);
});

test("a take with nothing to look at has no moments", () => {
  const transcript = words({ count: 40 });
  const report = reportOf(take({ transcript }));
  for (const id of ["fillers-2", "restarts-1", "long-pauses-3"]) {
    assert.deepEqual(plain(LOOP.momentsFor(id, report, transcript)), [], id);
  }
});

// --- taps ------------------------------------------------------------------------------------

test("each tap catches at most one event, from half a second before it to 2 s after", () => {
  const taps = [1.5, 4.9, 12, 12.1];
  const result = plain(LOOP.matchTaps(taps, [2, 3, 5, 10, 14.5], LOOP.SPOT_IT_WINDOW));
  assert.deepEqual(result, {
    caught: 3,
    total: 5,
    pairs: [
      [1.5, 2],
      [4.9, 3],
      [12, 10],
    ],
    text: "You caught 3 of 5.",
  });
});

test("tap windows include both edges and leave no event caught twice", () => {
  const window = { before: 0.5, after: 2 };
  assert.equal(LOOP.matchTaps([9.5], [10], window).caught, 1, "half a second early");
  assert.equal(LOOP.matchTaps([12], [10], window).caught, 1, "2 s late");
  assert.equal(LOOP.matchTaps([9.4], [10], window).caught, 0);
  assert.equal(LOOP.matchTaps([12.1], [10], window).caught, 0);
  assert.equal(LOOP.matchTaps([10, 10.2, 10.4], [10], window).caught, 1, "one event, one catch");
  // A tap between two events takes the earlier, so the later tap can still catch the later one.
  assert.deepEqual(plain(LOOP.matchTaps([11.5, 12.6], [10, 11], window).pairs), [
    [11.5, 10],
    [12.6, 11],
  ]);
  const live = LOOP.matchTaps([12.4], [10], LOOP.LIVE_TAP_WINDOW);
  assert.equal(live.caught, 1, "live taps allow 2.5 s");
});

test("matchTaps reads taps and events in any order and skips anything not a time", () => {
  const taps = [12, Number.NaN, "x", 1.5];
  const result = plain(LOOP.matchTaps(taps, [10, 2, null], LOOP.SPOT_IT_WINDOW));
  assert.deepEqual([result.caught, result.total, result.text], [2, 2, "You caught 2 of 2."]);
  assert.deepEqual(plain(LOOP.matchTaps(undefined, undefined, LOOP.SPOT_IT_WINDOW)), {
    caught: 0,
    total: 0,
    pairs: [],
    text: "You caught 0 of 0.",
  });
});

test("fillerTimes lists when each filler of a take began", () => {
  const transcript = words({ count: 20, say: ums(4, 12) });
  assert.deepEqual(plain(LOOP.fillerTimes(reportOf(take({ transcript })))), [3, 7]);
  assert.deepEqual(plain(LOOP.fillerTimes(undefined)), []);
});

// --- clips -----------------------------------------------------------------------------------

test("a moment's clip plays 3 s of take 1 from 1 s before it", () => {
  assert.deepEqual(plain(LOOP.clipFor({ at: 12.4 })), { offset: 11.4, duration: 3 });
  assert.deepEqual(plain(LOOP.clipFor({ at: 0.6 })), { offset: 0, duration: 3 });
  assert.deepEqual(plain(LOOP.clipFor(31.647)), { offset: 30.647, duration: 3 });
});

// --- feedback --------------------------------------------------------------------------------

// The change line feedbackFor gives `take1` against `history` on the local day `today`.
function changeFor(playId, take1, history, today = "2026-10-14") {
  const context = { history, today, takeId: take1.id };
  return plain(LOOP.feedbackFor(playId, reportOf(take1), context).change);
}

// A one-minute talk with `count` ums (at most 16), saved at `hour` on `day`.
function talkWithUms(count, day, hour = 10) {
  const umsAt = Array.from({ length: count }, (_, n) => 5 + n * 9);
  return take({
    transcript: words({ count: 150, step: 60 / 149.8, say: ums(...umsAt) }),
    createdAt: at(day, hour),
  });
}

test("feedback shows take 1's number against the target, and no change before a first take", () => {
  const take1 = talkWithUms(7, "2026-10-14");
  const context = { history: [take1], today: "2026-10-14", takeId: take1.id };
  const feedback = plain(LOOP.feedbackFor("fillers-3", reportOf(take1), context));
  assert.deepEqual(feedback, {
    value: 7,
    valueText: "7.0",
    unitLabel: "fillers a minute",
    targetText: "target 6",
    change: null,
    caught: null,
  });
});

test("the change line compares with the latest earlier own take: fewer fillers are better", () => {
  const today = "2026-10-14";
  const take1 = talkWithUms(5, today, 12);
  const history = [
    take1,
    talkWithUms(9, "2026-10-12"),
    talkWithUms(8, "2026-10-14", 9),
    talkWithUms(2, "2026-10-01"),
  ];
  assert.deepEqual(changeFor("fillers-3", take1, history), {
    text: "3.0 fewer than earlier today",
    direction: "better",
    trend: "down",
  });
  const worse = talkWithUms(10, today, 12);
  const worseHistory = [worse, ...history.slice(1)];
  assert.deepEqual(changeFor("fillers-3", worse, worseHistory), {
    text: "2.0 more than earlier today",
    direction: "worse",
    trend: "up",
  });
});

test("the change line says when: earlier today, yesterday, a weekday, else the date", () => {
  const today = "2026-10-14"; // a Wednesday
  const take1 = talkWithUms(4, today, 12);
  const changeAgainst = (day) => changeFor("fillers-3", take1, [take1, talkWithUms(4, day)]);
  assert.equal(changeAgainst("2026-10-13").text, "Same as yesterday");
  assert.equal(changeAgainst("2026-10-12").text, "Same as Monday");
  assert.equal(changeAgainst("2026-10-08").text, "Same as Thursday");
  assert.equal(changeAgainst("2026-10-07").text, "Same as Oct 7");
  assert.equal(changeAgainst("2026-10-03").direction, "same");
});

test("the change line leaves out the take itself, later takes and the sample", () => {
  const app = loadApp({ withResults: true });
  const today = "2026-10-14";
  const take1 = talkWithUms(4, today, 12);
  const later = talkWithUms(1, today, 13);
  const sample = talkWithUms(9, today, 11);
  sample.passageTitle = "Sample: Congress speech";
  const context = { history: [later, take1, sample], today, takeId: take1.id, at: take1.createdAt };
  assert.equal(app.loop.feedbackFor("fillers-3", reportOf(take1), context).change, null);
});

test("a read's change line compares with the latest earlier take that followed a script", () => {
  const today = "2026-10-14";
  const transcript = words({ count: 120, step: 0.4 });
  const restarts = (indexes) =>
    indexes.map((index) => ({
      text: `word${index} word${index + 1}`,
      at: transcript[index].start,
    }));
  const read = (indexes, createdAt) =>
    take({
      transcript,
      repeats: restarts(indexes),
      script: { restarts: restarts(indexes), skipped: [], misread: [] },
      createdAt,
    });
  const read1 = read([10, 50], at(today, 12));
  const history = [
    read1,
    take({ transcript, createdAt: at(today, 11) }),
    read([10, 30, 50, 70], at("2026-10-13")),
  ];
  assert.deepEqual(changeFor("restarts-1", read1, history), {
    text: "2 fewer than yesterday",
    direction: "better",
    trend: "down",
  });
});

test("a clean stretch is better longer, and a pace is better nearer the band", () => {
  const today = "2026-10-14";
  // 120 words over a minute: an um at 60 leaves 30 clean seconds before it; ums at 40 and 80
  // leave at most 20.
  const stretch = (umsAt, hour) =>
    take({ transcript: words({ count: 120, say: ums(...umsAt) }), createdAt: at(today, hour) });
  const longer = stretch([60], 12);
  const history = [longer, stretch([40, 80], 9)];
  assert.deepEqual(changeFor("long-pauses-1", longer, history), {
    text: "10 s longer than earlier today",
    direction: "better",
    trend: "up",
  });
  const paced = (count, hour) =>
    take({ transcript: words({ count, step: 60 / (count - 0.2) }), createdAt: at(today, hour) });
  const fast = paced(180, 12);
  const nearer = [fast, paced(195, 9)];
  assert.deepEqual(changeFor("pace-3", fast, nearer), {
    text: "15 wpm slower than earlier today",
    direction: "better",
    trend: "down",
  });
  const inBand = paced(150, 12);
  const alsoInBand = [inBand, paced(142, 9)];
  assert.deepEqual(changeFor("pace-3", inBand, alsoInBand), {
    text: "8 wpm faster than earlier today",
    direction: "same",
    trend: "up",
  });
});

test("Fillers level 3's feedback counts the fillers caught live", () => {
  const transcript = words({ count: 60, say: ums(4, 12, 30, 44) });
  const take1 = take({ transcript });
  const today = "2026-10-14";
  const context = { history: [take1], today, takeId: take1.id, liveTaps: [4, 9.5, 20] };
  const feedback = plain(LOOP.feedbackFor("fillers-3", reportOf(take1), context));
  assert.deepEqual(feedback.caught, { caught: 2, total: 4, text: "You caught 2 of 4 live." });
  const noTaps = LOOP.feedbackFor("fillers-3", reportOf(take1), { history: [], today });
  assert.equal(noTaps.caught, null);
  const notLive = LOOP.feedbackFor("fillers-2", reportOf(take1), {
    history: [],
    today,
    liveTaps: [4],
  });
  assert.equal(notLive.caught, null, "only Fillers level 3 taps live");
});

// --- days in words ---------------------------------------------------------------------------

test("dateText writes a local day long, short or as its month and day", () => {
  assert.equal(LOOP.dateText("2026-10-16", "long"), "Friday, Oct 16");
  assert.equal(LOOP.dateText("2026-10-28", "short"), "Wed, Oct 28");
  assert.equal(LOOP.dateText("2026-10-14"), "Oct 14");
  assert.equal(LOOP.dateText("2027-01-02", "long"), "Saturday, Jan 2");
  assert.equal(LOOP.dateText("nope", "long"), "");
});

test("whenText names an earlier day from today", () => {
  const today = "2026-10-14";
  assert.equal(LOOP.whenText("2026-10-14", today), "earlier today");
  assert.equal(LOOP.whenText("2026-10-13", today), "yesterday");
  assert.equal(LOOP.whenText("2026-10-09", today), "Friday");
  assert.equal(LOOP.whenText("2026-10-08", today), "Thursday");
  assert.equal(LOOP.whenText("2026-10-07", today), "Oct 7");
  assert.equal(LOOP.whenText("2025-12-31", today), "Dec 31");
  assert.equal(LOOP.whenText("2026-10-20", today), "Oct 20", "a day after today is named by date");
});
