// The Path's Units switch (spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md
// section 5: every unit in sight). Between the benchmark and the units sits the house segmented
// control, a group labeled "Units" of four toggle buttons in app.path.UNITS' fixed order, each
// the unit's name over its level in words ("Level 3 of 5", "All 5 cleared"), with a clock while
// one of its check-backs is due. One unit's block shows at a time and the others are hidden:
// first the one holding the screen's primary Start (the weakest unit that can start), else the
// first in app.path.order. A tap shows another unit and hands its next step the primary Start,
// with no redraw, no focus move and no announcement, and the pick is kept while the app is open.
// The screen runs for real through tests/path-screen-harness.js; the stylesheet is read as text,
// section 13 alone.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TODAY,
  mountPath,
  settle,
  record,
  words,
  take,
  sitting,
  classOf,
  hasClass,
  all,
  find,
  findAll,
  visible,
  iconsOf,
  unitsOf,
  titleOf,
  unitTitled,
  levelNodes,
  checkpointNode,
  cardOf,
  stateOf,
} = require("./path-screen-harness");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION = CSS.slice(CSS.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");

async function shown(options) {
  const mounted = mountPath(options);
  await mounted.screen.show({});
  return mounted;
}

// --- Takes and records ----------------------------------------------------------------------

// A minute of talk with an "um" every sixth word: far over 3 fillers a minute, so Fillers is
// the weakest unit and Pace the next. `fields` adds to the take: a time, a Path take's fields.
function fillerHeavyTake(day, fields = {}) {
  const say = {};
  for (let index = 0; index < 120; index += 6) {
    say[index] = "um";
  }
  return take({ day, transcript: words(120, say), ...fields });
}

// A missed scored take `takeNumber` of the loop `levelId` today, as heavy in fillers.
function fillerHeavyMiss(levelId, takeNumber) {
  return fillerHeavyTake(TODAY, {
    hour: 9,
    minute: takeNumber,
    pathFields: { play: levelId, kind: "loop", take: takeNumber, scored: true, passed: false },
  });
}

// Records clearing the unit's levels 1 to `through` today.
function clearedThrough(unitId, through) {
  return Array.from({ length: through }, (_, index) => record(unitId + "-" + (index + 1), TODAY));
}

// Records finishing the unit today: its five levels and its checkpoint.
function finished(unitId) {
  return clearedThrough(unitId, 5).concat([record(unitId + "_checkpoint", TODAY)]);
}

// --- Reading the switch ---------------------------------------------------------------------

function switchOf(body) {
  return find(body, "path-switch");
}

function optionsOf(body) {
  return switchOf(body).children;
}

function nameOf(option) {
  return visible(find(option, "path-switch__name"));
}

function levelOf(option) {
  return visible(find(option, "path-switch__level"));
}

function optionFor(body, title) {
  const option = optionsOf(body).find((entry) => nameOf(entry) === title);
  if (!option) {
    throw new Error("no option for " + title);
  }
  return option;
}

function pressedTitles(body) {
  return optionsOf(body)
    .filter((option) => option.getAttribute("aria-pressed") === "true")
    .map(nameOf);
}

function shownTitles(body) {
  return unitsOf(body)
    .filter((unit) => unit.hidden !== true)
    .map(titleOf);
}

function primariesOf(body) {
  return all(body, (element) => hasClass(element, "btn--primary"));
}

// The Start on the card of a unit's level 1, its next step while nothing is cleared.
function firstLevelStart(body, title) {
  return find(cardOf(body, levelNodes(unitTitled(body, title))[0]), "path-card__start");
}

// The switch presses the option of `title` alone, its tint following aria-pressed on every
// option, and only that unit's block shows.
function assertShown(body, title) {
  optionsOf(body).forEach((option) => {
    const pressed = option.getAttribute("aria-pressed");
    assert.ok(pressed === "true" || pressed === "false", nameOf(option) + " is a toggle");
    assert.equal(
      hasClass(option, "segmented__option--selected"),
      pressed === "true",
      nameOf(option) + ": the tint follows aria-pressed",
    );
  });
  assert.deepEqual(pressedTitles(body), [title], "one option pressed");
  assert.deepEqual(shownTitles(body), [title], "one unit shows");
}

// --- The stylesheet -------------------------------------------------------------------------

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

function closingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("styles.css has an unbalanced brace");
}

