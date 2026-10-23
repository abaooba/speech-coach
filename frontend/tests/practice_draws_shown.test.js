// Tests for what Practice has shown counting in its draws (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 2.1). A tap saves nothing,
// so before this rule, once every topic of a prompt or passage of a group had been used, the taps
// flipped between the two used longest ago, and with one left unused, between it and the one used
// longest ago. Now Practice also counts every topic and passage its draws have put on screen since
// the app opened, the ones each tab opens on included, as used at the moment it was shown. With
// path.js loaded a draw takes an item neither used by a take nor shown yet, at random, and failing
// that the one used or shown longest ago, so taps go through a whole prompt or group before any
// item comes back, and never give the item on screen. Mount draws every prompt a topic, but only
// the one Talk opens on shows; another prompt's has never been on screen, so the first tap on its
// chip does not pass over it. What Practice has shown lives in its module state only: it is
// never saved, never sent and in no session. The harness is practice-harness.js; a `random` stub
// fixes every draw, and a `now` stub holds the clock still, so every showing in a test falls in
// the same millisecond.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYSIS,
  IMPROMPTU_TOPIC,
  JUDGED_PATH,
  PROMPT_MATERIAL,
  flush,
  levelRequest,
  parts,
  plain,
  reaches,
  setup,
} = require("./practice-harness");

const NUMBERS = ["one", "two", "three", "four", "five", "six"];

function topicOf(number) {
  return "Topic " + number + ".";
}

function storyOf(number) {
  return "story-" + number;
}

function questionOf(number) {
  return "Question " + number + ".";
}

// Talk first, as in passages.js: one prompt of six topics. Then the Read tab's one group, six
// stories, so Read opens on one of them.
const PROMPT = {
  id: "day",
  kind: "prompt",
  title: "Your day",
  text: topicOf("one"),
  topics: NUMBERS.map(topicOf),
  targetWpm: [140, 160],
  timeLimitSeconds: 60,
};
const STORIES = NUMBERS.map((number) => ({
  id: storyOf(number),
  kind: "passage",
  title: "Story: " + number,
  text: "Story " + number + ".",
  targetWpm: [150, 170],
  group: "story",
}));
const PASSAGES = [PROMPT, ...STORIES];
const GROUPS = [{ id: "story", label: "Story" }];

// A second prompt of six topics, after the first, as Impromptu follows About you in passages.js.
// Talk opens on the first prompt, so the topic mount draws for this one never shows.
const SECOND = {
  id: "imp",
  kind: "prompt",
  title: "Impromptu",
  text: questionOf("one"),
  topics: NUMBERS.map(questionOf),
  targetWpm: [140, 160],
  timeLimitSeconds: 120,
};

// The clock every test holds still, a day after the takes below.
const NOW = Date.parse("2026-10-23T12:00:00.000Z");

// The takes below used the six in this order, oldest first, an hour apart on 2026-10-01, so the
// one used longest ago is never simply the first listed.
const USED_OLDEST_FIRST = ["four", "two", "six", "one", "five", "three"];

function usedAt(number) {
  const hour = USED_OLDEST_FIRST.indexOf(number) + 1;
  return "2026-10-01T0" + hour + ":00:00.000Z";
}

// Saved takes: a read of each story numbered.
function readsOf(numbers) {
  return numbers.map((number) => ({
    id: "read-" + number,
    createdAt: usedAt(number),
    passageId: storyOf(number),
    passageTitle: "Story: " + number,
    durationSeconds: 40,
    metrics: { pauses: [] },
    transcript: [],
  }));
}

// Saved takes: a talk on each topic numbered.
function talksOn(numbers) {
  return numbers.map((number) => ({
    id: "talk-" + number,
    createdAt: usedAt(number),
    passageId: PROMPT.id,
    passageTitle: PROMPT.title,
    durationSeconds: 60,
    metrics: { pauses: [] },
    transcript: [],
    topic: topicOf(number),
  }));
}

// Saved takes: a talk on each of the second prompt's questions numbered.
function answersTo(numbers) {
  return numbers.map((number) => ({
    id: "answer-" + number,
    createdAt: usedAt(number),
    passageId: SECOND.id,
    passageTitle: SECOND.title,
    durationSeconds: 60,
    metrics: { pauses: [] },
    transcript: [],
    topic: questionOf(number),
  }));
}

// Practice with path.js, the draw at 0 and the clock held still, once show() has listed `takes`.
// At a draw of 0 Talk opens on topic one and Read on story one: both are drawn at mount, before
// any take is read, and count as shown from then on.
async function practiceWith(takes) {
  const t = setup({
    passages: PASSAGES,
    groups: GROUPS,
    random: () => 0,
    now: () => NOW,
    withPath: true,
    list: () => Promise.resolve(plain(takes)),
  });
  t.practice.show({});
  await flush();
  return t;
}

