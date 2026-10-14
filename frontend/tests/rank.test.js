// Tests for frontend/rank.js: how one take scores, how a history of takes becomes a rating and
// a tier, and how many days in a row the speaker has practiced. The module is pure and loads
// into a bare vm context, so results are copied with plain() before deepEqual.
//
// A history is a list of takes, in any order, each {createdAt, score, speakingSeconds,
// longPauseCount}: createdAt is an ISO time and score is takeScore() of that take's report.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RANK_SOURCE = fs.readFileSync(path.join(__dirname, "..", "rank.js"), "utf8");

// Scores are compared to a tenth of a point, as a badge would show them.
const TOLERANCE = 0.05;

// The two real takes from 2026-10-11, as app.delivery.analyze reports them.
// Church, free talk: 62 s, 3 fillers, 1 restart, 1 long pause (5.19 s), 143 wpm.
const CHURCH = {
  speakingSeconds: 61.764,
  fillerCount: 3,
  repeatCount: 1,
  midSentencePauseCount: 0,
  longPauseCount: 1,
  misreads: [],
  skips: [],
  wordsPerMinute: 142.8,
};
// Uniforms, free talk: 43 s, 2 fillers, 1 restart, 160 wpm.
const UNIFORMS = {
  speakingSeconds: 42.882,
  fillerCount: 2,
  repeatCount: 1,
  midSentencePauseCount: 0,
  longPauseCount: 0,
  misreads: [],
  skips: [],
  wordsPerMinute: 159.5,
};

// No errors, in-target pace, one minute.
const CLEAN = {
  speakingSeconds: 60,
  fillerCount: 0,
  repeatCount: 0,
  midSentencePauseCount: 0,
  longPauseCount: 0,
  misreads: [],
  skips: [],
  wordsPerMinute: 150,
};

function load() {
  const app = {};
  vm.runInNewContext(RANK_SOURCE, { app }, { filename: "rank.js" });
  return app.rank;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < TOLERANCE,
    (message || "") + " expected about " + expected + ", got " + actual,
  );
}

function reportWith(overrides) {
  return { ...CLEAN, ...overrides };
}

// A local-time ISO string, so day boundaries are the speaker's midnight, not UTC's.
function localTime(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour || 12, minute || 0).toISOString();
}

// One history entry on 2026-10-<day> at noon.
function take(score, seconds, day, overrides) {
  return {
    createdAt: localTime(2026, 10, day || 1),
    score,
    speakingSeconds: seconds,
    longPauseCount: 0,
    ...overrides,
  };
}

// count takes on consecutive days ending 2026-10-<lastDay>, each the same score and length.
function run(count, score, seconds, overrides) {
  return Array.from({ length: count }, (_, i) => take(score, seconds, 1 + i, overrides));
}

test("rank.js assigns exactly app.rank with its functions, tiers and target pace", () => {
  const app = {};
  vm.runInNewContext(RANK_SOURCE, { app }, { filename: "rank.js" });
  assert.deepEqual(Object.keys(app), ["rank"]);
  for (const name of ["takeScore", "rating", "tier", "streak"]) {
    assert.equal(typeof app.rank[name], "function", name);
  }
  assert.deepEqual(plain(app.rank.DEFAULT_TARGET_WPM), [140, 160]);
  assert.deepEqual(plain(app.rank.TIERS), [
    { name: "Novice", min: 0 },
    { name: "Contender", min: 40 },
    { name: "Varsity", min: 60 },
    { name: "Elite", min: 75 },
    { name: "Champion", min: 88 },
    { name: "Master", min: 96 },
    { name: "Flawless", min: 99 },
  ]);
});

// takeScore ---------------------------------------------------------------------------------

test("the uniforms take scores 48.0 and the church take 33.5", () => {
  const rank = load();
  near(rank.takeScore(UNIFORMS), 48.0, "uniforms");
  near(rank.takeScore(CHURCH), 33.5, "church");
});

test("a clean take scores 100", () => {
  assert.equal(load().takeScore(CLEAN), 100);
});

test("one error a minute scores about 86 and one every ten minutes about 98.5", () => {
  const rank = load();
  near(rank.takeScore(reportWith({ speakingSeconds: 180, fillerCount: 3 })), 86.1);
  near(rank.takeScore(reportWith({ speakingSeconds: 600, fillerCount: 1 })), 98.5);
});

test("errors are weighted: restart 1.5, long pause 3, skip 0.5, filler/pause/misread 1", () => {
  const rank = load();
  // In a one-minute take, weighted errors w score 100 * exp(-0.15 * w).
  const expected = (weighted) => 100 * Math.exp(-0.15 * weighted);
  near(rank.takeScore(reportWith({ fillerCount: 1 })), expected(1), "filler");
  near(rank.takeScore(reportWith({ repeatCount: 1 })), expected(1.5), "restart");
  near(rank.takeScore(reportWith({ midSentencePauseCount: 1 })), expected(1), "mid pause");
  near(rank.takeScore(reportWith({ longPauseCount: 1 })), expected(3), "long pause");
  near(rank.takeScore(reportWith({ misreads: [{}] })), expected(1), "misread");
  near(rank.takeScore(reportWith({ skips: [{}, {}] })), expected(1), "two skips");
});

