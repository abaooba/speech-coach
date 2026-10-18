// Tests for app.nextMove (guided coach, spec Phase 5 item 4): the one thing to do next, with the
// first matching rule winning. Every rule has a test, and so does each rule's place in the order.
// passages.js, delivery.js, path.js and nextmove.js load into a vm; takes are stored takes whose
// reports come from the real app.delivery.analyze.
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

// A minute of talk at 150 wpm (a word every 0.4 s). `say` swaps in other text by index; `repeats`
// are the backend's restarts. With nothing swapped in it is a clean take, so the weakest unit is
// the one the swaps make worst.
function take(day, { say = {}, repeats = [], pathFields, hour = 10, id } = {}) {
  const transcript = Array.from({ length: 100 }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * 0.4,
    end: 1 + index * 0.4 + 0.3,
  }));
  const saved = {
    id: id || "take-" + day + "-" + hour,
    createdAt: at(day, hour),
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 60,
    metrics: { pauses: [], repeats, fillers: {} },
    transcript,
  };
  if (pathFields) {
    saved.path = Object.assign(
      { take: 2, scored: true, passed: false, stage: null, inRoom: null },
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

test("the move is {kind, label, href, why} and nothing else", () => {
  const result = move({});
  assert.deepEqual(Object.keys(result).sort(), ["href", "kind", "label", "why"]);
});

test("rule 1: a level missed with attempts left says Try again", () => {
  const miss = take(TODAY, { pathFields: { play: "fillers-2", kind: "loop", passed: false } });
  const result = move({
    history: [miss],
    cleared: [record("fillers-1", "2026-10-18")],
    after: { type: "level", levelId: "fillers-2", passed: false },
  });
  assert.deepEqual(result, {
    kind: "retry",
    label: "Try again",
    href: "#/level/fillers-2",
    why: "One clean take 2 clears the level.",
  });
});

test("rule 1 does not apply once today's attempts are used up", () => {
  const misses = [9, 10, 11].map((hour) =>
    take(TODAY, { hour, pathFields: { play: "fillers-2", kind: "loop", passed: false } }),
  );
  const result = move({
    history: misses,
    cleared: [record("fillers-1", "2026-10-18")],
    after: { type: "level", levelId: "fillers-2", passed: false },
  });
  assert.notEqual(result.kind, "retry");
  assert.notEqual(result.href, "#/level/fillers-2");
});

test("rule 2: a level passed leads to the same unit's next level", () => {
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: [record("restarts-1", TODAY)],
    after: { type: "level", levelId: "restarts-1", passed: true },
  });
  assert.deepEqual(result, {
    kind: "next-level",
    label: "Start: Restarts level 2",
    href: "#/level/restarts-2",
    why: "Next in Restarts.",
  });
});

test("rule 2 still names the next level before the pass is in the cleared records", () => {
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: [],
    after: { type: "level", levelId: "fillers-3", passed: true },
  });
  assert.equal(result.label, "Start: Fillers level 4");
});

test("rule 2: after level 5 the unit's checkpoint comes next", () => {
  const cleared = ["restarts-1", "restarts-2", "restarts-3", "restarts-4", "restarts-5"].map((id) =>
    record(id, "2026-10-19"),
  );
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared,
    after: { type: "level", levelId: "restarts-5", passed: true },
  });
  assert.deepEqual(result, {
    kind: "checkpoint",
    label: "Start: Restarts checkpoint",
    href: "#/level/restarts_checkpoint",
    why: "Next: the Restarts checkpoint.",
  });
});

test("rule 2 beats rule 3: a passed level leads on even with one take of your own", () => {
  const result = move({
    history: [take(TODAY)],
    cleared: [record("pace-1", TODAY)],
    after: { type: "level", levelId: "pace-1", passed: true },
  });
  assert.equal(result.label, "Start: Pace level 2");
});

test("rule 3: at most one take means level 1 of the weakest unit", () => {
  const none = move({});
  assert.deepEqual(none, {
    kind: "first-level",
    label: "Start: Restarts level 1",
    href: "#/level/restarts-1",
    why: "Restarts is the first unit on the Path.",
  });
  const say = {};
  for (let i = 5; i < 100; i += 10) {
    say[i] = "um";
  }
  const one = move({ history: [take("2026-10-19", { say })] });
  assert.deepEqual(one, {
    kind: "first-level",
    label: "Start: Fillers level 1",
    href: "#/level/fillers-1",
    why: "Fillers is your weakest unit right now.",
  });
});

test("rule 3 beats the due check-back and benchmark", () => {
  const result = move({
    history: [take("2026-10-10")],
    cleared: [record("pace-1", "2026-10-10")],
  });
  assert.equal(result.kind, "first-level");
});

