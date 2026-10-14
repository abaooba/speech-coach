// Tests for the Level screen's side of the Practice contract (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 6 to 8): the exact request it hands
// app.screens.practice.startLevelTake for each take (eyebrow, title, body with the fix, material,
// seconds, live tap), the material drawn once per run, the baseline frozen at the Goal or from a
// new speaker's first take with speech, and the session's `path` field judge() returns. The
// screen runs for real through tests/level-harness.js; Practice is a fake that keeps each
// request, and the test plays Practice's part by calling judge and onSaved.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  wordsOver,
  find,
  textOf,
  visibleText,
} = require("./level-harness");

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function steadyHistory() {
  return [
    savedTake({ id: "y2", createdAt: at("2026-10-13", 11), result: talkResult() }),
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult() }),
  ];
}

const FIRST_IMPROMPTU_TOPIC = "Explain one rule your school should change, and say why.";

// The request's own fields, without its three callbacks, which are checked apart.
function fieldsOf(request) {
  const { judge, onSaved, onLeave, ...fields } = request;
  assert.equal(typeof judge, "function");
  assert.equal(typeof onSaved, "function");
  assert.equal(typeof onLeave, "function");
  return plain(fields);
}

// The text of the step's primary button: "Review 3 moments (30 s)" after take 1.
function primaryText(world) {
  return visibleText(find(world.body, "btn--primary")).trim();
}

// From the Goal of a two-take loop to its take 2 request: take 1, its feedback, the review with
// the fix chosen (or none), then "Say it again".
async function toTakeTwo(world, take1, fix) {
  world.tap("Record take 1");
  await world.finishTake(take1);
  world.tap(primaryText(world));
  if (fix) {
    world.tap(fix);
  }
  world.tap("Say it again");
}

// --- Take 1 and take 2 -----------------------------------------------------------------------

test("Record take 1 hands Practice the take 1 request", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  assert.equal(world.practice.requests.length, 1);
  assert.deepEqual(world.router.gone.slice(-1), ["practice"]);
  assert.deepEqual(fieldsOf(world.request()), {
    eyebrow: "Path: Fillers, level 3",
    title: "Take 1 of 2",
    body: "Talk for 90 s. Take 2 counts: 6 or fewer fillers a minute.",
    material: {
      kind: "prompt",
      id: "impromptu",
      title: "Impromptu",
      text: FIRST_IMPROMPTU_TOPIC,
      targetWpm: [140, 160],
      topic: FIRST_IMPROMPTU_TOPIC,
    },
    seconds: 90,
    liveTap: true,
  });
});

test("take 2's request names the chosen fix and keeps take 1's material", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["fillers-2"]),
    draws: [0, 0.99],
  });
  await world.open("fillers-3");
  await toTakeTwo(world, talkResult({ fillers: 10 }), "Pause instead of um");
  assert.equal(world.practice.requests.length, 2);
  const [first, second] = world.practice.requests;
  assert.deepEqual(fieldsOf(second), {
    eyebrow: "Path: Fillers, level 3",
    title: "Take 2 of 2",
    body: "Your fix: Pause instead of um. Take 2 counts: 6 or fewer fillers a minute.",
    material: plain(first.material),
    seconds: 90,
    liveTap: true,
  });
});

test("without a fix, take 2's request says what to do and what counts", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-3"]) });
  await world.open("fillers-4");
  await toTakeTwo(world, talkResult({ fillers: 9 }), null);
  const fields = fieldsOf(world.request());
  assert.equal(fields.title, "Take 2 of 2");
  assert.equal(fields.body, "Talk for 90 s. Take 2 counts: 5 or fewer fillers a minute.");
  assert.equal(fields.liveTap, false, "only Fillers level 3 taps live");
});

