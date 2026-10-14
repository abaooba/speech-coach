// Tests for takes saved on a retired id. On 2026-10-14 the owner ruled that Speech Coach is for
// everyday fluency, not debate, so the Congress speech and PF constructive prompts and the two
// rebuttal passages left Practice; a speaker's saved takes still carry their ids.
// app.passages.retired() keeps each retired id's pace band and time limit and nothing a screen
// could show, so Results, History, Progress, the rank and the Path read an old take exactly as
// before, under the take's own saved title, while Practice never lists a retired id and the Path
// never hands one out. The frontend modules load with vm.runInNewContext, the screens against
// the shared fake DOM.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");

// The ids that left Practice, each with the band and time limit it had when it was retired.
const RETIRED = [
  { id: "congress-speech", kind: "prompt", targetWpm: [130, 160], timeLimitSeconds: 180 },
  { id: "pf-constructive", kind: "prompt", targetWpm: [140, 180], timeLimitSeconds: 240 },
  { id: "rebuttal-uniforms", kind: "passage", targetWpm: [150, 170] },
  { id: "rebuttal-homework", kind: "passage", targetWpm: [150, 170] },
];
const DEFAULT_BAND = [140, 160];

function source(file) {
  return fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
}

// The real modules, in index.html's order, in one context with the fake DOM.
function loadApp(files, extra = {}) {
  const app = { screens: {}, ui: {}, store: {}, router: { go() {} }, ...extra };
  const context = { app, document: fakeDocument() };
  files.forEach((file) => vm.runInNewContext(source(file), context, { filename: file }));
  return app;
}

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// A take saved without words, scored from its backend tallies: `wpm` over `seconds`, with `ums`.
function oldTake(id, passageId, passageTitle, { wpm, seconds = 60, ums = 0, createdAt }) {
  return {
    id,
    createdAt,
    passageId,
    passageTitle,
    durationSeconds: seconds,
    metrics: {
      words_per_minute: wpm,
      duration: seconds,
      word_count: Math.round((wpm * seconds) / 60),
      fillers: { um: ums },
      pauses: [],
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

const OCT_9 = "2026-10-09T15:30:00.000Z";
const OCT_10 = "2026-10-10T15:30:00.000Z";
const CONGRESS_TAKE = oldTake("old", "congress-speech", "Congress speech", {
  wpm: 135,
  seconds: 30,
  createdAt: OCT_9,
});

// The text of a node and everything inside it, in order.
function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

// The first node at any depth carrying the class `name`, or null.
function findClass(node, name) {
  for (const child of node.children || []) {
    if (child.classList && child.classList.contains(name)) {
      return child;
    }
    const found = findClass(child, name);
    if (found) {
      return found;
    }
  }
  return null;
}

// A screen mounted on a fresh body, with a store that serves `sessions` newest first.
async function showScreen(files, screen, sessions, params) {
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const app = loadApp(files, {
    store: {
      get: (id) => Promise.resolve(sessions.find((session) => session.id === id)),
      list: () => Promise.resolve([...newestFirst]),
    },
  });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens[screen].mount(root);
  await app.screens[screen].show(params);
  return { app, body };
}

const RESULTS_FILES = ["ui.js", "passages.js", "delivery.js", path.join("screens", "results.js")];

test("retired() keeps each retired id's band and time limit, and nothing to show", () => {
  const passages = loadApp(["passages.js"]).passages;
  assert.equal(typeof passages.retired, "function");
  const retired = plain(passages.retired());
  assert.deepEqual(retired, RETIRED);
  for (const entry of retired) {
    for (const field of ["title", "text", "topics", "source", "format"]) {
      assert.ok(!Object.hasOwn(entry, field), `${entry.id} has no ${field}`);
    }
  }
});

test("retired() returns new objects on every call, so a caller cannot change the next", () => {
  const passages = loadApp(["passages.js"]).passages;
  const first = passages.retired();
  first[0].targetWpm.push(200);
  first.pop();
  assert.deepEqual(plain(passages.retired()), RETIRED);
});

test("no retired id is a Practice entry, a cold read or benchmark material", () => {
  const passages = loadApp(["passages.js"]).passages;
  const ids = RETIRED.map((entry) => entry.id);
  const benchmark = passages.benchmark();
  const listed = [
    ...Array.from(passages, (entry) => entry.id),
    ...Array.from(passages.coldReads(), (entry) => entry.id),
    benchmark.read.id,
    benchmark.talk.id,
  ];
  assert.deepEqual(
    listed.filter((id) => ids.includes(id)),
    [],
  );
});

test("Practice lists no chip for a retired id", () => {
  const app = loadApp(["ui.js", "passages.js", path.join("screens", "practice.js")], {
    api: { messages: {} },
  });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.practice.mount(root);
  const chips = findClass(body, "chip-row").children;
  assert.equal(chips.length, app.passages.length, "one chip per Practice entry");
  const retiredIds = RETIRED.map((entry) => entry.id);
  assert.deepEqual(
    chips.map((chip) => chip.dataset.passageId).filter((id) => retiredIds.includes(id)),
    [],
  );
});

test("the Path never hands a new take a retired id", () => {
  const app = loadApp(["passages.js", "delivery.js", "path.js"]);
  const playIds = ["benchmark"];
  app.path.UNITS.forEach((unit) => {
    unit.levels.forEach((level) => playIds.push(level.id, level.id + "_checkback"));
    playIds.push(unit.id + "_checkpoint");
    if (unit.crown) {
      playIds.push(unit.crown.id);
    }
  });
  const retiredIds = RETIRED.map((entry) => entry.id);
  for (const playId of playIds) {
    for (const takeIndex of [0, 1]) {
      const material = app.path.materialFor(playId, [], () => 0, takeIndex);
      assert.ok(!retiredIds.includes(material.id), `${playId} take ${takeIndex + 1}`);
    }
  }
});

test("summarize reads an old take with the band and time limit of its retired id", () => {
  const results = loadApp(RESULTS_FILES).screens.results;
  for (const entry of RETIRED) {
    const take = oldTake("t", entry.id, "Old take", { wpm: 135, seconds: 30, createdAt: OCT_9 });
    const summary = results.summarize(take);
    assert.deepEqual(plain(summary.target), entry.targetWpm, entry.id);
    // A prompt was timed, so its take shows the time it used; a passage never was.
    const timeUsed = entry.timeLimitSeconds
      ? { seconds: 30, limitSeconds: entry.timeLimitSeconds }
      : null;
    assert.deepEqual(plain(summary.timeUsed), timeUsed, entry.id);
  }
  // An id that is neither listed nor retired still falls back to the default band, untimed.
  const gone = results.summarize(
    oldTake("t", "no-such-passage", "Gone", { wpm: 135, seconds: 30, createdAt: OCT_9 }),
  );
  assert.deepEqual(plain(gone.target), DEFAULT_BAND);
  assert.equal(gone.timeUsed, null);
});

test("Results shows an old take under its own title, with its old band and time used", async () => {
  const { app, body } = await showScreen(RESULTS_FILES, "results", [CONGRESS_TAKE], {
    id: "old",
  });
  assert.equal(
    fullText(findClass(body, "results__meta")),
    "Congress speech · " + app.ui.formatDate(OCT_9) + " · 0:30 of 3:00",
  );
  // 135 wpm is inside the take's own 130 to 160; against the default band it would be slow.
  const [strength, focus] = findClass(body, "headline").children.map(fullText);
  assert.equal(strength, "Your pace is inside the 130 to 160 target.");
  assert.equal(focus, "Next take, hold this delivery on a longer topic.");
});

// `count` words read at exactly `wpm` from 1 s, each 80% of its step long.
function wordsAt(count, wpm) {
  const step = ((60 / wpm) * count) / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// An old read of the school uniforms rebuttal at 165 wpm, which followed its script.
const REBUTTAL_READ = {
  id: "read",
  createdAt: OCT_9,
  passageId: "rebuttal-uniforms",
  passageTitle: "Rebuttal: school uniforms",
  durationSeconds: 41,
  metrics: {
    pauses: [],
    repeats: [],
    fillers: {},
    pace_windows: [],
    script: { restarts: [], skipped: [], misread: [] },
  },
  transcript: wordsAt(109, 165),
};

test("an old read of a retired passage keeps its 150 to 170 band on every screen", async () => {
  const results = await showScreen(RESULTS_FILES, "results", [REBUTTAL_READ], { id: "read" });
  assert.equal(
    fullText(findClass(results.body, "results__meta")),
    "Rebuttal: school uniforms · " + results.app.ui.formatDate(OCT_9),
  );
  // 165 wpm sits inside 150 to 170; against the default 140 to 160 it would read "Slow down".
  assert.equal(
    fullText(findClass(results.body, "metric-card__hint")),
    "Target 150 to 170",
  );
  const files = [...RESULTS_FILES, path.join("screens", "history.js")];
  const history = await showScreen(files, "history", [REBUTTAL_READ]);
  assert.equal(fullText(findClass(history.body, "session-row__status")), "On target");
});

test("History lists an old take under its own title, with a status from its old band", async () => {
  const files = [...RESULTS_FILES, path.join("screens", "history.js")];
  const { body } = await showScreen(files, "history", [CONGRESS_TAKE]);
  const row = findClass(body, "session-row");
  assert.equal(fullText(findClass(row, "session-row__title")), "Congress speech");
  // Against the default 140 to 160 band this take would read "Too slow".
  assert.equal(fullText(findClass(row, "session-row__status")), "On target");
});

test("Progress judges an old take's pace against its old band", async () => {
  const files = [...RESULTS_FILES, path.join("screens", "progress.js")];
  const newer = oldTake("new", "free-talk", "Your day", { wpm: 165, createdAt: OCT_10 });
  const older = oldTake("older", "congress-speech", "Congress speech", {
    wpm: 135,
    createdAt: OCT_9,
  });
  const { body } = await showScreen(files, "progress", [older, newer]);
  const cells = findClass(body, "progress-summary").children.map((item) =>
    item.children.map(fullText),
  );
  // 135 sits inside its own 130 to 160 and 165 is 5 over 160, so 135 is the best pace. Against
  // the default band both would be 5 out, and the tie would go to the newer 165.
  assert.deepEqual(cells, [
    ["Latest", "165 wpm"],
    ["Best", "135 wpm"],
    ["From your average", "30 faster"],
  ]);
});

test("the rank scores an old take against its old band", () => {
  const app = loadApp([...RESULTS_FILES, "rank.js", "rankcard.js"]);
  const ratingOf = (passageId) =>
    app.rankCard.model([{ ...CONGRESS_TAKE, passageId }], {
      screen: "progress",
      today: OCT_10,
    }).rating;
  // explain-something is a Practice prompt with the same 130 to 160 band; an id that is gone
  // falls to the default band, where 135 wpm costs a pace point.
  assert.equal(ratingOf("congress-speech"), ratingOf("explain-something"));
  assert.ok(ratingOf("congress-speech") > ratingOf("no-such-passage"));
});

test("the Path weighs an old take's pace against its old band", () => {
  const app = loadApp(["passages.js", "delivery.js", "path.js"]);
  // A minute at 135 wpm with 3 ums: fillers sit right at their target of 3 a minute.
  const take = (passageId) =>
    oldTake("t", passageId, "Old take", { wpm: 135, ums: 3, createdAt: OCT_9 });
  const order = (passageId) => Array.from(app.path.order([take(passageId)]), (unit) => unit.id);
  // Inside its own 130 to 160, pace is not the weakest skill; against the default band it is.
  assert.deepEqual(order("congress-speech"), ["fillers", "pace", "restarts", "long-pauses"]);
  assert.deepEqual(order("no-such-passage"), ["pace", "fillers", "restarts", "long-pauses"]);
});
