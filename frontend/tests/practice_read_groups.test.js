// Tests for Practice's Read groups (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md sections 2.1 and 2.3): the Read
// tab shows one chip per group app.passages.groups() lists, labeled with the group's label, and a
// passage of no listed group keeps a chip of its own; a tap on a group chip (the selected one or
// another) draws a passage of the group; the card's New topic button reads New passage on the
// Read tab and draws another passage of the group, shown when the group holds two or more; the
// Read tab opens on a drawn passage of its first group. A draw is app.path.pickPassage over the
// speaker's takes and the passages shown since the app opened when path.js is loaded, and
// otherwise any passage of the group but the one on screen, at random. The harness is
// practice-harness.js; a `random` stub fixes every draw.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYSIS,
  flush,
  parts,
  plain,
  realGroups,
  realPassages,
  setup,
} = require("./practice-harness");

const GROUPS = [
  { id: "explainer", label: "Explainer" },
  { id: "story", label: "Story" },
  { id: "speech", label: "Speech" },
  { id: "drill", label: "Drill" },
];

const TALK = {
  id: "day",
  kind: "prompt",
  title: "Your day",
  text: "First topic.",
  topics: ["First topic.", "Second topic.", "Third topic."],
  targetWpm: [140, 160],
  timeLimitSeconds: 60,
};

// A Read passage of `group`, or of none when `group` is null.
function passage(id, title, group) {
  const entry = { id, kind: "passage", title, text: title + " text.", targetWpm: [150, 170] };
  return group === null ? entry : { ...entry, group };
}

// The Read tab's data: groups of one, two and three, a passage of no group, and one whose group
// groups() does not list.
const PASSAGES = [
  TALK,
  passage("explainer-one", "Explainer: one", "explainer"),
  passage("story-one", "Story: one", "story"),
  passage("speech-one", "Speech one", "speech"),
  passage("speech-two", "Speech two", "speech"),
  passage("speech-three", "Speech three", "speech"),
  passage("loose", "Loose passage", null),
  passage("drill-one", "Drill: one", "drill"),
  passage("poem", "A poem", "poems"),
  passage("drill-two", "Drill: two", "drill"),
];

const SPEECH_IDS = ["speech-one", "speech-two", "speech-three"];

// A random source that returns `value`, which a test may change between taps, and counts how
// often it was asked.
function drawOf(value) {
  const draw = () => {
    draw.calls += 1;
    return draw.value;
  };
  draw.value = value;
  draw.calls = 0;
  return draw;
}

// Practice on the data above with its groups, shown on the Read tab.
function onRead(options = {}) {
  const t = setup({ passages: PASSAGES, groups: GROUPS, random: drawOf(0), ...options });
  parts(t).read.click();
  return t;
}

function visibleChips(t) {
  return parts(t).chips.filter((chip) => !chip.hidden);
}

function groupChip(t, id) {
  return parts(t).chips.find((chip) => chip.dataset.group === id);
}

function shownId(t) {
  return t.practice.selectedPassage().id;
}

function pressed(t) {
  return visibleChips(t)
    .filter((chip) => chip.getAttribute("aria-pressed") === "true")
    .map((chip) => chip.textContent);
}

// A saved take that read `passageId`.
function readOn(passageId, createdAt = "2026-10-22T10:00:00.000Z") {
  return {
    id: "take-" + passageId,
    createdAt,
    passageId,
    passageTitle: passageId,
    durationSeconds: 40,
    metrics: { pauses: [] },
    transcript: [],
  };
}

const STOP_GRACE_MS = 500;

async function saveTake(t) {
  t.clock.advance(STOP_GRACE_MS);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
}

// --- The chips --------------------------------------------------------------------------------

test("the Read tab shows one chip per group in groups() order, then one per other passage", () => {
  const t = onRead();
  assert.deepEqual(
    visibleChips(t).map((chip) => chip.textContent),
    ["Explainer", "Story", "Speech", "Drill", "Loose passage", "A poem"],
  );
  assert.deepEqual(
    visibleChips(t).map((chip) => chip.dataset.group || null),
    ["explainer", "story", "speech", "drill", null, null],
  );
  assert.deepEqual(
    visibleChips(t).map((chip) => chip.dataset.passageId || null),
    [null, null, null, null, "loose", "poem"],
  );
  assert.equal(parts(t).chips.length, 7, "one Talk chip and six Read chips");
});

