// Tests for the Level screen's frame and Goal step (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8): the screen's registration, the Path
// back link, the h1 and subtitle per play, the stepper per play kind, the Goal card (target,
// length, examples, the cited why line), Fillers level 1's top fillers, the long-pause prep
// countdown, the checkpoint's in-the-room switch, the Goal's button, and the states for a play
// that is unknown, locked or resting. The screen runs for real through tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TODAY,
  at,
  createWorld,
  talkResult,
  savedTake,
  wordsOver,
  find,
  findAll,
  byTag,
  hasClass,
  textOf,
  visibleText,
  control,
} = require("./level-harness");

const FILLER_LEVELS = ["fillers-1", "fillers-2", "fillers-3", "fillers-4", "fillers-5"];

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

// Two clean minutes and a half yesterday: a baseline for every rule.
function steadyHistory() {
  return [
    savedTake({ id: "y2", createdAt: at("2026-10-13", 11), result: talkResult() }),
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult() }),
  ];
}

function stepperOf(world) {
  const list = find(world.body, "level-steps");
  return findAll(list, "level-steps__item").map((item) => [
    visibleText(find(item, "level-steps__label")),
    item.getAttribute("aria-current"),
  ]);
}

function labels(world) {
  return stepperOf(world).map(([label]) => label);
}

// --- The module and its frame ----------------------------------------------------------------

test("level.js registers app.screens.level with mount, show and hide", () => {
  const world = createWorld();
  assert.deepEqual(Object.keys(world.app.screens).sort(), ["level", "practice"]);
  assert.deepEqual(Object.keys(world.screen).sort(), ["hide", "mount", "show"]);
  assert.deepEqual(Object.keys(world.app).sort(), [
    "delivery",
    "loop",
    "passages",
    "path",
    "router",
    "screens",
    "store",
    "ui",
  ]);
});

test("mount puts a Path back link, with a chevron, right before the h1", () => {
  const world = createWorld();
  const [link, heading, body] = world.section.children;
  assert.equal(link.tagName, "a");
  assert.ok(hasClass(link, "level-back"));
  assert.equal(link.getAttribute("href"), "#/path");
  assert.equal(visibleText(link).trim(), "Path");
  assert.equal(byTag(link, "svg")[0].getAttribute("data-icon"), "chevron-left");
  assert.equal(heading, world.heading);
  assert.equal(body, world.body);
});

test("the h1 names the play and the subtitle under it the level's title", async () => {
  const cleared = clearedOn([...FILLER_LEVELS, "pace-1", "pace-2", "pace-3"]);
  const cases = [
    ["fillers-3", "Fillers, level 3", "Catch it live"],
    ["fillers-3_checkback", "Fillers, level 3 check-back", "Catch it live"],
    ["fillers_crown", "Fillers crown", "Sudden death"],
    ["pace_crown", "Pace crown", "Speed ladder"],
    ["fillers_checkpoint", "Fillers checkpoint", "2-minute new topic"],
    ["benchmark", "Benchmark", "Same passage, same prompt, every 14 days"],
  ];
  for (const [playId, heading, subtitle] of cases) {
    const world = createWorld({ history: steadyHistory(), cleared });
    await world.open(playId);
    assert.equal(world.heading.textContent, heading, playId);
    const line = world.body.children[0];
    assert.ok(hasClass(line, "level__subtitle"), playId);
    assert.equal(textOf(line), subtitle, playId);
  }
});

// --- The stepper -----------------------------------------------------------------------------

test("the stepper lists the play's steps, the Goal current", async () => {
  const cleared = clearedOn([...FILLER_LEVELS, "restarts-1"]);
  const cases = [
    ["fillers-3", ["Goal", "Take 1", "Review", "Take 2", "Result"]],
    ["restarts-1", ["Goal", "Read 1", "Review", "Read 2", "Read 3", "Result"]],
    ["pace-2", null],
    ["fillers-3_checkback", ["Goal", "Take", "Result"]],
    ["fillers_crown", ["Goal", "Take", "Result"]],
    ["fillers_checkpoint", ["Goal", "Take", "Result"]],
    ["benchmark", ["Intro", "Read", "Talk", "Done"]],
  ];
  for (const [playId, expected] of cases) {
    const world = createWorld({
      history: steadyHistory(),
      cleared: playId === "pace-2" ? clearedOn(["pace-1"]) : cleared,
    });
    await world.open(playId);
    const steps = stepperOf(world);
    const want = expected || ["Goal", "Read 1", "Review", "Read 2", "Result"];
    assert.deepEqual(
      steps.map(([label]) => label),
      want,
      playId,
    );
    assert.deepEqual(
      steps.map(([, current]) => current),
      want.map((_, index) => (index === 0 ? "step" : null)),
      playId,
    );
  }
});