// The section's rules as {at, selector, declarations}, `at` the enclosing @-rule or null.
function parseRules(text, at = null, rules = []) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    const prelude = squash(text.slice(cursor, open));
    const close = closingBrace(text, open);
    const inside = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      parseRules(inside, prelude, rules);
    } else {
      const declarations = {};
      inside.split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
        }
      });
      rules.push({ at, selector: prelude, declarations });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(SECTION);

// The declarations of the one rule with exactly this selector, outside any @-rule unless `at`.
function rule(selector, at = null) {
  const found = RULES.filter((entry) => entry.selector === selector && entry.at === at);
  assert.equal(found.length, 1, "one rule for " + selector + (at ? " in " + at : ""));
  return found[0].declarations;
}

// --- The switch -----------------------------------------------------------------------------

test("the switch sits right before the units: a group of four toggles in UNITS order", async () => {
  const sessions = [fillerHeavyTake("2026-10-13")];
  const { app, root, body } = await shown({ sessions });
  // Array.from brings the vm's array into this realm, so deepEqual compares values alone.
  const order = Array.from(app.path.order(sessions), (pathUnit) => pathUnit.title);
  assert.deepEqual(order, ["Fillers", "Pace", "Restarts", "Long pauses"], "not the fixed order");
  assert.deepEqual(unitsOf(body).map(titleOf), order, "the blocks keep app.path.order");
  const control = switchOf(body);
  const at = body.children.indexOf(control);
  assert.equal(body.children[at - 1], find(body, "path-benchmark"), "after the benchmark");
  assert.equal(body.children[at + 1], unitsOf(body)[0], "right before the first unit");
  assert.equal(control.tagName, "div");
  assert.equal(classOf(control), "segmented path-switch");
  assert.equal(control.getAttribute("role"), "group");
  assert.equal(control.getAttribute("aria-label"), "Units");
  assert.equal(control.children.length, 4, "the four options alone: no heading, no hint");
  control.children.forEach((option) => {
    assert.equal(option.tagName, "button");
    assert.equal(option.getAttribute("type"), "button");
    const classes = classOf(option)
      .split(" ")
      .filter((name) => name !== "segmented__option--selected");
    assert.deepEqual(classes, ["segmented__option", "path-switch__option"]);
    assert.equal(option.getAttribute("aria-controls"), null);
    assert.equal(option.getAttribute("id"), null);
    assert.equal(option.getAttribute("role"), null, "a toggle button, never a tab");
    assert.equal(option.getAttribute("tabindex"), null, "every option is a Tab stop");
  });
  const fixed = Array.from(app.path.UNITS, (pathUnit) => pathUnit.title);
  assert.deepEqual(control.children.map(nameOf), fixed);
  assert.deepEqual(fixed, ["Restarts", "Fillers", "Long pauses", "Pace"]);
  const tabs = all(root, (element) => /^tab/.test(element.getAttribute("role") || ""));
  assert.deepEqual(tabs, [], "no tablist, no tabs");
});

test("each option shows its unit over its level in words, and its name says both", async () => {
  const cleared = [
    record("fillers-1", "2026-10-01"),
    record("fillers-1_cb1", "2026-10-03"),
    record("fillers-1_cb2", "2026-10-09"),
    record("fillers-2", "2026-10-10"),
    record("pace-1", "2026-10-13"),
    ...clearedThrough("long-pauses", 5),
  ];
  const { body } = await shown({ cleared });
  const options = optionsOf(body);
  options.forEach((option) => {
    assert.deepEqual(option.children.map(classOf), ["path-switch__name", "path-switch__level"]);
    assert.ok(option.children.every((part) => part.tagName === "span"));
  });
  assert.deepEqual(options.map(nameOf), ["Restarts", "Fillers", "Long pauses", "Pace"]);
  assert.deepEqual(options.map(levelOf), [
    "Level 1 of 5",
    "Level 3 of 5",
    "All 5 cleared",
    "Level 2 of 5",
  ]);
  assert.deepEqual(
    options.map((option) => option.getAttribute("aria-label")),
    [
      "Restarts, level 1 of 5",
      "Fillers, level 3 of 5, check-back due",
      "Long pauses, all 5 cleared",
      "Pace, level 2 of 5",
    ],
  );
  assert.deepEqual(
    options.map((option) => iconsOf(option)),
    [[], ["clock"], [], []],
    "the clock only where a check-back is due",
  );
  const name = find(optionFor(body, "Fillers"), "path-switch__name");
  const [clock] = name.children;
  assert.equal(clock.getAttribute("data-icon"), "clock", "the clock follows the unit's name");
  assert.equal(clock.getAttribute("aria-hidden"), "true");
  assert.equal(clock.getAttribute("width"), "16");
});

