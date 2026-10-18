// Tests for the Loop Path's data in frontend/path.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 1 and 3): the four units and their five
// levels, each a loop of goal, take 1, review and take 2; the check-back, crown and checkpoint
// beside them; and the plays playById() hands the Level screen, with their takes, goals,
// examples and fixes, and the material each take is said or read on. passages.js, delivery.js
// and path.js load into a vm in index.html's order.
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

const UNIT_IDS = ["restarts", "fillers", "long-pauses", "pace"];
const TALK_GUARDS = ["talkShare", "minWpm", "steadyOtherSlips"];
const READ_GUARDS = ["readThrough", "minWpm", "steadyOtherSlips"];
const PACE_READ_GUARDS = ["readThrough"];
const PACE_TALK_GUARDS = ["talkShare", "steadyOtherSlips"];
const LADDER_WORDS = 109;

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function unit(id) {
  const found = PATH.UNITS.find((entry) => entry.id === id);
  assert.ok(found, "no unit " + id);
  return found;
}

function play(id, options) {
  const found = PATH.playById(id, options);
  assert.ok(found, "no play " + id);
  return plain(found);
}

// Every play id: a loop and a check-back per level, two crowns, four checkpoints, the benchmark.
function allPlayIds() {
  const ids = [];
  PATH.UNITS.forEach((entry) => {
    entry.levels.forEach((level) => ids.push(level.id, level.id + "_checkback"));
  });
  return ids.concat(
    ["fillers_crown", "pace_crown"],
    UNIT_IDS.map((id) => id + "_checkpoint"),
    ["benchmark"],
  );
}

// A baseline with the numbers the plays read from it.
function usualAt({ fillersPerMinute = 4, wpm = 150 } = {}) {
  return {
    takes: 1,
    minutes: 1,
    fillersPerMinute,
    restartsPerMinute: 1,
    shortMidPerMinute: 2,
    longPausesPerMinute: 0,
    wpm,
    cleanStretchSeconds: 20,
    weightedPerMinute: 6,
    otherPerMinute: { restarts: 5, fillers: 2, "long-pauses": 5, pace: 6 },
  };
}

function cleared(...ids) {
  return ids.map((levelId) => ({ levelId, clearedAt: "2026-10-14T10:00:00.000Z" }));
}

// --- units -----------------------------------------------------------------------------------

test("each unit has a title, a subtitle, a cited why line, four fixes and an example", () => {
  assert.deepEqual(Array.from(PATH.UNITS, (entry) => entry.id), UNIT_IDS);
  assert.deepEqual(
    plain(Array.from(PATH.UNITS, (entry) => [entry.title, entry.subtitle])),
    [
      ["Restarts", "Read it three times, then twice, then say it"],
      ["Fillers", "Name it, spot it, catch it, pause instead"],
      ["Long pauses", "Plan, tell, then tell again"],
      ["Pace", "Feel the band, then hold it"],
    ],
  );
  PATH.UNITS.forEach((entry) => {
    assert.deepEqual(Object.keys(entry.why).sort(), ["entry", "label", "text", "url"], entry.id);
    assert.equal(entry.fixes.length, 4, entry.id);
  });
});

test("the fixes for a next take are the spec's, unit by unit", () => {
  assert.deepEqual(plain(unit("fillers").fixes), [
    "Pause instead of um",
    "Jot 3 points first",
    "Slow the first 3 words",
    "Finish the sentence, don't restart",
  ]);
  assert.deepEqual(plain(unit("restarts").fixes), [
    "Finish the sentence, don't restart",
    "Read a phrase ahead",
    "Slow the first 3 words",
    "Pause at commas",
  ]);
  assert.deepEqual(plain(unit("long-pauses").fixes), [
    "Jot 3 points first",
    "Say your next point out loud",
    "Pause at a full stop, not mid-sentence",
    "Slow the first 3 words",
  ]);
  assert.deepEqual(plain(unit("pace").fixes), [
    "Match the time bar",
    "Breathe at each full stop",
    "Pause at commas, not mid-phrase",
    "Keep going through small slips",
  ]);
});

test("each example and non-example is a line of parts with its slip marked", () => {
  const text = (parts) => parts.map((part) => part.text).join("");
  const marked = (parts) => parts.filter((part) => part.mark).map((part) => [part.text, part.mark]);
  const examples = Object.fromEntries(
    Array.from(PATH.UNITS, (entry) => [entry.id, plain(entry.example)]),
  );
  assert.equal(text(examples.fillers.good), "Close your lips and pause. The plan costs less.");
  assert.equal(text(examples.fillers.bad), "Um, so, the plan, uh, costs less.");
  assert.deepEqual(marked(examples.fillers.bad), [
    ["Um", "filler"],
    ["uh", "filler"],
  ]);
  assert.equal(text(examples.restarts.good), "I'm kinda nervous, but here's my point.");
  assert.equal(text(examples.restarts.bad), "I kinda ner— I'm kinda nervous.");
  assert.deepEqual(marked(examples.restarts.bad), [["I kinda ner—", "restart"]]);
  assert.equal(
    text(examples["long-pauses"].good),
    "I love this park. Here's why: it stays quiet all morning.",
  );
  assert.equal(
    text(examples["long-pauses"].bad),
    "I love this park because… [6 s] …it stays quiet.",
  );
  assert.deepEqual(marked(examples["long-pauses"].bad), [["[6 s]", "pause"]]);
  assert.equal(
    text(examples.pace.good),
    "A steady 150: every word lands, and the pauses fall at full stops.",
  );
  assert.equal(text(examples.pace.bad), "A rushed 190 that runs one sentence into the next.");
  Object.values(examples).forEach((example) => {
    assert.deepEqual(marked(example.good), [], "nothing is marked in a good line");
    [...example.good, ...example.bad].forEach((part) => {
      assert.deepEqual(Object.keys(part).sort(), ["mark", "text"]);
    });
  });
});

