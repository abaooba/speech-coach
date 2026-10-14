/* screens/path.js: app.screens.path (#/path), the Loop Path's map (spec
   docs/superpowers/specs/2026-10-14-loop-path.md section 9): this week's practice days, the
   check-backs due today and the benchmark, then one block per unit, weakest first, whose levels
   wind down the page as node buttons that each open a small card. app.path decides every state
   and app.loop writes the dates; this file only draws them. nodeX, dropD and linkD lay out the
   path. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // --- The winding path ------------------------------------------------------------------------

  // Where nodes sit across a unit's path, in percent of its width: the levels alternate left and
  // right of centre, starting left, and the checkpoint that ends the unit sits in the centre.
  const LEFT_X = 25;
  const RIGHT_X = 75;
  const CENTER_X = 50;
  // A link runs from one node's centre to the next one's in two parts, each drawn in a 100 by
  // 100 box the stylesheet stretches: a straight drop under the node to the foot of its row,
  // however tall an open card makes the row, then a turn whose box spans the row's --s-6 foot
  // and the next node's top half. --s-6 is 32px, a level's half height, so the foot is the box's
  // top half: the turn crosses to the next node's column there, in the gap between the rows, and
  // drops straight into the node. Crossing only in that gap, a link never runs through a card or
  // the crown beside a node, nor behind the next node's card, which starts at the top of its row.
  const LINK_BOX = "0 0 100 100";
  const LINK_FOOT_MIDDLE_Y = 25;
  const LINK_FOOT_END_Y = 50;
  const LINK_END_Y = 100;
  // A row's class for the side its node sits on, and how the node's card points at it: a card
  // beside a left node points left, beside a right node right, and under its node (the
  // checkpoint's, the crown's) up.
  const SIDES = { [LEFT_X]: "left", [RIGHT_X]: "right", [CENTER_X]: "center" };
  const POINTERS = { [LEFT_X]: "point-left", [RIGHT_X]: "point-right", [CENTER_X]: "point-up" };
  const POINT_UP = "point-up";

  // --- States and plays ------------------------------------------------------------------------

  // A level's states as app.path.statusOf names them, and the two a crown or a checkpoint adds:
  // open (it can be played and is not done yet) and, for a crown, earned.
  const CLEARED = "cleared";
  const CURRENT = "current";
  const LOCKED = "locked";
  const RESTING = "resting";
  const OPEN = "open";
  const EARNED = "earned";
  // app.path.ringOf's rings for a cleared level: none, half (its first check-back passed) and
  // gold (its second passed: locked in).
  const NO_RING = "none";
  const HALF_RING = "half";
  const GOLD_RING = "gold";
  const DUE = "due";
  // The node kinds, which are also their class modifiers.
  const LEVEL_NODE = "level";
  const CROWN_NODE = "crown";
  const CHECKPOINT_NODE = "checkpoint";

  // Every Start opens the Level screen on a play id (spec section 1): a level's own id, its
  // check-back's ("fillers-3_checkback"), a crown's or a checkpoint's id from app.path, or the
  // benchmark's.
  const LEVEL_SCREEN = "level";
  const CHECKBACK_PLAY_SUFFIX = "_checkback";
  const BENCHMARK_PLAY = "benchmark";
  // The record a level's second passed check-back keeps, the day it turned gold (spec section 1).
  const LOCKED_IN_RECORD_SUFFIX = "_cb2";
  // A unit's crown sits beside this level, and opens once it is cleared.
  const CROWN_BESIDE_LEVEL = 3;

  // --- Copy (spec section 9) -------------------------------------------------------------------

  const WEEK_PREFIX = "This week: ";
  const DUE_PREFIX = "Due today: ";
  const BENCHMARK_TITLE = "Benchmark day";
  const BENCHMARK_BODY = "Same passage, same prompt, every 14 days. See your real progress.";
  const BENCHMARK_START = "Start benchmark";
  const NEXT_BENCHMARK_PREFIX = "Next benchmark: ";
  const SINCE_FIRST_PREFIX = "Since your first: ";
  // A change since the first sitting reads "6 → 2", and a screen reader hears "6 to 2".
  const CHANGE_ARROW = "→";
  const CHANGE_ARROW_SPOKEN = "to";
  const NEW_TAB_NOTE = ", opens in a new tab";
  const LEVELS_LIST_SUFFIX = " levels";
  const RESTING_NOTE = "Back tomorrow";
  const RESTING_CARD = "This level opens again tomorrow.";
  const START = "Start";
  const CROWN_EARNED = "Crown earned.";
  const CLEARED_IN_THE_ROOM = "Cleared in the room.";
  // A node's state in its accessible name, where the words differ from the state's own.
  const STATE_WORDS = { [RESTING]: "back tomorrow" };
  const LOADING_TITLE = "Loading your path";
  const LOADING_BODY = "This takes a moment.";
  const ERROR_TITLE = "Path unavailable";
  const ERROR_BODY = "Could not load your path. Try again.";
  const RETRY = "Try again";
  // Fillers a minute are shown to a tenth, as everywhere else ("2.0").
  const RATE_DECIMALS = 1;

  // Icon sizes: a level's 64px circle holds a 28px check or a 22px lock or moon, a crown's or a
  // checkpoint's 48px circle a 20px icon, the due badge a 14px clock, and a chip a 16px icon.
  const CHECK_ICON_SIZE = 28;
  const LEVEL_ICON_SIZE = 22;
  const SMALL_NODE_ICON_SIZE = 20;
  const BADGE_ICON_SIZE = 14;
  const CHIP_ICON_SIZE = 16;

  const ESCAPE_KEY = "Escape";
  const CARD_ID_PREFIX = "path-card-";

  // The screen's .screen__body; every show() redraws everything inside it.
  let body = null;

  // Counts show() calls, so a slow store read from an earlier visit never paints over a newer
  // one, and a draw still on its way when the screen hides is dropped.
  let showCount = 0;

  // True while a drawn path is on screen: a later show() keeps it up until the new one is
  // ready, where the first one (or one after an error) says the path is loading.
  let pathDrawn = false;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  function show() {
    return draw(++showCount, false);
  }

  // Leaving the screen drops a draw still on its way. Nothing else to release: show() redraws
  // the body from the store every time.
  function hide() {
    showCount += 1;
  }

  // --- The winding layout (pure) ---------------------------------------------------------------

  // Where the step at `index` of a unit's `count` steps sits across its path, in percent of the
  // path's width: the levels alternate left and right of centre, starting left, and the last
  // step, the checkpoint that ends the unit, sits in the centre.
  function nodeX(index, count) {
    if (index === count - 1) {
      return CENTER_X;
    }
    return index % 2 === 0 ? LEFT_X : RIGHT_X;
  }

  // A link's drop under a node at `x`, as an SVG path's `d` in the 100 by 100 link box: x in
  // percent of the row, y 0 at the node's centre and 100 at the foot of its row.
  function dropD(x) {
    return "M" + x + " 0 L" + x + " " + LINK_END_Y;
  }

  // A link's turn from a node at `fromX` into the next one at `toX`, as an SVG path's `d` in
  // the 100 by 100 link box: y 0 at the top of the first node's row foot, 50 at the foot's end
  // (the top of the next row) and 100 at the next node's centre. It leaves straight down and
  // crosses inside the foot, an S when the two sit on opposite sides, then drops straight into
  // the next node.
  function linkD(fromX, toX) {
    const middle = " " + LINK_FOOT_MIDDLE_Y + " ";
    const crossing = "C" + fromX + middle + toX + middle + toX + " " + LINK_FOOT_END_Y;
    return "M" + fromX + " 0 " + crossing + " L" + toX + " " + LINK_END_Y;
  }

  // --- Drawing ---------------------------------------------------------------------------------

  // Reads the takes and the cleared records, then draws the path from them, unless a newer
  // show() started meanwhile or the screen was left. A store that fails, or takes that cannot
  // be drawn, show the shared error state, never a blank screen. `moveFocus` (Try again, whose
  // button the redraw removes) puts focus on the new content's first heading.
  async function draw(ticket, moveFocus) {
    if (!pathDrawn) {
      renderLoading(moveFocus);
    }
    let drawing;
    try {
      const [takes, cleared] = await Promise.all([
        app.store.list(),
        app.store.listClearedLevels(),
      ]);
      if (ticket !== showCount) {
        return;
      }
      drawing = buildPath(readPath(listOf(takes), listOf(cleared), app.path.localDay(new Date())));
    } catch {
      if (ticket === showCount) {
        renderError(moveFocus);
      }
      return;
    }
    app.ui.clear(body);
    drawing.parts.forEach((part) => body.appendChild(part));
    pathDrawn = true;
    if (moveFocus) {
      focusHeading(drawing.firstHeading);
    }
  }

  function renderLoading(moveFocus) {
    const block = app.ui.renderState(body, {
      kind: "loading",
      title: LOADING_TITLE,
      body: LOADING_BODY,
    });
    pathDrawn = false;
    if (moveFocus) {
      focusHeading(block.querySelector(".state__title"));
    }
  }

  function renderError(moveFocus) {
    const block = app.ui.renderState(body, {
      kind: "error",
      title: ERROR_TITLE,
      body: ERROR_BODY,
      actionLabel: RETRY,
      onAction: () => draw(++showCount, true),
    });
    pathDrawn = false;
    if (moveFocus) {
      focusHeading(block.querySelector(".state__title"));
    }
  }

  // What the path shows, read from app.path once per draw: `takes` as app.store.list() gives
  // them, `cleared` as app.store.listClearedLevels() does, and `today` the local day.
  function readPath(takes, cleared, today) {
    const checkbacks = app.path.checkbacks(cleared, takes, today);
    return {
      takes,
      cleared,
      today,
      baseline: app.path.baseline(takes),
      units: app.path.order(takes),
      week: app.path.weekDays(takes, today),
      benchmark: app.path.benchmarkState(takes, today),
      due: checkbacks.filter((entry) => entry.due),
      checkbackOf: new Map(checkbacks.map((entry) => [entry.levelId, entry])),
      clearedOn: clearedDays(cleared),
    };
  }

  // The local day each cleared record was kept on, by record id, for the cards' dates.
  function clearedDays(cleared) {
    const days = new Map();
    cleared.forEach((entry) => {
      if (entry && typeof entry.levelId === "string") {
        days.set(entry.levelId, app.path.localDay(entry.clearedAt));
      }
    });
    return days;
  }

  // The status row, the benchmark, then the units, weakest first: {parts, firstHeading}.
  // `drawing` hands the one primary button to the first Start drawn on an open card, the
  // weakest unit's next step, and keeps the first heading for focus.
  function buildPath(view) {
    const drawing = { primaryTaken: false, firstHeading: null, parts: [] };
    drawing.parts.push(buildStatus(view));
    const benchmark = buildBenchmark(view.benchmark, drawing);
    if (benchmark !== null) {
      drawing.parts.push(benchmark);
    }
    view.units.forEach((pathUnit) => drawing.parts.push(buildUnit(pathUnit, view, drawing)));
    return drawing;
  }

  // Keeps the first h2 drawn, where focus goes after Try again.
  function heading(drawing, element) {
    if (drawing.firstHeading === null) {
      drawing.firstHeading = element;
    }
    return element;
  }

  // --- The status row and the benchmark --------------------------------------------------------

  // This week's practice days, as plain text, and, when check-backs are due, a chip that starts
  // the first one due. Each icon follows its words and is drawn first by the stylesheet.
  function buildStatus(view) {
    const items = [
      app.ui.el("p", { class: "path__week", text: weekText(view.week) }, chipIcon("flame")),
    ];
    if (view.due.length > 0) {
      const first = view.due[0];
      items.push(
        app.ui.el(
          "button",
          {
            class: "chip path__due",
            type: "button",
            text: dueText(view.due),
            onClick: () => startPlay(first.levelId + CHECKBACK_PLAY_SUFFIX),
          },
          chipIcon("clock"),
        ),
      );
    }
    return app.ui.el("div", { class: "path__status" }, items);
  }

  // "This week: 3 of 4 days", or "This week: 5 days, goal met" at the goal and past it.
  function weekText(week) {
    if (week.days >= week.goal) {
      return WEEK_PREFIX + week.days + " days, goal met";
    }
    return WEEK_PREFIX + week.days + " of " + week.goal + " days";
  }

  // "Due today: 1 check-back: Fillers 2", or "Due today: 3 check-backs".
  function dueText(due) {
    if (due.length === 1) {
      const level = app.path.levelById(due[0].levelId);
      return DUE_PREFIX + "1 check-back: " + unitTitleOf(level.unit) + " " + level.number;
    }
    return DUE_PREFIX + due.length + " check-backs";
  }

  // The benchmark: a card when it is due; otherwise the next date and, from a second sitting,
  // the change since the first. With no sitting at all it is always due.
  function buildBenchmark(state, drawing) {
    if (state.due) {
      const play = app.path.playById(BENCHMARK_PLAY);
      const title = app.ui.el("h2", { class: "path-benchmark__title", text: BENCHMARK_TITLE });
      return app.ui.el("section", { class: "path-benchmark" }, [
        heading(drawing, title),
        app.ui.el("p", { class: "path-benchmark__text", text: BENCHMARK_BODY }),
        app.ui.el("p", { class: "path-benchmark__text", text: play.goal.length }),
        app.ui.el("button", {
          class: "btn btn--secondary path-benchmark__start",
          type: "button",
          text: BENCHMARK_START,
          onClick: () => startPlay(BENCHMARK_PLAY),
        }),
      ]);
    }
    if (state.sittings.length === 0) {
      return null;
    }
    const next = NEXT_BENCHMARK_PREFIX + app.loop.dateText(state.nextOn, "short");
    const lines = [app.ui.el("p", { class: "path__next", text: next })];
    const since = sinceFirstLine(state.sittings);
    if (since !== null) {
      lines.push(since);
    }
    return app.ui.el("div", { class: "path__benchmark" }, lines);
  }

  // "Since your first: read slips 6 → 2, fillers 5.1 → 2.4 a minute", from the first sitting to
  // the latest. A number either sitting lacks (a read off its passage, a talk not recorded) is
  // left out; null under two sittings, or with nothing to compare.
  function sinceFirstLine(sittings) {
    if (sittings.length < 2) {
      return null;
    }
    const first = sittings[0];
    const latest = sittings[sittings.length - 1];
    const changes = [];
    if (isNumber(first.readSlips) && isNumber(latest.readSlips)) {
      changes.push(changeParts("read slips ", first.readSlips, latest.readSlips, ""));
    }
    if (isNumber(first.fillersPerMinute) && isNumber(latest.fillersPerMinute)) {
      const from = first.fillersPerMinute.toFixed(RATE_DECIMALS);
      const to = latest.fillersPerMinute.toFixed(RATE_DECIMALS);
      changes.push(changeParts("fillers ", from, to, " a minute"));
    }
    if (changes.length === 0) {
      return null;
    }
    const children = [SINCE_FIRST_PREFIX];
    changes.forEach((parts, index) => {
      if (index > 0) {
        children.push(", ");
      }
      children.push(...parts);
    });
    return app.ui.el("p", { class: "path__since" }, children);
  }

  // "read slips 6 → 2" as parts: the arrow is drawn, and a screen reader hears "to" instead.
  function changeParts(label, from, to, unit) {
    return [
      label + from + " ",
      app.ui.el("span", { "aria-hidden": "true", text: CHANGE_ARROW }),
      app.ui.el("span", { class: "sr-only", text: CHANGE_ARROW_SPOKEN }),
      " " + to + unit,
    ];
  }

  // --- A unit ----------------------------------------------------------------------------------

  // One unit: its card, then its levels and checkpoint as an ordered list winding down the page,
  // the crown beside level 3. Each node opens its own card. The levels and the checkpoint open
  // theirs one at a time in a unit; the unit's next step (its current level, or once every level
  // is cleared its open checkpoint) has its card open from the start. The crown opens and closes
  // its card on its own: it sits under level 3's card, and closing that card as the crown's
  // opened would pull the crown up from under the finger.
  function buildUnit(pathUnit, view, drawing) {
    const cards = oneCardAtATime();
    const steps = pathUnit.levels
      .map((level) => levelStep(pathUnit, level, view))
      .concat([checkpointStep(pathUnit, view)]);
    const next = nextStepOf(steps);
    const items = steps.map((step, index) => {
      const x = nodeX(index, steps.length);
      const isNext = step === next;
      const primary = takePrimary(drawing, isNext && step.card.start !== null);
      const pair = buildPair(step, POINTERS[x], isNext, primary, cards);
      const beside = [];
      if (pathUnit.crown && step.number === CROWN_BESIDE_LEVEL) {
        const crownCard = oneCardAtATime();
        const crown = buildPair(crownStep(pathUnit, view), POINT_UP, false, false, crownCard);
        beside.push(crown.node, crown.card);
      }
      const link =
        index + 1 < steps.length
          ? buildLink(x, nodeX(index + 1, steps.length), step.state === CLEARED)
          : null;
      return app.ui.el("li", { class: "path-step path-step--" + SIDES[x] }, [
        link,
        pair.node,
        app.ui.el("div", { class: "path-step__side" }, [pair.card].concat(beside)),
      ]);
    });
    const title = app.ui.el("h2", { class: "path-unit__title", text: pathUnit.title });
    return app.ui.el("section", { class: "path-unit" }, [
      app.ui.el("div", { class: "path-unit__card" }, [
        heading(drawing, title),
        app.ui.el("p", { class: "path-unit__subtitle", text: pathUnit.subtitle }),
        buildWhy(pathUnit.why),
      ]),
      // The list role survives list-style: none in Safari, so VoiceOver still counts the steps.
      app.ui.el(
        "ol",
        { class: "path-steps", role: "list", "aria-label": pathUnit.title + LEVELS_LIST_SUFFIX },
        items,
      ),
    ]);
  }

  // The unit's "why this works" line, then its source as a link that opens in a new tab, with
  // rel="noopener" so the page it opens gets no handle on this one.
  function buildWhy(why) {
    return app.ui.el("p", { class: "path-unit__why" }, [
      why.text + " ",
      app.ui.el(
        "a",
        {
          class: "path-unit__source",
          href: why.url,
          target: "_blank",
          rel: "noopener",
          text: why.label,
        },
        app.ui.el("span", { class: "sr-only", text: NEW_TAB_NOTE }),
      ),
    ]);
  }

  // The step whose card is open from the start: the unit's current level or, once every level
  // is cleared, its open checkpoint; null when the next level rests or the unit is done.
  function nextStepOf(steps) {
    const levels = steps.filter((step) => step.kind === LEVEL_NODE);
    const current = levels.find((step) => step.state === CURRENT);
    if (current) {
      return current;
    }
    const checkpoint = steps[steps.length - 1];
    const allCleared = levels.every((step) => step.state === CLEARED);
    return allCleared && checkpoint.state === OPEN ? checkpoint : null;
  }

  // Whether a Start is the screen's one primary button: the first one asked for, on an open
  // card, which is the weakest unit's next step.
  function takePrimary(drawing, wanted) {
    if (!wanted || drawing.primaryTaken) {
      return false;
    }
    drawing.primaryTaken = true;
    return true;
  }

  // --- The steps -------------------------------------------------------------------------------

  // A step is what one node and its card show: {id, kind, number, state, modifiers, name, label,
  // note, circle, badge, card}, `name` the node's accessible name, `circle` what its circle
  // holds and `card` {lines, start, startName}, `start` the play its Start opens or null.

  function levelStep(pathUnit, level, view) {
    const state = app.path.statusOf(level, view.cleared, view.takes, view.today);
    const isCleared = state === CLEARED;
    const ring = isCleared ? app.path.ringOf(level.id, view.cleared) : NO_RING;
    const checkback = isCleared ? view.checkbackOf.get(level.id) || null : null;
    const due = checkback !== null && checkback.due;
    return {
      id: level.id,
      kind: LEVEL_NODE,
      number: level.number,
      state,
      modifiers: [ring === NO_RING ? null : ring, due ? DUE : null].filter(Boolean),
      name: levelName(pathUnit, level, state, ring, due),
      label: level.title,
      note: state === RESTING ? RESTING_NOTE : null,
      circle: levelCircle(level, state),
      badge: due,
      card: levelCard(level, state, ring, checkback, view),
    };
  }

  // "Fillers level 2, Spot it, cleared, check-back due".
  function levelName(pathUnit, level, state, ring, due) {
    const words = [pathUnit.title + " level " + level.number, level.title, stateWords(state)];
    if (ring === HALF_RING) {
      words.push("check-back 1 passed");
    } else if (ring === GOLD_RING) {
      words.push("locked in");
    }
    if (due) {
      words.push("check-back due");
    }
    return words.join(", ");
  }

  // The current level shows its number; a cleared one a check; a resting one a moon; a locked
  // one a lock.
  function levelCircle(level, state) {
    if (state === CURRENT) {
      return app.ui.el("span", { class: "path-node__number num", text: String(level.number) });
    }
    if (state === CLEARED) {
      return app.ui.icon("check", CHECK_ICON_SIZE);
    }
    return app.ui.icon(state === RESTING ? "moon" : "lock", LEVEL_ICON_SIZE);
  }

  // Locked: what clears the way. Resting: when it opens. Current: its short goal and Start.
  // Cleared: when, then its next check-back, due today with a Start or dated, or when it was
  // locked in.
  function levelCard(level, state, ring, checkback, view) {
    if (state === LOCKED) {
      return textCard(["Clear level " + (level.number - 1) + " first."]);
    }
    if (state === RESTING) {
      return textCard([RESTING_CARD]);
    }
    if (state === CURRENT) {
      const play = app.path.playById(level.id, { baseline: view.baseline, cleared: view.cleared });
      return startCard([play.goal.short], level.id);
    }
    const lines = [onDay("Cleared", view.clearedOn.get(level.id))];
    if (ring === GOLD_RING) {
      lines.push(onDay("Locked in", view.clearedOn.get(level.id + LOCKED_IN_RECORD_SUFFIX)));
      return textCard(lines);
    }
    if (checkback === null) {
      return textCard(lines);
    }
    const name = "Check-back " + checkback.stage;
    if (checkback.due) {
      lines.push(name + " is due today.");
      return startCard(lines, level.id + CHECKBACK_PLAY_SUFFIX);
    }
    lines.push(name + " is due " + app.loop.dateText(checkback.dueOn, "long") + ".");
    return textCard(lines);
  }

  // The crown beside level 3: locked until level 3 is cleared, then open, then earned once a
  // run (sudden death) or the ladder is.
  function crownStep(pathUnit, view) {
    const crown = app.path.crownState(pathUnit.id, view.cleared);
    let state = OPEN;
    if (!crown.open) {
      state = LOCKED;
    } else if (crown.earned > 0) {
      state = EARNED;
    }
    let words = state;
    if (state === EARNED && !crown.complete) {
      words = earnedCount(crown);
    }
    return {
      id: crown.id,
      kind: CROWN_NODE,
      number: null,
      state,
      modifiers: [],
      name: pathUnit.title + " crown, " + crown.label + ", " + words,
      label: crown.label,
      note: null,
      circle: app.ui.icon("crown", SMALL_NODE_ICON_SIZE),
      badge: false,
      card: crownCard(crown, state, view),
    };
  }

  // "2 of 5 earned": how much of a crown with more than one run is earned.
  function earnedCount(crown) {
    return crown.earned + " of " + crown.tiers.length + " earned";
  }

  // Locked: what opens it. Open: the next run's goal ("0:30 without a filler or restart"), and
  // part earned, how much first. Earned in full: "Crown earned." Every open crown has a Start.
  function crownCard(crown, state, view) {
    if (state === LOCKED) {
      return textCard(["Clear level " + CROWN_BESIDE_LEVEL + " first."]);
    }
    if (crown.complete) {
      return startCard([CROWN_EARNED], crown.id);
    }
    const goal = app.path.playById(crown.id, { cleared: view.cleared }).goal;
    const run = goal.headline + " " + goal.unitLabel + ".";
    return startCard([state === EARNED ? earnedCount(crown) + ". Next: " + run : run], crown.id);
  }

  // The checkpoint after level 5: locked until level 5 is cleared, then open, then cleared,
  // perhaps in the room.
  function checkpointStep(pathUnit, view) {
    const checkpoint = app.path.checkpointState(pathUnit.id, view.cleared);
    let state = LOCKED;
    if (checkpoint.cleared) {
      state = CLEARED;
    } else if (checkpoint.open) {
      state = OPEN;
    }
    const words = state === CLEARED && checkpoint.inRoom ? "cleared in the room" : state;
    return {
      id: checkpoint.id,
      kind: CHECKPOINT_NODE,
      number: null,
      state,
      modifiers: [],
      name: pathUnit.title + " " + lowerFirst(checkpoint.label) + ", " + words,
      label: checkpoint.label,
      note: null,
      circle: app.ui.icon("flag", SMALL_NODE_ICON_SIZE),
      badge: false,
      card: checkpointCard(pathUnit, checkpoint, state, view),
    };
  }

  // Locked: what opens it. Open: how long it lasts. Cleared: when, and in the room when someone
  // listened. Every open checkpoint has a Start, so one cleared alone can be cleared in the room.
  function checkpointCard(pathUnit, checkpoint, state, view) {
    if (state === LOCKED) {
      return textCard(["Clear level " + pathUnit.levels.length + " first."]);
    }
    if (state === OPEN) {
      return startCard([app.path.playById(checkpoint.id).goal.length + "."], checkpoint.id);
    }
    const lines = [onDay("Cleared", view.clearedOn.get(checkpoint.id))];
    if (checkpoint.inRoom) {
      lines.push(CLEARED_IN_THE_ROOM);
    }
    return startCard(lines, checkpoint.id);
  }

  function textCard(lines) {
    return { lines, start: null, startName: null };
  }

  // A card whose Start opens `playId`; the button's name says which play ("Start Fillers, level
  // 3"), since the Path holds several Starts.
  function startCard(lines, playId) {
    return { lines, start: playId, startName: app.path.playById(playId).heading };
  }

  // "Cleared Oct 14.", or "Cleared." for a record whose day cannot be read.
  function onDay(words, day) {
    const date = app.loop.dateText(day);
    return date ? words + " " + date + "." : words + ".";
  }

  function stateWords(state) {
    return STATE_WORDS[state] || state;
  }

  // --- Nodes, cards and links ------------------------------------------------------------------

  // A step's node button and its card. The button's name says everything its circle and label
  // show, which are hidden from screen readers; aria-expanded and aria-controls tie it to the
  // card, which `cards` opens and closes.
  function buildPair(step, pointer, startOpen, primary, cards) {
    const cardId = CARD_ID_PREFIX + step.id;
    const classes = ["path-node", "path-node--" + step.kind, "path-node--" + step.state].concat(
      step.modifiers.map((modifier) => "path-node--" + modifier),
    );
    const node = app.ui.el(
      "button",
      {
        class: classes.join(" "),
        type: "button",
        "aria-label": step.name,
        "aria-expanded": "false",
        "aria-controls": cardId,
      },
      [
        app.ui.el("span", { class: "path-node__circle", "aria-hidden": "true" }, [
          step.circle,
          step.badge ? buildBadge() : null,
        ]),
        app.ui.el("span", { class: "path-node__label", "aria-hidden": "true", text: step.label }),
        step.note === null
          ? null
          : app.ui.el("span", { class: "path-node__note", "aria-hidden": "true", text: step.note }),
      ],
    );
    const pair = { node, card: buildCard(cardId, step.card, pointer, startOpen, primary) };
    cards.add(pair, startOpen);
    return pair;
  }

  // The small clock on a cleared level whose check-back is due.
  function buildBadge() {
    return app.ui.el("span", { class: "path-node__badge" }, app.ui.icon("clock", BADGE_ICON_SIZE));
  }

  // A node's card: its lines, then Start when it has a play to start, primary only for the
  // screen's one primary action. The next step's card is tinted, and every card points at its
  // node.
  function buildCard(id, card, pointer, isNext, primary) {
    const children = card.lines.map((line) =>
      app.ui.el("p", { class: "path-card__text", text: line }),
    );
    if (card.start !== null) {
      const variant = primary ? "btn--primary" : "btn--secondary";
      children.push(
        app.ui.el("button", {
          class: "btn " + variant + " path-card__start",
          type: "button",
          "aria-label": START + " " + card.startName,
          text: START,
          onClick: () => startPlay(card.start),
        }),
      );
    }
    const classes = ["path-card", "path-card--" + pointer].concat(
      isNext ? ["path-card--current"] : [],
    );
    return app.ui.el("div", { class: classes.join(" "), id }, children);
  }

  // A group of cards, one open at a time (a unit's steps, or a crown alone): opening a node's
  // card closes the group's one open before it, a second tap on its node closes it, and each
  // node's aria-expanded follows its card. Escape closes the open card: pressed on its node,
  // focus stays there; pressed inside the card, focus goes back to its node.
  function oneCardAtATime() {
    let openPair = null;

    function setOpen(pair, isOpen) {
      pair.card.hidden = !isOpen;
      pair.node.setAttribute("aria-expanded", String(isOpen));
    }

    function open(pair) {
      if (openPair !== null && openPair !== pair) {
        setOpen(openPair, false);
      }
      setOpen(pair, true);
      openPair = pair;
    }

    function close(pair) {
      setOpen(pair, false);
      if (openPair === pair) {
        openPair = null;
      }
    }

    function closeOnEscape(pair, refocus) {
      return (event) => {
        if (event.key !== ESCAPE_KEY || openPair !== pair) {
          return;
        }
        close(pair);
        if (refocus) {
          focusIfPossible(pair.node);
        }
      };
    }

    function add(pair, startOpen) {
      setOpen(pair, false);
      pair.node.addEventListener("click", () => (openPair === pair ? close(pair) : open(pair)));
      pair.node.addEventListener("keydown", closeOnEscape(pair, false));
      pair.card.addEventListener("keydown", closeOnEscape(pair, true));
      if (startOpen) {
        open(pair);
      }
    }

    return { add };
  }

  // The link from one node down to the next, behind both: its drop, then its turn (see
  // LINK_BOX), in --ok once the first node is cleared (the path walked so far), else in --grid.
  function buildLink(fromX, toX, walked) {
    const className = "path-step__link" + (walked ? " path-step__link--walked" : "");
    return app.ui.el("span", { class: className, "aria-hidden": "true" }, [
      buildLinkPart("path-step__drop", dropD(fromX)),
      buildLinkPart("path-step__turn", linkD(fromX, toX)),
    ]);
  }

  // One part of a link: a path in the 100 by 100 box, stretched to the part's place by the
  // stylesheet, its stroke keeping its width however it is stretched.
  function buildLinkPart(className, d) {
    const svg = svgElement("svg", {
      class: className,
      viewBox: LINK_BOX,
      preserveAspectRatio: "none",
      focusable: "false",
    });
    svg.appendChild(svgElement("path", { d, "vector-effect": "non-scaling-stroke" }));
    return svg;
  }

  // SVG elements need their own namespace and take class via setAttribute.
  function svgElement(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  function chipIcon(name) {
    return app.ui.icon(name, CHIP_ICON_SIZE);
  }

  // --- Helpers ---------------------------------------------------------------------------------

  function startPlay(playId) {
    app.router.go(LEVEL_SCREEN, { id: playId });
  }

  function unitTitleOf(unitId) {
    return app.path.UNITS.find((pathUnit) => pathUnit.id === unitId).title;
  }

  function lowerFirst(text) {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  // Focus on a heading that is not a Tab stop (tabindex="-1"), so its words are read.
  function focusHeading(element) {
    if (!element) {
      return;
    }
    element.setAttribute("tabindex", "-1");
    focusIfPossible(element);
  }

  // Moves keyboard focus when the node can take it; the test fakes have no focus().
  function focusIfPossible(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  app.screens.path = { mount, show, hide, nodeX, dropD, linkD };
})();
