// Tests for the live pace row of a take whose mode has no kept factor yet
// (frontend/screens/practice.js; spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md
// section 7, Validation result). In the app the untuned cue was right on 1 of 4 first takes (the
// validation note's "End to end in the app"), so an untuned row never guesses: from its first
// paint to the end of the take it says when the live pace starts, "Live pace starts after a 20 s
// talk." or "... read." by the take's mode, in the waiting sentence's placeholder look, and never
// a number or a cue. Its blocks still reach the tracker, so the take tunes its mode once its
// analysis is back. Every browser API is a fake the tests drive by hand; the last test runs the
// real estimator on synthetic syllables.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { byClass } = require("./fake-dom");
const { flush, plain } = require("./practice-harness");
const {
  ANALYSIS,
  CUE,
  DELIVERY_SOURCE,
  READ_FLAG,
  SECOND,
  TALK_FLAG,
  WAITING,
  block,
  lastTracker,
  paceRow,
  readNext,
  rowView,
  setup,
} = require("./live-pace-harness");

const FRONTEND = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");

const TALK_LINE = "Live pace starts after a 20 s talk.";
const READ_LINE = "Live pace starts after a 20 s read.";

// What the tracker could say at any second: a number with each of the three cues.
const READINGS = [
  { wpm: 150, cue: CUE.ON_TARGET },
  { wpm: 185, cue: CUE.SLOW_DOWN },
  { wpm: 115, cue: CUE.SPEED_UP },
];

// The row holding one sentence in the placeholder look: the waiting sentence's span, alone.
function sentenceRow(text) {
  return { hidden: false, parts: ["span.practice__pace-placeholder"], text };
}

function chooseRead(t) {
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
}

// Pastes `text` into Talk's script box.
function pasteScript(t, text) {
  const box = byClass(byClass(t.body, "practice__hint"), "practice__script");
  box.children.find((child) => child.tagName === "textarea").value = text;
}

// --- an untuned take ---

test("an untuned Talk take says the Talk line from the first paint, before any block", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  assert.equal(t.root.dataset.state, "recording");
  assert.equal(lastTracker(t).options.factor, null, "no factor kept for Talk");
  assert.deepEqual(rowView(t), sentenceRow(TALK_LINE));
});

test("the Talk line stays for the whole take, never a number or a cue, whatever the tracker holds", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  const tracker = lastTracker(t);
  const line = paceRow(t).children[0];
  let blocks = 0;
  for (const reading of READINGS) {
    for (let second = 0; second < 20; second += 1) {
      block(t);
      blocks += 1;
      readNext(t, reading);
      assert.deepEqual(rowView(t), sentenceRow(TALK_LINE), JSON.stringify(reading));
    }
  }
  assert.equal(t.clock.performance.now(), 60 * SECOND, "a minute in");
  assert.equal(paceRow(t).children[0], line, "the same span: the words never changed");
  assert.equal(tracker.blocks.length, blocks, "every block still reaches the tracker");
  assert.equal(tracker.reads, 0, "an untuned take never reads it");
});

test("an untuned Read take says the Read line, and so does a Talk take sent with a script", async () => {
  const reading = setup();
  await reading.show();
  chooseRead(reading);
  await reading.startRecording();
  assert.deepEqual(rowView(reading), sentenceRow(READ_LINE), "first paint");
  for (const next of READINGS) {
    block(reading);
    readNext(reading, next);
    assert.deepEqual(rowView(reading), sentenceRow(READ_LINE), JSON.stringify(next));
  }

  // A pasted script makes the take a read (paceModeOf), as it records with Read's factor.
  const scripted = setup();
  await scripted.show();
  pasteScript(scripted, "My speech, word for word.");
  await scripted.startRecording();
  assert.deepEqual(rowView(scripted), sentenceRow(READ_LINE));
});