test("errors count per minute, so the same errors cost less in a longer take", () => {
  const rank = load();
  const short = rank.takeScore(reportWith({ speakingSeconds: 60, fillerCount: 2 }));
  const long = rank.takeScore(reportWith({ speakingSeconds: 120, fillerCount: 2 }));
  near(long, rank.takeScore(reportWith({ speakingSeconds: 60, fillerCount: 1 })));
  assert.ok(long > short);
});

test("pace costs 1 point per 5 wpm outside the target band", () => {
  const rank = load();
  assert.equal(rank.takeScore(reportWith({ wordsPerMinute: 160 })), 100);
  assert.equal(rank.takeScore(reportWith({ wordsPerMinute: 140 })), 100);
  near(rank.takeScore(reportWith({ wordsPerMinute: 170 })), 98);
  near(rank.takeScore(reportWith({ wordsPerMinute: 125 })), 97);
});

test("a passage's own target band replaces the default", () => {
  const rank = load();
  const congress = [130, 160];
  assert.equal(rank.takeScore(reportWith({ wordsPerMinute: 130 }), congress), 100);
  near(rank.takeScore(reportWith({ wordsPerMinute: 120 }), congress), 98);
  near(rank.takeScore(reportWith({ wordsPerMinute: 130 })), 98, "default band");
});

test("a score stays between 0 and 100", () => {
  const rank = load();
  // Errors alone only approach 0; the pace penalty can push below it, so that is clamped.
  near(rank.takeScore(reportWith({ fillerCount: 500 })), 0);
  assert.equal(rank.takeScore(reportWith({ wordsPerMinute: 700 })), 0);
  assert.equal(rank.takeScore(reportWith({ fillerCount: 5, wordsPerMinute: 400 })), 0);
});

test("a take with no speaking time or a junk report scores 0, and the report is unchanged", () => {
  const rank = load();
  assert.equal(rank.takeScore(reportWith({ speakingSeconds: 0 })), 0);
  for (const junk of [undefined, null, {}, { speakingSeconds: "long", fillerCount: "many" }]) {
    assert.equal(rank.takeScore(junk), 0, JSON.stringify(junk));
  }
  const report = reportWith({ fillerCount: 4, misreads: [{ said: "a" }] });
  const before = JSON.stringify(report);
  rank.takeScore(report, [130, 150]);
  assert.equal(JSON.stringify(report), before);
});

// rating ------------------------------------------------------------------------------------

test("the two real takes rate about 39.8: Novice, accepted as very harsh", () => {
  const rank = load();
  const history = [
    take(rank.takeScore(CHURCH), CHURCH.speakingSeconds, 11),
    take(rank.takeScore(UNIFORMS), UNIFORMS.speakingSeconds, 11),
  ];
  const rating = rank.rating(history);
  near(rating, 39.8);
  assert.equal(rank.tier(rating, history), "Novice");
});

test("no takes rate 40; a first take is pulled toward 40 by 3 imaginary 1-minute takes", () => {
  const rank = load();
  assert.equal(rank.rating([]), 40);
  near(rank.rating([take(100, 60)]), 55);
  near(rank.rating([take(0, 60)]), 30);
});

test("a take weighs its minutes, capped at 3", () => {
  const rank = load();
  near(rank.rating([take(100, 180)]), 70);
  near(rank.rating([take(100, 300)]), 70, "5 min weighs the same as 3");
});

test("a take under 30 s weighs a quarter of its minutes", () => {
  const rank = load();
  near(rank.rating([take(100, 20)]), 41.6);
  near(rank.rating([take(100, 30)]), 48.6, "30 s is not quartered");
});

test("a 10 s take barely moves the rating; a 2 min take moves it a lot", () => {
  const rank = load();
  const history = [take(33.5, 61.764, 11), take(48.0, 42.882, 11)];
  const before = rank.rating(history);
  const afterShort = rank.rating([...history, take(0, 10, 12)]);
  const afterLong = rank.rating([...history, take(0, 120, 12)]);
  assert.ok(before - afterShort < 0.5, "10 s take moved it " + (before - afterShort));
  assert.ok(before - afterLong > 10, "2 min take moved it " + (before - afterLong));
});

test("only the newest 10 takes count, whatever order the history is in", () => {
  const rank = load();
  const oldBad = take(0, 180, 1);
  const newPerfect = run(10, 100, 180).map((entry, i) => ({
    ...entry,
    createdAt: localTime(2026, 10, 2 + i),
  }));
  assert.equal(rank.rating([oldBad, ...newPerfect]), 100);
  assert.equal(rank.rating([...newPerfect].reverse().concat(oldBad)), 100);
});