// --- levels ----------------------------------------------------------------------------------

test("the levels' titles and materials follow the spec's tables", () => {
  const rows = Object.fromEntries(
    Array.from(PATH.UNITS, (entry) => [
      entry.id,
      Array.from(entry.levels, (level) => [level.title, level.material]),
    ]),
  );
  assert.deepEqual(plain(rows), {
    restarts: [
      ["Read it 3 times", "cold-read"],
      ["Read it 3 times", "cold-read"],
      ["Read it twice", "cold-read"],
      ["Read it twice", "cold-read"],
      ["Say it twice", "impromptu"],
    ],
    fillers: [
      ["Name it", "your-day"],
      ["Spot it", "your-day"],
      ["Catch it live", "impromptu"],
      ["Pause instead", "impromptu"],
      ["New topic", "new-topic"],
    ],
    "long-pauses": [
      ["Hold 15 s clean", "impromptu"],
      ["Hold 20 s", "impromptu"],
      ["Hold 30 s", "impromptu"],
      ["Hold 45 s", "impromptu"],
      ["Hold a minute", "new-topic"],
    ],
    pace: [
      ["Feel the band", "ladder"],
      ["Shift gears", "ladder"],
      ["Talk in the band", "impromptu"],
      ["Hold it", "impromptu"],
      ["New topic", "new-topic"],
    ],
  });
  PATH.UNITS.forEach((entry) => {
    entry.levels.forEach((level, index) => {
      assert.equal(level.id, entry.id + "-" + (index + 1));
      assert.equal(level.unit, entry.id);
      assert.equal(level.number, index + 1);
    });
  });
});

test("each level's takes have the spec's seconds, and only the last one is scored", () => {
  const seconds = (id) => Array.from(PATH.levelById(id).takes, (take) => take.seconds);
  assert.deepEqual(
    UNIT_IDS.flatMap((id) => [1, 2, 3, 4, 5].map((n) => [id + "-" + n, seconds(id + "-" + n)])),
    [
      ["restarts-1", [90, 90, 90]],
      ["restarts-2", [90, 90, 90]],
      ["restarts-3", [90, 90]],
      ["restarts-4", [90, 90]],
      ["restarts-5", [90, 90]],
      ["fillers-1", [60, 60]],
      ["fillers-2", [60, 60]],
      ["fillers-3", [90, 90]],
      ["fillers-4", [90, 90]],
      ["fillers-5", [120, 120]],
      ["long-pauses-1", [90, 90]],
      ["long-pauses-2", [90, 75]],
      ["long-pauses-3", [90, 60]],
      ["long-pauses-4", [120, 90]],
      ["long-pauses-5", [120, 120]],
      ["pace-1", [44, 44]],
      ["pace-2", [47, 41]],
      ["pace-3", [90, 90]],
      ["pace-4", [120, 120]],
      ["pace-5", [120, 120]],
    ],
  );
  PATH.UNITS.forEach((entry) => {
    entry.levels.forEach((level) => {
      const scored = Array.from(level.takes, (take) => take.scored);
      const expected =
        level.id === "pace-2"
          ? [true, true]
          : scored.map((_, index) => index === scored.length - 1);
      assert.deepEqual(scored, expected, level.id);
      assert.equal(level.scoredInPairs, level.id === "pace-2", level.id);
    });
  });
});

test("reading levels read, talk levels talk, and takes are labelled in order", () => {
  const labels = (id) => Array.from(PATH.levelById(id).takes, (take) => take.label);
  assert.deepEqual(labels("restarts-1"), ["Read 1", "Read 2", "Read 3"]);
  assert.deepEqual(labels("restarts-3"), ["Read 1", "Read 2"]);
  assert.deepEqual(labels("restarts-5"), ["Take 1", "Take 2"]);
  assert.deepEqual(labels("pace-2"), ["Read 1", "Read 2"]);
  assert.deepEqual(labels("pace-3"), ["Take 1", "Take 2"]);
  const reads = PATH.UNITS.flatMap((entry) =>
    Array.from(entry.levels)
      .filter((level) => level.takes.every((take) => take.read))
      .map((level) => level.id),
  );
  assert.deepEqual(plain(reads), [
    "restarts-1",
    "restarts-2",
    "restarts-3",
    "restarts-4",
    "pace-1",
    "pace-2",
  ]);
});

test("the crown's ladder read lasts as long as the passage takes at 180 wpm, rounded up", () => {
  const passage = APP.passages.find((entry) => entry.id === "explainer-rainbows");
  assert.equal(passage.text.trim().split(/\s+/).length, LADDER_WORDS);
  assert.deepEqual(plain(play("pace_crown").takes), [
    {
      seconds: Math.ceil((LADDER_WORDS * 60) / 180),
      scored: true,
      read: true,
      band: [170, 190],
      label: "Take",
    },
  ]);
});

