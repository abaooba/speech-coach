// Tests for the Loop Path's measures and baseline in frontend/path.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 2). measure(report, setSeconds) turns one
// take's app.delivery report into the numbers every rule reads, rounded as they are shown; and
// baseline(history) is the speaker's usual numbers over their 5 latest own takes with speech, each
// rate the takes' total count over their total minutes. passages.js, delivery.js and path.js load
// into a vm in index.html's order; every report comes from the real app.delivery.analyze.
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

// `count` words, one every `step` seconds from `start`, each 80% of a step long, so the take
// speaks from `start` to start + step * (count - 0.2). `say` swaps in other text by index.
function words({ count, step = 0.5, start = 1, say = {} }) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: start + index * step,
    end: start + index * step + step * 0.8,
  }));
}

// `seconds` of speech, `count` words long, from 1 s.
function wordsOver(count, seconds, say = {}) {
  return words({ count, step: seconds / (count - 0.2), say });
}

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

// A stored take as app.store.list() hands it back.
function take({
  transcript,
  repeats = [],
  pauses = [],
  script,
  createdAt = "2026-10-12T10:00:00.000Z",
  passageTitle = "Your day",
}) {
  const metrics = { pauses, repeats, fillers: {} };
  if (script) {
    metrics.script = script;
  }
  return {
    id: "take-" + createdAt,
    createdAt,
    passageId: "free-talk",
    passageTitle,
    durationSeconds: 60,
    metrics,
    transcript,
  };
}

function reportOf(saved) {
  return APP.delivery.analyze(saved.transcript, saved.metrics);
}

function measureOf(saved, setSeconds = 60) {
  return plain(PATH.measure(reportOf(saved), setSeconds));
}

// One minute of talk with 3 ums, a restart, a short mid-sentence pause and a long pause.
function busyMinute(createdAt) {
  const transcript = wordsOver(150, 60, ums(10, 20, 30));
  return take({
    transcript,
    repeats: [{ text: "word40 word41", at: transcript[40].start }],
    pauses: [
      [transcript[60].end, 1],
      [transcript[80].end, 6],
    ],
    createdAt,
  });
}

// --- measure ---------------------------------------------------------------------------------

test("measure counts each slip and rates it over the speaking minutes", () => {
  const saved = busyMinute();
  const measured = measureOf(saved, 90);
  assert.equal(measured.spoke, true);
  assert.equal(measured.setSeconds, 90);
  assert.equal(measured.speakingSeconds, 60);
  assert.equal(measured.fillers, 3);
  assert.equal(measured.fillersPerMinute, 3);
  assert.equal(measured.restarts, 1);
  assert.equal(measured.restartsPerMinute, 1);
  assert.equal(measured.shortMid, 1, "the 1 s mid-sentence pause; the long one counts as long");
  assert.equal(measured.shortMidPerMinute, 1);
  assert.equal(measured.longPauses, 1);
  assert.equal(measured.longPausesPerMinute, 1);
  assert.equal(measured.wpm, 147, "the 3 ums are not words");
  assert.equal(measured.cleanStretchSeconds, reportOf(saved).cleanStretch.seconds);
});

test("weighted slips use rank.js's weights, and each unit leaves its own skill out", () => {
  // 3 fillers x 1 + 1 restart x 1.5 + 1 short mid-sentence pause x 1 + 1 long pause x 3.
  const measured = measureOf(busyMinute());
  assert.equal(measured.weightedPerMinute, 8.5);
  assert.deepEqual(measured.otherPerMinute, {
    restarts: 7,
    fillers: 5.5,
    "long-pauses": 4.5,
    pace: 8.5,
  });
});

test("rates are rounded to a tenth, wpm to a whole number and seconds to a tenth", () => {
  // 7 ums in 59.92 s: 7.009 a minute shows as 7.0.
  const saved = take({ transcript: wordsOver(150, 59.92, ums(5, 25, 45, 65, 85, 105, 125)) });
  const measured = measureOf(saved);
  assert.equal(measured.fillersPerMinute, 7);
  assert.equal(measured.speakingSeconds, 59.9);
  assert.equal(measured.wpm, Math.round(reportOf(saved).wordsPerMinute));
  assert.ok(Number.isInteger(measured.wpm));
});

test("a take without speech has no speaking time and every rate at 0", () => {
  const silent = plain(PATH.measure(APP.delivery.analyze([], {}), 60));
  assert.equal(silent.spoke, false);
  assert.equal(silent.speakingSeconds, 0);
  assert.equal(silent.fillersPerMinute, 0);
  assert.equal(silent.weightedPerMinute, 0);
  assert.equal(plain(PATH.measure(undefined, 60)).spoke, false);
  // A take saved without words has speaking time but no first word: no speech to judge.
  const wordless = APP.delivery.analyze([], { duration: 30, fillers: { um: 2 } });
  assert.equal(PATH.measure(wordless, 60).spoke, false);
});