test("each take follows its own mode's factor: a tuned Talk shows numbers, an untuned Read its line", async () => {
  const talkTuned = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await talkTuned.show();
  await talkTuned.startRecording();
  block(talkTuned);
  readNext(talkTuned, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(talkTuned).text, "About 150 wpm On target");
  talkTuned.practice.hide();
  chooseRead(talkTuned);
  await talkTuned.startRecording();
  block(talkTuned);
  readNext(talkTuned, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(talkTuned), sentenceRow(READ_LINE));

  const readTuned = setup({ flags: { [READ_FLAG]: 0.9 } });
  await readTuned.show();
  await readTuned.startRecording();
  block(readTuned);
  readNext(readTuned, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(readTuned), sentenceRow(TALK_LINE));
  readTuned.practice.hide();
  chooseRead(readTuned);
  await readTuned.startRecording();
  assert.deepEqual(rowView(readTuned), sentenceRow(WAITING));
  block(readTuned);
  readNext(readTuned, { wpm: 160, cue: CUE.ON_TARGET });
  assert.equal(rowView(readTuned).text, "About 160 wpm On target");
});

// --- a tuned take, unchanged ---

test("a tuned take shows the waiting sentence, then About N wpm and the cue", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
  assert.deepEqual(rowView(t), sentenceRow(WAITING), "first paint");
  block(t);
  readNext(t, { wpm: null, cue: null });
  assert.deepEqual(rowView(t), sentenceRow(WAITING), "no number yet");
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t), {
    hidden: false,
    parts: [
      "span.practice__pace-number num",
      '" "',
      "span.practice__pace-cue practice__pace-cue--ok",
    ],
    text: "About 150 wpm On target",
  });
  readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
  assert.equal(rowView(t).text, "About 185 wpm Slow down");
  readNext(t, { wpm: 115, cue: CUE.SPEED_UP });
  assert.equal(rowView(t).text, "About 115 wpm Speed up");
  assert.equal(lastTracker(t).reads, 4, "read once a second");
});

// --- tuning ---

test("an untuned take still tunes its mode after analysis, and the next take shows numbers", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  const tracker = lastTracker(t);
  for (let second = 0; second < 25; second += 1) {
    block(t);
    readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  }
  assert.deepEqual(rowView(t), sentenceRow(TALK_LINE), "at 0:25");
  tracker.peakTimes = [0.5, 1, 1.5];
  t.app.delivery.nextFactor = 0.75;
  await t.stopRecording();
  t.resolveUpload();
  await flush();
  assert.equal(t.app.delivery.tunings.length, 1);
  const [tuning] = t.app.delivery.tunings;
  assert.equal(tuning.factor, null, "tuned from no factor");
  assert.deepEqual(plain(tuning.words), plain(ANALYSIS.transcript));
  assert.equal(tuning.peaks.length, 3, "with the tracker's peaks");
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]]);

  t.clock.advance(SECOND);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.75);
  assert.deepEqual(rowView(t), sentenceRow(WAITING), "the next Talk take is tuned");
  block(t);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 150 wpm On target");
});

test("a factor kept while an untuned take records leaves that take on its line", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  // The first take is still being analyzed when the second starts.
  await t.recordTake(25 * SECOND);
  await t.startRecording();
  const second = lastTracker(t);
  block(t);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]], "Talk is tuned mid-take");
  for (let at = 0; at < 10; at += 1) {
    block(t);
    readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  }
  assert.deepEqual(rowView(t), sentenceRow(TALK_LINE), "for the whole take");
  assert.equal(second.reads, 0);
});

// --- what the row says, and how ---

test("the row stays aria-live off: the line is never announced", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  for (let second = 0; second < 31; second += 1) {
    block(t);
    readNext(t, READINGS[second % READINGS.length]);
  }
  const row = paceRow(t);
  assert.equal(rowView(t).text, TALK_LINE);
  assert.equal(row.getAttribute("aria-live"), "off");
  for (const name of ["role", "aria-label", "tabindex"]) {
    assert.equal(row.getAttribute(name), null, name);
  }
  assert.deepEqual(t.calls.announce, ["Recording started", "0:30"]);
});