test("each level's rule is the spec's: conditions on take 2 and the guards it checks", () => {
  const rules = Object.fromEntries(
    PATH.UNITS.flatMap((entry) =>
      Array.from(entry.levels, (level) => [level.id, [level.conditions, level.guards]]),
    ),
  );
  assert.deepEqual(plain(rules), {
    "restarts-1": [[{ measure: "readSlips", max: 4 }], READ_GUARDS],
    "restarts-2": [[{ measure: "readSlips", max: 3 }], READ_GUARDS],
    "restarts-3": [[{ measure: "readSlips", max: 2 }], READ_GUARDS],
    "restarts-4": [[{ measure: "readSlips", max: 1 }], READ_GUARDS],
    "restarts-5": [[{ measure: "restartsPerMinute", max: 1 }], TALK_GUARDS],
    "fillers-1": [[{ measure: "fillersPerMinute", max: 8, halfwayFromUsual: true }], TALK_GUARDS],
    "fillers-2": [[{ measure: "fillersPerMinute", max: 8 }], TALK_GUARDS],
    "fillers-3": [[{ measure: "fillersPerMinute", max: 6 }], TALK_GUARDS],
    "fillers-4": [[{ measure: "fillersPerMinute", max: 5 }], TALK_GUARDS],
    "fillers-5": [[{ measure: "fillersPerMinute", max: 3 }], TALK_GUARDS],
    "long-pauses-1": [
      [
        { measure: "cleanStretchSeconds", min: 15 },
        { measure: "longPauses", max: 1 },
      ],
      TALK_GUARDS,
    ],
    "long-pauses-2": [
      [
        { measure: "cleanStretchSeconds", min: 20 },
        { measure: "longPauses", max: 0 },
      ],
      TALK_GUARDS,
    ],
    "long-pauses-3": [
      [
        { measure: "cleanStretchSeconds", min: 30 },
        { measure: "longPauses", max: 0 },
      ],
      TALK_GUARDS,
    ],
    "long-pauses-4": [
      [
        { measure: "cleanStretchSeconds", min: 45 },
        { measure: "longPauses", max: 0 },
        { measure: "shortMidPerMinute", max: "usual" },
      ],
      TALK_GUARDS,
    ],
    "long-pauses-5": [
      [
        { measure: "cleanStretchSeconds", min: 60 },
        { measure: "longPauses", max: 0 },
      ],
      TALK_GUARDS,
    ],
    "pace-1": [[{ measure: "wpm", band: "take" }], PACE_READ_GUARDS],
    "pace-2": [
      [
        { measure: "wpm", band: "take" },
        { measure: "restarts", max: 2 },
      ],
      PACE_READ_GUARDS,
    ],
    "pace-3": [[{ measure: "wpm", band: "take" }], PACE_TALK_GUARDS],
    "pace-4": [[{ measure: "wpm", band: "take" }], PACE_TALK_GUARDS],
    "pace-5": [
      [
        { measure: "wpm", band: "take" },
        { measure: "weightedPerMinute", max: "usual" },
      ],
      ["talkShare"],
    ],
  });
});

test("pace talk levels hold take 2 to the Impromptu prompt's band", () => {
  const impromptu = APP.passages.find((entry) => entry.id === "impromptu");
  ["pace-3", "pace-4", "pace-5"].forEach((id) => {
    PATH.levelById(id).takes.forEach((take) => {
      assert.deepEqual(Array.from(take.band), Array.from(impromptu.targetWpm), id);
    });
  });
});

