// Tests for Practice's Talk draws (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md sections 2.1 and 2.2): each prompt
// with topics starts on a drawn topic at mount, a tap on a Talk chip (the selected one or another)
// and New topic each draw a new topic and read it out, and the tabs, a visit elsewhere and level
// mode keep the topic as it was. A draw is app.path.pickTopic over the speaker's takes
// (app.store.list() at show(), and each take saved since) when path.js is loaded, and otherwise
// any topic but the one on screen, at random. The harness is practice-harness.js; a `random`
// stub on the vm context's Math fixes every draw.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYSIS,
  IMPROMPTU_TOPIC,
  flush,
  levelRequest,
  parts,
  plain,
  setup,
} = require("./practice-harness");

// Talk first, as in passages.js: two prompts with topics, a timed prompt without, then a passage.
const PASSAGES = [
  {
    id: "day",
    kind: "prompt",
    title: "Your day",
    text: "First topic.",
    topics: ["First topic.", "Second topic.", "Third topic."],
    targetWpm: [140, 160],
    timeLimitSeconds: 60,
  },
  {
    id: "imp",
    kind: "prompt",
    title: "Impromptu",
    text: "Rule topic.",
    topics: ["Rule topic.", "Uniform topic."],
    targetWpm: [140, 160],
    timeLimitSeconds: 120,
  },
  {
    id: "timed",
    kind: "prompt",
    title: "Timed talk",
    text: "Talk for three minutes on a subject you know well.",
    targetWpm: [130, 160],
    timeLimitSeconds: 180,
  },
  { id: "read1", kind: "passage", title: "Gettysburg", text: "Four score", targetWpm: [130, 150] },
];

// Record is ignored for a moment after a Stop (a bouncing thumb), so a second take waits it out.
const STOP_GRACE_MS = 500;

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

function chipFor(t, id) {
  return parts(t).chips.find((chip) => chip.dataset.passageId === id);
}

function cardText(t) {
  return parts(t).cardText.textContent;
}

// A saved take on prompt `passageId`, given `topic`.
function talkOn(passageId, topic, createdAt = "2026-10-22T10:00:00.000Z") {
  return {
    id: "take-" + topic,
    createdAt,
    passageId,
    passageTitle: "Your day",
    durationSeconds: 60,
    metrics: { pauses: [] },
    transcript: [],
    topic,
  };
}

// Records a take of twelve seconds and lets its analysis and save succeed.
async function saveTake(t) {
  t.clock.advance(STOP_GRACE_MS);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
}

// --- At mount ---------------------------------------------------------------------------------

test("at mount the first prompt shows a drawn topic, the draw picking it", () => {
  const cases = [
    [0, "First topic."],
    [0.5, "Second topic."],
    [0.9, "Third topic."],
  ];
  for (const [value, topic] of cases) {
    const t = setup({ passages: PASSAGES, random: drawOf(value) });
    assert.equal(t.practice.selectedPassage().id, "day", String(value));
    assert.equal(cardText(t), topic, String(value));
  }
});

test("every prompt with topics draws its own topic at mount, which its first tap passes over", () => {
  // Impromptu's mount draw is "Uniform topic." at 0.99 and "Rule topic." at 0, so its chip's
  // first tap, which never repeats the topic it is on, gives the other one.
  const high = setup({ passages: PASSAGES, random: drawOf(0.99) });
  chipFor(high, "imp").click();
  assert.equal(cardText(high), "Rule topic.");
  const low = setup({ passages: PASSAGES, random: drawOf(0) });
  chipFor(low, "imp").click();
  assert.equal(cardText(low), "Uniform topic.");
});

// --- Chip taps ----------------------------------------------------------------------------------

test("a tap on the selected Talk chip draws a topic other than the one on screen", () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0) });
  assert.equal(cardText(t), "First topic.");
  const day = chipFor(t, "day");
  day.click();
  assert.equal(cardText(t), "Second topic.");
  day.click();
  assert.equal(cardText(t), "First topic.");
  day.click();
  assert.equal(cardText(t), "Second topic.");
  assert.equal(t.practice.selectedPassage().id, "day");
  assert.equal(day.getAttribute("aria-pressed"), "true");
});

