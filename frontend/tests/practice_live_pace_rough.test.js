// Tests for the live pace row of a take whose mode has no kept factor yet (frontend/screens/
// practice.js; spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7,
// "Rough pace before tuning (2026-10-24)"). Such a take runs the same live estimate as a tuned
// one, with the starting factor (delivery.js LIVE_PACE_FACTOR, 0.69 words a peak): the waiting
// sentence until the tracker has a number, then "About N wpm" and, in the cue's place, "Rough
// until tuned" in the waiting sentence's look, with no icon and never a cue (On target, Slow
// down, Speed up): uncalibrated the median error is 22%, and in the app the untuned cue was right
// on only 1 of 4 first takes. A screen reader reads "About 150 wpm Rough until tuned", a text
// space between the two, as the number and the cue have. The take still tunes its mode when it
// counts, so the next take of that mode shows its number with a cue and no rough words, while
// the other mode stays rough. Level mode never shows the row, and a capture no audio reaches by
// 0:03 hides it, keeping its box. Every browser API is a fake the tests drive by hand; the tests
// that check the number run the real estimator on synthetic syllables.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { byClass } = require("./fake-dom");
const { flush, levelRequest, plain } = require("./practice-harness");
const {
  CUE,
  DELIVERY_SOURCE,
  READ_FLAG,
  SECOND,
  TALK_FLAG,
  WAITING,
  block,
  graph,
  lastTracker,
  paceRow,
  readNext,
  rowView,
  setup,
} = require("./live-pace-harness");

const FRONTEND = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");

const ROUGH = "Rough until tuned";
const RETIRED = ["Live pace starts after a 30 s talk.", "Live pace starts after a 30 s read."];

// What the tracker could say at any second: a number with each of the three cues.
const READINGS = [
  { wpm: 150, cue: CUE.ON_TARGET },
  { wpm: 185, cue: CUE.SLOW_DOWN },
  { wpm: 115, cue: CUE.SPEED_UP },
];

// The row holding the waiting sentence alone, in the placeholder look.
const WAITING_ROW = Object.freeze({
  hidden: false,
  parts: ["span.practice__pace-placeholder"],
  text: WAITING,
});

// An untuned row with a number: the number, a text space, then the rough words, and nothing more.
function roughRow(wpm) {
  return {
    hidden: false,
    parts: ["span.practice__pace-number num", '" "', "span.practice__pace-rough"],
    text: "About " + wpm + " wpm " + ROUGH,
  };
}

// Every element below `node`, itself included.
function elementsIn(node) {
  return [node, ...(node.children || []).flatMap((child) => elementsIn(child))].filter(
    (each) => each.nodeType !== 3,
  );
}

// No cue node and no icon anywhere in the row.
function assertNoCue(t, label) {
  const elements = elementsIn(paceRow(t));
  for (const element of elements) {
    assert.ok(!element.className.includes("practice__pace-cue"), label + ": no cue node");
    assert.notEqual(element.tagName, "svg", label + ": no icon");
  }
}

function chooseRead(t) {
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
}

// Pastes `text` into Talk's script box.
function pasteScript(t, text) {
  const box = byClass(byClass(t.body, "practice__hint"), "practice__script");
  box.children.find((child) => child.tagName === "textarea").value = text;
}

// --- an untuned take: waiting, then the rough number ---

test("an untuned Talk take shows the waiting sentence, then About N wpm and Rough until tuned", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "no factor kept for Talk");
  assert.deepEqual(rowView(t), WAITING_ROW, "first paint");
  block(t);
  readNext(t, { wpm: null, cue: null });
  assert.deepEqual(rowView(t), WAITING_ROW, "no number yet");
  for (const reading of READINGS) {
    readNext(t, reading);
    assert.deepEqual(rowView(t), roughRow(reading.wpm), JSON.stringify(reading));
    assertNoCue(t, JSON.stringify(reading));
  }
  assert.equal(lastTracker(t).reads, 4, "read once a second, as a tuned take is");
});