test("only Long pauses plans before take 1: 30, 20, 10, then no prep", () => {
  const prep = PATH.UNITS.flatMap((entry) =>
    Array.from(entry.levels, (level) => level.prepSeconds),
  );
  assert.deepEqual(plain(prep), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 20, 10, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(play("long-pauses-1").prepText, "Plan for 30 s: jot 3 points.");
  assert.equal(play("long-pauses-3").prepText, "Plan for 10 s: jot 3 points.");
  assert.equal(play("long-pauses-4").prepText, null);
  assert.equal(play("long-pauses-1_checkback").prepSeconds, 0, "a check-back has no prep");
});

test("only Fillers levels 1 to 3 add to the loop: top fillers, Spot it, the live tap", () => {
  const flagged = (flag) =>
    plain(
      PATH.UNITS.flatMap((entry) =>
        Array.from(entry.levels)
          .filter((level) => level[flag])
          .map((level) => level.id),
      ),
    );
  assert.deepEqual(flagged("listsTopFillers"), ["fillers-1"]);
  assert.deepEqual(flagged("spotIt"), ["fillers-2"]);
  assert.deepEqual(flagged("liveTap"), ["fillers-3"]);
  assert.equal(play("fillers-3").liveTap, true);
  assert.equal(play("fillers-3_checkback").liveTap, false, "only during the level's own takes");
  assert.equal(play("fillers-2").spotIt, true);
  assert.equal(play("fillers-1").listsTopFillers, true);
});

test("each level's check-back is one take on new material at the level's limit", () => {
  const checkbacks = Object.fromEntries(
    PATH.UNITS.flatMap((entry) =>
      Array.from(entry.levels, (level) => {
        const check = level.checkback;
        return [level.id, [check.material, check.take.seconds, check.take.read, check.conditions]];
      }),
    ),
  );
  assert.deepEqual(plain(checkbacks), {
    "restarts-1": ["cold-read", 90, true, [{ measure: "readSlips", max: 4 }]],
    "restarts-2": ["cold-read", 90, true, [{ measure: "readSlips", max: 3 }]],
    "restarts-3": ["cold-read", 90, true, [{ measure: "readSlips", max: 2 }]],
    "restarts-4": ["cold-read", 90, true, [{ measure: "readSlips", max: 1 }]],
    "restarts-5": ["new-topic", 90, false, [{ measure: "restartsPerMinute", max: 1 }]],
    "fillers-1": ["new-topic", 60, false, [{ measure: "fillersPerMinute", max: 8 }]],
    "fillers-2": ["new-topic", 60, false, [{ measure: "fillersPerMinute", max: 8 }]],
    "fillers-3": ["new-topic", 90, false, [{ measure: "fillersPerMinute", max: 6 }]],
    "fillers-4": ["new-topic", 90, false, [{ measure: "fillersPerMinute", max: 5 }]],
    "fillers-5": ["new-topic", 90, false, [{ measure: "fillersPerMinute", max: 3 }]],
    "long-pauses-1": [
      "new-topic",
      90,
      false,
      [
        { measure: "cleanStretchSeconds", min: 15 },
        { measure: "longPauses", max: 1 },
      ],
    ],
    "long-pauses-2": [
      "new-topic",
      90,
      false,
      [
        { measure: "cleanStretchSeconds", min: 20 },
        { measure: "longPauses", max: 0 },
      ],
    ],
    "long-pauses-3": [
      "new-topic",
      90,
      false,
      [
        { measure: "cleanStretchSeconds", min: 30 },
        { measure: "longPauses", max: 0 },
      ],
    ],
    "long-pauses-4": [
      "new-topic",
      90,
      false,
      [
        { measure: "cleanStretchSeconds", min: 45 },
        { measure: "longPauses", max: 0 },
      ],
    ],
    "long-pauses-5": [
      "new-topic",
      90,
      false,
      [
        { measure: "cleanStretchSeconds", min: 60 },
        { measure: "longPauses", max: 0 },
      ],
    ],
    "pace-1": ["new-topic", 90, false, [{ measure: "wpm", band: "take" }]],
    "pace-2": ["new-topic", 90, false, [{ measure: "wpm", band: "take" }]],
    "pace-3": ["new-topic", 90, false, [{ measure: "wpm", band: "take" }]],
    "pace-4": ["new-topic", 90, false, [{ measure: "wpm", band: "take" }]],
    "pace-5": ["new-topic", 90, false, [{ measure: "wpm", band: "take" }]],
  });
  const guards = (id) => Array.from(PATH.levelById(id).checkback.guards);
  assert.deepEqual(guards("restarts-2"), READ_GUARDS);
  assert.deepEqual(guards("restarts-5"), TALK_GUARDS);
  assert.deepEqual(guards("fillers-3"), TALK_GUARDS);
  assert.deepEqual(guards("long-pauses-4"), TALK_GUARDS);
  assert.deepEqual(guards("pace-1"), PACE_TALK_GUARDS);
});

test("crowns sit beside Fillers and Pace level 3: sudden death and the 180 wpm ladder", () => {
  assert.equal(unit("restarts").crown, null);
  assert.equal(unit("long-pauses").crown, null);
  const fillers = plain(unit("fillers").crown);
  assert.equal(fillers.id, "fillers_crown");
  assert.equal(fillers.label, "Sudden death, optional");
  assert.deepEqual(fillers.tiers, [
    { number: 1, seconds: 30, record: "fillers_crown-1" },
    { number: 2, seconds: 45, record: "fillers_crown-2" },
    { number: 3, seconds: 60, record: "fillers_crown-3" },
    { number: 4, seconds: 90, record: "fillers_crown-4" },
    { number: 5, seconds: 120, record: "fillers_crown-5" },
  ]);
  const pace = plain(unit("pace").crown);
  assert.equal(pace.id, "pace_crown");
  assert.equal(pace.label, "180 wpm ladder, optional");
  assert.deepEqual(pace.tiers, [{ number: 1, wpm: 180, maxRestarts: 1, record: "pace_crown-1" }]);
});

test("every unit ends in a 2-minute checkpoint held to its target and the usual slips", () => {
  const checkpoints = Object.fromEntries(
    Array.from(PATH.UNITS, (entry) => [entry.id, plain(entry.checkpoint)]),
  );
  const allSlips = { measure: "weightedPerMinute", max: "usual" };
  assert.deepEqual(checkpoints, {
    restarts: {
      id: "restarts_checkpoint",
      label: "Checkpoint: 2-minute new topic",
      seconds: 120,
      conditions: [{ measure: "restartsPerMinute", max: 1 }, allSlips],
      guards: TALK_GUARDS,
    },
    fillers: {
      id: "fillers_checkpoint",
      label: "Checkpoint: 2-minute new topic",
      seconds: 120,
      conditions: [{ measure: "fillersPerMinute", max: 3 }, allSlips],
      guards: ["talkShare", "minWpm"],
    },
    "long-pauses": {
      id: "long-pauses_checkpoint",
      label: "Checkpoint: 2-minute new topic",
      seconds: 120,
      conditions: [{ measure: "longPauses", max: 0 }, allSlips],
      guards: TALK_GUARDS,
    },
    pace: {
      id: "pace_checkpoint",
      label: "Checkpoint: 2-minute new topic",
      seconds: 120,
      conditions: [{ measure: "wpm", band: "take" }, allSlips],
      guards: ["talkShare"],
    },
  });
});

test("plays, takes, tips and examples cannot be changed by a caller", () => {
  assert.ok(Object.isFrozen(PATH.UNITS[0].levels[0].tip));
  assert.ok(Object.isFrozen(PATH.UNITS[0].why));
  assert.ok(Object.isFrozen(PATH.UNITS[0].example.bad[0]));
  const loop = PATH.playById("fillers-3");
  assert.ok(Object.isFrozen(loop) && Object.isFrozen(loop.takes[1]) && Object.isFrozen(loop.goal));
  assert.ok(Object.isFrozen(PATH.playById("fillers_crown").tier));
  assert.ok(Object.isFrozen(PATH.takeAt("fillers-3", 2)));
});

// --- plays -----------------------------------------------------------------------------------

test("every play id resolves to a play of its kind, and nothing else does", () => {
  const ids = allPlayIds();
  assert.equal(ids.length, 47);
  const kinds = {};
  ids.forEach((id) => {
    const found = play(id);
    assert.equal(found.id, id);
    kinds[found.kind] = (kinds[found.kind] || 0) + 1;
    assert.deepEqual(Object.keys(found).sort(), [
      "example",
      "fixes",
      "goal",
      "heading",
      "id",
      "inRoomSwitch",
      "kind",
      "level",
      "listsTopFillers",
      "liveTap",
      "material",
      "number",
      "prepSeconds",
      "prepText",
      "spotIt",
      "subtitle",
      "takes",
      "tier",
      "tip",
      "unit",
      "unitTitle",
      "why",
    ]);
    assert.deepEqual(Object.keys(found.goal).sort(), ["headline", "length", "short", "unitLabel"]);
  });
  assert.deepEqual(kinds, { loop: 20, checkback: 20, crown: 2, checkpoint: 4, benchmark: 1 });
  for (const unknown of ["fillers-6", "fillers", "fillers-1_checkback_checkback", "restarts_crown",
    "long-pauses_crown", "checkpoint", "", undefined, null, 3, {}]) {
    assert.equal(PATH.playById(unknown), null, String(unknown));
  }
});

test("a play's heading and subtitle name what it is", () => {
  const titles = (id) => {
    const found = play(id);
    return [found.heading, found.subtitle, found.unit, found.level, found.number];
  };
  assert.deepEqual(titles("fillers-3"), [
    "Fillers, level 3",
    "Catch it live",
    "fillers",
    "fillers-3",
    3,
  ]);
  assert.deepEqual(titles("long-pauses-2"), [
    "Long pauses, level 2",
    "Hold 20 s",
    "long-pauses",
    "long-pauses-2",
    2,
  ]);
  assert.deepEqual(titles("fillers-3_checkback"), [
    "Fillers, level 3 check-back",
    "Catch it live",
    "fillers",
    "fillers-3",
    3,
  ]);
  assert.deepEqual(titles("fillers_crown"), [
    "Fillers crown",
    "Sudden death",
    "fillers",
    null,
    null,
  ]);
  assert.deepEqual(titles("pace_crown"), ["Pace crown", "Speed ladder", "pace", null, null]);
  assert.deepEqual(titles("restarts_checkpoint"), [
    "Restarts checkpoint",
    "2-minute new topic",
    "restarts",
    null,
    null,
  ]);
  assert.deepEqual(titles("benchmark"), [
    "Benchmark",
    "Same passage, same prompt, every 14 days",
    null,
    null,
    null,
  ]);
  assert.equal(play("pace-1").unitTitle, "Pace");
  assert.equal(play("benchmark").unitTitle, null);
});

test("a play carries its unit's example and fixes; only a checkpoint asks who listens", () => {
  allPlayIds().forEach((id) => {
    const found = play(id);
    if (found.kind === "benchmark") {
      assert.equal(found.example, null);
      assert.deepEqual(found.fixes, []);
    } else {
      assert.deepEqual(found.example, plain(unit(found.unit).example), id);
      assert.deepEqual(found.fixes, plain(unit(found.unit).fixes), id);
    }
    assert.equal(found.inRoomSwitch, found.kind === "checkpoint", id);
    assert.equal(found.tier === null, found.kind !== "crown", id);
  });
});

test("the loops' goals: the headline target, its unit, the length and the short goal", () => {
  const goals = Object.fromEntries(
    PATH.UNITS.flatMap((entry) =>
      Array.from(entry.levels, (level) => [level.id, play(level.id, { baseline: usualAt() }).goal]),
    ),
  );
  const goal = (headline, unitLabel, length, short) => ({ headline, unitLabel, length, short });
  assert.deepEqual(goals, {
    "restarts-1": goal("4 or fewer", "slips on read 3: restarts and misreads",
      "3 reads of a new passage", "4 slips or fewer"),
    "restarts-2": goal("3 or fewer", "slips on read 3: restarts and misreads",
      "3 reads of a new passage", "3 slips or fewer"),
    "restarts-3": goal("2 or fewer", "slips on read 2: restarts and misreads",
      "2 reads of a new passage", "2 slips or fewer"),
    "restarts-4": goal("1 or fewer", "slips on read 2: restarts and misreads",
      "2 reads of a new passage", "1 slip or fewer"),
    "restarts-5": goal("1 or fewer", "restarts a minute", "90 s, two takes", "1 or fewer /min"),
    "fillers-1": goal("8 or fewer", "fillers a minute", "60 s, two takes", "8 or fewer /min"),
    "fillers-2": goal("8 or fewer", "fillers a minute", "60 s, two takes", "8 or fewer /min"),
    "fillers-3": goal("6 or fewer", "fillers a minute", "90 s, two takes", "6 or fewer /min"),
    "fillers-4": goal("5 or fewer", "fillers a minute", "90 s, two takes", "5 or fewer /min"),
    "fillers-5": goal("3 or fewer", "fillers a minute", "120 s, two takes", "3 or fewer /min"),
    "long-pauses-1": goal("15 s", "clean stretch, at most 1 long pause", "90 s, two takes",
      "15 s clean"),
    "long-pauses-2": goal("20 s", "clean stretch, no long pause", "90 s, then 75 s", "20 s clean"),
    "long-pauses-3": goal("30 s", "clean stretch, no long pause", "90 s, then 60 s", "30 s clean"),
    "long-pauses-4": goal("45 s",
      "clean stretch, no long pause, mid-sentence pauses at your usual or fewer",
      "120 s, then 90 s", "45 s clean"),
    "long-pauses-5": goal("60 s", "clean stretch, no long pause", "120 s, two takes", "60 s clean"),
    "pace-1": goal("140 to 160", "wpm on read 2", "2 reads of the passage", "150 wpm, twice"),
    "pace-2": goal("140, then 160", "wpm, give or take 10, at most 2 restarts each",
      "2 reads of the passage", "140, then 160 wpm"),
    "pace-3": goal("140 to 160", "wpm on take 2", "90 s, two takes", "140 to 160 wpm"),
    "pace-4": goal("140 to 160", "wpm on take 2", "120 s, two takes", "140 to 160 wpm"),
    "pace-5": goal("140 to 160", "wpm on take 2, slips in all at your usual or fewer",
      "120 s, two takes", "140 to 160 wpm"),
  });
});

test("the check-backs', crowns', checkpoints' and benchmark's goals", () => {
  const goal = (headline, unitLabel, length, short) => ({ headline, unitLabel, length, short });
  assert.deepEqual(play("fillers-1_checkback").goal,
    goal("8 or fewer", "fillers a minute", "60 s on a new topic", "8 or fewer /min"));
  assert.deepEqual(play("restarts-3_checkback").goal,
    goal("2 or fewer", "slips: restarts and misreads", "One read of a new passage",
      "2 slips or fewer"));
  assert.deepEqual(play("long-pauses-4_checkback").goal,
    goal("45 s", "clean stretch, no long pause", "90 s on a new topic", "45 s clean"));
  assert.deepEqual(play("pace-2_checkback").goal,
    goal("140 to 160", "wpm", "90 s on a new topic", "140 to 160 wpm"));
  assert.deepEqual(play("fillers_crown").goal,
    goal("0:30", "without a filler or restart", "45 s on About you", "Sudden death, optional"));
  assert.deepEqual(play("pace_crown").goal,
    goal("170 to 190", "wpm, at most 1 restart", "One read of the passage",
      "180 wpm ladder, optional"));
  assert.deepEqual(play("fillers_checkpoint", { baseline: usualAt() }).goal,
    goal("3 or fewer", "fillers a minute, slips in all at your usual or fewer",
      "120 s on a new topic", "2-minute new topic"));
  assert.deepEqual(play("long-pauses_checkpoint", { baseline: usualAt() }).goal,
    goal("No long pause", "slips in all at your usual or fewer", "120 s on a new topic",
      "2-minute new topic"));
  assert.deepEqual(play("pace_checkpoint", { baseline: usualAt() }).goal,
    goal("140 to 160", "wpm, slips in all at your usual or fewer", "120 s on a new topic",
      "2-minute new topic"));
  assert.deepEqual(play("benchmark").goal,
    goal("One read, one talk", "the same passage and prompt every 14 days", "About 3 minutes",
      "Every 14 days"));
});

test("Fillers level 1's target is halfway from the usual rate down to 8, or 8", () => {
  const target = (fillersPerMinute) =>
    play("fillers-1", { baseline: usualAt({ fillersPerMinute }) }).goal;
  assert.deepEqual([target(12).headline, target(12).short], ["10 or fewer", "10 or fewer /min"]);
  assert.equal(target(9).headline, "8.5 or fewer");
  assert.equal(target(8).headline, "8 or fewer");
  assert.equal(target(3).headline, "8 or fewer");
  assert.equal(target(12).unitLabel, "fillers a minute");
});

test("without a baseline, Fillers level 1 says take 1 sets its target, never guessing", () => {
  for (const options of [undefined, {}, { baseline: null }, { baseline: { wpm: 150 } }]) {
    assert.deepEqual(play("fillers-1", options).goal, {
      headline: "8 or fewer",
      unitLabel: "fillers a minute, or halfway there from take 1",
      length: "60 s, two takes",
      short: "Halfway to 8 /min",
    });
  }
});

test("Pace level 3's take 2 is 70 s for a speaker under the band, 90 s otherwise", () => {
  const take2 = (wpm) => play("pace-3", { baseline: usualAt({ wpm }) }).takes[1];
  assert.equal(take2(130).seconds, 70);
  assert.equal(take2(139).seconds, 70);
  assert.equal(take2(140).seconds, 90);
  assert.equal(take2(175).seconds, 90);
  assert.equal(play("pace-3", { baseline: usualAt({ wpm: 130 }) }).goal.length, "90 s, then 70 s");
  assert.equal(play("pace-3", { baseline: usualAt({ wpm: 150 }) }).goal.length, "90 s, two takes");
  // Until take 1 sets a baseline the length is not known, and the play says so.
  assert.equal(play("pace-3").takes[1].seconds, null);
  assert.equal(play("pace-3").goal.length, "90 s, then 70 or 90 s");
  assert.equal(play("pace-3").takes[0].seconds, 90, "take 1 never waits on the baseline");
});

test("a crown plays its next tier not yet earned, and its top tier once all are", () => {
  const crown = (...records) => play("fillers_crown", { cleared: cleared(...records) });
  assert.deepEqual(crown().tier, {
    number: 1,
    seconds: 30,
    record: "fillers_crown-1",
    earned: false,
  });
  assert.deepEqual(crown().takes, [{ seconds: 45, scored: true, read: false, label: "Take" }]);
  const third = crown("fillers_crown-1", "fillers_crown-2");
  assert.deepEqual(third.tier, {
    number: 3,
    seconds: 60,
    record: "fillers_crown-3",
    earned: false,
  });
  assert.equal(third.takes[0].seconds, 75);
  assert.equal(third.goal.headline, "1:00");
  assert.equal(third.goal.length, "75 s on About you");
  const skipped = crown("fillers_crown-2");
  assert.equal(skipped.tier.number, 1, "the first tier not yet earned");
  const all = crown(...[1, 2, 3, 4, 5].map((n) => "fillers_crown-" + n));
  assert.deepEqual(all.tier, { number: 5, seconds: 120, record: "fillers_crown-5", earned: true });
  assert.equal(all.takes[0].seconds, 135);
  assert.equal(play("pace_crown", { cleared: cleared("pace_crown-1") }).tier.earned, true);
});

test("one-take plays take one scored take: a read for a cold-read check-back, else a talk", () => {
  assert.deepEqual(play("restarts-1_checkback").takes, [
    { seconds: 90, scored: true, read: true, label: "Take" },
  ]);
  assert.deepEqual(play("fillers-1_checkback").takes, [
    { seconds: 60, scored: true, read: false, label: "Take" },
  ]);
  assert.deepEqual(play("pace-4_checkback").takes, [
    { seconds: 90, scored: true, read: false, band: [140, 160], label: "Take" },
  ]);
  assert.deepEqual(play("fillers_checkpoint").takes, [
    { seconds: 120, scored: true, read: false, label: "Take" },
  ]);
  assert.deepEqual(play("pace_checkpoint").takes, [
    { seconds: 120, scored: true, read: false, band: [140, 160], label: "Take" },
  ]);
  assert.deepEqual(play("benchmark").takes, [
    { seconds: 90, scored: false, read: true, band: [140, 160], label: "Read" },
    { seconds: 90, scored: false, read: false, band: [140, 160], label: "Talk" },
  ]);
});

test("takeAt gives a loop's retries: the scored take again, or Pace level 2's pair again", () => {
  const at = (id, index, options) => plain(PATH.takeAt(id, index, options));
  assert.deepEqual(at("fillers-3", 0), {
    seconds: 90,
    scored: false,
    read: false,
    label: "Take 1",
  });
  assert.deepEqual(at("fillers-3", 2), { seconds: 90, scored: true, read: false, label: "Take 3" });
  assert.deepEqual(at("fillers-3", 3), { seconds: 90, scored: true, read: false, label: "Take 4" });
  assert.deepEqual(at("restarts-1", 3), { seconds: 90, scored: true, read: true, label: "Read 4" });
  assert.deepEqual(at("pace-2", 2), {
    seconds: 47,
    scored: true,
    read: true,
    band: [130, 150],
    label: "Read 3",
  });
  assert.deepEqual(at("pace-2", 3), {
    seconds: 41,
    scored: true,
    read: true,
    band: [150, 170],
    label: "Read 4",
  });
  assert.equal(at("pace-3", 2, { baseline: usualAt({ wpm: 120 }) }).seconds, 70);
  assert.equal(at("long-pauses-2", 2).seconds, 75);
  assert.deepEqual(at("fillers-2_checkback", 0), {
    seconds: 60,
    scored: true,
    read: false,
    label: "Take",
  });
  assert.equal(at("benchmark", 1).label, "Talk");
  assert.equal(PATH.takeAt("benchmark", 2), null);
  assert.equal(PATH.takeAt("nothing", 0), null);
  assert.equal(PATH.takeAt("fillers-1", -1), null);
  assert.equal(PATH.takeAt("fillers-1", 1.5), null);
  assert.equal(at(PATH.playById("fillers-1"), 1).label, "Take 2", "a play works as well as its id");
});

// --- material --------------------------------------------------------------------------------

function topicsOf(promptId) {
  return Array.from(APP.passages.find((entry) => entry.id === promptId).topics);
}

function talkOn(topic, createdAt = "2026-10-12T10:00:00.000Z") {
  return {
    id: "take-" + createdAt,
    createdAt,
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [] },
    transcript: [],
    topic,
  };
}