// --- The unit shown first -------------------------------------------------------------------

test("with no takes Restarts shows first, its level 1 Start the one primary", async () => {
  const { body } = await shown();
  assertShown(body, "Restarts");
  assert.deepEqual(optionsOf(body).map(levelOf), [
    "Level 1 of 5",
    "Level 1 of 5",
    "Level 1 of 5",
    "Level 1 of 5",
  ]);
  assert.deepEqual(iconsOf(switchOf(body)), [], "nothing is due");
  const primaries = primariesOf(body);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0], firstLevelStart(body, "Restarts"));
  assert.equal(levelNodes(unitTitled(body, "Restarts"))[0].getAttribute("aria-expanded"), "true");
});

test("the weakest unit shows first: Fillers, after a take heavy in fillers", async () => {
  const sessions = [fillerHeavyTake("2026-10-13")];
  const { app, body } = await shown({ sessions });
  assert.equal(app.path.order(sessions)[0].title, "Fillers");
  assertShown(body, "Fillers");
  const primaries = primariesOf(body);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0], firstLevelStart(body, "Fillers"));
  ["Restarts", "Long pauses", "Pace"].forEach((title) =>
    assert.equal(classOf(firstLevelStart(body, title)), "btn btn--secondary path-card__start"),
  );
});

test("while the weakest unit rests, the next one that can start shows first", async () => {
  const sessions = [2, 3, 4].map((number) => fillerHeavyMiss("fillers-1", number));
  const { app, body } = await shown({ sessions });
  const order = Array.from(app.path.order(sessions), (pathUnit) => pathUnit.title);
  assert.equal(order[0], "Fillers", "the weakest unit");
  assert.equal(stateOf(levelNodes(unitTitled(body, "Fillers"))[0]), "resting");
  const resting = optionFor(body, "Fillers");
  assert.equal(levelOf(resting), "Level 1 of 5", "a resting level keeps its number");
  assertShown(body, order[1]);
  const primaries = primariesOf(body);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0], firstLevelStart(body, order[1]));
});

test("when no unit can start, the first in app.path.order shows, with no primary", async () => {
  const sessions = [fillerHeavyTake("2026-10-13")];
  const cleared = ["restarts", "fillers", "long-pauses", "pace"].flatMap(finished);
  const { app, body } = await shown({ sessions, cleared });
  assert.equal(app.path.order(sessions)[0].title, "Fillers");
  assertShown(body, "Fillers");
  assert.deepEqual(optionsOf(body).map(levelOf), [
    "All 5 cleared",
    "All 5 cleared",
    "All 5 cleared",
    "All 5 cleared",
  ]);
  assert.equal(primariesOf(body).length, 0);
});

// --- A tap ----------------------------------------------------------------------------------

test("a tap shows that unit alone and hands its next step the primary Start", async () => {
  const { body, store, focusLog, live, routes } = await shown();
  assertShown(body, "Restarts");
  const sections = unitsOf(body);
  const reads = store.calls;
  optionFor(body, "Pace").click();
  assertShown(body, "Pace");
  assert.ok(
    unitsOf(body).every((unit, index) => unit === sections[index]),
    "nothing is redrawn",
  );
  assert.equal(store.calls, reads, "nothing is read again");
  const primaries = primariesOf(body);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0], firstLevelStart(body, "Pace"));
  assert.equal(classOf(primaries[0]), "btn btn--primary path-card__start");
  ["Restarts", "Fillers", "Long pauses"].forEach((title) =>
    assert.equal(classOf(firstLevelStart(body, title)), "btn btn--secondary path-card__start"),
  );
  assert.deepEqual(focusLog, [], "focus stays on the tapped option");
  assert.equal(live.textContent, "", "nothing is announced");
  assert.deepEqual(routes, []);
});

test("a tap on the option already pressed changes nothing", async () => {
  const { body, focusLog } = await shown();
  const snapshot = () => ({
    pressed: optionsOf(body).map((option) => option.getAttribute("aria-pressed")),
    classes: optionsOf(body).map(classOf),
    hidden: unitsOf(body).map((unit) => unit.hidden === true),
    starts: findAll(body, "path-card__start").map(classOf),
  });
  const before = snapshot();
  optionFor(body, "Restarts").click();
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(focusLog, []);
});

