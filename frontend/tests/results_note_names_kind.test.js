// Tests that the note under the Results strip, and the hidden endings that finish each "vs last
// take" line for screen readers, say which kind of take the arrows compare with
// (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 6). The arrows compare a
// take only with the last earlier take of its own kind (results_compare_same_kind.test.js), so
// once the store holds a take of the other kind, one that is not a sample, "your last take"
// becomes "your last Talk take" or "your last Read take". With takes of one kind only, or
// without language.js, the copy stays word for word as results_compare.test.js pins it. ui.js,
// passages.js, delivery.js, language.js and screens/results.js run for real against the shared
// fake DOM; app.store is a fake.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const PASSAGES_SOURCE = read("passages.js");
const DELIVERY_SOURCE = read("delivery.js");
const LANGUAGE_SOURCE = read("language.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));

const PLAIN_NOTE = "Arrows compare with your last take.";
const TALK_NOTE = "Arrows compare with your last Talk take.";
const READ_NOTE = "Arrows compare with your last Read take.";

// Ids from passages.js: two Talk tab prompts (the second is the bundled sample's), and two
// passages read aloud, a Read tab speech and a Path cold read.
const TALK_PROMPT = "free-talk";
const SAMPLE_PROMPT = "explain-something";
const READ_PASSAGE = "gettysburg-opening";
const COLD_READ = "cold-read-school-start";

// The block the backend adds to a take that followed the script it was sent.
const FOLLOWED_SCRIPT = { restarts: [], skipped: [], misread: [] };

// A take saved without words, ten minutes long, so `fillers` ums make fillers / 10 a minute; it
// is saved on the given day of October 2026.
function take(id, day, passageId, { wpm = 140, fillers = 0 } = {}) {
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T10:00:00Z",
    passageId,
    passageTitle: passageId,
    durationSeconds: 600,
    metrics: {
      words_per_minute: wpm,
      duration: 600,
      word_count: wpm * 10,
      fillers: { um: fillers },
      pauses: [],
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

// A take titled like the bundled sample ("Sample: ..."), saved on `passageId`.
function sample(id, day, passageId) {
  return { ...take(id, day, passageId), passageTitle: "Sample: " + passageId };
}

// Mounts Results with a store that serves `sessions` newest first, as the real one does.
// `language` picks the rule: "real" runs language.js, "none" leaves app.language unset, and an
// object becomes app.language itself. `tips` stands in for tips.js when a test needs the coach
// notes. `draws` counts Results draws: every draw empties the body and starts again with the
// meta line.
function mount(sessions, { language = "real", tips = null } = {}) {
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const context = {
    app: {
      screens: {},
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => Promise.resolve([...newestFirst]),
      },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  if (language === "real") {
    vm.runInNewContext(LANGUAGE_SOURCE, context, { filename: "language.js" });
  } else if (language !== "none") {
    context.app.language = language;
  }
  if (tips) {
    context.app.tips = tips;
  }
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const calls = { draws: 0 };
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  const append = body.appendChild.bind(body);
  body.appendChild = (child) => {
    if (child.classList && child.classList.contains("results__meta")) {
      calls.draws += 1;
    }
    return append(child);
  };
  root.appendChild(body);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body, calls };
}

// The body of Results once show() has drawn the take `id` and its comparison.
async function shown(sessions, id, options) {
  const { results, body } = mount(sessions, options);
  await results.show({ id });
  return body;
}

// The note under the strip, or null when there is none.
function noteOf(body) {
  const note = byClass(body, "stat-strip__note");
  return note ? note.textContent : null;
}

// Each stat's delta line, in strip order: its own words and then its hidden ending, as
// "words | class:ending".
function deltaLines(body) {
  const strip = byClass(body, "stat-strip");
  assert.ok(strip, "Results should draw the stat strip");
  assert.equal(strip.children.length, 4, "the strip keeps its four stats");
  return strip.children.map((cell) => {
    const delta = byClass(cell, "stat__delta");
    assert.ok(delta, "every stat has its delta line when there is a last take");
    const ending = delta.children[0];
    return delta.textContent + " | " + ending.className + ":" + ending.textContent;
  });
}

// talk-2 against talk-1: a rise, a fall, no change and a stat two takes without words cannot
// share, so each of the three hidden endings shows up.
const TALK_1 = take("talk-1", 8, TALK_PROMPT, { wpm: 110, fillers: 40 });
const TALK_2 = take("talk-2", 11, TALK_PROMPT, { wpm: 130, fillers: 28 });
// read-2 against read-1, the same four ways.
const READ_1 = take("read-1", 7, READ_PASSAGE, { wpm: 150, fillers: 20 });
const READ_2 = take("read-2", 12, COLD_READ, { wpm: 140, fillers: 30 });

test("a Talk take's note and hidden endings say Talk once a Read take is saved", async () => {
  const body = await shown(
    [TALK_1, take("read-9", 9, READ_PASSAGE), take("read-10", 10, COLD_READ), TALK_2],
    "talk-2",
  );
  assert.equal(noteOf(body), TALK_NOTE);
  assert.deepEqual(deltaLines(body), [
    "20 faster | sr-only: than your last Talk take",
    "1.2 fewer | sr-only: than your last Talk take",
    "No change | sr-only: from your last Talk take",
    "Not compared | sr-only: with your last Talk take",
  ]);
});

test("a Read take's note and hidden endings say Read once a Talk take is saved", async () => {
  const body = await shown(
    [READ_1, take("talk-9", 9, TALK_PROMPT, { wpm: 100, fillers: 50 }), READ_2],
    "read-2",
  );
  assert.equal(noteOf(body), READ_NOTE);
  assert.deepEqual(deltaLines(body), [
    "10 slower | sr-only: than your last Read take",
    "1 more | sr-only: than your last Read take",
    "No change | sr-only: from your last Read take",
    "Not compared | sr-only: with your last Read take",
  ]);
});

test("with takes of one kind only, the note and the endings stay word for word", async () => {
  const talks = await shown([TALK_1, TALK_2], "talk-2");
  assert.equal(noteOf(talks), PLAIN_NOTE);
  assert.deepEqual(deltaLines(talks), [
    "20 faster | sr-only: than your last take",
    "1.2 fewer | sr-only: than your last take",
    "No change | sr-only: from your last take",
    "Not compared | sr-only: with your last take",
  ]);
  const reads = await shown([READ_1, READ_2], "read-2");
  assert.equal(noteOf(reads), PLAIN_NOTE);
  assert.deepEqual(deltaLines(reads), [
    "10 slower | sr-only: than your last take",
    "1 more | sr-only: than your last take",
    "No change | sr-only: from your last take",
    "Not compared | sr-only: with your last take",
  ]);
});

test("a take of the other kind saved after this one counts too: the store holds both", async () => {
  const sessions = [TALK_1, TALK_2, take("read-20", 20, READ_PASSAGE)];
  const body = await shown(sessions, "talk-2");
  assert.equal(noteOf(body), TALK_NOTE, "reopened from History after a later read");
  assert.equal(deltaLines(body)[0], "20 faster | sr-only: than your last Talk take");
});

test("a sample never counts as the other kind", async () => {
  // A Read-kind sample beside talks, and the bundled sample's Talk prompt beside reads.
  const talks = await shown([TALK_1, sample("read-sample", 9, READ_PASSAGE), TALK_2], "talk-2");
  assert.equal(noteOf(talks), PLAIN_NOTE);
  assert.equal(deltaLines(talks)[0], "20 faster | sr-only: than your last take");
  const reads = await shown([READ_1, sample("talk-sample", 9, SAMPLE_PROMPT), READ_2], "read-2");
  assert.equal(noteOf(reads), PLAIN_NOTE);
  assert.equal(deltaLines(reads)[0], "10 slower | sr-only: than your last take");
});

// The passages say the opposite of the rule, and the rule answers with values that are not
// true or false: results.js must read the kind from app.language.isReadTake alone, as yes or
// no, as the arrows, Progress and the rank do.
test("the kind is app.language.isReadTake's answer, read as yes or no", async () => {
  const answers = {
    "talk-1": 0,
    "talk-2": undefined,
    "read-1": "gettysburg-opening",
    "read-2": FOLLOWED_SCRIPT,
  };
  const language = { isReadTake: (session) => answers[session.id] };
  const talk1 = take("talk-1", 8, READ_PASSAGE, { wpm: 110 });
  const talk2 = take("talk-2", 10, COLD_READ, { wpm: 130 });
  const read1 = take("read-1", 9, TALK_PROMPT, { wpm: 150 });
  const read2 = take("read-2", 11, TALK_PROMPT, { wpm: 160 });

  const oneKind = await shown([talk1, talk2], "talk-2", { language });
  assert.equal(noteOf(oneKind), PLAIN_NOTE, "0 and undefined are both talk");
  const talk = await shown([talk1, read1, talk2, read2], "talk-2", { language });
  assert.equal(noteOf(talk), TALK_NOTE);
  assert.equal(deltaLines(talk)[0], "20 faster | sr-only: than your last Talk take");
  const reading = await shown([talk1, read1, talk2, read2], "read-2", { language });
  assert.equal(noteOf(reading), READ_NOTE, "a passage id and a script block are both read");
  assert.equal(deltaLines(reading)[0], "10 faster | sr-only: than your last Read take");
});

test("without language.js, or without its rule, the note and the endings stay word for word", async () => {
  const sessions = [TALK_1, take("read-9", 9, READ_PASSAGE, { wpm: 150, fillers: 40 }), TALK_2];
  for (const language of ["none", {}, { isReadTake: "not a function" }]) {
    const body = await shown(sessions, "talk-2", { language });
    assert.equal(noteOf(body), PLAIN_NOTE);
    assert.deepEqual(deltaLines(body), [
      "20 slower | sr-only: than your last take",
      "1.2 fewer | sr-only: than your last take",
      "No change | sr-only: from your last take",
      "Not compared | sr-only: with your last take",
    ]);
  }
});

// A take with words on the Talk prompt: 120 back-to-back words of half a second with an "um"
// every six seconds, so 110 wpm, 10 fillers a minute, no pause, and a speech map with more
// cards than it shows before Show all.
function spokenTalk(id, day) {
  return {
    ...take(id, day, TALK_PROMPT),
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: 120 }, (_, index) => ({
      text: index % 12 === 6 ? "um" : "word",
      start: index * 0.5,
      end: (index + 1) * 0.5,
    })),
  };
}

test("the coach notes' redraw and Show all keep the kind in the note and the endings", async () => {
  const tips = {
    select: () => [],
    coachNotes: () => Promise.resolve({ headline: "Keep the pace.", tips: [] }),
  };
  const sessions = [
    take("talk-1", 8, TALK_PROMPT, { wpm: 100, fillers: 40 }),
    take("read-9", 9, READ_PASSAGE),
    spokenTalk("talk-10", 10),
  ];
  const lines = [
    "10 faster | sr-only: than your last Talk take",
    "6 more | sr-only: than your last Talk take",
    "No change | sr-only: from your last Talk take",
    "Not compared | sr-only: with your last Talk take",
  ];
  const { results, body, calls } = mount(sessions, { tips });
  await results.show({ id: "talk-10" });
  assert.equal(calls.draws, 3, "the take, the comparison, then the notes");
  assert.equal(noteOf(body), TALK_NOTE);
  assert.deepEqual(deltaLines(body), lines);

  byClass(byClass(body, "speech-map"), "speech-map__more").click();
  assert.equal(calls.draws, 4, "Show all draws the screen again");
  assert.equal(noteOf(body), TALK_NOTE);
  assert.deepEqual(deltaLines(body), lines);
});
