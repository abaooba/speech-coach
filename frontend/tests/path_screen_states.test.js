// Tests for the states the Path screen draws (frontend/screens/path.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 9): a cleared node with its half or
// gold ring and its check-back, due or dated; a resting node; the crown locked, open and earned;
// the checkpoint locked, open, cleared and cleared in the room; the due chip; the week chip;
// and the benchmark, due or dated, with the change since the first sitting. The screen's today
// is Wednesday 14 October 2026 (path-screen-harness.js), unless a test sets another clock.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TODAY,
  mountPath,
  record,
  take,
  miss,
  sitting,
  classOf,
  hasClass,
  all,
  find,
  findAll,
  visible,
  spoken,
  iconsOf,
  unitsOf,
  unitTitled,
  levelNodes,
  crownNode,
  checkpointNode,
  cardOf,
  cardLines,
  stateOf,
} = require("./path-screen-harness");

async function shown(options) {
  const mounted = mountPath(options);
  await mounted.screen.show({});
  return mounted;
}

function fillersLevel(body, number) {
  return levelNodes(unitTitled(body, "Fillers"))[number - 1];
}

function startOf(body, node) {
  return find(cardOf(body, node), "path-card__start");
}

// Records clearing the unit's levels 1 to `through`, a day apart from 1 October.
function clearedThrough(unitId, through) {
  return Array.from({ length: through }, (_, index) =>
    record(unitId + "-" + (index + 1), "2026-10-0" + (index + 1)),
  );
}

// --- cleared levels and their check-backs ----------------------------------------------------

test("a cleared level shows a check, and its card dates the next check-back", async () => {
  const { body } = await shown({ cleared: [record("fillers-1", "2026-10-13")] });
  const node = fillersLevel(body, 1);
  assert.equal(stateOf(node), "cleared");
  assert.deepEqual(iconsOf(find(node, "path-node__circle")), ["check"]);
  assert.equal(find(node, "path-node__badge"), null, "nothing due yet");
  assert.equal(node.getAttribute("aria-label"), "Fillers level 1, Name it, cleared");
  assert.equal(node.getAttribute("aria-expanded"), "false", "only the next step opens itself");
  const next = fillersLevel(body, 2);
  assert.equal(stateOf(next), "current");
  assert.equal(next.getAttribute("aria-expanded"), "true");
  node.click();
  assert.deepEqual(cardLines(cardOf(body, node)), [
    "Cleared Oct 13.",
    "Check-back 1 is due Thursday, Oct 15.",
  ]);
  assert.equal(startOf(body, node), null);
});

test("the path is walked in --ok up to the current node, and grey past it", async () => {
  const cleared = [record("fillers-1", "2026-10-12"), record("fillers-2", "2026-10-13")];
  const { body } = await shown({ cleared });
  const links = findAll(unitTitled(body, "Fillers"), "path-step__link");
  assert.deepEqual(
    links.map((link) => hasClass(link, "path-step__link--walked")),
    [true, true, false, false, false],
  );
  const restarts = findAll(unitTitled(body, "Restarts"), "path-step__link");
  assert.ok(restarts.every((link) => !hasClass(link, "path-step__link--walked")));
});

test("a due check-back adds a clock badge, and the card starts it", async () => {
  const { body, routes } = await shown({ cleared: [record("fillers-1", "2026-10-10")] });
  const node = fillersLevel(body, 1);
  assert.equal(stateOf(node), "cleared");
  assert.ok(hasClass(node, "path-node--due"));
  const badge = find(node, "path-node__badge");
  assert.ok(badge, "the clock badge");
  assert.deepEqual(iconsOf(badge), ["clock"]);
  assert.equal(
    node.getAttribute("aria-label"),
    "Fillers level 1, Name it, cleared, check-back due",
  );
  node.click();
  assert.deepEqual(cardLines(cardOf(body, node)), [
    "Cleared Oct 10.",
    "Check-back 1 is due today.",
  ]);
  const start = startOf(body, node);
  assert.equal(visible(start), "Start");
  assert.equal(start.getAttribute("aria-label"), "Start Fillers, level 1 check-back");
  assert.equal(classOf(start), "btn btn--secondary path-card__start");
  start.click();
  assert.deepEqual(routes, [{ name: "level", id: "fillers-1_checkback" }]);
});