test("a talk's material is its prompt, on a topic pickTopic picks", () => {
  const yourDay = plain(PATH.materialFor("fillers-1", [], () => 0));
  assert.deepEqual(yourDay, {
    kind: "prompt",
    id: "free-talk",
    title: "About you",
    text: topicsOf("free-talk")[0],
    targetWpm: [140, 160],
    topic: topicsOf("free-talk")[0],
  });
  for (const id of ["fillers-3", "fillers-5", "long-pauses-1_checkback", "fillers_checkpoint"]) {
    const material = plain(PATH.materialFor(id, [], () => 0.99));
    assert.equal(material.id, "impromptu", id);
    assert.equal(material.topic, topicsOf("impromptu")[7], id);
    assert.equal(material.text, material.topic, id);
  }
  assert.equal(PATH.materialFor("fillers_crown", [], () => 0).id, "free-talk");
});

test("a cold read's material is the passage pickColdRead picks, with the same draw", () => {
  const material = plain(PATH.materialFor("restarts-1", [], () => 0.5));
  const picked = PATH.pickColdRead([], () => 0.5);
  assert.deepEqual(material, {
    kind: "passage",
    id: picked.id,
    title: picked.title,
    text: picked.text,
    targetWpm: [140, 160],
    topic: null,
  });
  assert.equal(PATH.materialFor("restarts-4_checkback", [], () => 0.5).id, picked.id);
});

