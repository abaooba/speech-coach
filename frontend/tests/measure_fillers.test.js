// Tests for scripts/measure_fillers.js, the accuracy scorer for hand-labeled takes: score()
// compares what app.delivery.classify flags with the word indexes a person labeled, and
// formatRow() prints a result with "-" wherever there is nothing to divide.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const measure = require(path.join(__dirname, "..", "..", "scripts", "measure_fillers.js"));

function round(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

// Words 0.3 s long with 0.1 s between them, as in delivery.test.js.
function timed(sentence) {
  let clock = 0;
  return sentence.split(" ").map((text) => {
    const word = { text, start: round(clock), end: round(clock + 0.3) };
    clock += 0.4;
    return word;
  });
}

test("the module loads without running the CLI", () => {
  assert.equal(typeof measure.score, "function");
  assert.equal(typeof measure.formatRow, "function");
});

test("every flagged filler is labeled and every label is flagged", () => {
  const result = measure.score(timed("Um, like, the plan works."), {
    hesitation: [0],
    habit: [1],
  });
  for (const kind of ["hesitation", "habit"]) {
    assert.equal(result[kind].flagged, 1);
    assert.equal(result[kind].labeled, 1);
    assert.equal(result[kind].correct, 1);
    assert.equal(result[kind].precision, 1);
    assert.equal(result[kind].recall, 1);
  }
});

test("a labeled habit the rules miss gives null precision and zero recall", () => {
  const { habit } = measure.score(timed("It was like really big."), { habit: [2] });
  assert.equal(habit.flagged, 0);
  assert.equal(habit.labeled, 1);
  assert.equal(habit.correct, 0);
  assert.equal(habit.precision, null);
  assert.equal(habit.recall, 0);
});

test("a flagged habit nobody labeled gives zero precision and null recall", () => {
  const { habit } = measure.score(timed("Basically, the plan fails."), { habit: [] });
  assert.equal(habit.flagged, 1);
  assert.equal(habit.labeled, 0);
  assert.equal(habit.precision, 0);
  assert.equal(habit.recall, null);
});

test("a clean take has null everywhere and its printed row shows a dash", () => {
  const result = measure.score(timed("The plan works."), {});
  for (const kind of ["hesitation", "habit"]) {
    assert.equal(result[kind].flagged, 0);
    assert.equal(result[kind].labeled, 0);
    assert.equal(result[kind].precision, null);
    assert.equal(result[kind].recall, null);
  }
  const row = measure.formatRow("clean", result, 0);
  assert.match(row, /-/);
  assert.doesNotMatch(row, /NaN|null|undefined/);
});

test("the printed row shows percentages and the missed count", () => {
  const result = measure.score(timed("Um, like, the plan works."), {
    hesitation: [0],
    habit: [1],
  });
  const row = measure.formatRow("take", result, 2);
  assert.match(row, /take/);
  assert.match(row, /100%/);
  assert.match(row, /2\s*$/);
});