test("reads: each read's title, body and passage", async () => {
  const history = steadyHistory();
  const restarts = createWorld({ history });
  await restarts.open("restarts-1");
  restarts.tap("Record read 1");
  const read1 = fieldsOf(restarts.request());
  assert.equal(read1.title, "Read 1 of 3");
  assert.equal(read1.body, "Read the passage aloud. Read 3 counts: 4 or fewer slips.");
  assert.equal(read1.seconds, 90);
  const drawn = restarts.app.path.materialFor("restarts-1", history, () => 0, 0);
  assert.deepEqual(read1.material, plain(drawn));
  assert.equal(read1.material.kind, "passage");
  assert.equal(read1.material.topic, null);
  assert.ok(read1.material.id.startsWith("cold-read-"), read1.material.id);

  const pace = createWorld({ history: steadyHistory() });
  await pace.open("pace-1");
  pace.tap("Record read 1");
  const ladder = fieldsOf(pace.request());
  assert.equal(ladder.title, "Read 1 of 2");
  assert.equal(
    ladder.body,
    "Read the passage at 140 to 160 wpm. Read 2 counts: 140 to 160 wpm.",
  );
  assert.equal(ladder.seconds, pace.app.path.playById("pace-1").takes[0].seconds);
  assert.equal(ladder.material.id, "rebuttal-uniforms");
  assert.deepEqual(ladder.material.targetWpm, [140, 160]);
});

test("Pace level 2: both reads count, each on the same passage at its own band", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["pace-1"]) });
  await world.open("pace-2");
  world.tap("Record read 1");
  const read1 = fieldsOf(world.request());
  assert.equal(read1.title, "Read 1 of 2");
  assert.equal(
    read1.body,
    "Read the passage at 130 to 150 wpm. Both reads count: 140, then 160 wpm, give or take " +
      "10, at most 2 restarts each.",
  );
  assert.deepEqual(read1.material.targetWpm, [130, 150]);
  await world.finishTake(readResult({ words: 120, seconds: 51.4 }));
  world.tap(primaryText(world));
  world.tap("Read it again");
  const read2 = fieldsOf(world.request());
  assert.equal(read2.title, "Read 2 of 2");
  assert.equal(read2.material.id, read1.material.id);
  assert.equal(read2.material.text, read1.material.text);
  assert.deepEqual(read2.material.targetWpm, [150, 170]);
  assert.equal(read2.seconds, world.app.path.playById("pace-2").takes[1].seconds);
});

test("one-take plays: one take or one read, with the target", async () => {
  const cleared = clearedOn([
    "fillers-1",
    "fillers-2",
    "fillers-3",
    "fillers-4",
    "fillers-5",
    "long-pauses-1",
    "long-pauses-2",
    "long-pauses-3",
    "long-pauses-4",
    "long-pauses-5",
    "restarts-1",
    "pace-1",
    "pace-2",
    "pace-3",
  ]);
  const cases = [
    [
      "fillers-3_checkback",
      "Record",
      "One take",
      "Talk for 90 s. Target: 6 or fewer fillers a minute.",
      90,
    ],
    [
      "restarts-1_checkback",
      "Read it",
      "One read",
      "Read the passage aloud. Target: 4 or fewer slips.",
      90,
    ],
    [
      "fillers_crown",
      "Record",
      "One take",
      "Talk for 45 s. Target: 0:30 without a filler or restart.",
      45,
    ],
    [
      "pace_crown",
      "Read it",
      "One read",
      "Read the passage aloud. Target: 170 to 190 wpm, at most 1 restart.",
      null,
    ],
    [
      "long-pauses_checkpoint",
      "Record",
      "One take",
      "Talk for 120 s. Target: No long pause, slips in all at your usual or fewer.",
      120,
    ],
  ];
  for (const [playId, button, title, body, seconds] of cases) {
    const world = createWorld({ history: steadyHistory(), cleared });
    await world.open(playId);
    world.tap(button);
    const fields = fieldsOf(world.request());
    assert.equal(fields.eyebrow, "Path: " + world.app.path.playById(playId).heading, playId);
    assert.equal(fields.title, title, playId);
    assert.equal(fields.body, body, playId);
    assert.equal(
      fields.seconds,
      seconds === null ? world.app.path.playById(playId).takes[0].seconds : seconds,
      playId,
    );
    assert.equal(fields.liveTap, false, playId);
  }
});

