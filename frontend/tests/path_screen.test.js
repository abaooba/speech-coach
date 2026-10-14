// Tests for the Path screen, frontend/screens/path.js (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 9): the winding layout's pure helpers,
// the units in app.path.order, each unit's card and its nodes as an ordered list of buttons,
// the card each node opens (the current one open from the start), Escape, one primary button,
// the first draw, a redraw on every show, the shared error state and no rank anywhere. The
// states a node can be in are in path_screen_states.test.js. Both run the real ui.js,
// passages.js, delivery.js, path.js and loop.js through path-screen-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mountPath,
  settle,
  record,
  words,
  take,
  miss,
  sitting,
  classOf,
  hasClass,
  all,
  findAll,
  find,
  visible,
  spoken,
  everything,
  iconsOf,
  unitsOf,
  titleOf,
  unitTitled,
  nodesOf,
  levelNodes,
  crownNode,
  checkpointNode,
  cardOf,
  cardLines,
  stateOf,
  press,
} = require("./path-screen-harness");

const SVG_NS = "http://www.w3.org/2000/svg";

// A minute of talk on Impromptu with an "um" every sixth word: far over 3 fillers a minute, so
// Fillers is the weakest unit; at about 100 wpm, Pace comes next.
function fillerHeavyTake(day) {
  const say = {};
  for (let index = 0; index < 120; index += 6) {
    say[index] = "um";
  }
  return take({ day, transcript: words(120, say) });
}

async function shown(options) {
  const mounted = mountPath(options);
  await mounted.screen.show({});
  return mounted;
}

// --- the winding layout ----------------------------------------------------------------------

test("nodeX alternates the levels left and right of centre and centres the checkpoint", () => {
  const { screen } = mountPath();
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((index) => screen.nodeX(index, 6)),
    [25, 75, 25, 75, 25, 50],
  );
  assert.deepEqual(
    [0, 1, 2].map((index) => screen.nodeX(index, 3)),
    [25, 75, 50],
  );
});

test("dropD runs straight down under a node", () => {
  const { screen } = mountPath();
  assert.equal(screen.dropD(25), "M25 0 L25 100");
  assert.equal(screen.dropD(75), "M75 0 L75 100");
});

test("linkD turns from one node's column into the next, straight down at both ends", () => {
  const { screen } = mountPath();
  assert.equal(screen.linkD(25, 75), "M25 0 C25 25 75 25 75 50 L75 100");
  assert.equal(screen.linkD(75, 25), "M75 0 C75 25 25 25 25 50 L25 100");
  assert.equal(screen.linkD(25, 50), "M25 0 C25 25 50 25 50 50 L50 100");
});

// The two parts of a link: an SVG in the 100 by 100 box, stretched, drawing one path.
function linkPart(svg, className) {
  assert.equal(svg.tagName, "svg");
  assert.equal(svg.namespaceURI, SVG_NS);
  assert.equal(svg.getAttribute("class"), className);
  assert.equal(svg.getAttribute("viewBox"), "0 0 100 100");
  assert.equal(svg.getAttribute("preserveAspectRatio"), "none");
  assert.equal(svg.children.length, 1);
  const [line] = svg.children;
  assert.equal(line.tagName, "path");
  assert.equal(line.namespaceURI, SVG_NS);
  assert.equal(line.getAttribute("vector-effect"), "non-scaling-stroke");
  return line.getAttribute("d");
}

test("each unit's steps wind left and right, joined by dropD and linkD paths", async () => {
  const { screen, body } = await shown();
  for (const unit of unitsOf(body)) {
    const list = find(unit, "path-steps");
    assert.equal(list.tagName, "ol");
    assert.equal(list.getAttribute("role"), "list", "the role survives list-style: none");
    assert.equal(list.getAttribute("aria-label"), titleOf(unit) + " levels");
    const steps = list.children;
    assert.ok(steps.every((step) => step.tagName === "li"));
    assert.deepEqual(
      steps.map((step) => classOf(step)),
      [
        "path-step path-step--left",
        "path-step path-step--right",
        "path-step path-step--left",
        "path-step path-step--right",
        "path-step path-step--left",
        "path-step path-step--center",
      ],
    );
    const xs = steps.map((_, index) => screen.nodeX(index, steps.length));
    steps.forEach((step, index) => {
      const links = findAll(step, "path-step__link");
      if (index === steps.length - 1) {
        assert.equal(links.length, 0, "the checkpoint ends the path");
        return;
      }
      assert.equal(links.length, 1);
      const [link] = links;
      assert.equal(step.children[0], link, "the link is drawn first, behind the node");
      assert.equal(link.getAttribute("aria-hidden"), "true");
      assert.equal(link.children.length, 2, "a drop under the node, then a turn");
      const [drop, turn] = link.children;
      assert.equal(linkPart(drop, "path-step__drop"), screen.dropD(xs[index]));
      assert.equal(linkPart(turn, "path-step__turn"), screen.linkD(xs[index], xs[index + 1]));
    });
  }
});