test("a reading take's slips are its restarts and misreads; skipped words are not slips", () => {
  const transcript = wordsOver(100, 40);
  const restarts = [{ text: "word10 word11", at: transcript[10].start }];
  const misread = [20, 50].map((index) => ({
    word: "script" + index,
    index,
    at: transcript[index].start,
    said: transcript[index].text,
  }));
  const skipped = [
    ...[0, 1, 2].map((offset) => ({ word: "a" + offset, index: offset, at: transcript[30].end })),
    { word: "b", index: 9, at: transcript[70].end },
  ];
  const saved = take({ transcript, repeats: restarts, script: { restarts, skipped, misread } });
  const measured = measureOf(saved, 90);
  assert.equal(measured.followedScript, true);
  assert.equal(measured.restarts, 1);
  assert.equal(measured.misreads, 2);
  assert.equal(measured.readSlips, 3);
  assert.equal(measured.unreadRun, 3, "the most script words skipped in one place");
  const talk = measureOf(take({ transcript }));
  assert.equal(talk.followedScript, false);
  assert.equal(talk.readSlips, 0);
  assert.equal(talk.unreadRun, 0);
});

// --- baseline --------------------------------------------------------------------------------

test("there is no baseline without a take that holds speech", () => {
  assert.equal(PATH.baseline([]), null);
  assert.equal(PATH.baseline(undefined), null);
  assert.equal(PATH.baseline([take({ transcript: [] }), null, "take"]), null);
});

test("the baseline of one take is that take's numbers", () => {
  const saved = busyMinute();
  const usual = plain(PATH.baseline([saved]));
  const measured = measureOf(saved);
  assert.equal(usual.takes, 1);
  for (const key of [
    "fillersPerMinute",
    "restartsPerMinute",
    "shortMidPerMinute",
    "longPausesPerMinute",
    "wpm",
    "cleanStretchSeconds",
    "weightedPerMinute",
    "otherPerMinute",
  ]) {
    assert.deepEqual(usual[key], measured[key], key);
  }
});

test("each baseline rate is the total count over the total minutes, not a mean of rates", () => {
  // One minute with 6 ums and two minutes with 3: 9 fillers in 3 minutes is 3.0 a minute (the
  // mean of 6.0 and 1.5 would be 3.75).
  const short = take({
    transcript: wordsOver(150, 60, ums(10, 30, 50, 70, 90, 110)),
    createdAt: "2026-10-12T10:00:00.000Z",
  });
  const long = take({
    transcript: wordsOver(300, 120, ums(40, 140, 240)),
    createdAt: "2026-10-12T11:00:00.000Z",
  });
  const usual = plain(PATH.baseline([short, long]));
  assert.equal(usual.takes, 2);
  assert.equal(usual.fillersPerMinute, 3);
  assert.equal(usual.weightedPerMinute, 3);
  assert.equal(usual.otherPerMinute.fillers, 0);
  assert.equal(usual.otherPerMinute.pace, 3);
});

test("baseline wpm and clean stretch are means weighted by speaking minutes", () => {
  // 120 words in one minute (120 wpm), then 480 words in three minutes (160 wpm): (120 + 480) / 4.
  const slow = take({ transcript: wordsOver(120, 60), createdAt: "2026-10-12T10:00:00.000Z" });
  const fast = take({ transcript: wordsOver(480, 180), createdAt: "2026-10-12T11:00:00.000Z" });
  const usual = plain(PATH.baseline([slow, fast]));
  assert.equal(usual.wpm, 150);
  const stretches = [slow, fast].map((saved) => reportOf(saved).cleanStretch.seconds);
  const weighted = (stretches[0] + 3 * stretches[1]) / 4;
  assert.equal(usual.cleanStretchSeconds, Math.round(weighted * 10) / 10);
});

test("the baseline reads the five latest takes with speech, in any order", () => {
  // The old take has 30 fillers a minute; the five after it have none.
  const old = take({
    transcript: wordsOver(150, 60, ums(...Array.from({ length: 30 }, (_, n) => n * 5))),
    createdAt: "2026-10-01T10:00:00.000Z",
  });
  const recent = [2, 3, 4, 5, 6].map((day) =>
    take({ transcript: wordsOver(150, 60), createdAt: `2026-10-0${day}T10:00:00.000Z` }),
  );
  const silent = take({ transcript: [], createdAt: "2026-10-07T10:00:00.000Z" });
  assert.equal(PATH.baseline([...recent, old, silent]).fillersPerMinute, 0);
  assert.equal(PATH.baseline([old, recent[4], recent[1], silent, recent[0], recent[3]]).takes, 5);
  assert.equal(PATH.baseline([old, ...recent.slice(1)]).fillersPerMinute, 6, "one of five");
});

test("the sample a visitor opens never counts toward the baseline", () => {
  const app = loadApp({ withResults: true });
  const sample = busyMinute();
  sample.passageTitle = "Sample: Congress speech";
  assert.equal(app.path.baseline([sample]), null);
  sample.passageTitle = "Your day";
  assert.equal(app.path.baseline([sample]).takes, 1);
});