test("a tap on another Talk chip selects that prompt on a newly drawn topic", () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0) });
  const imp = chipFor(t, "imp");
  imp.click();
  assert.equal(t.practice.selectedPassage().id, "imp");
  assert.equal(parts(t).cardTitle.textContent, "Impromptu");
  assert.equal(cardText(t), "Uniform topic.");
  assert.equal(imp.getAttribute("aria-pressed"), "true");
  assert.equal(chipFor(t, "day").getAttribute("aria-pressed"), "false");
  chipFor(t, "day").click();
  assert.equal(cardText(t), "Second topic.", "Your day draws again, passing over its topic");
});

test("the draw is even over the other topics: the source's value picks among them in order", () => {
  const random = drawOf(0);
  const t = setup({ passages: PASSAGES, random });
  const day = chipFor(t, "day");
  random.value = 0.6;
  day.click();
  assert.equal(cardText(t), "Third topic.", "0.6 of [Second, Third]");
  random.value = 0.2;
  day.click();
  assert.equal(cardText(t), "First topic.", "0.2 of [First, Second]");
  random.value = 0.99;
  day.click();
  assert.equal(cardText(t), "Third topic.", "0.99 of [Second, Third]");
});

test("a chip tap reads the new topic out; a prompt without topics says nothing", () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0) });
  chipFor(t, "day").click();
  assert.deepEqual(t.calls.announce, ["Second topic."]);
  chipFor(t, "timed").click();
  assert.equal(cardText(t), "Talk for three minutes on a subject you know well.");
  assert.deepEqual(t.calls.announce, ["Second topic."], "nothing new was drawn");
  chipFor(t, "imp").click();
  assert.deepEqual(t.calls.announce, ["Second topic.", "Uniform topic."]);
});

test("a chip does nothing outside idle: no draw, no new topic", () => {
  const random = drawOf(0);
  const t = setup({ passages: PASSAGES, random });
  const drawn = random.calls;
  for (const state of ["recording", "uploading", "error"]) {
    t.practice.render(state, { title: "t", body: "b" });
    chipFor(t, "day").click();
    chipFor(t, "imp").click();
    assert.equal(cardText(t), "First topic.", state);
  }
  assert.equal(random.calls, drawn);
});

// --- New topic ------------------------------------------------------------------------------

test("New topic draws a topic other than the one on screen and reads it out", () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0) });
  const button = parts(t).newTopic;
  assert.equal(button.textContent, "New topic");
  button.click();
  assert.equal(cardText(t), "Second topic.");
  button.click();
  assert.equal(cardText(t), "First topic.");
  button.click();
  assert.equal(cardText(t), "Second topic.");
  assert.deepEqual(t.calls.announce, ["Second topic.", "First topic.", "Second topic."]);
});

test("a prompt with one topic shows it again on every draw", () => {
  const passages = [{ ...PASSAGES[0], topics: ["Only topic."], text: "Only topic." }];
  const t = setup({ passages, random: drawOf(0.7) });
  assert.equal(cardText(t), "Only topic.");
  parts(t).newTopic.click();
  chipFor(t, "day").click();
  assert.equal(cardText(t), "Only topic.");
});

// --- Kept as it was -------------------------------------------------------------------------

test("the tabs and a visit elsewhere keep the topic, and draw nothing", () => {
  const random = drawOf(0.5);
  const t = setup({ passages: PASSAGES, random });
  chipFor(t, "imp").click();
  const shown = cardText(t);
  const drawn = random.calls;
  parts(t).read.click();
  parts(t).talk.click();
  t.practice.hide();
  t.practice.show({});
  assert.equal(t.practice.selectedPassage().id, "imp");
  assert.equal(cardText(t), shown);
  assert.equal(random.calls, drawn);
});

test("after a saved take, coming back shows the same topic, so Record again retries it", async () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0.5) });
  t.practice.show({});
  await saveTake(t);
  assert.equal(t.calls.save[0].topic, "Second topic.");
  assert.equal(t.calls.go.at(-1).name, "results");
  t.practice.hide();
  t.practice.show({});
  assert.equal(cardText(t), "Second topic.");
});

test("level mode draws nothing, and leaving it brings the topic back as it was", () => {
  const random = drawOf(0.5);
  const t = setup({ passages: PASSAGES, random });
  const drawn = random.calls;
  const { request } = levelRequest();
  t.startLevel(request);
  assert.equal(cardText(t), IMPROMPTU_TOPIC);
  parts(t).leave.click();
  assert.equal(cardText(t), "Second topic.");
  assert.equal(random.calls, drawn);
});

// --- The speaker's takes and app.path -------------------------------------------------------