// Practice on both prompts and the stories, with path.js, the draw at 0.5 and the clock held
// still, once show() has listed `takes`. Mount draws before any take is read, so each of its
// draws is over six items no take has used, and at 0.5 it gives the fourth: the second prompt is
// on Question four., which never shows, while Talk opens on the first prompt, on Topic four.
async function bothPromptsWith(takes) {
  const t = setup({
    passages: [PROMPT, SECOND, ...STORIES],
    groups: GROUPS,
    random: () => 0.5,
    now: () => NOW,
    withPath: true,
    list: () => Promise.resolve(plain(takes)),
  });
  t.practice.show({});
  await flush();
  return t;
}

function talkChip(t) {
  return parts(t).chips.find((chip) => chip.dataset.passageId === PROMPT.id);
}

function storyChip(t) {
  return parts(t).chips.find((chip) => chip.dataset.group === "story");
}

function secondChip(t) {
  return parts(t).chips.find((chip) => chip.dataset.passageId === SECOND.id);
}

// The number of what the card shows: "four" for "Topic four." on Talk and for story four on Read.
function shownNumber(t) {
  const entry = t.practice.selectedPassage();
  const shown = entry.kind === "prompt" ? parts(t).cardText.textContent : entry.id;
  return NUMBERS.find((number) => shown === topicOf(number) || shown === storyOf(number));
}

// Taps the control `pick` finds 12 times and gives the number each tap showed.
function twelveTaps(t, pick) {
  const shown = [];
  for (let tap = 0; tap < 12; tap += 1) {
    pick().click();
    shown.push(shownNumber(t));
  }
  return shown;
}

// Taps the second prompt's chip, which selects it, then the control `pick` finds 11 times, and
// gives the number of the question each of the 12 taps showed: none for a card showing anything
// else.
function twelveTapsOnSecond(t, pick) {
  const shown = [];
  for (let tap = 0; tap < 12; tap += 1) {
    (tap === 0 ? secondChip(t) : pick()).click();
    const text = parts(t).cardText.textContent;
    shown.push(NUMBERS.find((number) => text === questionOf(number)));
  }
  return shown;
}

// The Talk tab's two ways to draw, then the Read tab's.
const TALK_TAPS = {
  "its chip": talkChip,
  "New topic": (t) => parts(t).newTopic,
};
const READ_TAPS = {
  "its chip": storyChip,
  "New passage": (t) => parts(t).newTopic,
};
// The second prompt's two ways to draw, once a tap on its chip has selected it.
const SECOND_TAPS = {
  "its chip": secondChip,
  "New topic": (t) => parts(t).newTopic,
};

// Each tap passes over the item on screen and, with every item used, takes the one used or shown
// longest ago: the five the tab did not open on, in the order the takes used them, then item one,
// shown at mount before any of them, and round again. Before, the taps flipped between four and
// two, the two used longest ago.
const ALL_USED_TURN = ["four", "two", "six", "five", "three", "one"];

// With five never used, the first tap gives it; then the four others the tab did not open on, in
// the order the takes used them, then item one, and round again. Before, the taps flipped between
// five and four, the one used longest ago.
const ONE_UNUSED_TURN = ["five", "four", "two", "six", "three", "one"];

// --- Read: a group of six ---------------------------------------------------------------------

test("a group whose six passages were all read: 12 taps show all six, none back before the other five", async () => {
  for (const [name, control] of Object.entries(READ_TAPS)) {
    const t = await practiceWith(readsOf(NUMBERS));
    parts(t).read.click();
    assert.equal(shownNumber(t), "one", `${name}: Read opens on story one`);
    const shown = twelveTaps(t, () => control(t));
    assert.deepEqual(shown, [...ALL_USED_TURN, ...ALL_USED_TURN], name);
    assert.equal(new Set(shown.slice(0, 6)).size, 6, `${name}: all six in the first six taps`);
  }
});

test("a group with one passage not read: the first tap gives it, then the rest in turn, with no flip", async () => {
  for (const [name, control] of Object.entries(READ_TAPS)) {
    const t = await practiceWith(readsOf(NUMBERS.filter((number) => number !== "five")));
    parts(t).read.click();
    assert.equal(shownNumber(t), "one", `${name}: Read opens on story one`);
    const shown = twelveTaps(t, () => control(t));
    assert.equal(shown[0], "five", `${name}: the passage not read comes first`);
    assert.deepEqual(shown, [...ONE_UNUSED_TURN, ...ONE_UNUSED_TURN], name);
  }
});

// --- Talk: a prompt of six topics --------------------------------------------------------------

