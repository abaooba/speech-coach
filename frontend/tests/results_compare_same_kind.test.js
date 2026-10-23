// Tests that the "vs last take" arrows on Results compare a take only with the speaker's latest
// earlier take of the same kind (docs/superpowers/specs/2026-10-22-tester-feedback-design.md
// section 6): a Talk take with a Talk take, a Read take with a Read take, by
// app.language.isReadTake, and no arrows and no note when there is none. A read's near-silent
// numbers never pass for progress in free talk, and the reverse. Without language.js every take
// counts as talk, as before the rule. ui.js, passages.js, delivery.js, language.js and
// screens/results.js run for real against the shared fake DOM; app.store is a fake.
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

const NOTE = "Arrows compare with your last take.";
const NO_ARROWS = [null, null, null, null];

// Ids from passages.js: a Talk tab prompt, and two passages read aloud, a Read tab speech and a
// Path cold read.
const TALK_PROMPT = "free-talk";
const READ_PASSAGE = "gettysburg-opening";
const COLD_READ = "cold-read-school-start";

// The block the backend adds to a take that followed the script it was sent: a pasted script the
// speaker followed on the Talk tab was read aloud too.
const FOLLOWED_SCRIPT = { restarts: [], skipped: [], misread: [] };

// A take saved without words, ten minutes long, so `fillers` ums make fillers / 10 a minute; it
// is saved on the given day of October 2026.
function take(id, day, passageId, { wpm = 140, fillers = 0, script = null } = {}) {
  const metrics = {
    words_per_minute: wpm,
    duration: 600,
    word_count: wpm * 10,
    fillers: { um: fillers },
    pauses: [],
    repeats: [],
    pace_windows: [],
  };
  if (script) {
    metrics.script = script;
  }
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T10:00:00Z",
    passageId,
    passageTitle: passageId,
    durationSeconds: 600,
    metrics,
    transcript: [],
  };
}

// Mounts Results with a store that serves `sessions` newest first, as the real one does.
// `language` picks the rule: "real" runs language.js, "none" leaves app.language unset, and an
// object becomes app.language itself.
function mount(sessions, { language = "real" } = {}) {
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
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body };
}

// The body of Results once show() has drawn the take `id` and its comparison.
async function shown(sessions, id, options) {
  const { results, body } = mount(sessions, options);
  await results.show({ id });
  return body;
}

// Each stat's "vs last take" words, in strip order, or null for a stat that has no delta line.
function deltaTexts(body) {
  const strip = byClass(body, "stat-strip");
  assert.ok(strip, "Results should draw the stat strip");
  assert.equal(strip.children.length, 4, "the strip keeps its four stats");
  return strip.children.map((cell) => {
    const delta = byClass(cell, "stat__delta");
    return delta ? delta.textContent : null;
  });
}

// The note under the strip, or null when there is none.
function noteOf(body) {
  const note = byClass(body, "stat-strip__note");
  return note ? note.textContent : null;
}

test("a Talk take compares with the last Talk take, past the reads saved since", async () => {
  const body = await shown(
    [
      take("talk-1", 8, TALK_PROMPT, { wpm: 110, fillers: 40 }),
      take("read-1", 9, READ_PASSAGE, { wpm: 150 }),
      take("read-2", 10, COLD_READ, { wpm: 155 }),
      take("talk-2", 11, TALK_PROMPT, { wpm: 130, fillers: 28 }),
    ],
    "talk-2",
  );
  // Against read-2, the take just before, it would read "25 slower" and "2.8 more".
  assert.deepEqual(deltaTexts(body), ["20 faster", "1.2 fewer", "No change", "Not compared"]);
  assert.equal(noteOf(body), "Arrows compare with your last Talk take.");
});

test("a Read take compares with the last Read take, past the talks saved since", async () => {
  const body = await shown(
    [
      take("read-1", 8, READ_PASSAGE, { wpm: 140 }),
      take("talk-1", 9, TALK_PROMPT, { wpm: 100, fillers: 52 }),
      take("talk-2", 10, TALK_PROMPT, { wpm: 105, fillers: 47 }),
      take("read-2", 11, COLD_READ, { wpm: 150 }),
    ],
    "read-2",
  );
  // Against talk-2 it would read "45 faster" and "4.7 fewer".
  assert.deepEqual(deltaTexts(body), ["10 faster", "No change", "No change", "Not compared"]);
  assert.equal(noteOf(body), "Arrows compare with your last Read take.");
});

test("the last take of the kind is the newest one saved before this one", async () => {
  const sessions = [
    take("read-1", 7, READ_PASSAGE, { wpm: 120 }),
    take("read-2", 8, COLD_READ, { wpm: 140 }),
    take("talk-1", 9, TALK_PROMPT, { wpm: 100 }),
    take("read-3", 10, READ_PASSAGE, { wpm: 150 }),
    take("read-4", 11, COLD_READ, { wpm: 170 }),
  ];
  const body = await shown(sessions, "read-3");
  assert.equal(deltaTexts(body)[0], "10 faster", "read-2: not the older read-1, not read-4");
});

test("a first Talk take after reads shows no arrows and no note", async () => {
  const body = await shown(
    [
      take("read-1", 8, READ_PASSAGE, { wpm: 140 }),
      take("read-2", 9, COLD_READ, { wpm: 150 }),
      take("talk-1", 10, TALK_PROMPT, { wpm: 90, fillers: 30 }),
    ],
    "talk-1",
  );
  assert.deepEqual(deltaTexts(body), NO_ARROWS, "a read is never a talk's last take");
  assert.equal(noteOf(body), null);
});

