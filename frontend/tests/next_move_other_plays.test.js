// Tests for app.nextMove after a Path play that is not a level loop (guided coach, final review
// finding 1): a check-back, a crown, a checkpoint or the benchmark. `after.levelId` is the play's
// route id ("fillers-2_checkback", "fillers_crown", "fillers_checkpoint", "benchmark"), read with
// app.path.playById; every rule comes from app.path. passages.js, delivery.js, path.js and
// nextmove.js load into a vm, as in next_move.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js", "nextmove.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const TODAY = "2026-10-20";
const FILLER_LEVELS = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function at(day, hour = 10) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, 0).toISOString();
}

function record(levelId, day) {
  return { levelId, clearedAt: at(day) };
}

// A minute of talk at 150 wpm; `say` swaps in other text by index.
function take(day, { say = {}, pathFields, hour = 10 } = {}) {
  const transcript = Array.from({ length: 100 }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * 0.4,
    end: 1 + index * 0.4 + 0.3,
  }));
  const saved = {
    id: "take-" + day + "-" + hour,
    createdAt: at(day, hour),
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [], fillers: {} },
    transcript,
  };
  if (pathFields) {
    saved.path = Object.assign(
      { take: 1, scored: true, passed: false, stage: null, inRoom: null },
      pathFields,
    );
  }
  return saved;
}

// Takes whose weakest unit is Fillers: a hesitation in every tenth word.
function fillerTakes(days) {
  const say = {};
  for (let i = 5; i < 100; i += 10) {
    say[i] = "um";
  }
  return days.map((day, index) => take(day, { say, hour: 9 + index }));
}

function move(options) {
  return plain(APP.nextMove({ today: TODAY, ...options }));
}

function after(levelId, passed) {
  return { type: "level", levelId, passed };
}

// --- Check-backs -------------------------------------------------------------------------------

test("a passed check-back goes on to the next due check-back, not the one just passed", () => {
  // Both check-back 1s are due; fillers-1's was just passed, its record not in the list yet.
  const cleared = [record("fillers-1", "2026-10-10"), record("fillers-2", "2026-10-11")];
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared,
    after: after("fillers-1_checkback", true),
  });
  assert.deepEqual(result, {
    kind: "checkback",
    label: "Start: Fillers 2 check-back",
    href: "#/level/fillers-2_checkback",
    why: "A check-back keeps a cleared level locked in.",
  });
});

test("a passed check-back with no other due goes to its unit's current level", () => {
  const cleared = [record("fillers-1", "2026-10-10"), record("fillers-1_cb1", TODAY)];
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared,
    after: after("fillers-1_checkback", true),
  });
  assert.deepEqual(result, {
    kind: "next-level",
    label: "Start: Fillers level 2",
    href: "#/level/fillers-2",
    why: "Next in Fillers.",
  });
});

test("a missed check-back never says Try again: it comes back in two days", () => {
  const miss = take(TODAY, {
    hour: 15,
    pathFields: { play: "fillers-1_checkback", kind: "checkback", stage: 1, passed: false },
  });
  const history = [miss].concat(fillerTakes(["2026-10-17", "2026-10-18"]));
  const cleared = [record("fillers-1", "2026-10-10")];
  const result = move({ history, cleared, after: after("fillers-1_checkback", false) });
  assert.notEqual(result.kind, "retry");
  assert.notEqual(result.href, "#/level/fillers-1_checkback");
  // The rest of the rules pick the move, as with nothing just done.
  assert.deepEqual(result, move({ history, cleared }));
});

// --- Crowns ------------------------------------------------------------------------------------

test("a missed crown says Try again, with no daily limit", () => {
  const misses = [9, 10, 11].map((hour) =>
    take(TODAY, { hour, pathFields: { play: "fillers_crown", kind: "crown", passed: false } }),
  );
  const result = move({
    history: misses.concat(fillerTakes(["2026-10-17", "2026-10-18"])),
    cleared: ["fillers-1", "fillers-2", "fillers-3"].map((id) => record(id, "2026-10-19")),
    after: after("fillers_crown", false),
  });
  assert.deepEqual(result, {
    kind: "retry",
    label: "Try again",
    href: "#/level/fillers_crown",
    why: "A crown has no daily limit. One clean run earns it.",
  });
});

test("an earned crown goes to its unit's current level", () => {
  const cleared = ["fillers-1", "fillers-2", "fillers-3"].map((id) => record(id, "2026-10-19"));
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: cleared.concat([record("fillers_crown-1", TODAY)]),
    after: after("fillers_crown", true),
  });
  assert.deepEqual(result, {
    kind: "next-level",
    label: "Start: Fillers level 4",
    href: "#/level/fillers-4",
    why: "Next in Fillers.",
  });
});

// --- Checkpoints -------------------------------------------------------------------------------

test("a missed checkpoint says Try again, with no daily limit", () => {
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: FILLER_LEVELS.map((id) => record(id, "2026-10-19")),
    after: after("fillers_checkpoint", false),
  });
  assert.deepEqual(result, {
    kind: "retry",
    label: "Try again",
    href: "#/level/fillers_checkpoint",
    why: "A checkpoint has no daily limit. One clean take clears it.",
  });
});

test("a cleared checkpoint goes to the weakest unit's current level, never back to itself", () => {
  const history = fillerTakes(["2026-10-17", "2026-10-18"]);
  // The checkpoint's own record is not in the list yet.
  const result = move({
    history,
    cleared: FILLER_LEVELS.map((id) => record(id, "2026-10-19")),
    after: after("fillers_checkpoint", true),
  });
  const order = Array.from(APP.path.order(history), (unit) => unit);
  assert.equal(order[0].id, "fillers", "Fillers is the weakest unit, all of it cleared");
  const next = order[1];
  assert.deepEqual(result, {
    kind: "weakest-unit",
    label: "Start: " + next.title + " level 1",
    href: "#/level/" + next.levels[0].id,
    why: next.title + " is your weakest unit right now.",
  });
});

// --- The benchmark -----------------------------------------------------------------------------

test("after the benchmark the weakest unit's current level comes next", () => {
  // Three takes and no sitting in the list yet: rule 5 alone would offer the benchmark again.
  const history = fillerTakes(["2026-10-17", "2026-10-18", "2026-10-19"]);
  assert.equal(move({ history, cleared: [] }).kind, "benchmark");
  const result = move({ history, cleared: [], after: after("benchmark", null) });
  assert.deepEqual(result, {
    kind: "weakest-unit",
    label: "Start: Fillers level 1",
    href: "#/level/fillers-1",
    why: "Fillers is your weakest unit right now.",
  });
});

test("every play kind's move is {kind, label, href, why} with no debate words", () => {
  const ids = ["fillers-1_checkback", "fillers_crown", "fillers_checkpoint", "benchmark"];
  ids.forEach((levelId) => {
    [true, false].forEach((passed) => {
      const result = move({
        history: fillerTakes(["2026-10-17", "2026-10-18"]),
        cleared: FILLER_LEVELS.map((id) => record(id, "2026-10-10")),
        after: after(levelId, passed),
      });
      assert.deepEqual(Object.keys(result).sort(), ["href", "kind", "label", "why"], levelId);
      assert.doesNotMatch(
        result.label + " " + result.why,
        /debat|rebuttal|resolution|judge|ballot/i,
      );
    });
  });
});