// groups() decides the Read tab's order (spec section 2.3), whatever order the data lists the
// passages in: here Drill's and Speech's come first and a passage of no group before them all.
test("the group chips follow groups(), not the data's order, and Read opens on the first", () => {
  const ofGroup = (id) => PASSAGES.filter((entry) => entry.group === id);
  const loose = PASSAGES.filter((entry) => entry.id === "loose");
  const reordered = [
    TALK,
    ...loose,
    ...ofGroup("drill"),
    ...ofGroup("speech"),
    ...ofGroup("story"),
    ...ofGroup("explainer"),
  ];
  const t = setup({ passages: reordered, groups: GROUPS, random: drawOf(0) });
  parts(t).read.click();
  assert.deepEqual(
    visibleChips(t).map((chip) => chip.textContent),
    ["Explainer", "Story", "Speech", "Drill", "Loose passage"],
  );
  assert.equal(shownId(t), "explainer-one", "the first group's passage, not the data's first");
  assert.deepEqual(pressed(t), ["Explainer"]);
});

test("a group groups() lists but no passage names gets no chip; Read opens on the next", () => {
  const withoutExplainer = PASSAGES.filter((entry) => entry.group !== "explainer");
  const t = setup({ passages: withoutExplainer, groups: GROUPS, random: drawOf(0) });
  parts(t).read.click();
  assert.deepEqual(
    visibleChips(t).map((chip) => chip.textContent),
    ["Story", "Speech", "Drill", "Loose passage", "A poem"],
  );
  assert.equal(shownId(t), "story-one");
  assert.deepEqual(pressed(t), ["Story"]);
});

test("a group chip is a toggle button like the others, named by the group's label", () => {
  const t = onRead();
  for (const group of GROUPS) {
    const chip = groupChip(t, group.id);
    assert.equal(chip.tagName, "button");
    assert.equal(chip.getAttribute("type"), "button");
    assert.equal(chip.className.split(" ")[0], "chip");
    assert.equal(chip.dataset.kind, "passage");
    assert.equal(chip.textContent, group.label, "no time: passages are untimed");
    assert.ok(["true", "false"].includes(chip.getAttribute("aria-pressed")));
  }
});

test("without app.passages.groups() every Read passage keeps a chip of its own, as before", () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0) });
  parts(t).read.click();
  assert.deepEqual(
    visibleChips(t).map((chip) => chip.dataset.passageId),
    PASSAGES.slice(1).map((entry) => entry.id),
  );
  assert.equal(shownId(t), "explainer-one");
  visibleChips(t)[3].click();
  assert.equal(shownId(t), "speech-two");
  assert.equal(parts(t).newTopic.hidden, true, "a passage on its own chip has nothing to draw");
});

// --- At mount ---------------------------------------------------------------------------------

test("the Read tab opens on a drawn passage of its first group", () => {
  const t = onRead();
  assert.equal(shownId(t), "explainer-one", "a group of one gives its one passage");
  assert.deepEqual(pressed(t), ["Explainer"]);

  const speechFirst = [TALK, ...PASSAGES.filter((entry) => entry.group === "speech")];
  for (const [value, id] of [
    [0, "speech-one"],
    [0.5, "speech-two"],
    [0.9, "speech-three"],
  ]) {
    const other = setup({ passages: speechFirst, groups: GROUPS, random: drawOf(value) });
    parts(other).read.click();
    assert.equal(shownId(other), id, String(value));
    assert.deepEqual(pressed(other), ["Speech"]);
  }
});

// --- Group chip taps --------------------------------------------------------------------------

test("a tap on a group chip draws a passage of that group and selects it", () => {
  const t = onRead();
  groupChip(t, "speech").click();
  assert.equal(shownId(t), "speech-one");
  assert.equal(parts(t).cardTitle.textContent, "Speech one");
  assert.equal(parts(t).cardText.textContent, "Speech one text.");
  assert.equal(parts(t).cardTarget.textContent, "Target 150 to 170 wpm");
  assert.deepEqual(pressed(t), ["Speech"]);
  groupChip(t, "drill").click();
  assert.equal(shownId(t), "drill-one");
  assert.deepEqual(pressed(t), ["Drill"]);
});