test("a first Read take after talks shows no arrows and no note", async () => {
  const body = await shown(
    [
      take("talk-1", 8, TALK_PROMPT, { wpm: 100, fillers: 30 }),
      take("talk-2", 9, TALK_PROMPT, { wpm: 110, fillers: 20 }),
      take("read-1", 10, READ_PASSAGE, { wpm: 160 }),
    ],
    "read-1",
  );
  assert.deepEqual(deltaTexts(body), NO_ARROWS, "a talk is never a read's last take");
  assert.equal(noteOf(body), null);
});

test("a pasted script followed on Talk compares as a read, as Progress charts it", async () => {
  const sessions = [
    take("read-1", 8, READ_PASSAGE, { wpm: 140 }),
    take("talk-1", 9, TALK_PROMPT, { wpm: 100, fillers: 50 }),
    take("pasted", 10, TALK_PROMPT, { wpm: 145, script: FOLLOWED_SCRIPT }),
    take("talk-2", 11, TALK_PROMPT, { wpm: 120, fillers: 20 }),
  ];
  const pasted = await shown(sessions, "pasted");
  assert.equal(deltaTexts(pasted)[0], "5 faster", "against the Gettysburg read, not talk-1");
  const talk = await shown(sessions, "talk-2");
  assert.equal(deltaTexts(talk)[0], "20 faster", "against talk-1, past the pasted script");
});

test("app.language.isReadTake alone decides the kind, asked about each take", async () => {
  const asked = [];
  const language = {
    isReadTake: (session) => {
      asked.push(session.id);
      return session.id.startsWith("read");
    },
  };
  // The passages say the opposite of the rule: results.js must not judge a take by its passage.
  const body = await shown(
    [
      take("talk-1", 8, READ_PASSAGE, { wpm: 110 }),
      take("read-1", 9, TALK_PROMPT, { wpm: 150 }),
      take("talk-2", 10, READ_PASSAGE, { wpm: 130 }),
    ],
    "talk-2",
    { language },
  );
  assert.equal(deltaTexts(body)[0], "20 faster", "talk-1 by the rule, not read-1 before it");
  assert.ok(asked.includes("talk-2"), "the rule is asked about the take on screen");
  assert.ok(asked.includes("read-1"), "and about the earlier take it passes over");
});

// The guard hands back the rule's own answer, so previousOf reads the kind as yes or no, as
// Progress and the rank do: otherwise a rule answering with a passage id or a script block, or
// with 0 or undefined, would keep two takes of one kind apart.
test("a rule answering with any truthy or falsy value still pairs takes by kind", async () => {
  const answers = {
    "talk-1": 0,
    "read-1": "gettysburg-opening",
    "talk-2": undefined,
    "read-2": FOLLOWED_SCRIPT,
  };
  const language = { isReadTake: (session) => answers[session.id] };
  const sessions = [
    take("talk-1", 8, TALK_PROMPT, { wpm: 110 }),
    take("read-1", 9, READ_PASSAGE, { wpm: 140 }),
    take("talk-2", 10, TALK_PROMPT, { wpm: 130 }),
    take("read-2", 11, COLD_READ, { wpm: 150 }),
  ];
  const talk = await shown(sessions, "talk-2", { language });
  assert.equal(deltaTexts(talk)[0], "20 faster", "talk-1, though the rule said 0 and undefined");
  const reading = await shown(sessions, "read-2", { language });
  assert.equal(deltaTexts(reading)[0], "10 faster", "read-1, though the rule gave two values");
});

test("without language.js, or without its rule, every take is talk, as before", async () => {
  const sessions = [
    take("talk-1", 8, TALK_PROMPT, { wpm: 110 }),
    take("read-1", 9, READ_PASSAGE, { wpm: 150 }),
    take("talk-2", 10, TALK_PROMPT, { wpm: 130 }),
  ];
  for (const language of ["none", {}, { isReadTake: "not a function" }]) {
    const body = await shown(sessions, "talk-2", { language });
    assert.equal(deltaTexts(body)[0], "20 slower", "the take just before, whatever its passage");
    assert.equal(noteOf(body), NOTE);
  }
});

// A take titled like the bundled sample ("Sample: ..."), saved on `passageId`: on a Talk prompt
// it is a talk, on a Read tab passage a read.
function sample(id, day, passageId, wpm) {
  return { ...take(id, day, passageId, { wpm }), passageTitle: "Sample: " + passageId };
}

test("a sample stays out of the comparison, whatever its kind", async () => {
  const sessions = [
    take("talk-1", 7, TALK_PROMPT, { wpm: 110 }),
    take("read-1", 8, READ_PASSAGE, { wpm: 150 }),
    sample("talk-sample", 9, "explain-something", 200),
    sample("read-sample", 10, READ_PASSAGE, 90),
    take("talk-2", 11, TALK_PROMPT, { wpm: 130 }),
    take("read-2", 12, COLD_READ, { wpm: 160 }),
  ];
  const talk = await shown(sessions, "talk-2");
  assert.equal(deltaTexts(talk)[0], "20 faster", "talk-1: neither a sample nor the read");
  const reading = await shown(sessions, "read-2");
  assert.equal(deltaTexts(reading)[0], "10 faster", "read-1, not the sample read since");
});