test("a ladder read's material is the ladder passage held to the read's own band", () => {
  const passage = APP.passages.find((entry) => entry.id === "explainer-rainbows");
  const ladder = (id, index) => plain(PATH.materialFor(id, [], () => 0, index));
  assert.deepEqual(ladder("pace-1", 0), {
    kind: "passage",
    id: "explainer-rainbows",
    title: passage.title,
    text: passage.text,
    targetWpm: [140, 160],
    topic: null,
  });
  assert.deepEqual(ladder("pace-2", 0).targetWpm, [130, 150]);
  assert.deepEqual(ladder("pace-2", 1).targetWpm, [150, 170]);
  assert.deepEqual(ladder("pace-2", 3).targetWpm, [150, 170]);
  assert.deepEqual(ladder("pace_crown", 0).targetWpm, [170, 190]);
  assert.throws(() => PATH.materialFor("nothing", [], () => 0), /nothing/);
});

test("pickTopic hands out a topic no take has used, drawn with the random source", () => {
  const topics = topicsOf("impromptu");
  topics.forEach((topic, index) => {
    const draw = (index + 0.5) / topics.length;
    assert.equal(PATH.pickTopic([], "impromptu", () => draw), topic);
  });
  const used = topics.slice(0, -1).map((topic, index) =>
    talkOn(topic, `2026-10-12T10:0${index}:00.000Z`),
  );
  for (const draw of [0, 0.5, 0.999]) {
    assert.equal(PATH.pickTopic(used, "impromptu", () => draw), topics[7], String(draw));
  }
});