test("a passed first check-back draws the half ring and dates the second", async () => {
  const cleared = [record("fillers-1", "2026-10-10"), record("fillers-1_cb1", "2026-10-12")];
  const { body } = await shown({ cleared });
  const node = fillersLevel(body, 1);
  assert.ok(hasClass(node, "path-node--half"));
  assert.ok(!hasClass(node, "path-node--gold"));
  assert.ok(!hasClass(node, "path-node--due"));
  assert.equal(
    node.getAttribute("aria-label"),
    "Fillers level 1, Name it, cleared, check-back 1 passed",
  );
  node.click();
  assert.deepEqual(cardLines(cardOf(body, node)), [
    "Cleared Oct 10.",
    "Check-back 2 is due Saturday, Oct 17.",
  ]);
  assert.equal(startOf(body, node), null);
});

test("a half-ringed level with its second check-back due starts check-back 2", async () => {
  const cleared = [record("fillers-1", "2026-10-01"), record("fillers-1_cb1", "2026-10-03")];
  const { body, routes } = await shown({ cleared });
  const node = fillersLevel(body, 1);
  assert.ok(hasClass(node, "path-node--half"));
  assert.ok(hasClass(node, "path-node--due"));
  assert.equal(
    node.getAttribute("aria-label"),
    "Fillers level 1, Name it, cleared, check-back 1 passed, check-back due",
  );
  node.click();
  assert.deepEqual(cardLines(cardOf(body, node)), ["Cleared Oct 1.", "Check-back 2 is due today."]);
  startOf(body, node).click();
  assert.deepEqual(routes, [{ name: "level", id: "fillers-1_checkback" }]);
});

test("a level locked in by its second check-back turns gold, and its card says when", async () => {
  const cleared = [
    record("fillers-1", "2026-10-01"),
    record("fillers-1_cb1", "2026-10-03"),
    record("fillers-1_cb2", "2026-10-09"),
  ];
  const { body } = await shown({ cleared });
  const node = fillersLevel(body, 1);
  assert.ok(hasClass(node, "path-node--gold"));
  assert.ok(!hasClass(node, "path-node--half"));
  assert.ok(!hasClass(node, "path-node--due"));
  assert.equal(find(node, "path-node__badge"), null);
  assert.equal(node.getAttribute("aria-label"), "Fillers level 1, Name it, cleared, locked in");
  node.click();
  assert.deepEqual(cardLines(cardOf(body, node)), ["Cleared Oct 1.", "Locked in Oct 9."]);
  assert.equal(startOf(body, node), null);
});

// --- resting --------------------------------------------------------------------------------

test("a level missed three times today rests: a moon, Back tomorrow, and no Start", async () => {
  const sessions = [2, 3, 4].map((number) => miss("fillers-1", TODAY, number));
  const { body } = await shown({ sessions });
  const node = fillersLevel(body, 1);
  assert.equal(stateOf(node), "resting");
  assert.deepEqual(iconsOf(find(node, "path-node__circle")), ["moon"]);
  assert.equal(visible(find(node, "path-node__note")), "Back tomorrow");
  assert.equal(node.getAttribute("aria-label"), "Fillers level 1, Name it, back tomorrow");
  assert.equal(node.getAttribute("aria-expanded"), "false");
  node.click();
  assert.deepEqual(cardLines(cardOf(body, node)), ["This level opens again tomorrow."]);
  assert.equal(startOf(body, node), null);
  const primaries = all(body, (element) => hasClass(element, "btn--primary"));
  assert.equal(primaries.length, 1, "another unit's current level takes the primary Start");
  const inFillers = all(unitTitled(body, "Fillers"), (element) => primaries.includes(element));
  assert.equal(inFillers.length, 0);
});