test("the stepper is an ordered list with numbered marks; done steps carry a check", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  const list = find(world.body, "level-steps");
  assert.equal(list.tagName, "ol");
  assert.equal(list.getAttribute("aria-label"), "Level steps");
  const items = findAll(list, "level-steps__item");
  assert.ok(hasClass(items[0], "level-steps__item--current"));
  assert.ok(items.slice(1).every((item) => hasClass(item, "level-steps__item--upcoming")));
  assert.deepEqual(
    items.map((item) => textOf(find(item, "level-steps__mark"))),
    ["1", "2", "3", "4", "5"],
  );
  assert.ok(items.every((item) => find(item, "level-steps__mark").getAttribute("aria-hidden")));

  world.tap("Record take 1");
  await world.finishTake(talkResult({ fillers: 10 }));
  const after = findAll(find(world.body, "level-steps"), "level-steps__item");
  assert.deepEqual(
    after.map((item) => item.className.split(" ")[1]),
    [
      "level-steps__item--done",
      "level-steps__item--done",
      "level-steps__item--current",
      "level-steps__item--upcoming",
      "level-steps__item--upcoming",
    ],
  );
  const doneMark = find(after[0], "level-steps__mark");
  assert.equal(byTag(doneMark, "svg")[0].getAttribute("data-icon"), "check");
  assert.equal(textOf(find(after[0], "sr-only")), ", done");
});

// --- Goal ------------------------------------------------------------------------------------

test("Goal: a card with the target, its unit label, the length and the examples", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  const step = find(world.body, "level-step");
  assert.equal(textOf(find(step, "level-heading")), "Goal");
  const card = find(step, "level-target");
  assert.ok(hasClass(card, "level-card"));
  assert.equal(textOf(find(card, "level-target__headline")), "6 or fewer");
  assert.equal(textOf(find(card, "level-target__unit")), "fillers a minute");
  assert.equal(textOf(find(card, "level-target__length")), "90 s, two takes");

  const [good, bad] = findAll(card, "level-example");
  assert.ok(hasClass(good, "level-example--good"));
  assert.ok(hasClass(bad, "level-example--bad"));
  assert.equal(
    visibleText(good).trim(),
    "Close your lips and pause. The plan costs less.",
  );
  assert.equal(visibleText(bad).trim(), "Um, so, the plan, uh, costs less.");
  assert.deepEqual(
    findAll(bad, "tok--filler").map(textOf),
    ["Um", "uh"],
  );
  assert.equal(byTag(good, "svg")[0].getAttribute("data-icon"), "check");
  assert.equal(byTag(bad, "svg")[0].getAttribute("data-icon"), "close");
  assert.equal(textOf(find(good, "sr-only")), "Like this: ");
  assert.equal(textOf(find(bad, "sr-only")), "Not like this: ");
});

test("Goal: the unit's why line links its source in a new tab", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  const why = world.app.path.playById("fillers-3").why;
  const card = find(world.body, "level-target");
  assert.equal(textOf(find(card, "level-why__text")), why.text);
  const source = find(card, "level-source");
  assert.equal(visibleText(source), "Source: " + why.label);
  const link = find(source, "level-source__link");
  assert.equal(link.tagName, "a");
  assert.equal(link.getAttribute("href"), why.url);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  assert.equal(textOf(find(link, "sr-only")), ", opens in a new tab");
});

test("Goal: each unit's example marks its own slip", async () => {
  const restarts = createWorld({ history: steadyHistory() });
  await restarts.open("restarts-1");
  const restartBad = findAll(restarts.body, "level-example")[1];
  assert.deepEqual(findAll(restartBad, "tok--restart").map(textOf), ["I kinda ner—"]);
  assert.equal(visibleText(restartBad).trim(), "I kinda ner— I'm kinda nervous.");

  const pauses = createWorld({ history: steadyHistory() });
  await pauses.open("long-pauses-1");
  const pauseBad = findAll(pauses.body, "level-example")[1];
  assert.deepEqual(findAll(pauseBad, "tok--pause").map(textOf), ["[6 s]"]);
});