test("the benchmark: take 1 reads its passage, take 2 talks on its prompt", async () => {
  const world = createWorld({ history: steadyHistory() });
  await world.open("benchmark");
  world.tap("Start benchmark");
  const read = fieldsOf(world.request());
  assert.deepEqual(
    [read.eyebrow, read.title, read.body, read.seconds],
    ["Path: Benchmark", "Take 1 of 2", "Read the passage aloud. It is measured, not scored.", 90],
  );
  assert.equal(read.material.id, "benchmark-read");
  assert.equal(read.material.kind, "passage");
  await world.finishTake(readResult({ words: 160, seconds: 64 }));
  world.tap("Record the talk");
  const talk = fieldsOf(world.request());
  assert.deepEqual(
    [talk.title, talk.body, talk.seconds],
    ["Take 2 of 2", "Talk for 90 s. It is measured, not scored.", 90],
  );
  assert.equal(talk.material.id, "benchmark-talk");
  assert.equal(talk.material.kind, "prompt");
  assert.equal(talk.material.topic, talk.material.text);
});

// --- Material --------------------------------------------------------------------------------

test("the material is drawn once at the Goal; a fresh run draws fresh material", async () => {
  const world = createWorld({
    history: steadyHistory(),
    cleared: clearedOn(["fillers-2"]),
    draws: [0, 0.99, 0.99],
  });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const firstRun = world.request().material.topic;
  assert.equal(firstRun, FIRST_IMPROMPTU_TOPIC);
  // Back from Practice without recording: the same run, the same material.
  await world.open("fillers-3");
  world.tap("Record take 1");
  assert.equal(world.request().material.topic, firstRun);
  // Away to the path and back: a fresh run, a fresh draw.
  world.router.go("path");
  await world.open("fillers-3");
  world.tap("Record take 1");
  assert.notEqual(world.request().material.topic, firstRun);
});

// --- The baseline ----------------------------------------------------------------------------

test("a new speaker's take 1 sets the baseline that Fillers level 1's target needs", async () => {
  const world = createWorld({ history: [] });
  await world.open("fillers-1");
  assert.equal(textOf(find(world.body, "level-target__headline")), "8 or fewer");
  assert.equal(
    textOf(find(world.body, "level-target__unit")),
    "fillers a minute, or halfway there from take 1",
  );
  world.tap("Record take 1");
  assert.equal(
    world.request().body,
    "Talk for 60 s. Take 2 counts: 8 or fewer fillers a minute, or halfway there from take 1.",
  );
  // Take 1: 12 fillers in a minute, so halfway to 8 is 10.
  await world.finishTake(talkResult({ seconds: 60, words: 150, fillers: 12 }));
  assert.equal(textOf(find(world.body, "level-take__target")), "target 10");
  world.tap(primaryText(world));
  world.tap("Say it again");
  assert.equal(world.request().body, "Talk for 60 s. Take 2 counts: 10 or fewer fillers a minute.");
});

test("a new speaker's slow take 1 makes Pace level 3's take 2 the shorter one", async () => {
  const world = createWorld({ history: [], cleared: clearedOn(["pace-2"]) });
  await world.open("pace-3");
  assert.equal(textOf(find(world.body, "level-target__length")), "90 s, then 70 or 90 s");
  world.tap("Record take 1");
  // 130 wpm, under the band of 140 to 160.
  await world.finishTake(talkResult({ seconds: 90, words: 195 }));
  world.tap(primaryText(world));
  world.tap("Say it again");
  const fields = fieldsOf(world.request());
  assert.equal(fields.seconds, 70);
  assert.equal(fields.body, "Talk for 70 s. Take 2 counts: 140 to 160 wpm.");
});

test("a frozen baseline from the history is not changed by the run's takes", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["pace-2"]) });
  await world.open("pace-3");
  assert.equal(textOf(find(world.body, "level-target__length")), "90 s, two takes");
  world.tap("Record take 1");
  await world.finishTake(talkResult({ seconds: 90, words: 195 }));
  world.tap(primaryText(world));
  world.tap("Say it again");
  assert.equal(world.request().seconds, 90, "the steady 150 wpm baseline keeps take 2 at 90 s");
});

// --- judge(): the session's path field -------------------------------------------------------

test("judge returns a practice take's path field: not scored", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const { pathField } = await world.finishTake(talkResult({ fillers: 10 }));
  assert.deepEqual(plain(pathField), {
    play: "fillers-3",
    kind: "loop",
    take: 1,
    scored: false,
    passed: null,
    stage: null,
    inRoom: null,
  });
});