test("misses on an earlier day leave the level current", async () => {
  const sessions = [2, 3, 4].map((number) => miss("fillers-1", "2026-10-13", number));
  const { body } = await shown({ sessions });
  assert.equal(stateOf(fillersLevel(body, 1)), "current");
  assert.equal(find(fillersLevel(body, 1), "path-node__note"), null);
});

// --- crowns ---------------------------------------------------------------------------------

test("a crown stays locked until level 3 is cleared", async () => {
  const { body } = await shown({ cleared: clearedThrough("fillers", 2) });
  const crown = crownNode(unitTitled(body, "Fillers"));
  assert.equal(stateOf(crown), "locked");
  assert.deepEqual(iconsOf(find(crown, "path-node__circle")), ["crown", "lock"]);
  crown.click();
  assert.deepEqual(cardLines(cardOf(body, crown)), ["Clear level 3 first."]);
  assert.equal(startOf(body, crown), null);
});

test("an open crown names its run, and Start plays it", async () => {
  const { body, routes } = await shown({ cleared: clearedThrough("fillers", 3) });
  const crown = crownNode(unitTitled(body, "Fillers"));
  assert.equal(stateOf(crown), "open");
  assert.equal(crown.getAttribute("aria-label"), "Fillers crown, Sudden death, optional, open");
  assert.equal(crown.getAttribute("aria-expanded"), "false", "a crown is optional");
  crown.click();
  assert.deepEqual(cardLines(cardOf(body, crown)), ["0:30 without a filler or restart."]);
  const start = startOf(body, crown);
  assert.equal(start.getAttribute("aria-label"), "Start Fillers crown");
  start.click();
  assert.deepEqual(routes, [{ name: "level", id: "fillers_crown" }]);
  const pace = await shown({ cleared: clearedThrough("pace", 3) });
  const ladder = crownNode(unitTitled(pace.body, "Pace"));
  ladder.click();
  assert.deepEqual(cardLines(cardOf(pace.body, ladder)), ["170 to 190 wpm, at most 1 restart."]);
});

test("a crown is filled once earned: part of the way, then all of it", async () => {
  const cleared = [
    ...clearedThrough("fillers", 3),
    record("fillers_crown-1", "2026-10-05"),
    record("fillers_crown-2", "2026-10-06"),
  ];
  const { body } = await shown({ cleared });
  const crown = crownNode(unitTitled(body, "Fillers"));
  assert.equal(stateOf(crown), "earned");
  assert.equal(
    crown.getAttribute("aria-label"),
    "Fillers crown, Sudden death, optional, 2 of 5 earned",
  );
  crown.click();
  assert.deepEqual(cardLines(cardOf(body, crown)), [
    "2 of 5 earned. Next: 1:00 without a filler or restart.",
  ]);
  assert.ok(startOf(body, crown));

  const pace = await shown({
    cleared: [...clearedThrough("pace", 3), record("pace_crown-1", "2026-10-05")],
  });
  const ladder = crownNode(unitTitled(pace.body, "Pace"));
  assert.equal(stateOf(ladder), "earned");
  assert.equal(ladder.getAttribute("aria-label"), "Pace crown, 180 wpm ladder, optional, earned");
  ladder.click();
  assert.deepEqual(cardLines(cardOf(pace.body, ladder)), ["Crown earned."]);
  startOf(pace.body, ladder).click();
  assert.deepEqual(pace.routes, [{ name: "level", id: "pace_crown" }]);
});

// --- checkpoints ----------------------------------------------------------------------------

test("a checkpoint stays locked until level 5 is cleared", async () => {
  const { body } = await shown({ cleared: clearedThrough("fillers", 4) });
  const flag = checkpointNode(unitTitled(body, "Fillers"));
  assert.equal(stateOf(flag), "locked");
  assert.deepEqual(iconsOf(find(flag, "path-node__circle")), ["flag"]);
  flag.click();
  assert.deepEqual(cardLines(cardOf(body, flag)), ["Clear level 5 first."]);
  assert.equal(startOf(body, flag), null);
});