test("rule 4: a due check-back says Start: Fillers 2 check-back", () => {
  const cleared = [record("fillers-1", "2026-10-10"), record("fillers-2", "2026-10-11")];
  const result = move({ history: fillerTakes(["2026-10-17", "2026-10-18"]), cleared });
  assert.deepEqual(result, {
    kind: "checkback",
    label: "Start: Fillers 1 check-back",
    href: "#/level/fillers-1_checkback",
    why: "A check-back keeps a cleared level locked in.",
  });
  const second = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: [record("fillers-1", "2026-10-19"), record("fillers-2", "2026-10-10")],
  });
  assert.equal(second.label, "Start: Fillers 2 check-back");
});

test("rule 4 waits until the check-back is due", () => {
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: [record("fillers-1", TODAY)],
  });
  assert.notEqual(result.kind, "checkback");
});

test("rule 5: the benchmark is due with 3 or more takes of your own", () => {
  const three = fillerTakes(["2026-10-17", "2026-10-18", "2026-10-19"]);
  const result = move({ history: three, cleared: [] });
  assert.deepEqual(result, {
    kind: "benchmark",
    label: "Start benchmark",
    href: "#/level/benchmark",
    why: "Same passage, same prompt, every 14 days. See your real progress.",
  });
  assert.equal(APP.nextMove.BENCHMARK_AFTER_TAKES, 3);
});

test("rule 5 needs 3 takes, and a benchmark done lately is not due", () => {
  const two = move({ history: fillerTakes(["2026-10-17", "2026-10-18"]), cleared: [] });
  assert.equal(two.kind, "weakest-unit");
  const done = fillerTakes(["2026-10-17", "2026-10-18", "2026-10-19"]);
  done.push(
    take("2026-10-19", {
      hour: 15,
      pathFields: { play: "benchmark", kind: "benchmark", take: 1, scored: false, passed: null },
    }),
  );
  assert.notEqual(move({ history: done, cleared: [] }).kind, "benchmark");
});

test("rule 6: otherwise the weakest unit's first current level", () => {
  const history = fillerTakes(["2026-10-17", "2026-10-18"]);
  const cleared = [record("fillers-1", TODAY)];
  const result = move({ history, cleared });
  assert.deepEqual(result, {
    kind: "weakest-unit",
    label: "Start: Fillers level 2",
    href: "#/level/fillers-2",
    why: "Fillers is your weakest unit right now.",
  });
});

test("rule 6 skips a resting unit for the next weakest", () => {
  const history = fillerTakes(["2026-10-17", "2026-10-18"]);
  const misses = [9, 10, 11].map((hour) =>
    take(TODAY, { hour, pathFields: { play: "fillers-1", kind: "loop", passed: false } }),
  );
  const benchmark = take("2026-10-19", {
    hour: 15,
    pathFields: { play: "benchmark", kind: "benchmark", take: 1, scored: false, passed: null },
  });
  const all = history.concat(misses, [benchmark]);
  const result = move({ history: all, cleared: [] });
  const weakest = Array.from(APP.path.order(all), (unit) => unit.id);
  assert.equal(weakest[0], "fillers");
  assert.notEqual(result.href, "#/level/fillers-1");
  assert.equal(result.kind, "weakest-unit");
  assert.match(result.why, /is your weakest unit right now\.$/);
});

test("rule 7: nothing left to do falls back to Record another take", () => {
  const allCleared = [];
  APP.path.UNITS.forEach((unit) => {
    unit.levels.forEach((level) => allCleared.push(record(level.id, "2026-10-19")));
    allCleared.push(record(unit.checkpoint.id, "2026-10-19"));
  });
  const history = fillerTakes(["2026-10-17", "2026-10-18"]);
  history.push(
    take("2026-10-19", {
      hour: 15,
      pathFields: { play: "benchmark", kind: "benchmark", take: 1, scored: false, passed: null },
    }),
  );
  const result = move({ history, cleared: allCleared, today: "2026-10-19" });
  assert.deepEqual(result, {
    kind: "record",
    label: "Record another take",
    href: "#/practice",
    why: "Every take adds a point to your trend.",
  });
});

test("bad input still gives a move", () => {
  assert.equal(plain(APP.nextMove()).kind, "first-level");
  assert.equal(plain(APP.nextMove({ history: "x", cleared: null, after: 5 })).kind, "first-level");
  assert.equal(
    move({ history: [], after: { type: "level", levelId: "nope", passed: true } }).kind,
    "first-level",
  );
});

test("a free-talk take (after: {type: take}) skips rules 1 and 2", () => {
  const result = move({
    history: fillerTakes(["2026-10-17", "2026-10-18"]),
    cleared: [record("fillers-1", "2026-10-19")],
    after: { type: "take" },
  });
  assert.equal(result.kind, "weakest-unit");
  assert.equal(result.label, "Start: Fillers level 2");
});

test("no label or line mentions debate", () => {
  const results = [
    move({}),
    move({ history: fillerTakes(["2026-10-17", "2026-10-18", "2026-10-19"]) }),
  ];
  results.forEach((result) => {
    assert.doesNotMatch(result.label + result.why, /debat|round|rebut|judge/i);
  });
});