test("a unit whose next step cannot start shows no primary: resting, or finished", async () => {
  const sessions = [2, 3, 4].map((number) => fillerHeavyMiss("fillers-1", number));
  const { body } = await shown({ sessions, cleared: finished("long-pauses") });
  assert.equal(primariesOf(body).length, 1, "the unit shown first can start");
  optionFor(body, "Fillers").click();
  assertShown(body, "Fillers");
  assert.equal(primariesOf(body).length, 0, "its level rests until tomorrow");
  optionFor(body, "Long pauses").click();
  assertShown(body, "Long pauses");
  assert.equal(levelOf(optionFor(body, "Long pauses")), "All 5 cleared");
  assert.equal(primariesOf(body).length, 0, "its checkpoint is cleared too");
});

test("a finished unit's open checkpoint is its next step, primary once it shows", async () => {
  const { body } = await shown({ cleared: clearedThrough("long-pauses", 5) });
  const option = optionFor(body, "Long pauses");
  assert.equal(levelOf(option), "All 5 cleared");
  assert.equal(option.getAttribute("aria-label"), "Long pauses, all 5 cleared");
  assertShown(body, "Restarts");
  const flag = checkpointNode(unitTitled(body, "Long pauses"));
  const start = find(cardOf(body, flag), "path-card__start");
  assert.equal(start.getAttribute("aria-label"), "Start Long pauses checkpoint");
  assert.equal(classOf(start), "btn btn--secondary path-card__start");
  option.click();
  assertShown(body, "Long pauses");
  const primaries = primariesOf(body);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0], start);
  assert.equal(classOf(start), "btn btn--primary path-card__start");
  assert.equal(classOf(firstLevelStart(body, "Restarts")), "btn btn--secondary path-card__start");
});

test("a hidden unit's cards keep working, and show as they were left", async () => {
  const { body } = await shown();
  const fillers = unitTitled(body, "Fillers");
  assert.equal(fillers.hidden, true, "Restarts shows first");
  const [first, second] = levelNodes(fillers);
  assert.equal(first.getAttribute("aria-expanded"), "true", "its next step's card opened itself");
  second.click();
  assert.equal(cardOf(body, second).hidden, false);
  assert.equal(first.getAttribute("aria-expanded"), "false");
  optionFor(body, "Fillers").click();
  assertShown(body, "Fillers");
  assert.equal(second.getAttribute("aria-expanded"), "true", "the switch leaves the cards alone");
  assert.equal(cardOf(body, second).hidden, false);
});

test("the units stay in the body, each hidden by the hidden property alone", async () => {
  const { body } = await shown({ sessions: [fillerHeavyTake("2026-10-13")] });
  const units = unitsOf(body);
  assert.equal(units.length, 4);
  units.forEach((unit) => {
    assert.equal(unit.tagName, "section");
    assert.equal(classOf(unit), "path-unit", "no modifier class");
    assert.equal(unit.getAttribute("hidden"), null, "the property, never the attribute");
    assert.ok(hasClass(unit.children[0], "path-unit__card"), "the card still heads the block");
  });
  assert.deepEqual(
    units.map((unit) => unit.hidden === true),
    [false, true, true, true],
  );
});

// --- The pick, kept -------------------------------------------------------------------------

test("the pick is kept through a redraw from a changed store and a visit elsewhere", async () => {
  const { body, screen, store } = await shown();
  optionFor(body, "Pace").click();
  store.sessions = [fillerHeavyTake("2026-10-13")];
  await screen.show({});
  assert.deepEqual(
    unitsOf(body).map(titleOf),
    ["Fillers", "Pace", "Restarts", "Long pauses"],
    "redrawn in the new order",
  );
  assertShown(body, "Pace");
  const primaries = primariesOf(body);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0], firstLevelStart(body, "Pace"));
  screen.hide();
  await screen.show({});
  assertShown(body, "Pace");
  assert.equal(store.calls, 3);
});