test("an untuned Read take, and a Talk take sent with a script, show the rough number too", async () => {
  const reading = setup();
  await reading.show();
  chooseRead(reading);
  await reading.startRecording();
  assert.equal(lastTracker(reading).options.factor, null, "no factor kept for Read");
  assert.deepEqual(plain(lastTracker(reading).options.band), [150, 170], "the passage's band");
  assert.deepEqual(rowView(reading), WAITING_ROW, "first paint");
  for (const next of READINGS) {
    block(reading);
    readNext(reading, next);
    assert.deepEqual(rowView(reading), roughRow(next.wpm), JSON.stringify(next));
    assertNoCue(reading, JSON.stringify(next));
  }

  const scripted = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await scripted.show();
  pasteScript(scripted, "My speech, word for word.");
  await scripted.startRecording();
  assert.equal(lastTracker(scripted).options.factor, null, "recorded as a read, with no factor");
  assert.deepEqual(rowView(scripted), WAITING_ROW);
  block(scripted);
  readNext(scripted, { wpm: 160, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(scripted), roughRow(160));
});

test("a rough row keeps its number when the tracker's number holds, and repaints when it moves", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  block(t);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  const [number] = paceRow(t).children;
  // A new cue alone changes nothing the rough row shows.
  readNext(t, { wpm: 150, cue: CUE.SLOW_DOWN });
  assert.equal(paceRow(t).children[0], number, "the same span: the words never changed");
  readNext(t, { wpm: 155, cue: CUE.SLOW_DOWN });
  assert.deepEqual(rowView(t), roughRow(155));
  assert.notEqual(paceRow(t).children[0], number, "rebuilt with the new number");
});

// --- what a screen reader reads ---

test("the rough row reads as one line with a text space between the number and the rough words", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  block(t);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  const row = paceRow(t);
  assert.equal(row.children.length, 3);
  const [number, space, rough] = row.children;
  assert.equal(number.textContent, "About 150 wpm");
  assert.equal(space.nodeType, 3, "a text node, which a screen reader keeps");
  assert.equal(space.textContent, " ");
  assert.equal(rough.textContent, ROUGH);
  assert.equal(rough.children.length, 0, "words only, no icon");
  assert.equal(rowView(t).text, "About 150 wpm Rough until tuned");
  assert.equal(row.getAttribute("aria-live"), "off");
  assert.deepEqual(t.calls.announce, ["Recording started"], "nothing of the row is announced");
});

// --- tuning ---

test("once Talk is tuned its next take shows a cue and no rough words, while Read stays rough", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  for (let second = 0; second < 25; second += 1) {
    block(t);
    readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  }
  assert.deepEqual(rowView(t), roughRow(150), "the untuned take, at 0:25");
  lastTracker(t).peakTimes = [0.5, 1, 1.5];
  t.app.delivery.nextFactor = 0.75;
  await t.stopRecording();
  t.resolveUpload();
  await flush();
  assert.equal(t.app.delivery.tunings.length, 1);
  assert.equal(t.app.delivery.tunings[0].factor, null, "tuned from no factor");
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]]);

  t.clock.advance(SECOND);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.75);
  assert.deepEqual(rowView(t), WAITING_ROW, "the tuned Talk take waits for its number");
  block(t);
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
  assert.ok(!rowView(t).text.includes(ROUGH), "no rough words once tuned");
  t.practice.hide();

  chooseRead(t);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "Read has no factor yet");
  block(t);
  readNext(t, { wpm: 160, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t), roughRow(160), "Read is still rough");
  assertNoCue(t, "Read");
});

test("a Read take that counts tunes Read, and Talk stays rough until a Talk take does", async () => {
  const t = setup({ language: false });
  await t.show();
  chooseRead(t);
  t.app.delivery.nextFactor = 0.9;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[READ_FLAG, 0.9]]);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9);
  block(t);
  readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
  assert.equal(rowView(t).text, "About 185 wpm Slow down", "Read is tuned");
  t.practice.hide();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Talk").click();
  await t.startRecording();
  block(t);
  readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
  assert.deepEqual(rowView(t), roughRow(185), "Talk is still rough");
});

test("a factor kept while an untuned take records leaves that take rough to its end", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  // The first take is still being analyzed when the second starts.
  await t.recordTake(25 * SECOND);
  await t.startRecording();
  block(t);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]], "Talk is tuned mid-take");
  for (let at = 0; at < 10; at += 1) {
    block(t);
    readNext(t, READINGS[at % READINGS.length]);
    assert.deepEqual(rowView(t), roughRow(READINGS[at % READINGS.length].wpm), "at " + at);
  }
  assertNoCue(t, "for the whole take");
});

// --- level mode and a capture no audio reaches ---

test("level mode never shows the row, rough or tuned, and its takes still tune", async () => {
  for (const tuned of [false, true]) {
    const label = tuned ? "tuned" : "untuned";
    const t = setup({ flags: tuned ? { [TALK_FLAG]: 0.8 } : {} });
    t.startLevel(levelRequest().request);
    await flush();
    await t.startRecording();
    const tracker = lastTracker(t);
    for (let second = 0; second < 25; second += 1) {
      block(t);
      readNext(t, READINGS[second % READINGS.length]);
      assert.equal(paceRow(t).hidden, true, label + " at " + second);
      assert.deepEqual(paceRow(t).children, [], label + ": nothing painted");
    }
    assert.equal(tracker.reads, 0, label + ": never read in level mode");
    tracker.peakTimes = [0.5, 1, 1.5];
    t.app.delivery.nextFactor = 0.75;
    await t.stopRecording();
    t.resolveUpload();
    await flush();
    assert.equal(t.app.delivery.tunings.length, 1, label);
    assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]], label + ": the take tunes");
  }
});