test("with path.js loaded a topic draw is app.path.pickTopic(takes, prompt, Math.random, topic)", () => {
  const random = drawOf(0);
  const t = setup({ passages: PASSAGES, random, withPath: true });
  const asked = [];
  const pickTopic = t.app.path.pickTopic;
  t.app.path.pickTopic = (...args) => {
    asked.push(args);
    return pickTopic(...args);
  };
  parts(t).newTopic.click();
  chipFor(t, "imp").click();
  assert.equal(asked.length, 2);
  const [history, promptId, source, current] = asked[0];
  assert.deepEqual(plain(history), []);
  assert.equal(promptId, "day");
  assert.equal(source, random, "the vm's own Math.random");
  assert.equal(current, "First topic.");
  assert.equal(asked[1][1], "imp");
  assert.equal(asked[1][3], "Rule topic.", "Impromptu passes over the topic it was on");
  assert.equal(cardText(t), "Uniform topic.");
});

test("the takes app.store.list() gives at show() steer the draw to a topic not used yet", async () => {
  const takes = [talkOn("day", "First topic."), talkOn("day", "Second topic.")];
  const t = setup({
    passages: PASSAGES,
    random: drawOf(0),
    withPath: true,
    list: () => Promise.resolve(plain(takes)),
  });
  assert.equal(cardText(t), "First topic.", "mount draws before any take is read");
  t.practice.show({});
  await flush();
  parts(t).newTopic.click();
  assert.equal(cardText(t), "Third topic.", "Second topic. was used");
});

// The tap passes over the topic on screen (Third, the mount draw at 0.99), so it picks between
// First and Second: First was used longest ago, where a draw blind to the takes gives Second at
// 0.99, and the old next-topic step gave Second too.
test("once every topic is used, the draw gives the one used longest ago", async () => {
  const takes = [
    talkOn("day", "First topic.", "2026-10-22T09:00:00.000Z"),
    talkOn("day", "Second topic.", "2026-10-22T10:00:00.000Z"),
    talkOn("day", "Third topic.", "2026-10-22T09:30:00.000Z"),
  ];
  const t = setup({
    passages: PASSAGES,
    random: drawOf(0.99),
    withPath: true,
    list: () => Promise.resolve(plain(takes)),
  });
  assert.equal(cardText(t), "Third topic.", "mount draws before any take is read");
  t.practice.show({});
  await flush();
  parts(t).newTopic.click();
  assert.equal(cardText(t), "First topic.", "used at 09:00, Second at 10:00");
});

test("every show() reads the takes again", async () => {
  const lists = [[], [talkOn("day", "Second topic.")]];
  const t = setup({
    passages: PASSAGES,
    random: drawOf(0),
    withPath: true,
    list: () => Promise.resolve(plain(lists.shift() || [])),
  });
  t.practice.show({});
  await flush();
  t.practice.hide();
  t.practice.show({});
  await flush();
  parts(t).newTopic.click();
  assert.equal(cardText(t), "Third topic.");
});

// The store has no list(), so only the takes saved here steer the draws, at 0.99: Third at
// mount, then Second (0.99 of First and Second), then First, the one topic no take used. A draw
// blind to the takes would give Third last, and the old next-topic step started on First.
test("a take saved on Practice joins the takes the next draws read", async () => {
  const t = setup({ passages: PASSAGES, random: drawOf(0.99), withPath: true });
  assert.equal(cardText(t), "Third topic.");
  await saveTake(t);
  assert.equal(t.calls.save[0].topic, "Third topic.");
  parts(t).newTopic.click();
  assert.equal(cardText(t), "Second topic.");
  await saveTake(t);
  assert.equal(t.calls.save[1].topic, "Second topic.");
  parts(t).newTopic.click();
  assert.equal(cardText(t), "First topic.", "Third topic. and Second topic. were used");
});

test("a store whose list() fails, throws or gives no list leaves the draws working", async () => {
  const lists = [
    () => Promise.reject(new Error("blocked")),
    () => {
      throw new Error("blocked");
    },
    () => Promise.resolve(undefined),
    () => Promise.resolve("not a list"),
  ];
  for (const list of lists) {
    const t = setup({ passages: PASSAGES, random: drawOf(0), withPath: true, list });
    assert.doesNotThrow(() => t.practice.show({}));
    await flush();
    parts(t).newTopic.click();
    assert.equal(cardText(t), "Second topic.");
  }
});