test("the lines' 20 s is the speech a take needs to tune its mode, PACE_FACTOR_MIN_SECONDS", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  const seconds = app.delivery.PACE_FACTOR_MIN_SECONDS;
  assert.equal(typeof seconds, "number");
  // 30 words from 1 s whose last ends exactly that much speech later count; a hair less do not.
  const words = (lastEnd) =>
    Array.from({ length: 30 }, (_, i) =>
      i === 29
        ? { text: "word", start: lastEnd - 0.3, end: lastEnd }
        : { text: "word", start: 1 + i * 0.6, end: 1.3 + i * 0.6 },
    );
  assert.equal(app.delivery.countsForPaceFactor(words(1 + seconds), [2, 3, 4]), true);
  assert.equal(app.delivery.countsForPaceFactor(words(1 + seconds - 0.01), [2, 3, 4]), false);
  for (const line of [TALK_LINE, READ_LINE]) {
    assert.ok(line.includes(" " + seconds + " s "), line);
  }
  const how = read("how.html").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.ok(how.includes("your first take of " + seconds + " seconds or more"), "how.html");
});

test("each line lives in one string literal, in practice.js", () => {
  const sources = [
    "api.js",
    ...fs.readdirSync(path.join(FRONTEND, "screens")).map((file) => path.join("screens", file)),
  ];
  for (const line of [TALK_LINE, READ_LINE]) {
    const counts = Object.fromEntries(
      sources.map((file) => [file, read(file).split(line).length - 1]),
    );
    assert.equal(counts[path.join("screens", "practice.js")], 1, line);
    assert.equal(
      Object.values(counts).reduce((sum, count) => sum + count, 0),
      1,
      JSON.stringify(counts),
    );
  }
});

// --- with the real estimator ---

// Speech-like samples at 16384 Hz: voiced syllables (12 harmonics of 120 Hz under a raised
// cosine, each 75% of its period) from 0.5 s, 4 a second, as practice_live_pace.test.js makes.
function syllables(seconds) {
  const sampleRate = 16384;
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let t = 0.5; t < seconds - 0.5; t += 0.25) {
    const from = Math.round(t * sampleRate);
    const length = Math.round(0.25 * 0.75 * sampleRate);
    for (let k = 0; k < length && from + k < out.length; k += 1) {
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / length);
      let tone = 0;
      for (let h = 1; h <= 12; h += 1) {
        tone += Math.sin((2 * Math.PI * 120 * h * (from + k)) / sampleRate) / h;
      }
      out[from + k] = 0.15 * envelope * tone;
    }
  }
  return out;
}

test("with the real estimator an untuned take keeps its line, then tunes Talk for the next", async () => {
  const t = setup({ realDelivery: true, audio: { sampleRate: 16384 } });
  await t.show();
  await t.startRecording();
  const samples = syllables(26);
  const blockMs = (1024 / 16384) * 1000;
  const texts = new Set();
  for (let from = 0; from + 1024 <= samples.length; from += 1024) {
    block(t, samples.subarray(from, from + 1024));
    t.clock.advance(blockMs);
    texts.add(rowView(t).text);
  }
  assert.deepEqual([...texts], [TALK_LINE], "26 s of speech, and only the line");
  await t.stopRecording();
  t.resolveUpload();
  await flush();
  assert.equal(t.calls.setFlag.length, 1, "the take counted");
  const [[flag, factor]] = t.calls.setFlag;
  assert.equal(flag, TALK_FLAG);
  assert.ok(factor >= 0.45 && factor <= 1.1, String(factor));

  t.clock.advance(SECOND);
  await t.startRecording();
  assert.equal(rowView(t).text, WAITING, "the next Talk take waits for its number");
});
