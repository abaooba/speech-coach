// Tests for a pause that starts inside the transcript span of a word. pauses.js reconcile adds
// an energy-only pause at the moment the voice went quiet, and the transcript can have the word
// just said still running then: "sad." runs from 34.95 to 35.738 while the mic is quiet from
// 35.4. That word is the one the pause follows, not the word before it. So a 1.8 s pause there
// comes after a full stop and does not count, the same pause inside a mid-sentence word does,
// and the Results transcript draws a counted one right after that word, so the pauses card and
// the pills stay in step. Skips keep their own rule: a skip's `at` is the end of the word said
// before it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const PAUSES_SOURCE = read("pauses.js");
const DELIVERY_SOURCE = read("delivery.js");
const TIPS_SOURCE = read("tips.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const SCREEN_SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// A seven-word take: "be" runs from 34.5 to 34.9 and the fourth word from 34.95 to 35.738. The
// speaker goes on at `resumeAt`, by default 37.2: 1.462 s after the fourth word ends, under the
// backend's 1.5 s bar, so the transcript alone shows no pause there.
function take(sentence, resumeAt = 37.2) {
  const times = [
    [33.9, 34.0],
    [34.1, 34.4],
    [34.5, 34.9],
    [34.95, 35.738],
    [resumeAt, resumeAt + 0.3],
    [resumeAt + 0.4, resumeAt + 0.5],
    [resumeAt + 0.6, resumeAt + 1.0],
  ];
  return sentence.split(" ").map((text, index) => ({
    text,
    start: round3(times[index][0]),
    end: round3(times[index][1]),
  }));
}

const AFTER_STOP = take("I would be sad. Then I left.");
const MID_SENTENCE = take("I would be sad about the loss.");
// The mic is quiet from 35.4, inside the fourth word, to 37.2, when the fifth starts. pauses.js
// reports that as [35.4, 1.8] (the first test shows it).
const QUIET_IN_FOURTH_WORD = [35.4, 1.8];
// The same take with the speaker going on at 41 s instead: quiet for 5.6 s from 35.4.
const AFTER_STOP_FROZEN = take("I would be sad. Then I left.", 41);
const LONG_QUIET_IN_FOURTH_WORD = [35.4, 5.6];

function loadDelivery() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

function loadTips() {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  return app.tips;
}

function analyze(words, pauses) {
  return loadDelivery().analyze(words, { pauses, repeats: [] });
}

// ---- Where the pause comes from ---------------------------------------------------------

// pauses.js reads the mic's loudness every 50 ms. Here its clock starts at 33 s, so the sample
// times read as the take's word times.
const SAMPLE_EVERY_MS = 50;
const CLOCK_START_MS = 33000;
const ROOM_NOISE = 0.01;
const SPEECH = 0.3;

// {t, rms} loudness samples, as pauses.js takes them, from [seconds, rms] runs in order.
function samples(runs) {
  const list = [];
  let milliseconds = CLOCK_START_MS;
  runs.forEach(([seconds, rms]) => {
    const count = Math.round((seconds * 1000) / SAMPLE_EVERY_MS);
    for (let i = 0; i < count; i += 1) {
      list.push({ t: milliseconds / 1000, rms });
      milliseconds += SAMPLE_EVERY_MS;
    }
  });
  return list;
}

test("reconcile adds the quiet after 'sad.' as a pause that starts inside 'sad.'", () => {
  const app = {};
  vm.runInNewContext(PAUSES_SOURCE, { app }, { filename: "pauses.js" });
  // Room noise, speech from 33.9, quiet from 35.4 to 37.2, speech to 38.2, room noise.
  const loudness = samples([
    [0.9, ROOM_NOISE],
    [1.5, SPEECH],
    [1.8, ROOM_NOISE],
    [1.0, SPEECH],
    [0.9, ROOM_NOISE],
  ]);
  // The backend found no transcript pause; its duration runs from "I" to "left.".
  const metrics = app.pauses.reconcile({ pauses: [], duration: 4.3 }, loudness);
  assert.deepEqual(plain(metrics.pauses), [QUIET_IN_FOURTH_WORD]);
  const sad = AFTER_STOP[3];
  assert.equal(sad.text, "sad.");
  assert.ok(sad.start < QUIET_IN_FOURTH_WORD[0] && QUIET_IN_FOURTH_WORD[0] < sad.end);
});

// ---- The delivery report ----------------------------------------------------------------

test("a 1.8 s pause that starts inside 'sad.' follows the full stop and does not count", () => {
  const report = analyze(AFTER_STOP, [QUIET_IN_FOURTH_WORD]);
  assert.deepEqual(plain(report.pauses), [
    { at: 35.4, length: 1.8, midSentence: false, long: false },
  ]);
  assert.equal(report.pauseCount, 0);
  assert.equal(report.midSentencePauseCount, 0);
  assert.equal(report.longestPause, 0);
  assert.deepEqual(
    plain(report.cleanStretch),
    { start: 33.9, end: 38.2, seconds: 4.3 },
    "nothing cuts the take",
  );
});

test("the same pause inside a mid-sentence word still counts as mid-sentence", () => {
  const report = analyze(MID_SENTENCE, [QUIET_IN_FOURTH_WORD]);
  assert.deepEqual(plain(report.pauses), [
    { at: 35.4, length: 1.8, midSentence: true, long: false },
  ]);
  assert.equal(report.pauseCount, 1);
  assert.equal(report.midSentencePauseCount, 1);
  assert.equal(report.longestMidSentencePause, 1.8);
  // The pause cuts [35.4, 37.2]: the longest clean run is "I would be sad" up to 35.4.
  assert.deepEqual(plain(report.cleanStretch), { start: 33.9, end: 35.4, seconds: 1.5 });
});

test("a pause inside a word that opens a sentence counts, though the word before ends one", () => {
  // "it." ends the first sentence; the voice goes quiet inside "Sadly", which opens the next.
  const report = analyze(take("They won it. Sadly we lost again."), [QUIET_IN_FOURTH_WORD]);
  assert.equal(report.pauses[0].midSentence, true, "'Sadly' does not end a sentence");
  assert.equal(report.pauseCount, 1);
  assert.equal(report.midSentencePauseCount, 1);
});

test("a 5.6 s pause that starts inside 'sad.' is a long pause after a full stop: a freeze", () => {
  const report = analyze(AFTER_STOP_FROZEN, [LONG_QUIET_IN_FOURTH_WORD]);
  assert.deepEqual(plain(report.pauses), [
    { at: 35.4, length: 5.6, midSentence: false, long: true },
  ]);
  assert.equal(report.pauseCount, 1);
  assert.equal(report.longPauseCount, 1);
  assert.equal(report.midSentencePauseCount, 0);
  assert.equal(report.longestMidSentencePause, 0);
  const ids = plain(loadTips().select(report, { targetWpm: [140, 160] })).map((tip) => tip.id);
  assert.ok(ids.includes("freeze"), ids.join(", "));
  assert.ok(!ids.includes("break-long"), "not a mid-sentence pause: " + ids.join(", "));
});

test("a silence that starts inside the last word is the quiet after the speech", () => {
  // "left." runs from 37.8 to 38.2; the room stays quiet from 38.0 for 6 s.
  const report = analyze(AFTER_STOP, [[38, 6]]);
  assert.deepEqual(plain(report.pauses), [{ at: 38, length: 6, midSentence: false, long: false }]);
  assert.equal(report.pauseCount, 0);
  assert.equal(report.longPauseCount, 0);
});

// ---- Results ----------------------------------------------------------------------------

function loadPure() {
  const context = {
    app: { screens: {}, passages: [], ui: {}, store: {}, router: {} },
  };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app.screens.results;
}

// Plan items as words, ["pause", length] and ["skip", text].
function planShape(plan) {
  return Array.from(plan, (item) => {
    if (item.type === "word") {
      return item.text;
    }
    return [item.type, item.type === "pause" ? item.length : item.text];
  });
}

function sessionWith(words, pauses) {
  return {
    id: "s1",
    createdAt: "2026-10-13T10:00:00.000Z",
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 12,
    metrics: { pauses, repeats: [], fillers: {}, pace_windows: [] },
    transcript: words.map((word) => ({ ...word })),
  };
}

async function showSession(session) {
  const context = {
    app: {
      screens: {},
      passages: [{ id: "gettysburg", targetWpm: [130, 150] }],
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SCREEN_SOURCES.forEach(([file, source]) => {
    vm.runInNewContext(source, context, { filename: file });
  });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return body;
}

// The transcript's spans in order: words as their text, pause markers as "[1.8 s pause]".
function transcriptTokens(body) {
  return byClass(body, "transcript")
    .children.filter((node) => node.tagName === "span")
    .map((span) =>
      span.classList.contains("tok--pause") ? "[" + span.textContent + "]" : span.textContent,
    );
}

function pauseCard(body) {
  const card = byClass(body, "stat-strip").children[2];
  return byClass(card, "stat__value").children[0].textContent;
}

// How many speech-map rows carry the modifier (moment--pause, moment--long-pause).
function mapRows(body, modifier) {
  const stage = byClass(byClass(body, "speech-map"), "speech-map__stage");
  const list = byClass(byClass(stage, "speech-map__body"), "speech-map__moments");
  return list.children.filter((row) =>
    row.classList.contains(modifier),
  ).length;
}

test("buildTranscriptPlan puts a pause that starts inside 'sad.' right after 'sad.'", () => {
  const plan = loadPure().buildTranscriptPlan(AFTER_STOP, [QUIET_IN_FOURTH_WORD]);
  assert.deepEqual(planShape(plan), [
    "I",
    "would",
    "be",
    "sad.",
    ["pause", 1.8],
    "Then",
    "I",
    "left.",
  ]);
});

test("Results draws no pill for the 1.8 s pause after 'sad.'; the card counts none", async () => {
  const body = await showSession(sessionWith(AFTER_STOP, [QUIET_IN_FOURTH_WORD]));
  assert.deepEqual(transcriptTokens(body), ["I", "would", "be", "sad.", "Then", "I", "left."]);
  assert.equal(pauseCard(body), "0");
  assert.equal(mapRows(body, "moment--pause"), 0);
});

test("a long pause that starts inside 'sad.' is drawn after 'sad.', not before it", async () => {
  const body = await showSession(sessionWith(AFTER_STOP_FROZEN, [LONG_QUIET_IN_FOURTH_WORD]));
  assert.deepEqual(transcriptTokens(body), [
    "I",
    "would",
    "be",
    "sad.",
    "[5.6 s long pause]",
    "Then",
    "I",
    "left.",
  ]);
  assert.equal(pauseCard(body), "1");
  assert.equal(mapRows(body, "moment--long-pause"), 1);
});

test("a pause inside a mid-sentence word is drawn after that word and counted once", async () => {
  const body = await showSession(sessionWith(MID_SENTENCE, [QUIET_IN_FOURTH_WORD]));
  assert.deepEqual(transcriptTokens(body), [
    "I",
    "would",
    "be",
    "sad",
    "[1.8 s pause]",
    "about",
    "the",
    "loss.",
  ]);
  assert.equal(pauseCard(body), "1");
  assert.equal(mapRows(body, "moment--pause"), 1);
});

test("a skip still goes after the word it follows when the next word overlaps its `at`", () => {
  // The transcript has "sad." start at 34.85, before "be" ends at 34.9. The read skipped "so"
  // right after "be", so the skip's `at` is 34.9 and it stays between "be" and "sad.".
  const words = AFTER_STOP.map((word, index) => (index === 3 ? { ...word, start: 34.85 } : word));
  const plan = loadPure().buildTranscriptPlan(words, [], [], {
    misreads: [],
    skips: [{ at: 34.9, word: "so" }],
  });
  assert.deepEqual(planShape(plan), [
    "I",
    "would",
    "be",
    ["skip", "so"],
    "sad.",
    "Then",
    "I",
    "left.",
  ]);
});

// ---- The quiet ends inside the next word ------------------------------------------------
// The transcript can also pull the next sentence's first word back over the silence: "over."
// ends at 35.5 and "Sadly" runs from 35.55 to 37.9, while the mic is quiet from 35.6 to 37.6.
// The quiet ends before "Sadly" does, so "Sadly" was said after it: the pause follows "over.",
// comes after a full stop and does not count.
const OVER_THEN_SADLY = [
  { text: "It", start: 33.0, end: 33.2 },
  { text: "is", start: 33.3, end: 33.6 },
  { text: "over.", start: 34.0, end: 35.5 },
  { text: "Sadly", start: 35.55, end: 37.9 },
  { text: "we", start: 38.0, end: 38.2 },
  { text: "lost.", start: 38.3, end: 38.7 },
];
const QUIET_INSIDE_SADLY = [35.6, 2.0];

test("a quiet that ends inside the next word follows the word before it: after 'over.'", () => {
  const report = analyze(OVER_THEN_SADLY, [QUIET_INSIDE_SADLY]);
  assert.deepEqual(plain(report.pauses), [
    { at: 35.6, length: 2.0, midSentence: false, long: false },
  ]);
  assert.equal(report.pauseCount, 0);
  assert.equal(report.midSentencePauseCount, 0);
});

test("buildTranscriptPlan puts that pause after 'over.', before 'Sadly'", () => {
  const plan = loadPure().buildTranscriptPlan(OVER_THEN_SADLY, [QUIET_INSIDE_SADLY]);
  assert.deepEqual(planShape(plan), ["It", "is", "over.", ["pause", 2], "Sadly", "we", "lost."]);
});

test("the same quiet after a mid-sentence word still counts as mid-sentence", () => {
  const words = OVER_THEN_SADLY.map((word) =>
    word.text === "over." ? { ...word, text: "over" } : word,
  );
  const report = analyze(words, [QUIET_INSIDE_SADLY]);
  assert.equal(report.pauses[0].midSentence, true);
  assert.equal(report.pauseCount, 1);
});