test("Goal: Fillers level 1 lists the speaker's top fillers", async () => {
  const say = { 5: "um", 20: "uh", 40: "um", 60: "Um", 80: "uh", 100: "like" };
  const take = savedTake({
    id: "fillers",
    createdAt: at("2026-10-13"),
    result: talkResult({ transcript: wordsOver(225, 90, say) }),
  });
  const world = createWorld({ history: [take] });
  await world.open("fillers-1");
  const card = find(world.body, "level-fillers");
  assert.ok(hasClass(card, "level-card"));
  assert.equal(textOf(find(card, "level-card__title")), "Your top fillers");
  const items = findAll(card, "level-fillers__item");
  // The vm realm's array, copied into this one so the lists compare by value.
  const expected = JSON.parse(JSON.stringify(world.app.path.topFillers([take])));
  assert.deepEqual(expected, [
    { text: "um", count: 3 },
    { text: "uh", count: 2 },
  ]);
  assert.deepEqual(
    items.map((item) => visibleText(item)),
    ["um 3 times", "uh 2 times"],
  );
  assert.deepEqual(
    items.map((item) => textOf(find(item, "tok--filler"))),
    expected.map((filler) => filler.text),
  );
});

test("Goal: with no fillers counted, Fillers level 1 says take 1 will find them", async () => {
  const world = createWorld({ history: [] });
  await world.open("fillers-1");
  const card = find(world.body, "level-fillers");
  assert.equal(
    textOf(find(card, "level-fillers__none")),
    "No fillers counted yet. Take 1 will find yours.",
  );
  assert.equal(findAll(card, "level-fillers__item").length, 0);
  // Other levels list no fillers.
  const other = createWorld({ history: [], cleared: clearedOn(["fillers-1"]) });
  await other.open("fillers-2");
  assert.equal(find(other.body, "level-fillers"), null);
});

test("Goal: the long-pause prep counts down after Start planning, with Skip", async () => {
  const world = createWorld({ history: steadyHistory() });
  await world.open("long-pauses-1");
  const prep = find(world.body, "level-prep");
  assert.equal(textOf(find(prep, "level-prep__text")), "Plan for 30 s: jot 3 points.");
  assert.equal(world.activeTimers("interval"), 0, "nothing counts until the speaker starts");

  world.tap("Start planning");
  assert.equal(world.announcements[world.announcements.length - 1], "Planning for 30 seconds.");
  assert.equal(textOf(find(world.body, "level-prep__clock")), "0:30");
  assert.equal(control(world.body, "Start planning"), null);
  const skip = control(world.body, "Skip");
  assert.ok(skip, "Skip shows while the countdown runs");
  assert.equal(world.focusLog[world.focusLog.length - 1], skip, "focus moves to Skip");
  assert.equal(world.activeTimers("interval"), 1);

  world.tick();
  assert.equal(textOf(find(world.body, "level-prep__clock")), "0:29");
  for (let second = 0; second < 29; second += 1) {
    world.tick();
  }
  assert.equal(world.activeTimers("interval"), 0);
  assert.equal(world.announcements[world.announcements.length - 1], "Planning time is up.");
  assert.equal(control(world.body, "Skip"), null);
  assert.ok(control(world.body, "Start planning"));
  assert.equal(
    world.focusLog[world.focusLog.length - 1],
    control(world.body, "Record take 1"),
    "focus moves on to the take",
  );
});

test("Goal: Skip ends the prep at once; leaving the screen stops it too", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["long-pauses-1"]) });
  await world.open("long-pauses-2");
  assert.equal(textOf(find(world.body, "level-prep__text")), "Plan for 20 s: jot 3 points.");
  world.tap("Start planning");
  assert.equal(textOf(find(world.body, "level-prep__clock")), "0:20");
  world.tap("Skip");
  assert.equal(world.activeTimers("interval"), 0);
  assert.equal(world.announcements[world.announcements.length - 1], "Planning skipped.");
  assert.ok(control(world.body, "Start planning"));

  world.tap("Start planning");
  assert.equal(world.activeTimers("interval"), 1);
  world.router.go("history");
  assert.equal(world.activeTimers("interval"), 0, "hide() stops the countdown");
});