test("a prompt whose six topics were all used: 12 taps show all six, none back before the other five", async () => {
  for (const [name, control] of Object.entries(TALK_TAPS)) {
    const t = await practiceWith(talksOn(NUMBERS));
    assert.equal(shownNumber(t), "one", `${name}: Talk opens on topic one`);
    const shown = twelveTaps(t, () => control(t));
    assert.deepEqual(shown, [...ALL_USED_TURN, ...ALL_USED_TURN], name);
    assert.equal(new Set(shown.slice(0, 6)).size, 6, `${name}: all six in the first six taps`);
  }
});

test("a prompt with one topic not used: the first tap gives it, then the rest in turn, with no flip", async () => {
  for (const [name, control] of Object.entries(TALK_TAPS)) {
    const t = await practiceWith(talksOn(NUMBERS.filter((number) => number !== "five")));
    assert.equal(shownNumber(t), "one", `${name}: Talk opens on topic one`);
    const shown = twelveTaps(t, () => control(t));
    assert.equal(shown[0], "five", `${name}: the topic not used comes first`);
    assert.deepEqual(shown, [...ONE_UNUSED_TURN, ...ONE_UNUSED_TURN], name);
  }
});

// With no takes, every item is unused: at a draw of 0 each tap takes the first not shown yet, and
// once all six have shown, the one shown longest ago, item one, which the tab opened on.
test("with no takes at all, the taps show every topic and passage once before any comes back", async () => {
  const turn = ["two", "three", "four", "five", "six", "one"];
  const t = await practiceWith([]);
  assert.deepEqual(twelveTaps(t, () => parts(t).newTopic), [...turn, ...turn], "New topic");
  parts(t).read.click();
  assert.deepEqual(twelveTaps(t, () => storyChip(t)), [...turn, ...turn], "the Story chip");
});

// --- Talk: a prompt Talk does not open on ------------------------------------------------------

// Mount put the second prompt on Question four., which never showed, so the first tap on its chip
// has no topic of that prompt on screen to pass over: it gives four when four is the one question
// no take used, or the one used longest ago. Then each tap passes over the question on screen and
// takes the one used or shown longest ago, so the taps go round the questions in the order the
// takes used them, four first, and none comes back before the other five have shown. Before, the
// first tap passed over four as if it were on screen and gave two, the oldest of the others, and
// only the second tap gave four.

test("another prompt's one unused topic, drawn for it at mount and never shown: its first tap gives it", async () => {
  for (const [name, control] of Object.entries(SECOND_TAPS)) {
    const t = await bothPromptsWith(answersTo(NUMBERS.filter((number) => number !== "four")));
    assert.equal(t.practice.selectedPassage().id, PROMPT.id, `${name}: Talk opens on the first`);
    const shown = twelveTapsOnSecond(t, () => control(t));
    assert.equal(shown[0], "four", `${name}: the question no take used comes first`);
    assert.deepEqual(shown, [...USED_OLDEST_FIRST, ...USED_OLDEST_FIRST], name);
  }
});

test("another prompt's topic used longest ago, drawn for it at mount and never shown: its first tap gives it", async () => {
  for (const [name, control] of Object.entries(SECOND_TAPS)) {
    const t = await bothPromptsWith(answersTo(NUMBERS));
    assert.equal(t.practice.selectedPassage().id, PROMPT.id, `${name}: Talk opens on the first`);
    const shown = twelveTapsOnSecond(t, () => control(t));
    assert.equal(shown[0], "four", `${name}: the question used longest ago comes first`);
    assert.deepEqual(shown, [...USED_OLDEST_FIRST, ...USED_OLDEST_FIRST], name);
  }
});

// --- What a showing is -------------------------------------------------------------------------

// A showing goes to the draw as the fields it reads of a take: the passage's id (a topic's
// prompt), the topic for a topic, and the moment it was shown. Each one is stamped with the
// clock, and at least 1 ms after the one before it, so with the clock held still the showings
// still come in the order they were shown.
test("each showing is the draw's fields, stamped 1 ms after the last when the clock stands still", async () => {
  const t = await practiceWith([]);
  const asked = [];
  const pickTopic = t.app.path.pickTopic;
  t.app.path.pickTopic = (history, ...rest) => {
    asked.push(plain(history));
    return pickTopic(history, ...rest);
  };
  parts(t).newTopic.click();
  parts(t).newTopic.click();
  parts(t).newTopic.click();
  const at = (ms) => new Date(NOW + ms).toISOString();
  // The third tap reads the topic and the story each tab opened on, then the first two taps'
  // topics, newest first.
  assert.deepEqual(asked[2], [
    { passageId: "day", topic: "Topic three.", createdAt: at(3) },
    { passageId: "day", topic: "Topic two.", createdAt: at(2) },
    { passageId: "story-one", createdAt: at(1) },
    { passageId: "day", topic: "Topic one.", createdAt: at(0) },
  ]);
  assert.equal(shownNumber(t), "four");
});