test("an untuned capture no block reached by 0:03 hides its row there, keeping its box", async () => {
  const t = setup();
  await t.show();
  await t.startRecording();
  const g = graph(t);
  const tracker = lastTracker(t);
  t.clock.advance(3 * SECOND - 1);
  assert.deepEqual(rowView(t), WAITING_ROW, "the waiting sentence at 0:02");
  assert.equal(tracker.reads, 2, "read at 0:01 and 0:02, as a tuned take is");
  const [sentence] = paceRow(t).children;
  t.clock.advance(1);
  assert.equal(g.context.closes, 1, "the context is closed");
  assert.equal(paceRow(t).hidden, true, "hidden at 0:03");
  assert.ok(paceRow(t).classList.contains("practice__pace--held"), "its box is held");
  assert.equal(paceRow(t).children[0], sentence, "the same words, so the same box");
  t.clock.advance(20 * SECOND);
  assert.equal(paceRow(t).hidden, true, "for the rest of the take");
  assert.equal(tracker.reads, 2, "never read again");
  await t.stopRecording();
  assert.ok(!paceRow(t).classList.contains("practice__pace--held"), "the take's end lets it go");
  t.app.delivery.nextFactor = 0.75;
  t.resolveUpload();
  await flush();
  assert.equal(t.app.delivery.tunings.length, 0, "it tunes nothing");
});

// --- the copy ---

test("the rough words live in one string literal, in practice.js, and the old lines nowhere", () => {
  const sources = [
    "api.js",
    "how.html",
    "index.html",
    ...fs.readdirSync(path.join(FRONTEND, "screens")).map((file) => path.join("screens", file)),
  ];
  const counts = Object.fromEntries(
    sources.map((file) => [file, read(file).split('"' + ROUGH + '"').length - 1]),
  );
  assert.equal(counts[path.join("screens", "practice.js")], 1, JSON.stringify(counts));
  assert.equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    1,
    JSON.stringify(counts),
  );
  for (const file of sources) {
    const source = read(file);
    for (const line of RETIRED) {
      for (const spelling of [line, line.replace(/ /g, "\\u00a0"), line.replace(/ /g, " ")]) {
        assert.ok(!source.includes(spelling), file + " still says " + spelling);
      }
    }
    assert.ok(!source.includes("PACE_STARTS_AFTER"), file + " keeps a retired constant");
  }
});

test("styles.css gives the rough words no look of their own but one unbroken line", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selectors, body]) => ({ selectors: selectors.trim(), body: body.trim() }))
    .filter((rule) => rule.selectors.includes("practice__pace-rough"));
  assert.equal(rules.length, 1, "one rule names the rough words");
  assert.deepEqual(
    rules[0].selectors.split(",").map((selector) => selector.trim()),
    [".practice__pace-number", ".practice__pace-cue", ".practice__pace-rough"],
  );
  assert.equal(rules[0].body.replace(/\s+/g, " "), "white-space: nowrap;");
});

// WCAG relative luminance of a #RRGGBB colour, and the contrast ratio of two.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test("the rough words' --muted keeps 4.5:1 on --bg and --surface, light and dark", () => {
  const css = read("styles.css");
  const blocks = [
    css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))),
    css.slice(
      css.indexOf(':root:not([data-theme="light"]) {'),
      css.indexOf("}", css.indexOf(':root:not([data-theme="light"]) {')),
    ),
    css.slice(
      css.indexOf(':root[data-theme="dark"] {'),
      css.indexOf("}", css.indexOf(':root[data-theme="dark"] {')),
    ),
  ];
  for (const scheme of blocks) {
    const token = (name) => new RegExp("--" + name + ":\\s*(#[0-9A-Fa-f]{6});").exec(scheme)[1];
    for (const ground of ["bg", "surface"]) {
      const ratio = contrast(token("muted"), token(ground));
      assert.ok(ratio >= 4.5, token("muted") + " on " + token(ground) + ": " + ratio.toFixed(2));
    }
  }
});

// --- with the real estimator ---