// --- the units ------------------------------------------------------------------------------

test("with no takes every unit shows, each level 1 current with its card open", async () => {
  const { body } = await shown();
  const units = unitsOf(body);
  assert.deepEqual(units.map(titleOf), ["Restarts", "Fillers", "Long pauses", "Pace"]);
  for (const unit of units) {
    const levels = levelNodes(unit);
    assert.deepEqual(levels.map(stateOf), ["current", "locked", "locked", "locked", "locked"]);
    assert.equal(levels[0].getAttribute("aria-expanded"), "true");
    assert.equal(cardOf(body, levels[0]).hidden, false);
    levels.slice(1).forEach((node) => {
      assert.equal(node.getAttribute("aria-expanded"), "false");
      assert.equal(cardOf(body, node).hidden, true);
    });
    assert.equal(stateOf(checkpointNode(unit)), "locked");
    const crown = crownNode(unit);
    if (crown) {
      assert.equal(stateOf(crown), "locked");
    }
  }
  assert.equal(crownNode(unitTitled(body, "Restarts")), null, "Restarts has no crown");
  assert.equal(crownNode(unitTitled(body, "Long pauses")), null, "Long pauses has no crown");
});

test("the units follow app.path.order: the weakest first", async () => {
  const history = [fillerHeavyTake("2026-10-13")];
  const { app, body } = await shown({ sessions: history });
  // Array.from brings the vm's array into this realm, so deepEqual compares values alone.
  const expected = Array.from(app.path.order(history), (pathUnit) => pathUnit.title);
  assert.deepEqual(expected, ["Fillers", "Pace", "Restarts", "Long pauses"], "not the default");
  assert.deepEqual(unitsOf(body).map(titleOf), expected);
});

test("each unit card holds its h2 title, subtitle and why line, linked to its source", async () => {
  const { app, body } = await shown();
  for (const unit of unitsOf(body)) {
    const data = app.path.UNITS.find((pathUnit) => pathUnit.title === titleOf(unit));
    const card = find(unit, "path-unit__card");
    assert.ok(card, "the unit card heads the block");
    assert.equal(unit.children[0], card);
    assert.equal(find(card, "path-unit__title").tagName, "h2");
    assert.equal(visible(find(card, "path-unit__subtitle")), data.subtitle);
    const why = find(card, "path-unit__why");
    assert.equal(visible(why), data.why.text + " " + data.why.label);
    const link = find(why, "path-unit__source");
    assert.equal(link.tagName, "a");
    assert.equal(link.getAttribute("href"), data.why.url);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener");
    assert.equal(visible(link), data.why.label);
    assert.equal(spoken(link), data.why.label + ", opens in a new tab");
  }
});

test("every node is a button named for its unit, level, title and state", async () => {
  const { body } = await shown();
  const fillers = unitTitled(body, "Fillers");
  const nodes = nodesOf(fillers);
  assert.ok(nodes.every((node) => node.tagName === "button"));
  assert.ok(nodes.every((node) => node.getAttribute("type") === "button"));
  assert.deepEqual(
    nodes.map((node) => node.getAttribute("aria-label")),
    [
      "Fillers level 1, Name it, current",
      "Fillers level 2, Spot it, locked",
      "Fillers level 3, Catch it live, locked",
      "Fillers crown, Sudden death, optional, locked",
      "Fillers level 4, Pause instead, locked",
      "Fillers level 5, New topic, locked",
      "Fillers checkpoint: 2-minute new topic, locked",
    ],
  );
  assert.deepEqual(
    nodes.map((node) => visible(find(node, "path-node__label"))),
    [
      "Name it",
      "Spot it",
      "Catch it live",
      "Sudden death, optional",
      "Pause instead",
      "New topic",
      "Checkpoint: 2-minute new topic",
    ],
  );
  const restarts = nodesOf(unitTitled(body, "Restarts")).map((node) =>
    node.getAttribute("aria-label"),
  );
  assert.deepEqual(restarts, [
    "Restarts level 1, Read it 3 times, current",
    "Restarts level 2, Read it 3 times, locked",
    "Restarts level 3, Read it twice, locked",
    "Restarts level 4, Read it twice, locked",
    "Restarts level 5, Say it twice, locked",
    "Restarts checkpoint: 2-minute new topic, locked",
  ]);
  const pace = crownNode(unitTitled(body, "Pace"));
  assert.equal(pace.getAttribute("aria-label"), "Pace crown, 180 wpm ladder, optional, locked");
});

