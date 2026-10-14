// The crown stays where it was tapped (spec docs/superpowers/specs/2026-10-14-loop-path.md
// section 9: the crown is a small node beside level 3 whose tap opens its card). The crown and
// its card sit in level 3's side column, under level 3's card. When tapping the crown closed
// level 3's open card, the crown moved up by that card's height and its own card opened where
// level 3's had been: 114px in headless Chrome at 320 and 640px wide. So the crown's card opens
// and closes on its own, and the unit's levels and checkpoint keep theirs one at a time.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mountPath,
  record,
  all,
  hasClass,
  unitTitled,
  levelNodes,
  crownNode,
  checkpointNode,
  cardOf,
  cardLines,
  press,
} = require("./path-screen-harness");

async function shown(options) {
  const mounted = mountPath(options);
  await mounted.screen.show({});
  return mounted;
}

function cleared(...ids) {
  return ids.map((id) => record(id, "2026-10-12"));
}

// The side column that holds the crown (the fake DOM keeps no parentNode).
function columnOf(body, crown) {
  const columns = all(
    body,
    (element) => hasClass(element, "path-step__side") && element.children.includes(crown),
  );
  assert.equal(columns.length, 1, "the crown sits in one side column");
  return columns[0];
}

// Which elements of the crown's side column are shown, in order: a card is shown unless hidden.
function shownInColumn(body, crown) {
  return columnOf(body, crown).children.map((element) => element.hidden !== true);
}

// Everything before the crown in its column, and whether it is hidden: what can move the crown.
function aboveCrown(body, crown) {
  const { children } = columnOf(body, crown);
  return children.slice(0, children.indexOf(crown)).map((element) => ({
    element,
    hidden: element.hidden === true,
  }));
}

test("tapping the crown leaves level 3's open card above it, so the crown does not move", async () => {
  const { body } = await shown({ cleared: cleared("fillers-1", "fillers-2") });
  const fillers = unitTitled(body, "Fillers");
  const level3 = levelNodes(fillers)[2];
  const crown = crownNode(fillers);
  assert.equal(level3.getAttribute("aria-expanded"), "true", "level 3 is next: its card is open");
  const before = aboveCrown(body, crown);
  assert.deepEqual(
    before.map(({ element }) => element),
    [cardOf(body, level3)],
    "level 3's card is the only thing above the crown in its column",
  );

  crown.click();
  assert.deepEqual(aboveCrown(body, crown), before, "nothing above the crown opened or closed");
  assert.equal(level3.getAttribute("aria-expanded"), "true");
  assert.equal(crown.getAttribute("aria-expanded"), "true");
  assert.deepEqual(cardLines(cardOf(body, crown)), ["Clear level 3 first."]);
  assert.deepEqual(
    shownInColumn(body, crown),
    [true, true, true],
    "level 3's card, the crown, its card",
  );

  crown.click();
  assert.equal(crown.getAttribute("aria-expanded"), "false", "a second tap closes the crown's card");
  assert.equal(cardOf(body, crown).hidden, true);
  assert.deepEqual(aboveCrown(body, crown), before, "and leaves level 3's card as it was");
});

test("an open crown's card opens under it, whichever card the unit has open", async () => {
  const { body } = await shown({ cleared: cleared("fillers-1", "fillers-2", "fillers-3") });
  const fillers = unitTitled(body, "Fillers");
  const [, , level3, level4] = levelNodes(fillers);
  const crown = crownNode(fillers);
  level3.click();
  assert.equal(cardOf(body, level3).hidden, false, "level 3's cleared card, opened by a tap");
  const before = aboveCrown(body, crown);
  crown.click();
  assert.deepEqual(aboveCrown(body, crown), before);
  assert.equal(crown.getAttribute("aria-expanded"), "true");
  assert.deepEqual(cardLines(cardOf(body, crown)), ["0:30 without a filler or restart."]);
  assert.equal(level4.getAttribute("aria-expanded"), "false", "level 3's tap closed level 4's");
});

test("tapping a level or the checkpoint leaves the crown's card as it is", async () => {
  const { body } = await shown({ cleared: cleared("fillers-1", "fillers-2", "fillers-3") });
  const fillers = unitTitled(body, "Fillers");
  const levels = levelNodes(fillers);
  const crown = crownNode(fillers);
  crown.click();
  [levels[4], checkpointNode(fillers), levels[0]].forEach((node) => {
    node.click();
    assert.equal(node.getAttribute("aria-expanded"), "true");
    assert.equal(crown.getAttribute("aria-expanded"), "true", "the crown's card stays open");
    assert.equal(cardOf(body, crown).hidden, false);
  });
  assert.equal(levels[4].getAttribute("aria-expanded"), "false", "the steps keep one at a time");
  assert.equal(checkpointNode(fillers).getAttribute("aria-expanded"), "false");
});

test("Escape closes the crown's card and returns focus to the crown, and nothing else", async () => {
  const { body, focusLog } = await shown({ cleared: cleared("pace-1", "pace-2") });
  const pace = unitTitled(body, "Pace");
  const level3 = levelNodes(pace)[2];
  const crown = crownNode(pace);
  crown.click();
  press(cardOf(body, crown), "Escape");
  assert.equal(cardOf(body, crown).hidden, true);
  assert.equal(crown.getAttribute("aria-expanded"), "false");
  assert.equal(focusLog[focusLog.length - 1], crown);
  assert.equal(level3.getAttribute("aria-expanded"), "true", "level 3's card is still open");
});