test("the imaginary takes fill only the empty slots of the 10, so they fade out", () => {
  const rank = load();
  // 9 perfect 3-minute takes and 1 imaginary 40-point minute.
  near(rank.rating(run(9, 100, 180)), 97.9);
  // A full window has no imaginary takes left.
  assert.equal(rank.rating(run(10, 100, 180)), 100);
});

test("rating never changes the history", () => {
  const rank = load();
  const history = run(12, 80, 90);
  const before = JSON.stringify(history);
  rank.rating(history);
  rank.tier(rank.rating(history), history);
  rank.streak(history, new Date(2026, 9, 12, 20));
  assert.equal(JSON.stringify(history), before);
});

// tier --------------------------------------------------------------------------------------

test("tiers start at 40, 60, 75, 88 and 96", () => {
  const rank = load();
  const cases = [
    [0, "Novice"],
    [39.9, "Novice"],
    [40, "Contender"],
    [59.9, "Contender"],
    [60, "Varsity"],
    [75, "Elite"],
    [88, "Champion"],
    [96, "Master"],
    [100, "Master"],
  ];
  for (const [rating, name] of cases) {
    assert.equal(rank.tier(rating, []), name, "rating " + rating);
  }
});

test("Flawless needs 99+ and each of the last 10 takes 2 min+, 97+, no long pause", () => {
  const rank = load();
  const perfect = run(10, 100, 120);
  assert.equal(rank.tier(99, perfect), "Flawless");
  assert.equal(rank.tier(98.9, perfect), "Master", "rating under 99");
});

test("9 perfect takes are not Flawless", () => {
  const rank = load();
  const nine = run(9, 100, 180);
  assert.equal(rank.tier(rank.rating(nine), nine), "Master");
});

test("one take short, under 97 or with a long pause keeps a 99 rating at Master", () => {
  const rank = load();
  const spoil = (overrides) => {
    const history = run(10, 100, 120);
    history[9] = { ...history[9], ...overrides };
    return history;
  };
  assert.equal(rank.tier(99.5, spoil({ speakingSeconds: 119 })), "Master", "119 s");
  assert.equal(rank.tier(99.5, spoil({ score: 96.9 })), "Master", "96.9");
  assert.equal(rank.tier(99.5, spoil({ longPauseCount: 1 })), "Master", "long pause");
});

test("an older spoiled take outside the last 10 does not block Flawless", () => {
  const rank = load();
  const old = take(10, 20, 1, { longPauseCount: 2 });
  const perfect = run(10, 100, 120).map((entry, i) => ({
    ...entry,
    createdAt: localTime(2026, 10, 2 + i),
  }));
  assert.equal(rank.tier(99.5, [old, ...perfect]), "Flawless");
});

// streak ------------------------------------------------------------------------------------

test("no takes is no streak", () => {
  assert.deepEqual(plain(load().streak([], new Date(2026, 9, 12, 20))), {
    current: 0,
    longest: 0,
  });
});

test("several takes on one day count as one day", () => {
  const rank = load();
  const history = [
    take(50, 60, 12, { createdAt: localTime(2026, 10, 12, 8) }),
    take(50, 60, 12, { createdAt: localTime(2026, 10, 12, 21) }),
  ];
  assert.deepEqual(plain(rank.streak(history, new Date(2026, 9, 12, 22))), {
    current: 1,
    longest: 1,
  });
});

test("takes at 23:50 and 00:10 the next night are two days in a row", () => {
  const rank = load();
  const history = [
    take(50, 60, 11, { createdAt: localTime(2026, 10, 11, 23, 50) }),
    take(50, 60, 12, { createdAt: localTime(2026, 10, 12, 0, 10) }),
  ];
  assert.deepEqual(plain(rank.streak(history, new Date(2026, 9, 12, 9))), {
    current: 2,
    longest: 2,
  });
});

test("a gap day breaks the streak; longest remembers the best run", () => {
  const rank = load();
  // Oct 5-8 (4 days), gap on 9 and 10, then 11-12 (2 days).
  const history = [5, 6, 7, 8, 11, 12].map((day) => take(50, 60, day));
  assert.deepEqual(plain(rank.streak(history, new Date(2026, 9, 12, 20))), {
    current: 2,
    longest: 4,
  });
});

test("the streak stays alive through today until a whole day is missed", () => {
  const rank = load();
  const history = [10, 11, 12].map((day) => take(50, 60, day));
  const morningAfter = rank.streak(history, new Date(2026, 9, 13, 7));
  assert.deepEqual(plain(morningAfter), { current: 3, longest: 3 }, "no take yet today");
  const dayAfterThat = rank.streak(history, new Date(2026, 9, 14, 7));
  assert.deepEqual(plain(dayAfterThat), { current: 0, longest: 3 }, "missed the 13th");
});

test("streak survives junk entries", () => {
  const rank = load();
  const history = [take(50, 60, 12), { createdAt: "not a date" }, null, {}];
  assert.deepEqual(plain(rank.streak(history, new Date(2026, 9, 12, 20))), {
    current: 1,
    longest: 1,
  });
});