test("once every topic is used, pickTopic hands back the one used longest ago", () => {
  const topics = topicsOf("free-talk");
  const history = topics.map((topic, index) =>
    talkOn(topic, `2026-10-12T10:${String(59 - index).padStart(2, "0")}:00.000Z`),
  );
  // The last topic was used at 10:52, before every other one; then the first is used again.
  history.push(talkOn(topics[0], "2026-10-12T11:00:00.000Z"));
  assert.equal(PATH.pickTopic(history, "free-talk", () => 0), topics[topics.length - 1]);
});

test("pickTopic passes over an excluded topic while another is left", () => {
  const topics = topicsOf("impromptu");
  assert.equal(PATH.pickTopic([], "impromptu", () => 0, topics[0]), topics[1]);
  assert.equal(PATH.pickTopic([], "impromptu", () => 0, [topics[0], topics[1]]), topics[2]);
  assert.equal(PATH.pickTopic([], "impromptu", () => 0, topics), topics[0], "all excluded");
});

test("pickTopic needs a random source and a prompt with topics", () => {
  assert.throws(() => PATH.pickTopic([], "impromptu"), /random/);
  // Every Practice prompt holds topics; a timed prompt without them gives null.
  const app = loadApp();
  app.passages.push({
    id: "timed-talk",
    kind: "prompt",
    title: "Timed talk",
    text: "Talk for three minutes on a subject you know well.",
    targetWpm: [140, 160],
    timeLimitSeconds: 180,
  });
  assert.equal(app.path.pickTopic([], "timed-talk", () => 0), null);
  assert.equal(PATH.pickTopic([], "nothing", () => 0), null);
  assert.equal(PATH.pickTopic([], "impromptu", () => Number.NaN), topicsOf("impromptu")[0]);
});