test("a tap on the selected group chip draws another passage of it, never the one on screen", () => {
  const random = drawOf(0);
  const t = onRead({ random });
  const speech = groupChip(t, "speech");
  speech.click();
  assert.equal(shownId(t), "speech-one");
  speech.click();
  assert.equal(shownId(t), "speech-two", "0 of [two, three]");
  speech.click();
  assert.equal(shownId(t), "speech-one", "0 of [one, three]");
  random.value = 0.9;
  speech.click();
  assert.equal(shownId(t), "speech-three", "0.9 of [two, three]");
});

test("a group of one shows its passage on every tap", () => {
  const t = onRead();
  groupChip(t, "story").click();
  groupChip(t, "story").click();
  assert.equal(shownId(t), "story-one");
});

test("a group chip tap reads the drawn passage's title out", () => {
  const t = onRead();
  groupChip(t, "speech").click();
  groupChip(t, "speech").click();
  groupChip(t, "explainer").click();
  assert.deepEqual(t.calls.announce, ["Speech one", "Speech two", "Explainer: one"]);
});

test("a passage of no listed group is selected by its own chip, as before", () => {
  const t = onRead();
  const loose = visibleChips(t).find((chip) => chip.dataset.passageId === "loose");
  loose.click();
  assert.equal(shownId(t), "loose");
  assert.equal(parts(t).cardTitle.textContent, "Loose passage");
  assert.deepEqual(pressed(t), ["Loose passage"]);
  assert.deepEqual(t.calls.announce, [], "nothing was drawn");
});

test("group chips do nothing outside idle", () => {
  const random = drawOf(0);
  const t = onRead({ random });
  const drawn = random.calls;
  for (const state of ["recording", "uploading", "error"]) {
    t.practice.render(state, { title: "t", body: "b" });
    groupChip(t, "speech").click();
    assert.equal(shownId(t), "explainer-one", state);
  }
  assert.equal(random.calls, drawn);
});

// --- New passage ------------------------------------------------------------------------------

test("on the Read tab New topic reads New passage: the same button, icon and place", () => {
  const t = setup({ passages: PASSAGES, groups: GROUPS, random: drawOf(0) });
  const button = parts(t).newTopic;
  parts(t).read.click();
  groupChip(t, "speech").click();
  assert.equal(parts(t).newTopic, button, "the same button");
  assert.equal(button.textContent, "New passage");
  assert.equal(button.className, "btn btn--ghost passage-card__new");
  assert.equal(button.children.length, 1);
  assert.equal(button.children[0].getAttribute("data-icon"), "refresh", "the icon follows");
  assert.deepEqual(
    parts(t).card.children.map((child) => child.className),
    [
      "passage-card__title",
      "btn btn--ghost passage-card__new",
      "passage-card__target",
      "passage-card__text",
    ],
  );
  parts(t).talk.click();
  assert.equal(button.textContent, "New topic");
  assert.equal(button.children[0].getAttribute("data-icon"), "refresh");
});

test("New passage shows only for a group of two or more, and only in idle", () => {
  const t = onRead();
  const hidden = () => parts(t).newTopic.hidden;
  assert.equal(hidden(), true, "Explainer holds one passage");
  groupChip(t, "story").click();
  assert.equal(hidden(), true, "Story holds one");
  groupChip(t, "speech").click();
  assert.equal(hidden(), false, "Speech holds three");
  groupChip(t, "drill").click();
  assert.equal(hidden(), false, "Drill holds two");
  for (const state of ["recording", "uploading", "error"]) {
    t.practice.render(state, { title: "t", body: "b" });
    assert.equal(hidden(), true, state);
    assert.equal(parts(t).newTopic.disabled, true, state);
  }
  t.practice.render("idle");
  visibleChips(t)
    .find((chip) => chip.dataset.passageId === "loose")
    .click();
  assert.equal(hidden(), true, "a passage of no group");
});

test("New passage draws another passage of the group and reads its title out", () => {
  const t = onRead();
  groupChip(t, "speech").click();
  parts(t).newTopic.click();
  assert.equal(shownId(t), "speech-two");
  parts(t).newTopic.click();
  assert.equal(shownId(t), "speech-one");
  assert.deepEqual(pressed(t), ["Speech"]);
  assert.deepEqual(t.calls.announce, ["Speech one", "Speech two", "Speech one"]);
});

test("a new passage scrolls the text back to the top", () => {
  const t = onRead();
  groupChip(t, "speech").click();
  parts(t).cardText.scrollTop = 80;
  parts(t).newTopic.click();
  assert.equal(parts(t).cardText.scrollTop, 0);
});

// --- The take and the selection -----------------------------------------------------------