test("each node controls its own card, right after it; the crown sits beside level 3", async () => {
  const { body } = await shown();
  const fillers = unitTitled(body, "Fillers");
  const ids = nodesOf(fillers).map((node) => node.getAttribute("aria-controls"));
  assert.equal(new Set(ids).size, ids.length, "one card per node");
  const steps = find(fillers, "path-steps").children;
  const third = steps[2];
  const side = find(third, "path-step__side");
  const [levelNode] = findAll(third, "path-node");
  assert.equal(levelNode.getAttribute("aria-label"), "Fillers level 3, Catch it live, locked");
  const crown = crownNode(fillers);
  assert.deepEqual(side.children, [
    cardOf(body, levelNode),
    crown,
    cardOf(body, crown),
  ]);
  steps.forEach((step) => {
    const [node] = findAll(step, "path-node");
    const stepSide = find(step, "path-step__side");
    assert.equal(stepSide.children[0], cardOf(body, node), "the card comes right after its node");
  });
});

// --- cards ----------------------------------------------------------------------------------

test("the current node's card shows its short goal, and Start opens the level", async () => {
  const { body, routes } = await shown();
  const goals = unitsOf(body).map((unit) => cardLines(cardOf(body, levelNodes(unit)[0])));
  assert.deepEqual(goals, [
    ["4 slips or fewer"],
    ["Halfway to 8 /min"],
    ["15 s clean"],
    ["150 wpm, twice"],
  ]);
  const fillersCard = cardOf(body, levelNodes(unitTitled(body, "Fillers"))[0]);
  assert.ok(hasClass(fillersCard, "path-card--current"));
  const start = find(fillersCard, "path-card__start");
  assert.equal(start.tagName, "button");
  assert.equal(visible(start), "Start");
  assert.equal(start.getAttribute("aria-label"), "Start Fillers, level 1");
  start.click();
  assert.deepEqual(routes, [{ name: "level", id: "fillers-1" }]);
});

test("the Path has one primary button: Start on the weakest unit's current level", async () => {
  const { body } = await shown({ sessions: [fillerHeavyTake("2026-10-13")] });
  const primaries = all(body, (element) => hasClass(element, "btn--primary"));
  assert.equal(primaries.length, 1);
  const fillersCard = cardOf(body, levelNodes(unitsOf(body)[0])[0]);
  assert.equal(titleOf(unitsOf(body)[0]), "Fillers");
  assert.equal(find(fillersCard, "path-card__start"), primaries[0]);
  const others = unitsOf(body)
    .slice(1)
    .map((unit) => find(cardOf(body, levelNodes(unit)[0]), "path-card__start"));
  others.forEach((start) => assert.equal(classOf(start), "btn btn--secondary path-card__start"));
});

test("Fillers level 1's short goal follows the speaker's usual fillers", async () => {
  const history = [fillerHeavyTake("2026-10-13")];
  const { app, body } = await shown({ sessions: history });
  const expected = app.path.playById("fillers-1", {
    baseline: app.path.baseline(history),
    cleared: [],
  }).goal.short;
  assert.notEqual(expected, "Halfway to 8 /min");
  assert.match(expected, /^\d+(\.\d)? or fewer \/min$/);
  assert.deepEqual(cardLines(cardOf(body, levelNodes(unitTitled(body, "Fillers"))[0])), [
    expected,
  ]);
});