// Speech-like samples at 16384 Hz: voiced syllables (12 harmonics of 120 Hz under a raised
// cosine, each 75% of its period) from 0.5 s, `rate` a second, as practice_live_pace.test.js
// makes.
function syllables(seconds, rate) {
  const sampleRate = 16384;
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let t = 0.5; t < seconds - 0.5; t += 1 / rate) {
    const from = Math.round(t * sampleRate);
    const length = Math.round((0.75 / rate) * sampleRate);
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

// Records `samples` through Practice on the real estimator, block by block, and pushes the same
// blocks into `twin`, a tracker of the test's own; at every whole second, once the row has read
// its tracker, the twin is read too. Returns [row text, twin reading] at each whole second.
async function recordBesideTwin(t, samples, twin) {
  await t.startRecording();
  const seconds = [];
  const blockMs = (1024 / 16384) * 1000;
  for (let from = 0; from + 1024 <= samples.length; from += 1024) {
    const piece = samples.subarray(from, from + 1024);
    block(t, piece);
    twin.push(piece);
    t.clock.advance(blockMs);
    if (Math.round(t.clock.performance.now()) % SECOND === 0) {
      seconds.push([rowView(t).text, twin.read()]);
    }
  }
  return seconds;
}

test("the rough number is the estimate at the starting factor, LIVE_PACE_FACTOR 0.69", async () => {
  const t = setup({ realDelivery: true, audio: { sampleRate: 16384 } });
  const delivery = t.app.delivery;
  assert.equal(delivery.LIVE_PACE_FACTOR, 0.69);
  await t.show();
  const twin = delivery.livePace(16384, { band: [140, 160], factor: 0.69 });
  const seconds = await recordBesideTwin(t, syllables(14, 4), twin);
  assert.equal(seconds.length, 14);
  assert.deepEqual(
    seconds.slice(0, 5).map(([text]) => text),
    Array(5).fill(WAITING),
    "1 to 5 s: not 5 s of speech yet",
  );
  for (const [index, [text, reading]] of seconds.entries()) {
    const expected = reading.wpm === null ? WAITING : "About " + reading.wpm + " wpm " + ROUGH;
    assert.equal(text, expected, "at " + (index + 1) + " s");
  }
  const numbers = seconds.slice(5).map(([, reading]) => reading.wpm);
  for (const wpm of numbers) {
    assert.equal(wpm % 5, 0, String(wpm));
    // 4 syllables a second at 0.69 words a syllable is 165.6 wpm.
    assert.ok(Math.abs(wpm - 165.6) <= 15, String(wpm));
  }
  assertNoCue(t, "real estimator");
});

test("with the real estimator a rough take tunes Talk, and the next shows a cue", async () => {
  const t = setup({ realDelivery: true, audio: { sampleRate: 16384 } });
  await t.show();
  const twin = t.app.delivery.livePace(16384, { band: [140, 160], factor: 0.69 });
  const seconds = await recordBesideTwin(t, syllables(26, 4), twin);
  assert.ok(
    seconds.slice(5).every(([text]) => text.endsWith(" wpm " + ROUGH)),
    JSON.stringify(seconds.map(([text]) => text)),
  );
  await t.stopRecording();
  t.resolveUpload();
  await flush();
  assert.equal(t.calls.setFlag.length, 1, "the take counted");
  const [[flag, factor]] = t.calls.setFlag;
  assert.equal(flag, TALK_FLAG);
  assert.ok(factor >= 0.45 && factor <= 1.1, String(factor));

  t.clock.advance(SECOND);
  const tunedTwin = t.app.delivery.livePace(16384, { band: [140, 160], factor });
  const next = await recordBesideTwin(t, syllables(12, 4), tunedTwin);
  assert.deepEqual(
    next.slice(0, 5).map(([text]) => text),
    Array(5).fill(WAITING),
    "the next Talk take waits for its number",
  );
  const cues = { "on-target": "On target", "slow-down": "Slow down", "speed-up": "Speed up" };
  for (const [text, reading] of next.slice(5)) {
    assert.equal(text, "About " + reading.wpm + " wpm " + cues[reading.cue], text);
  }
});

// The real delivery module, on its own, for the factor checks.
test("delivery.js counts a missing factor as LIVE_PACE_FACTOR, so a rough take uses 0.69", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  const { delivery } = app;
  const peaks = Array.from({ length: 40 }, (_, i) => 0.5 + i * 0.25);
  const at = 10.5;
  assert.equal(delivery.livePaceAt(peaks, at, null), delivery.livePaceAt(peaks, at, 0.69));
  assert.notEqual(delivery.livePaceAt(peaks, at, null), delivery.livePaceAt(peaks, at, 0.8));
});