test("judge returns a scored take's path field, passed or not", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  await toTakeTwo(world, talkResult({ fillers: 10 }), null);
  const missed = await world.finishTake(talkResult({ fillers: 10 }));
  assert.deepEqual(plain(missed.pathField), {
    play: "fillers-3",
    kind: "loop",
    take: 2,
    scored: true,
    passed: false,
    stage: null,
    inRoom: null,
  });
  world.tap("Try take 3");
  const passed = await world.finishTake(talkResult({ fillers: 8 }));
  assert.deepEqual(plain(passed.pathField), {
    play: "fillers-3",
    kind: "loop",
    take: 3,
    scored: true,
    passed: true,
    stage: null,
    inRoom: null,
  });
});

test("judge gives a check-back its stage, a checkpoint whether someone listened", async () => {
  const first = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-3"]) });
  await first.open("fillers-3_checkback");
  first.tap("Record");
  const stage1 = await first.finishTake(talkResult({ fillers: 5 }));
  assert.deepEqual(plain(stage1.pathField), {
    play: "fillers-3_checkback",
    kind: "checkback",
    take: 1,
    scored: true,
    passed: true,
    stage: 1,
    inRoom: null,
  });

  // Check-back 2 is due 7 days after the level was cleared, so the level was cleared Oct 1.
  const second = createWorld({
    history: steadyHistory(),
    cleared: [
      ...clearedOn(["fillers-3"], "2026-10-01"),
      ...clearedOn(["fillers-3_cb1"], "2026-10-03"),
    ],
  });
  await second.open("fillers-3_checkback");
  second.tap("Record");
  const stage2 = await second.finishTake(talkResult({ fillers: 12 }));
  assert.equal(stage2.pathField.stage, 2);
  assert.equal(stage2.pathField.passed, false);

  const fillerLevels = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];
  const room = createWorld({ history: steadyHistory(), cleared: clearedOn(fillerLevels) });
  await room.open("fillers_checkpoint");
  find(room.body, "level-switch").click();
  room.tap("Record");
  const listened = await room.finishTake(
    talkResult({ seconds: 120, words: 300, fillers: 2 }),
  );
  assert.deepEqual(plain(listened.pathField), {
    play: "fillers_checkpoint",
    kind: "checkpoint",
    take: 1,
    scored: true,
    passed: listened.pathField.passed,
    stage: null,
    inRoom: true,
  });

  const alone = createWorld({ history: steadyHistory(), cleared: clearedOn(fillerLevels) });
  await alone.open("fillers_checkpoint");
  alone.tap("Record");
  const unheard = await alone.finishTake(talkResult({ seconds: 120, words: 300, fillers: 2 }));
  assert.equal(unheard.pathField.inRoom, false);
});

test("judge marks the benchmark's takes unscored and a crown's take scored", async () => {
  const bench = createWorld({ history: steadyHistory() });
  await bench.open("benchmark");
  bench.tap("Start benchmark");
  const read = await bench.finishTake(readResult({ words: 160, seconds: 64 }));
  assert.deepEqual(plain(read.pathField), {
    play: "benchmark",
    kind: "benchmark",
    take: 1,
    scored: false,
    passed: null,
    stage: null,
    inRoom: null,
  });
  bench.tap("Record the talk");
  const talk = await bench.finishTake(talkResult({ fillers: 3 }));
  assert.equal(talk.pathField.take, 2);
  assert.equal(talk.pathField.scored, false);

  const crown = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-3"]) });
  await crown.open("fillers_crown");
  crown.tap("Record");
  // 45 s with no filler or restart: a run past 30 s.
  const clean = await crown.finishTake({
    transcript: wordsOver(110, 44),
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 46,
  });
  assert.deepEqual(plain(clean.pathField), {
    play: "fillers_crown",
    kind: "crown",
    take: 1,
    scored: true,
    passed: true,
    stage: null,
    inRoom: null,
  });
});

test("judge stands alone: calling it twice for one take gives the same field", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const request = world.request();
  const result = talkResult({ fillers: 10 });
  assert.deepEqual(plain(request.judge(result)), plain(request.judge(result)));
});