test("a tap opens a node's card, closing the unit's open one; a second tap closes it", async () => {
  const { body } = await shown();
  const fillers = unitTitled(body, "Fillers");
  const [first, second] = levelNodes(fillers);
  second.click();
  assert.equal(second.getAttribute("aria-expanded"), "true");
  const card = cardOf(body, second);
  assert.equal(card.hidden, false);
  assert.deepEqual(cardLines(card), ["Clear level 1 first."]);
  assert.equal(find(card, "path-card__start"), null, "a locked level cannot start");
  assert.ok(!hasClass(card, "path-card--current"));
  assert.equal(first.getAttribute("aria-expanded"), "false", "one card at a time in a unit");
  assert.equal(cardOf(body, first).hidden, true);
  const restartsFirst = levelNodes(unitTitled(body, "Restarts"))[0];
  assert.equal(restartsFirst.getAttribute("aria-expanded"), "true", "other units keep theirs");
  second.click();
  assert.equal(second.getAttribute("aria-expanded"), "false");
  assert.equal(card.hidden, true);
  first.click();
  assert.equal(first.getAttribute("aria-expanded"), "true");
  assert.equal(cardOf(body, first).hidden, false);
});

test("a level card points at its node: right of a left node, left of a right one", async () => {
  const { body } = await shown();
  const fillers = unitTitled(body, "Fillers");
  const [first, second] = levelNodes(fillers);
  assert.ok(hasClass(cardOf(body, first), "path-card--point-left"));
  assert.ok(hasClass(cardOf(body, second), "path-card--point-right"));
  assert.ok(hasClass(cardOf(body, crownNode(fillers)), "path-card--point-up"));
  assert.ok(hasClass(cardOf(body, checkpointNode(fillers)), "path-card--point-up"));
});

test("Escape closes an open card and returns focus to its node", async () => {
  const { body, focusLog } = await shown();
  const fillers = unitTitled(body, "Fillers");
  const [first, second] = levelNodes(fillers);
  const card = cardOf(body, first);
  press(card, "Enter");
  assert.equal(card.hidden, false, "only Escape closes it");
  press(card, "Escape");
  assert.equal(card.hidden, true);
  assert.equal(first.getAttribute("aria-expanded"), "false");
  assert.equal(focusLog[focusLog.length - 1], first);

  second.click();
  press(second, "Escape");
  assert.equal(cardOf(body, second).hidden, true, "Escape on the node closes its card too");
  assert.equal(second.getAttribute("aria-expanded"), "false");

  const before = focusLog.length;
  press(cardOf(body, second), "Escape");
  press(first, "Escape");
  assert.equal(focusLog.length, before, "Escape with no card open moves nothing");
  assert.equal(cardOf(body, first).hidden, true);
});

test("circles and labels are drawn for the eye; the button's name speaks for them", async () => {
  const { body } = await shown();
  const fillers = unitTitled(body, "Fillers");
  const [current, locked] = levelNodes(fillers);
  const circle = find(current, "path-node__circle");
  assert.equal(circle.getAttribute("aria-hidden"), "true");
  assert.equal(visible(circle), "1");
  assert.deepEqual(iconsOf(find(locked, "path-node__circle")), ["lock"]);
  assert.deepEqual(iconsOf(find(crownNode(fillers), "path-node__circle")), ["crown"]);
  assert.deepEqual(iconsOf(find(checkpointNode(fillers), "path-node__circle")), ["flag"]);
  assert.equal(find(current, "path-node__label").getAttribute("aria-hidden"), "true");
});

// --- drawing --------------------------------------------------------------------------------

test("the body holds the status row, the benchmark, then one block per unit", async () => {
  const { body, root, heading } = await shown();
  assert.deepEqual(root.children, [heading, body], "the h1 is left alone");
  assert.equal(heading.textContent, "Path");
  assert.deepEqual(
    body.children.map((child) => classOf(child)),
    ["path__status", "path-benchmark", "path-unit", "path-unit", "path-unit", "path-unit"],
  );
  assert.ok(unitsOf(body).every((unit) => unit.tagName === "section"));
});

test("the first show says the Path is loading until the store answers", async () => {
  const mounted = mountPath();
  mounted.store.hold = true;
  const showing = mounted.screen.show({});
  const block = find(mounted.body, "state");
  assert.ok(block, "a loading block, not a blank screen");
  assert.ok(hasClass(block, "state--loading"));
  assert.equal(visible(find(block, "state__title")), "Loading your path");
  mounted.store.release();
  await showing;
  assert.equal(find(mounted.body, "state"), null);
  assert.equal(unitsOf(mounted.body).length, 4);
});