// path.js leaves the bundled sample out of the takes a draw reads (isOwnTake, through
// app.screens.results.isSample). A showing has no passageTitle, so it stays in, as every take of
// the speaker's does, while the sample, a talk on topic four after every other take, is left out.
test("with Results' sample check loaded the showings still count, and the sample still does not", async () => {
  const sample = {
    ...talksOn(["four"])[0],
    id: "sample",
    passageTitle: "Sample: Your day",
    createdAt: "2026-10-02T00:00:00.000Z",
  };
  for (const [name, control] of Object.entries(TALK_TAPS)) {
    const t = await practiceWith([...talksOn(NUMBERS), sample]);
    // The rule results.js's isSample holds: a title that starts with "Sample: ".
    t.app.screens.results = {
      isSample: (session) =>
        typeof session.passageTitle === "string" && session.passageTitle.startsWith("Sample: "),
    };
    const shown = twelveTaps(t, () => control(t));
    assert.deepEqual(shown, [...ALL_USED_TURN, ...ALL_USED_TURN], name);
  }
});

// Level mode draws nothing and shows the request's material, which no draw put on screen: a talk
// level on topic five, the one no take used, left before any take, leaves it to the first tap.
test("a level's material is no showing: after Leave level the first tap can give it", async () => {
  const t = await practiceWith(talksOn(NUMBERS.filter((number) => number !== "five")));
  const five = topicOf("five");
  const { request } = levelRequest({
    material: { ...PROMPT_MATERIAL, id: "day", title: "Your day", text: five, topic: five },
  });
  t.startLevel(request);
  assert.equal(parts(t).cardText.textContent, "Topic five.");
  parts(t).leave.click();
  assert.equal(shownNumber(t), "one", "back on the topic Talk was left on");
  parts(t).newTopic.click();
  assert.equal(shownNumber(t), "five");
});

// --- Never kept anywhere -----------------------------------------------------------------------

test("what Practice has shown is never saved, never sent and in no session", async () => {
  const t = await practiceWith(talksOn(["two"]));
  const flags = [];
  t.app.store.getFlag = (...args) => {
    flags.push(args);
    return Promise.resolve(undefined);
  };
  t.app.store.setFlag = (...args) => {
    flags.push(args);
    return Promise.resolve();
  };
  const histories = [];
  for (const name of ["pickTopic", "pickPassage"]) {
    const pick = t.app.path[name];
    t.app.path[name] = (history, ...rest) => {
      histories.push(history);
      return pick(history, ...rest);
    };
  }

  // Draws on both tabs, a Talk take, a level take, then one more draw, which reads them all.
  parts(t).newTopic.click();
  parts(t).read.click();
  storyChip(t).click();
  parts(t).newTopic.click();
  parts(t).talk.click();
  talkChip(t).click();
  const talked = parts(t).cardText.textContent;
  t.clock.advance(500);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  const { request, log } = levelRequest();
  t.startLevel(request);
  t.clock.advance(500);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  parts(t).newTopic.click();

  // The showings are the entries with no passageTitle: every take carries its own.
  const showings = histories.at(-1).filter((entry) => !("passageTitle" in entry));
  assert.equal(showings.length, 6, "the two each tab opened on and four taps");
  const stamps = showings.map((entry) => entry.createdAt);
  const kept = [t.calls.save, t.calls.analyze, t.calls.go, flags, log];
  for (const showing of showings) {
    assert.equal(reaches(kept, showing), false, "no store call, upload, route or callback holds one");
  }
  const written = JSON.stringify(plain(kept));
  assert.ok(
    stamps.every((stamp) => !written.includes(stamp)),
    "no copy of a showing's stamp was saved or sent",
  );

  // A saved take keeps its own fields, exactly as before.
  assert.equal(t.calls.save.length, 2);
  assert.deepEqual(plain(t.calls.save[0]), {
    passageId: "day",
    passageTitle: "Your day",
    durationSeconds: 12,
    metrics: ANALYSIS.metrics,
    transcript: ANALYSIS.transcript,
    topic: talked,
  });
  assert.deepEqual(plain(t.calls.save[1]), {
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 12,
    metrics: ANALYSIS.metrics,
    transcript: ANALYSIS.transcript,
    topic: IMPROMPTU_TOPIC,
    path: JUDGED_PATH,
  });
  assert.deepEqual(plain(log.onSaved[0].session), plain(t.calls.save[1]));
});