test("the sample's topic never counts as used", () => {
  const app = loadApp({ withResults: true });
  const topics = topicsOf("impromptu");
  const sample = talkOn(topics[0]);
  sample.passageTitle = "Sample: Congress speech";
  assert.equal(app.path.pickTopic([sample], "impromptu", () => 0), topics[0]);
});

// --- top fillers -----------------------------------------------------------------------------

function talkWith(sayings, createdAt) {
  const transcript = sayings.map((text, index) => ({
    text,
    start: 1 + index * 0.4,
    end: 1 + index * 0.4 + 0.3,
  }));
  return {
    id: "take-" + createdAt,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [] },
    transcript,
  };
}

test("topFillers lists the most used fillers of the five latest takes, at most three", () => {
  const history = [
    talkWith(["Um", "we", "uh", "go", "um,", "then", "uh", "stop."], "2026-10-12T10:00:00.000Z"),
    talkWith(["Then", "um", "the", "plan.", "Hmm", "yes."], "2026-10-12T11:00:00.000Z"),
  ];
  assert.deepEqual(plain(PATH.topFillers(history)), [
    { text: "um", count: 3 },
    { text: "uh", count: 2 },
    { text: "hmm", count: 1 },
  ]);
});

test("a tie in topFillers goes to the filler heard first, oldest take first", () => {
  const newer = talkWith(["Uh", "one.", "Um", "two."], "2026-10-12T11:00:00.000Z");
  const older = talkWith(["Hmm", "one.", "Er", "two."], "2026-10-12T10:00:00.000Z");
  assert.deepEqual(
    plain(PATH.topFillers([newer, older])).map((filler) => filler.text),
    ["hmm", "er", "uh"],
  );
});

test("topFillers reads only the five latest takes and none at all with no fillers", () => {
  const old = talkWith(["Uh", "uh", "uh", "uh", "uh."], "2026-10-01T10:00:00.000Z");
  const recent = [2, 3, 4, 5, 6].map((day) =>
    talkWith(["Um", "the", "day."], `2026-10-0${day}T10:00:00.000Z`),
  );
  assert.deepEqual(plain(PATH.topFillers([old, ...recent])), [{ text: "um", count: 5 }]);
  assert.deepEqual(plain(PATH.topFillers([talkWith(["Clear", "words."], "2026-10-02")])), []);
  assert.deepEqual(plain(PATH.topFillers(undefined)), []);
});