test("every show redraws from the store, keeping the last drawing until the new one", async () => {
  const mounted = await shown();
  const { store, screen, body } = mounted;
  assert.equal(stateOf(levelNodes(unitTitled(body, "Fillers"))[0]), "current");
  store.cleared = [record("fillers-1", "2026-10-13")];
  store.hold = true;
  const showing = screen.show({});
  assert.equal(find(body, "state"), null, "no loading block over a drawn path");
  assert.equal(unitsOf(body).length, 4);
  store.release();
  await showing;
  const levels = levelNodes(unitTitled(body, "Fillers"));
  assert.deepEqual(levels.slice(0, 2).map(stateOf), ["cleared", "current"]);
  assert.equal(store.calls, 2);
});

test("hide drops a draw still on its way", async () => {
  const mounted = await shown();
  const { store, screen, body } = mounted;
  const before = levelNodes(unitTitled(body, "Fillers"))[0];
  store.cleared = [record("fillers-1", "2026-10-13")];
  store.hold = true;
  const showing = screen.show({});
  screen.hide();
  store.release();
  await showing;
  assert.equal(levelNodes(unitTitled(body, "Fillers"))[0], before, "nothing was redrawn");
});

test("when the takes cannot be read the Path shows the shared error state", async () => {
  for (const fail of ["list", "cleared"]) {
    const { body, store, focusLog } = await shown({ fail });
    assert.equal(body.children.length, 1);
    const block = body.children[0];
    assert.ok(hasClass(block, "state"));
    assert.ok(hasClass(block, "state--error"));
    assert.equal(block.getAttribute("role"), "alert");
    assert.equal(visible(find(block, "state__title")), "Path unavailable");
    assert.equal(visible(find(block, "state__body")), "Could not load your path. Try again.");
    const retry = find(block, "state__action");
    assert.equal(visible(retry), "Try again");
    store.fail = null;
    retry.click();
    await settle();
    assert.equal(unitsOf(body).length, 4, "Try again draws the path");
    const firstHeading = find(body, "path-benchmark__title");
    assert.equal(focusLog[focusLog.length - 1], firstHeading, "focus lands on the first heading");
    assert.equal(firstHeading.getAttribute("tabindex"), "-1");
  }
});

// --- no rank --------------------------------------------------------------------------------

test("no rank, tier or rating appears anywhere on the Path", async () => {
  const cleared = [
    record("fillers-1", "2026-10-01"),
    record("fillers-1_cb1", "2026-10-03"),
    record("fillers-1_cb2", "2026-10-09"),
    record("fillers-2", "2026-10-05"),
    record("fillers-3", "2026-10-06"),
    record("fillers_crown-1", "2026-10-07"),
    record("fillers_crown-2", "2026-10-08"),
    record("pace-1", "2026-10-02"),
    record("pace-2", "2026-10-03"),
    record("pace-3", "2026-10-04"),
    record("pace_crown-1", "2026-10-05"),
    record("pace-4", "2026-10-06"),
    record("pace-5", "2026-10-07"),
    record("pace_checkpoint", "2026-10-08"),
    record("pace_checkpoint_room", "2026-10-08"),
    record("restarts-1", "2026-10-12"),
  ];
  const sessions = [
    ...sitting("2026-09-20", { restartsAt: [10, 20, 30], umsAt: [5, 25] }),
    ...sitting("2026-10-06", { restartsAt: [10], umsAt: [5] }),
    miss("long-pauses-1", "2026-10-14", 2),
    miss("long-pauses-1", "2026-10-14", 3),
    miss("long-pauses-1", "2026-10-14", 4),
    fillerHeavyTake("2026-10-13"),
  ];
  const { body } = await shown({ sessions, cleared });
  unitsOf(body).forEach((unit) => nodesOf(unit).forEach((node) => node.click()));
  const words = everything(body);
  assert.match(words, /Locked in/, "the rich state is drawn");
  assert.match(words, /2 of 5 earned/);
  assert.doesNotMatch(words, /rank|tier|rating|Novice|Contender|Varsity/i);
});