test("once every level is cleared the open checkpoint is next, its card open", async () => {
  const { body, routes } = await shown({ cleared: clearedThrough("fillers", 5) });
  const unit = unitTitled(body, "Fillers");
  assert.ok(levelNodes(unit).every((node) => stateOf(node) === "cleared"));
  const flag = checkpointNode(unit);
  assert.equal(stateOf(flag), "open");
  assert.equal(flag.getAttribute("aria-label"), "Fillers checkpoint: 2-minute new topic, open");
  assert.equal(flag.getAttribute("aria-expanded"), "true");
  const card = cardOf(body, flag);
  assert.ok(hasClass(card, "path-card--current"));
  assert.deepEqual(cardLines(card), ["120 s on a new topic."]);
  const start = startOf(body, flag);
  assert.equal(start.getAttribute("aria-label"), "Start Fillers checkpoint");
  start.click();
  assert.deepEqual(routes, [{ name: "level", id: "fillers_checkpoint" }]);
});

test("a cleared checkpoint says when, and in the room when someone listened", async () => {
  const cleared = [...clearedThrough("fillers", 5), record("fillers_checkpoint", "2026-10-12")];
  const { body } = await shown({ cleared });
  const flag = checkpointNode(unitTitled(body, "Fillers"));
  assert.equal(stateOf(flag), "cleared");
  assert.equal(flag.getAttribute("aria-label"), "Fillers checkpoint: 2-minute new topic, cleared");
  assert.equal(flag.getAttribute("aria-expanded"), "false");
  flag.click();
  assert.deepEqual(cardLines(cardOf(body, flag)), ["Cleared Oct 12."]);
  assert.ok(startOf(body, flag), "a checkpoint can be played again");

  cleared.push(record("fillers_checkpoint_room", "2026-10-12"));
  const room = await shown({ cleared });
  const roomFlag = checkpointNode(unitTitled(room.body, "Fillers"));
  assert.equal(
    roomFlag.getAttribute("aria-label"),
    "Fillers checkpoint: 2-minute new topic, cleared in the room",
  );
  roomFlag.click();
  assert.deepEqual(cardLines(cardOf(room.body, roomFlag)), [
    "Cleared Oct 12.",
    "Cleared in the room.",
  ]);
});

// --- the status chips -----------------------------------------------------------------------

function dueChip(body) {
  return find(body, "path__due");
}

test("one due check-back gets a chip naming it, which starts it", async () => {
  const cleared = [
    record("fillers-1", "2026-10-01"),
    record("fillers-1_cb1", "2026-10-03"),
    record("fillers-1_cb2", "2026-10-09"),
    record("fillers-2", "2026-10-10"),
  ];
  const { body, routes } = await shown({ cleared });
  const chip = dueChip(body);
  assert.equal(chip.tagName, "button");
  assert.equal(chip.getAttribute("type"), "button");
  assert.ok(hasClass(chip, "chip"));
  assert.equal(visible(chip), "Due today: 1 check-back: Fillers 2");
  assert.deepEqual(iconsOf(chip), ["clock"]);
  chip.click();
  assert.deepEqual(routes, [{ name: "level", id: "fillers-2_checkback" }]);
});

test("several due check-backs are counted, and the chip starts the first one due", async () => {
  const cleared = [
    record("pace-1", "2026-10-07"),
    record("restarts-1", "2026-10-10"),
    record("fillers-1", "2026-10-11"),
  ];
  const { body, routes } = await shown({ cleared });
  assert.equal(visible(dueChip(body)), "Due today: 3 check-backs");
  dueChip(body).click();
  assert.deepEqual(routes, [{ name: "level", id: "pace-1_checkback" }]);
});

test("with nothing due there is no due chip", async () => {
  const { body } = await shown({ cleared: [record("fillers-1", "2026-10-13")] });
  assert.equal(dueChip(body), null);
  assert.equal(find(body, "path__status").children.length, 1);
});

test("the week chip counts this week's practice days as plain text", async () => {
  const empty = await shown();
  const none = find(empty.body, "path__week");
  assert.equal(none.tagName, "p", "plain text, not a button");
  assert.equal(visible(none), "This week: 0 of 4 days");
  assert.deepEqual(iconsOf(none), ["flame"]);

  const sessions = ["2026-10-11", "2026-10-12", "2026-10-13", TODAY, TODAY].map((day) =>
    take({ day }),
  );
  const three = await shown({ sessions });
  assert.equal(visible(find(three.body, "path__week")), "This week: 3 of 4 days");
});