test("the due chip starts the first check-back due and leaves the pick alone", async () => {
  const cleared = [
    record("pace-1", "2026-10-07"),
    record("restarts-1", "2026-10-10"),
    record("fillers-1", "2026-10-11"),
  ];
  const { body, routes } = await shown({ cleared });
  assert.deepEqual(
    optionsOf(body).map((option) => iconsOf(option)),
    [["clock"], ["clock"], [], ["clock"]],
    "every unit with a check-back due shows the clock",
  );
  assert.deepEqual(
    optionsOf(body).map((option) => option.getAttribute("aria-label")),
    [
      "Restarts, level 2 of 5, check-back due",
      "Fillers, level 2 of 5, check-back due",
      "Long pauses, level 1 of 5",
      "Pace, level 2 of 5, check-back due",
    ],
  );
  optionFor(body, "Long pauses").click();
  find(body, "path__due").click();
  assert.deepEqual(routes, [{ name: "level", id: "pace-1_checkback" }]);
  assertShown(body, "Long pauses");
});

test("with no benchmark due, Try again puts focus on the shown unit's heading", async () => {
  const sessions = sitting("2026-10-13");
  const first = await shown({ sessions, fail: "list" });
  first.store.fail = null;
  find(first.body, "state__action").click();
  await settle();
  assert.equal(find(first.body, "path-benchmark"), null, "no benchmark is due");
  const lead = first.app.path.order(sessions)[0].title;
  assertShown(first.body, lead);
  const leadTitle = find(unitTitled(first.body, lead), "path-unit__title");
  assert.equal(first.focusLog[first.focusLog.length - 1], leadTitle, "the unit shown first");
  assert.equal(leadTitle.getAttribute("tabindex"), "-1");

  const picked = await shown({ sessions });
  optionFor(picked.body, "Long pauses").click();
  picked.store.fail = "list";
  await picked.screen.show({});
  picked.store.fail = null;
  find(picked.body, "state__action").click();
  await settle();
  assertShown(picked.body, "Long pauses");
  const pickedTitle = find(unitTitled(picked.body, "Long pauses"), "path-unit__title");
  assert.equal(picked.focusLog[picked.focusLog.length - 1], pickedTitle, "the unit picked");
  assert.equal(pickedTitle.getAttribute("tabindex"), "-1");
});

// --- Its stylesheet -------------------------------------------------------------------------

test("the options sit two by two, four in a row from 600px, one column under 240px", () => {
  const control = rule(".path-switch");
  assert.equal(control["grid-auto-flow"], "row");
  assert.equal(control["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(control["margin-bottom"], "var(--s-3)");
  assert.equal(
    rule(".path-switch", "@media (min-width: 600px)")["grid-template-columns"],
    "repeat(4, minmax(0, 1fr))",
  );
  assert.equal(
    rule(".path-switch", "@media (max-width: 239px)")["grid-template-columns"],
    "minmax(0, 1fr)",
  );
});

test("an option is a 56px target, its name in --text over its level in --muted", () => {
  const option = rule(".path-switch__option");
  assert.equal(option.display, "flex");
  assert.equal(option["flex-direction"], "column");
  assert.equal(option["min-height"], "56px");
  assert.equal(option.padding, "var(--s-2)");
  assert.equal(option["text-align"], "center");
  const name = rule(".path-switch__name");
  assert.equal(name.color, "var(--text)");
  assert.equal(name["font-size"], "var(--fs-body)");
  assert.equal(name["font-weight"], "600");
  assert.equal(rule(".segmented__option--selected .path-switch__name").color, "var(--accent)");
  assert.equal(rule(".path-switch__name svg").color, "var(--muted)", "the clock is no warning");
  const level = rule(".path-switch__level");
  assert.equal(level.color, "var(--muted)");
  assert.equal(level["font-size"], "var(--fs-small)");
  assert.equal(level["font-variant-numeric"], "tabular-nums");
});

test("a hidden unit takes no room, and no rule spaces one unit from the next", () => {
  assert.equal(rule(".path-unit[hidden]").display, "none");
  assert.ok(
    RULES.every((entry) => !entry.selector.includes(".path-unit + .path-unit")),
    "a hidden unit before the shown one would push it down",
  );
});

test("the switch is the house control, restyled only through .path-switch; it never sticks", () => {
  const selectors = RULES.flatMap((entry) => entry.selector.split(",").map((part) => part.trim()));
  const segmented = selectors.filter((selector) => selector.includes("segmented"));
  assert.ok(segmented.length > 0);
  segmented.forEach((selector) => assert.match(selector, /path-switch/, selector));
  assert.doesNotMatch(SECTION, /sticky/);
});