test("Goal: plays without prep show none", async () => {
  for (const playId of ["long-pauses-4", "fillers-1", "long-pauses-1_checkback"]) {
    const world = createWorld({
      history: steadyHistory(),
      cleared: clearedOn(["long-pauses-1", "long-pauses-2", "long-pauses-3"]),
    });
    await world.open(playId);
    assert.equal(find(world.body, "level-prep"), null, playId);
  }
});

test("Goal: a checkpoint asks whether someone is listening, with a switch", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(FILLER_LEVELS) });
  await world.open("fillers_checkpoint");
  const toggle = find(world.body, "level-switch");
  assert.equal(toggle.tagName, "button");
  assert.equal(toggle.getAttribute("role"), "switch");
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.equal(visibleText(toggle).trim(), "Someone is listening (in the room)");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-checked"), "false");

  const loop = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) });
  await loop.open("fillers-3");
  assert.equal(find(loop.body, "level-switch"), null);
});

test("Goal: the primary button records take 1, or reads or records a one-take play", async () => {
  const cleared = clearedOn([...FILLER_LEVELS, "restarts-1", "pace-1", "pace-2", "pace-3"]);
  const cases = [
    ["fillers-3", "Record take 1"],
    ["restarts-1", "Record read 1"],
    ["restarts-1_checkback", "Read it"],
    ["fillers-3_checkback", "Record"],
    ["fillers_crown", "Record"],
    ["pace_crown", "Read it"],
    ["fillers_checkpoint", "Record"],
    ["benchmark", "Start benchmark"],
  ];
  for (const [playId, label] of cases) {
    const world = createWorld({ history: steadyHistory(), cleared });
    await world.open(playId);
    const primary = findAll(world.body, "btn--primary");
    assert.equal(primary.length, 1, playId + " has one primary button");
    assert.equal(visibleText(primary[0]).trim(), label, playId);
  }
});

// --- Plays that cannot start -----------------------------------------------------------------

test("an unknown play shows Level not found, with a way back to the path", async () => {
  const world = createWorld();
  await world.open("fillers-9");
  assert.equal(world.heading.textContent, "Level");
  const state = find(world.body, "state");
  assert.ok(hasClass(state, "state--empty"));
  assert.equal(textOf(find(state, "state__title")), "Level not found");
  assert.equal(textOf(find(state, "state__body")), "Pick a level on the path.");
  world.tap("Back to path");
  assert.equal(world.router.gone[world.router.gone.length - 1], "path");
});

test("a locked play says what opens it and starts nothing", async () => {
  const cases = [
    ["fillers-3", [], "Clear level 2 first."],
    ["fillers-3_checkback", clearedOn(["fillers-2"]), "Clear level 3 first."],
    ["fillers_crown", clearedOn(["fillers-1", "fillers-2"]), "Clear the levels before it first."],
    ["pace_checkpoint", clearedOn(["pace-1"]), "Clear the levels before it first."],
  ];
  for (const [playId, cleared, why] of cases) {
    const world = createWorld({ history: steadyHistory(), cleared });
    await world.open(playId);
    const state = find(world.body, "state");
    assert.equal(textOf(find(state, "state__title")), "Not open yet", playId);
    assert.equal(textOf(find(state, "state__body")), why, playId);
    assert.equal(find(world.body, "level-steps"), null, playId);
    assert.equal(world.practice.requests.length, 0, playId);
  }
});

test("a level out of attempts today rests until tomorrow", async () => {
  const miss = (id, hour) =>
    savedTake({
      id,
      createdAt: at(TODAY, hour),
      result: talkResult({ fillers: 12 }),
      path: {
        play: "fillers-3",
        kind: "loop",
        take: 2,
        scored: true,
        passed: false,
        stage: null,
        inRoom: null,
      },
    });
  const history = [miss("m3", 9), miss("m2", 8), miss("m1", 7), ...steadyHistory()];
  const world = createWorld({ history, cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  const state = find(world.body, "state");
  assert.equal(textOf(find(state, "state__title")), "Back tomorrow");
  assert.equal(textOf(find(state, "state__body")), "This level opens again tomorrow.");
  assert.equal(world.practice.requests.length, 0);
});