test("the week chip says the goal is met at 4 days and more", async () => {
  const friday = [2026, 9, 16, 18, 0];
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const four = await shown({ now: friday, sessions: days.slice(0, 4).map((day) => take({ day })) });
  assert.equal(visible(find(four.body, "path__week")), "This week: 4 days, goal met");
  const five = await shown({ now: friday, sessions: days.map((day) => take({ day })) });
  assert.equal(visible(find(five.body, "path__week")), "This week: 5 days, goal met");
});

// --- the benchmark --------------------------------------------------------------------------

test("before any sitting the benchmark card is due, and Start opens it", async () => {
  const { body, routes } = await shown();
  const card = find(body, "path-benchmark");
  assert.equal(card.tagName, "section");
  assert.equal(find(card, "path-benchmark__title").tagName, "h2");
  assert.equal(visible(find(card, "path-benchmark__title")), "Benchmark day");
  assert.deepEqual(findAll(card, "path-benchmark__text").map(visible), ["About 3 minutes"]);
  const start = find(card, "path-benchmark__start");
  assert.equal(start.tagName, "button");
  assert.equal(classOf(start), "btn btn--secondary path-benchmark__start");
  assert.equal(visible(start), "Start");
  assert.equal(start.getAttribute("aria-label"), "Start benchmark");
  start.click();
  assert.deepEqual(routes, [{ name: "level", id: "benchmark" }]);
  assert.equal(find(body, "path__next"), null);
});

test("after a sitting the benchmark is one line naming the next date", async () => {
  const { body } = await shown({ sessions: sitting("2026-10-13") });
  assert.equal(find(body, "path-benchmark"), null);
  assert.equal(visible(find(body, "path__next")), "Next benchmark: Tue, Oct 27");
  assert.equal(find(body, "path__since"), null, "one sitting has nothing to compare");
});

test("with two sittings the line adds the change since the first", async () => {
  const six = [10, 20, 30, 40, 50, 60];
  const sessions = [
    ...sitting("2026-09-20", { restartsAt: six, umsAt: six.map((index) => index + 3) }),
    ...sitting("2026-10-06", { restartsAt: [10, 20], umsAt: [13, 23] }),
  ];
  const { body } = await shown({ sessions });
  assert.equal(visible(find(body, "path__next")), "Next benchmark: Tue, Oct 20");
  const since = find(body, "path__since");
  assert.equal(
    visible(since),
    "Since your first: read slips 6 → 2, fillers 6.0 → 2.0 a minute",
  );
  assert.equal(
    spoken(since),
    "Since your first: read slips 6 to 2, fillers 6.0 to 2.0 a minute",
  );
});

test("the change since the first leaves out a number a sitting lacks", async () => {
  const later = sitting("2026-10-06", { restartsAt: [10, 20], umsAt: [3, 13] });
  delete later[0].metrics.script;
  const sessions = [...sitting("2026-09-20", { restartsAt: [10], umsAt: [3, 13, 23] }), ...later];
  const { body } = await shown({ sessions });
  assert.equal(
    visible(find(body, "path__since")),
    "Since your first: fillers 3.0 → 2.0 a minute",
  );
});

test("14 days after the latest sitting the benchmark card is due again", async () => {
  const { body } = await shown({ sessions: sitting("2026-09-29") });
  assert.ok(find(body, "path-benchmark"));
  assert.equal(find(body, "path__next"), null);
});

test("the benchmark line sits where the card would, before the units", async () => {
  const { body } = await shown({ sessions: sitting("2026-10-13") });
  assert.deepEqual(
    body.children.map((child) => classOf(child)),
    [
      "path__status",
      "path__benchmark",
      "segmented path-switch",
      "path-unit",
      "path-unit",
      "path-unit",
      "path-unit",
    ],
  );
  assert.equal(unitsOf(body).length, 4);
});