test("a Read take saves the drawn passage's own id and title, and sends its text", async () => {
  const t = onRead({ random: drawOf(0.5) });
  groupChip(t, "speech").click();
  assert.equal(shownId(t), "speech-two");
  await saveTake(t);
  assert.equal(t.calls.analyze[0].script, "Speech two text.");
  const [session] = t.calls.save;
  assert.equal(session.passageId, "speech-two");
  assert.equal(session.passageTitle, "Speech two");
  assert.ok(!("topic" in session), "a passage is given no topic");
});

test("the tabs and a visit elsewhere keep the Read passage, and draw nothing", () => {
  const random = drawOf(0.5);
  const t = onRead({ random });
  groupChip(t, "speech").click();
  const shown = shownId(t);
  const drawn = random.calls;
  parts(t).talk.click();
  parts(t).read.click();
  t.practice.hide();
  t.practice.show({});
  assert.equal(shownId(t), shown);
  assert.deepEqual(pressed(t), ["Speech"]);
  assert.equal(random.calls, drawn);
});

// --- The speaker's takes and app.path -------------------------------------------------------

// The store has no list(), so the draw reads no take: only what each tab opened on, the Talk
// topic and then the explainer, shown from mount and stamped then, with the clock held still
// (spec section 2.1), newest first.
test("with path.js loaded a draw is app.path.pickPassage(takes, group, Math.random, on screen)", () => {
  const random = drawOf(0);
  const now = Date.parse("2026-10-23T12:00:00.000Z");
  const t = onRead({ random, now: () => now, withPath: true });
  const asked = [];
  const pickPassage = t.app.path.pickPassage;
  t.app.path.pickPassage = (...args) => {
    asked.push(args);
    return pickPassage(...args);
  };
  groupChip(t, "speech").click();
  parts(t).newTopic.click();
  assert.equal(asked.length, 2);
  const [history, passages, source, current] = asked[0];
  assert.deepEqual(plain(history), [
    { passageId: "explainer-one", createdAt: new Date(now + 1).toISOString() },
    { passageId: "day", topic: "First topic.", createdAt: new Date(now).toISOString() },
  ]);
  assert.deepEqual(Array.from(passages, (entry) => entry.id), SPEECH_IDS);
  assert.equal(source, random, "the vm's own Math.random");
  assert.equal(current, "explainer-one", "the passage on screen at the tap");
  assert.equal(asked[1][3], "speech-one");
  assert.equal(shownId(t), "speech-two");
});

test("the takes app.store.list() gives at show() steer the draw to a passage not read yet", async () => {
  const takes = [readOn("speech-one"), readOn("speech-two")];
  const t = onRead({ withPath: true, list: () => Promise.resolve(plain(takes)) });
  t.practice.show({});
  await flush();
  groupChip(t, "speech").click();
  assert.equal(shownId(t), "speech-three");
});

test("a Read take saved on Practice joins the takes the next draws read", async () => {
  const t = onRead({ withPath: true });
  groupChip(t, "speech").click();
  assert.equal(shownId(t), "speech-one");
  await saveTake(t);
  parts(t).newTopic.click();
  assert.equal(shownId(t), "speech-two");
  await saveTake(t);
  parts(t).newTopic.click();
  assert.equal(shownId(t), "speech-three", "speech-one and speech-two were read");
});

// --- The real passages ----------------------------------------------------------------------

// Each chip draws only its own group's passages, all of them app.passages entries: never a cold
// read, the benchmark or another group's passage.
test("with the real passages Read shows Explainer, Story, Speech and Drill, each its own", () => {
  const passages = realPassages();
  for (const value of [0, 0.5, 0.99]) {
    const t = setup({ passages, groups: realGroups(), random: drawOf(value) });
    parts(t).read.click();
    assert.deepEqual(
      visibleChips(t).map((chip) => chip.textContent),
      ["Explainer", "Story", "Speech", "Drill"],
    );
    assert.equal(t.practice.selectedPassage().group, "explainer", "the first group");
    for (const group of realGroups()) {
      groupChip(t, group.id).click();
      const shown = t.practice.selectedPassage();
      const members = passages.filter((entry) => entry.group === group.id);
      assert.ok(members.some((entry) => entry.id === shown.id), `${shown.id} in ${group.id}`);
      assert.equal(parts(t).cardTitle.textContent, shown.title);
      assert.equal(parts(t).newTopic.hidden, members.length < 2, `New passage on ${group.id}`);
    }
  }
});
