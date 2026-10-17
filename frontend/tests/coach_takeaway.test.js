// Tests for app.coach.coachTakeaway: the rule-based line shown at once, {text, momentId}. The
// priority is a long pause, restarts, a filler cluster, a mid-sentence pause, a misread (then a
// skip), and last a strength, so a clean take still gets a line.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadCoach, plain } = require("./coach-harness");

const app = loadCoach();

function moment(kind, number, at, extra) {
  const minutes = Math.floor(at / 60);
  return {
    id: kind + "-" + number,
    kind,
    at,
    clock: minutes + ":" + String(Math.floor(at % 60)).padStart(2, "0"),
    seconds: null,
    text: "",
    before: "",
    after: "",
    expected: null,
    hint: false,
    ...extra,
  };
}

const LONG = moment("long-pause", 1, 41, { seconds: 5.4, before: "so we and" });
const RESTART = moment("restart", 1, 32, { text: "the few— the few" });
const RESTART_2 = moment("restart", 2, 14, { text: "a plan a plan" });
const FILLERS = [
  moment("filler", 1, 12, { text: "um" }),
  moment("filler", 2, 15, { text: "um" }),
  moment("filler", 3, 19, { text: "uh" }),
];
const PAUSE = moment("pause", 1, 22, { seconds: 1.8, before: "we make a", after: "plan" });
const MISREAD = moment("misread", 1, 10, { text: "cat", expected: "dog" });
const SKIP = moment("skip", 1, 11, { text: "quickly" });
const SUMMARY = { cleanStretch: { seconds: 18.44 } };

function takeaway(moments, summary) {
  return plain(app.coach.coachTakeaway(moments, summary));
}

test("a long pause comes first, with its length, clock and the word before it", () => {
  const all = [PAUSE, ...FILLERS, RESTART, MISREAD, LONG];
  assert.deepEqual(takeaway(all, SUMMARY), {
    text: "Your longest pause was 5.4 s, at 0:41 after “and”. Finish the thought, then pause.",
    momentId: "long-pause-1",
  });
});

test("the longest of several long pauses is named", () => {
  const longer = moment("long-pause", 2, 70, { seconds: 8, before: "" });
  const result = takeaway([LONG, longer], SUMMARY);
  assert.equal(result.momentId, "long-pause-2");
  assert.equal(result.text, "Your longest pause was 8.0 s, at 1:10. Finish the thought, then pause.");
});

test("one restart quotes the phrase; several list their clocks", () => {
  assert.deepEqual(takeaway([PAUSE, ...FILLERS, RESTART], SUMMARY), {
    text:
      "You restarted “the few— the few” at 0:32. " +
      "Breathe before each sentence instead of starting twice.",
    momentId: "restart-1",
  });
  const two = takeaway([RESTART_2, RESTART], SUMMARY);
  assert.equal(
    two.text,
    "Two restarts, at 0:14 and 0:32. Breathe before each sentence instead of starting twice.",
  );
  assert.equal(two.momentId, "restart-2");
  const many = [1, 2, 3, 4].map((n) => moment("restart", n, n * 10));
  assert.match(takeaway(many, SUMMARY).text, /^Four restarts, at 0:10, 0:20, 0:30 and 1 more\./);
});

test("a cluster of fillers within 5 s of each other comes next", () => {
  assert.deepEqual(takeaway([PAUSE, MISREAD, ...FILLERS], SUMMARY), {
    text: "3 fillers within a few seconds, from 0:12. Close your mouth and pause instead.",
    momentId: "filler-1",
  });
});

test("fillers far apart are not a cluster and fall through to the next rule", () => {
  const far = [moment("filler", 1, 5), moment("filler", 2, 30), moment("filler", 3, 60)];
  assert.equal(takeaway([...far, PAUSE], SUMMARY).momentId, "pause-1");
  assert.equal(takeaway(far, SUMMARY).momentId, null);
});

test("a mid-sentence pause names its length, clock and the word before it", () => {
  assert.deepEqual(takeaway([PAUSE, MISREAD], SUMMARY), {
    text: "You paused mid-sentence for 1.8 s, at 0:22 after “a”. Glance at your next point first.",
    momentId: "pause-1",
  });
});

test("a misread names both words, then a skip", () => {
  assert.deepEqual(takeaway([SKIP, MISREAD], SUMMARY), {
    text: "You read “cat” where the script says “dog”, at 0:10. Slow down on that word.",
    momentId: "misread-1",
  });
  assert.deepEqual(takeaway([SKIP], SUMMARY), {
    text: "You skipped “quickly”, at 0:11. Look a phrase ahead so no word is skipped.",
    momentId: "skip-1",
  });
});

test("hints never make a takeaway", () => {
  const hints = [
    moment("stumble", 1, 4, { hint: true, text: "children" }),
    moment("unclear", 1, 8, { hint: true, text: "village" }),
  ];
  assert.equal(takeaway(hints, SUMMARY).momentId, null);
});

test("a clean take gets a strength: the clean stretch, or a plain clean-run line", () => {
  assert.deepEqual(takeaway([], SUMMARY), {
    text: "Your longest clean stretch was 18.4 s, with no filler, pause or restart. Keep that going.",
    momentId: null,
  });
  assert.deepEqual(takeaway([], { cleanStretch: { seconds: 0 } }), {
    text: "Clean run. No filler, long pause or restart stood out.",
    momentId: null,
  });
  assert.equal(takeaway(null, undefined).momentId, null);
  assert.ok(takeaway(undefined, null).text.length > 0);
});

test("a long quoted phrase is cut with an ellipsis", () => {
  const phrase = "the very long phrase that the speaker said twice over and over again";
  const result = takeaway([moment("restart", 1, 3, { text: phrase })], SUMMARY);
  assert.match(result.text, /^You restarted “the very long phrase that the speaker sa…” at 0:03\./);
});

test("no line mentions debate", () => {
  const all = [LONG, RESTART, RESTART_2, ...FILLERS, PAUSE, MISREAD, SKIP];
  [all, [], [LONG], [RESTART], FILLERS, [PAUSE], [MISREAD], [SKIP]].forEach((moments) => {
    assert.doesNotMatch(takeaway(moments, SUMMARY).text, /debat|round|rebut|judge/i);
  });
});

test("the takeaway works on the moments coachMoments finds", () => {
  const words = [
    { text: "so", start: 0, end: 0.3 },
    { text: "and", start: 0.4, end: 0.7 },
    { text: "then", start: 6.5, end: 6.8 },
    { text: "we", start: 6.9, end: 7.1 },
  ];
  const report = app.delivery.analyze(words, { pauses: [[0.7, 5.8]] });
  const moments = app.coach.coachMoments(report, words);
  const result = takeaway(moments, report);
  assert.equal(result.momentId, "long-pause-1");
  assert.equal(
    result.text,
    "Your longest pause was 5.8 s, at 0:00 after “and”. Finish the thought, then pause.",
  );
});
