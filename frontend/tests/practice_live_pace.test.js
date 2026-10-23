// Tests for the live pace row while a take records (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7, Capture, Display and the
// Validation result). A take opens an AudioContext of its own: MediaStreamSource ->
// ScriptProcessor(1024, 1, 1) -> a zero gain -> the output, and each block goes to an
// app.delivery.livePace tracker. Once the take's mode (Talk or Read) has a kept words-a-peak
// factor, a row in the timer shows the waiting sentence, then "About 150 wpm" and the cue; until
// then it says only when the live pace starts (practice_live_pace_untuned.test.js). It repaints
// once per new whole second from the clock's tick, is never announced, and shows only while a
// normal take records. A capture no block has reached by 0:03 goes, so a test whose take runs
// longer hands it a block first. Once a take's analysis is back, its mode's factor is tuned
// (app.delivery.paceFactorAfter) and kept in a store flag, never on the session. Every browser
// API is a fake the tests drive by hand. The estimator is a fake whose readings each test sets,
// with cue ids unlike delivery.js's own so the row must use app.delivery's; the last tests run
// the real one on synthetic syllables.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { byClass } = require("./fake-dom");
const { PASSAGE_MATERIAL, flush, levelRequest, plain, reaches } = require("./practice-harness");
const {
  ANALYSIS,
  CUE,
  DELIVERY_SOURCE,
  MESSAGES,
  READ_FLAG,
  SAVED_ID,
  SECOND,
  TALK_FLAG,
  WAITING,
  WORDS,
  assertReleased,
  block,
  graph,
  lastTracker,
  paceRow,
  readNext,
  rowView,
  setup,
} = require("./live-pace-harness");

// --- the cue ids ---

test("delivery.js exports the live row's cue ids beside HESITATION and HABIT", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  const { delivery } = app;
  assert.equal(delivery.ON_TARGET, "on-target");
  assert.equal(delivery.SLOW_DOWN, "slow-down");
  assert.equal(delivery.SPEED_UP, "speed-up");
  const keys = Object.keys(delivery);
  const habit = keys.indexOf("HABIT");
  assert.deepEqual(
    keys.slice(habit + 1, habit + 4),
    ["ON_TARGET", "SLOW_DOWN", "SPEED_UP"],
    "right after HESITATION and HABIT",
  );
  const cueAt = (estimate) =>
    delivery.nextLiveReading(null, { at: 6, estimate, quietSeconds: 0.2, band: [140, 160] }).cue;
  assert.equal(cueAt(150), delivery.ON_TARGET);
  assert.equal(cueAt(200), delivery.SLOW_DOWN);
  assert.equal(cueAt(90), delivery.SPEED_UP);
});

// --- the row ---

test("the row is a p after the limit bar in the timer, aria-live off, built hidden", () => {
  const t = setup();
  const timer = byClass(t.body, "practice__timer");
  assert.deepEqual(
    timer.children.map((child) => child.className),
    ["rec-dot", "timer num", "practice__limit num", "practice__limit-bar", "practice__pace"],
  );
  const row = paceRow(t);
  assert.equal(row.tagName, "p");
  assert.equal(row.getAttribute("aria-live"), "off");
  assert.equal(row.hidden, true);
  for (const name of ["role", "aria-label", "tabindex"]) {
    assert.equal(row.getAttribute(name), null, name);
  }
  // The body keeps its eight parts: the row lives inside the timer.
  assert.deepEqual(
    t.body.children.map((child) => child.className),
    [
      "segmented",
      "chip-row",
      "passage-card",
      "practice__timer",
      "btn-record",
      "btn-record__label",
      "practice__hint",
      "practice__state",
    ],
  );
});

test("a take opens its own audio context: source, ScriptProcessor(1024, 1, 1), zero gain, output", async () => {
  const t = setup();
  await t.startRecording();
  assert.equal(t.AudioContext.instances.length, 1);
  const g = graph(t);
  assert.equal(g.source.stream, t.streams[0]);
  assert.deepEqual([g.processor.bufferSize, g.processor.inputs, g.processor.outputs], [1024, 1, 1]);
  assert.equal(g.gain.gain.value, 0);
  assert.deepEqual(g.source.connections, [g.processor]);
  assert.deepEqual(g.processor.connections, [g.gain]);
  assert.deepEqual(g.gain.connections, [g.context.destination]);
  assert.equal(typeof g.processor.onaudioprocess, "function");
  // The tracker runs at the context's own rate, with the entry's band and no factor yet.
  const tracker = lastTracker(t);
  assert.equal(tracker.sampleRate, 48000);
  assert.deepEqual(plain(tracker.options.band), [140, 160]);
  assert.equal(tracker.options.factor, null);
  assert.equal(t.root.dataset.state, "recording");
});

test("the capture starts right after the pause sampler and leaves it and the mic request alone", async () => {
  const started = [];
  const pauses = (log) => ({
    start(stream) {
      log.push("pauses.start");
      started.push(stream);
    },
    stop() {
      log.push("pauses.stop");
      return [];
    },
    reconcile: (metrics) => metrics,
  });
  const t = setup({ pauses });
  await t.startRecording();
  assert.deepEqual(t.log, ["pauses.start", "AudioContext"]);
  assert.equal(started[0], t.streams[0], "the sampler gets the same stream");
  assert.deepEqual(plain(t.calls.constraints), [{ audio: true }]);
  assert.equal(t.AudioContext.instances.length, 1, "a context of its own, beside the sampler's");
});

test("a suspended context is resumed, as pauses.js does; a refused resume lets the capture go", async () => {
  for (const rejectResume of [false, true]) {
    const t = setup({ audio: { state: "suspended", rejectResume } });
    await t.startRecording();
    await flush();
    assert.equal(graph(t).context.resumes, 1, "resumed once");
    assert.equal(t.root.dataset.state, "recording");
    assert.equal(paceRow(t).hidden, rejectResume, rejectResume ? "refused: no row" : "resumed");
    assert.equal(graph(t).context.closes, rejectResume ? 1 : 0);
  }
  const running = setup();
  await running.startRecording();
  assert.equal(graph(running).context.resumes, 0, "a running context is left as it is");
});

test("webkitAudioContext stands in when there is no AudioContext", async () => {
  const t = setup({ audioGlobal: "webkitAudioContext" });
  await t.startRecording();
  assert.equal(t.AudioContext.instances.length, 1);
  assert.equal(paceRow(t).hidden, false);
});

test("each block's first channel goes to the tracker as it arrives", async () => {
  const t = setup();
  await t.startRecording();
  const first = new Float32Array(1024).fill(0.1);
  const second = new Float32Array(1024).fill(0.2);
  block(t, first);
  block(t, second);
  const tracker = lastTracker(t);
  assert.equal(tracker.blocks.length, 2);
  assert.equal(tracker.blocks[0], first);
  assert.equal(tracker.blocks[1], second);
});

test("a tuned take starts at the waiting sentence and keeps it until the tracker has a number", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
  const waiting = { hidden: false, parts: ["span.practice__pace-placeholder"], text: WAITING };
  assert.deepEqual(rowView(t), waiting);
  block(t);
  for (let second = 1; second <= 4; second += 1) {
    readNext(t, { wpm: null, cue: null });
    assert.deepEqual(rowView(t), waiting, "at " + second + " s");
  }
});

test("the cue is its words, then a 16px check icon hidden from screen readers", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
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
  const cue = paceRow(t).children[2];
  assert.equal(cue.textContent, "On target", "the words come first in the DOM");
  assert.equal(cue.children.length, 1);
  const icon = cue.children[0];
  assert.equal(icon.getAttribute("data-icon"), "check");
  assert.equal(icon.getAttribute("width"), "16");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
});

test("with a kept factor the row shows About 150 wpm, a space and the cue", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.8, "the tracker counts with the kept factor");
  assert.deepEqual(rowView(t).text, WAITING, "the number waits for the tracker too");
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
  assert.equal(paceRow(t).children[0].textContent, "About 150 wpm");
});

test("Slow down and Speed up carry the alert triangle in the warn tone, on Talk and on Read", async () => {
  for (const kind of ["Talk", "Read"]) {
    const t = setup({ flags: { [TALK_FLAG]: 0.7, [READ_FLAG]: 0.75 } });
    await t.show();
    byClass(t.body, "segmented").children.find((option) => option.textContent === kind).click();
    await t.startRecording();
    assert.equal(lastTracker(t).options.factor, kind === "Talk" ? 0.7 : 0.75, kind);
    readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
    assert.equal(rowView(t).text, "About 185 wpm Slow down");
    let cue = paceRow(t).children[paceRow(t).children.length - 1];
    assert.equal(cue.className, "practice__pace-cue practice__pace-cue--warn");
    assert.equal(cue.children[0].getAttribute("data-icon"), "alert");
    readNext(t, { wpm: 115, cue: CUE.SPEED_UP });
    assert.equal(rowView(t).text, "About 115 wpm Speed up");
    cue = paceRow(t).children[paceRow(t).children.length - 1];
    assert.equal(cue.className, "practice__pace-cue practice__pace-cue--warn");
    assert.equal(cue.children[0].getAttribute("data-icon"), "alert");
  }
});

test("the number is the estimator's, rounded there: the row writes it as it comes", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 152, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 152 wpm On target");
});

test("the row shows the cue the tracker holds, never one it judges from the number itself", async () => {
  // 200 is far over 140 to 160, but the tracker still holds On target (its 3 s hold).
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  readNext(t, { wpm: 200, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 200 wpm On target");
  readNext(t, { wpm: 120, cue: CUE.SLOW_DOWN });
  assert.equal(rowView(t).text, "About 120 wpm Slow down");
});

test("the row reads the tracker once per new whole second on the clock, from the clock's tick", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
  block(t);
  const tracker = lastTracker(t);
  t.clock.advance(750);
  assert.equal(tracker.reads, 0);
  t.clock.advance(250);
  assert.equal(tracker.reads, 1, "at 1 s");
  t.clock.advance(750);
  assert.equal(tracker.reads, 1);
  t.clock.advance(250);
  assert.equal(tracker.reads, 2, "at 2 s");
  t.clock.advance(10 * SECOND);
  assert.equal(tracker.reads, 12, "at 12 s");
});

test("the row's children are rebuilt only when its words change", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  block(t);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  const before = paceRow(t).children.slice();
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  t.practice.render("recording");
  assert.equal(paceRow(t).children.length, before.length);
  paceRow(t).children.forEach((child, index) => assert.equal(child, before[index]));
  readNext(t, { wpm: 155, cue: CUE.ON_TARGET });
  assert.notEqual(paceRow(t).children[0], before[0], "new words, new children");
  assert.equal(rowView(t).text, "About 155 wpm On target");
});

test("the row is shown only while recording: hidden in idle, uploading and error", async () => {
  const t = setup();
  assert.equal(paceRow(t).hidden, true, "idle");
  await t.startRecording();
  block(t);
  assert.equal(paceRow(t).hidden, false, "recording");
  t.practice.render("uploading");
  assert.equal(paceRow(t).hidden, true, "uploading");
  t.practice.render("error", { title: "Upload failed", body: MESSAGES.network });
  assert.equal(paceRow(t).hidden, true, "error");
  t.practice.render("recording");
  assert.equal(paceRow(t).hidden, false, "recording again");
  t.clock.advance(6 * SECOND);
  assert.equal(paceRow(t).hidden, false, "still recording at 0:06");
  await t.stopRecording();
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(paceRow(t).hidden, true, "idle after Stop");
});

test("in level mode every take is captured, but the row stays hidden in every state", async () => {
  const { request } = levelRequest();
  const t = setup();
  t.startLevel(request);
  assert.equal(paceRow(t).hidden, true, "idle");
  await t.startRecording();
  assert.equal(t.AudioContext.instances.length, 1, "the capture runs");
  assert.equal(t.app.delivery.trackers.length, 1);
  block(t);
  t.clock.advance(3 * SECOND);
  assert.equal(paceRow(t).hidden, true, "recording");
  t.clock.advance(3 * SECOND);
  await t.stopRecording();
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(paceRow(t).hidden, true, "uploading");
  t.rejectUpload("network");
  await flush();
  assert.equal(t.root.dataset.state, "error");
  assert.equal(paceRow(t).hidden, true, "error");
});

for (const [name, options] of [
  ["no AudioContext", { audioGlobal: "none" }],
  ["no estimator", { delivery: null }],
  ["an estimator without livePace", { delivery: { LIVE_PACE_FACTOR: 0.69 } }],
  ["a sample rate under 8 kHz", { audio: { sampleRate: 4000 } }],
  ["a context that cannot open", { audio: { failOnCreate: true } }],
  ["a source that cannot be made", { audio: { failAt: "source" } }],
  ["a ScriptProcessor that cannot be made", { audio: { failAt: "processor" } }],
  ["a gain that cannot be made", { audio: { failAt: "gain" } }],
]) {
  test(`a take whose capture did not start (${name}) records without the row`, async () => {
    const t = setup(options);
    await t.startRecording();
    assert.equal(t.root.dataset.state, "recording");
    assert.equal(paceRow(t).hidden, true);
    t.clock.advance(6 * SECOND);
    assert.equal(paceRow(t).hidden, true, "for the whole take");
    assert.equal(t.clock.activeIntervals(), 1);
    await t.stopRecording();
    assert.equal(t.calls.analyze.length, 1, "the take still uploads");
  });
}

test("the pace is never announced", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.startRecording();
  block(t);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  readNext(t, { wpm: 185, cue: CUE.SLOW_DOWN });
  for (let second = 0; second < 30; second += 1) {
    readNext(t, { wpm: 115, cue: CUE.SPEED_UP });
  }
  assert.deepEqual(t.calls.announce, ["Recording started", "0:30"]);
});

test("the row adds no interval, timeout or animation frame", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  await t.startRecording();
  block(t);
  assert.equal(t.clock.activeIntervals(), 1, "the clock's one 250 ms tick");
  for (let second = 0; second < 8; second += 1) {
    readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  }
  assert.equal(t.clock.activeIntervals(), 1);
  assert.equal(t.calls.timers, 0);
});

test("every take starts at the waiting sentence: nothing carries over", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.7 } });
  await t.show();
  await t.recordTake(8 * SECOND);
  await t.startRecording();
  assert.equal(t.app.delivery.trackers.length, 2, "a new tracker for the new take");
  assert.deepEqual(rowView(t).text, WAITING);
  block(t);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t).text, "About 150 wpm On target");
  t.clock.advance(5 * SECOND);
  await t.stopRecording();
  t.clock.advance(SECOND);
  await t.startRecording();
  assert.equal(t.app.delivery.trackers.length, 3);
  assert.deepEqual(rowView(t).text, WAITING);
});

// --- letting the capture go ---

test("Stop lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  block(t);
  const g = graph(t);
  t.clock.advance(8 * SECOND);
  await t.stopRecording();
  assertReleased(g);
  assert.equal(paceRow(t).hidden, true);
});

test("the track ending on its own lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  block(t);
  const g = graph(t);
  t.clock.advance(8 * SECOND);
  t.MediaRecorder.last.finish();
  await flush();
  assertReleased(g);
  assert.equal(t.calls.analyze.length, 1);
});

test("leaving mid-take lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  block(t);
  const g = graph(t);
  t.clock.advance(3 * SECOND);
  t.practice.hide();
  assertReleased(g);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(paceRow(t).hidden, true);
});

test("a take under 5 seconds lets the capture go", async () => {
  const t = setup();
  await t.startRecording();
  block(t);
  const g = graph(t);
  t.clock.advance(3 * SECOND);
  await t.stopRecording();
  assert.equal(t.root.dataset.state, "error");
  assertReleased(g);
  assert.equal(paceRow(t).hidden, true);
});

test("a level take's Stop lets the capture go", async () => {
  const { request } = levelRequest();
  const t = setup();
  t.startLevel(request);
  await t.startRecording();
  block(t);
  const g = graph(t);
  t.clock.advance(8 * SECOND);
  await t.stopRecording();
  assertReleased(g);
});

test("a throw while the graph is built lets go of what was made", async () => {
  for (const failAt of ["processor", "gain"]) {
    const t = setup({ audio: { failAt } });
    await t.startRecording();
    const g = graph(t);
    assert.ok(g.source.disconnects >= 1, "the source is disconnected");
    if (g.processor) {
      assert.ok(g.processor.disconnects >= 1, "the processor is disconnected");
      assert.equal(g.processor.onaudioprocess, null);
    }
    assert.equal(g.context.closes, 1, "the context is closed");
    assert.equal(t.root.dataset.state, "recording", "the take records on");
  }
});

test("a tracker that cannot run at the context's rate lets the context go", async () => {
  const t = setup({ audio: { sampleRate: 4000 } });
  await t.startRecording();
  const { context } = graph(t);
  assert.equal(context.closes, 1);
  assert.equal(t.app.delivery.trackers.length, 0);
});

// --- tuning the factor ---

test("after the take's analysis its mode's factor is tuned once and kept in its own flag", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND, { firstBlockMs: 120, peaks: [0.5, 1, 1.5] });
  assert.equal(t.app.delivery.tunings.length, 0, "nothing before the analysis");
  t.resolveUpload();
  await flush();
  assert.equal(t.app.delivery.tunings.length, 1);
  const [tuning] = t.app.delivery.tunings;
  assert.equal(tuning.factor, null, "no factor kept yet");
  assert.deepEqual(plain(tuning.words), plain(ANALYSIS.transcript));
  // The peaks count from the first block's first sample, its 1024 samples (21.3 ms at 48 kHz)
  // before the block came 0.12 s after the recorder started; the words count from the
  // recorder's start.
  assert.deepEqual(
    tuning.peaks.map((peak) => Math.round(peak * 1000) / 1000),
    [0.599, 1.099, 1.599],
  );
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]]);
  assert.equal(t.flags.get(TALK_FLAG), 0.75);
});

test("a kept factor shows the number from the next take of that mode on", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.75);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "About 150 wpm On target");
  t.practice.hide();
  // Read has no factor yet: its row still says when the live pace starts.
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null);
  assert.deepEqual(plain(lastTracker(t).options.band), [150, 170]);
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.deepEqual(rowView(t), {
    hidden: false,
    parts: ["span.practice__pace-placeholder"],
    text: "Live pace starts after a 20 s read.",
  });
});

test("show() reads each mode's factor from its flag; anything but a number counts as none", async () => {
  const t = setup({ flags: { [TALK_FLAG]: "0.8", [READ_FLAG]: 0.9 } });
  await t.show();
  assert.deepEqual(t.calls.getFlag.slice().sort(), [READ_FLAG, TALK_FLAG]);
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "Talk's flag is no number");
  t.practice.hide();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9);
});

test("a Read passage, or a Talk take with a pasted script, records with the Read factor", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.6, [READ_FLAG]: 0.9 } });
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.6, "Talk");
  t.practice.hide();
  pasteScript(t, "My speech, word for word.");
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9, "Talk with a script is sent as a read");
  t.practice.hide();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.9, "a Read passage");
});

// The analysis of a take that followed its script: the backend adds a script block.
function withScriptBlock(analysis) {
  return { ...analysis, metrics: { ...analysis.metrics, script: { skipped: [] } } };
}

// Pastes `text` into Talk's script box.
function pasteScript(t, text) {
  const box = byClass(byClass(t.body, "practice__hint"), "practice__script");
  box.children.find((child) => child.tagName === "textarea").value = text;
}

test("the take is tuned in the mode app.language.isReadTake gives its saved session", async () => {
  // A Talk take sent with a script it strayed from: no script block, so it counts as Talk,
  // though it recorded as a read.
  const strayed = setup({ flags: { [TALK_FLAG]: 0.6, [READ_FLAG]: 0.9 } });
  await strayed.show();
  pasteScript(strayed, "My speech, word for word.");
  strayed.app.delivery.nextFactor = 0.65;
  await strayed.recordTake(25 * SECOND);
  assert.equal(lastTracker(strayed).options.factor, 0.9, "recorded with Read's factor");
  strayed.resolveUpload();
  await flush();
  assert.equal(strayed.app.delivery.tunings[0].factor, 0.6, "tuned from Talk's factor");
  assert.deepEqual(plain(strayed.calls.setFlag), [[TALK_FLAG, 0.65]]);

  // A Talk take that followed its script carries a script block: it counts as Read.
  const followed = setup({ flags: { [TALK_FLAG]: 0.6, [READ_FLAG]: 0.9 } });
  await followed.show();
  pasteScript(followed, "My speech, word for word.");
  followed.app.delivery.nextFactor = 0.85;
  await followed.recordTake(25 * SECOND);
  followed.resolveUpload(withScriptBlock(ANALYSIS));
  await flush();
  assert.equal(followed.app.delivery.tunings[0].factor, 0.9, "tuned from Read's factor");
  assert.deepEqual(plain(followed.calls.setFlag), [[READ_FLAG, 0.85]]);
});

test("without language.js the take is tuned in the mode it was recorded in", async () => {
  const t = setup({ language: false });
  await t.show();
  byClass(t.body, "segmented").children.find((option) => option.textContent === "Read").click();
  t.app.delivery.nextFactor = 0.8;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.setFlag), [[READ_FLAG, 0.8]]);
});

test("a take that does not count keeps no factor", async () => {
  // No factor kept: a take that does not count gives back LIVE_PACE_FACTOR.
  const fresh = setup();
  await fresh.show();
  await fresh.recordTake(25 * SECOND);
  fresh.resolveUpload();
  await flush();
  assert.equal(fresh.app.delivery.tunings.length, 1);
  assert.deepEqual(fresh.calls.setFlag, []);
  await fresh.startRecording();
  assert.equal(lastTracker(fresh).options.factor, null, "still none");

  const kept = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await kept.show();
  await kept.recordTake(25 * SECOND);
  kept.resolveUpload();
  await flush();
  assert.equal(kept.app.delivery.tunings[0].factor, 0.8);
  assert.deepEqual(kept.calls.setFlag, []);
});

test("Retry never tunes a take twice", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  t.failures.save = 1;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  const banner = t.app.ui.banner.current();
  assert.equal(banner.title, "Upload failed");
  assert.equal(t.app.delivery.tunings.length, 1);
  banner.actions[0].onClick();
  await flush();
  assert.equal(t.calls.save.length, 2, "the save was tried again");
  assert.equal(t.calls.analyze.length, 1, "with the analysis it kept");
  assert.equal(t.app.delivery.tunings.length, 1, "and no second tuning");
  assert.deepEqual(plain(t.calls.setFlag), [[TALK_FLAG, 0.75]]);
});

test("a store that cannot keep the factor changes nothing the speaker sees", async () => {
  const t = setup();
  await t.show();
  t.failures.setFlag = true;
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND);
  t.resolveUpload();
  await flush();
  assert.equal(t.calls.setFlag.length, 1, "it tried");
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.app.ui.banner.current(), null);
  assert.equal(t.root.dataset.state, "idle");
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, null, "no factor was kept");
  readNext(t, { wpm: 150, cue: CUE.ON_TARGET });
  assert.equal(rowView(t).text, "Live pace starts after a 20 s talk.");
});

test("a store that cannot be read leaves the factors as they were", async () => {
  const t = setup({ flags: { [TALK_FLAG]: 0.8 } });
  await t.show();
  t.failures.getFlag = true;
  await t.show();
  await t.startRecording();
  assert.equal(lastTracker(t).options.factor, 0.8);
});

test("a take without a capture, or one no block reached, tunes nothing", async () => {
  const silent = setup({ audioGlobal: "none" });
  await silent.show();
  await silent.startRecording();
  silent.clock.advance(25 * SECOND);
  await silent.stopRecording();
  silent.resolveUpload();
  await flush();
  assert.equal(silent.app.delivery.tunings.length, 0);
  assert.deepEqual(silent.calls.setFlag, []);

  const blockless = setup();
  await blockless.show();
  await blockless.startRecording();
  blockless.clock.advance(25 * SECOND);
  await blockless.stopRecording();
  blockless.resolveUpload();
  await flush();
  assert.equal(blockless.app.delivery.tunings.length, 0);
  assert.deepEqual(blockless.calls.setFlag, []);
});

test("the sample is never tuned on", async () => {
  const sample = {
    passageId: "explain-something",
    passageTitle: "Sample: Explain something",
    durationSeconds: 34,
    metrics: { words_per_minute: 152.6, pauses: [] },
    transcript: WORDS,
  };
  const fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(plain(sample)) });
  const t = setup({ fetch });
  await t.show();
  byClass(byClass(t.body, "practice__hint"), "practice__sample").click();
  await flush();
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.app.delivery.tunings.length, 0);
  assert.deepEqual(t.calls.setFlag, []);
});

test("nothing of the live pace reaches the saved session", async () => {
  const t = setup();
  await t.show();
  t.app.delivery.nextFactor = 0.75;
  await t.recordTake(25 * SECOND, { peaks: [0.5, 1, 1.5] });
  const tracker = lastTracker(t);
  t.resolveUpload();
  await flush();
  const [session] = t.calls.save;
  assert.deepEqual(Object.keys(session), [
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "transcript",
  ]);
  assert.deepEqual(plain(session.metrics), plain(ANALYSIS.metrics));
  assert.ok(!JSON.stringify(session).includes("0.75"), "no factor");
  assert.ok(!reaches(session, tracker), "no tracker");
  assert.ok(!/pace|factor|peak/i.test(JSON.stringify(Object.keys(session.metrics))));
});

test("a level take tunes its mode too", async () => {
  const { request } = levelRequest({ material: { ...PASSAGE_MATERIAL, targetWpm: [140, 160] } });
  const t = setup();
  await t.show();
  t.startLevel(request);
  t.app.delivery.nextFactor = 0.8;
  await t.recordTake(25 * SECOND);
  t.resolveUpload(withScriptBlock(ANALYSIS));
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(t.app.delivery.tunings.length, 1);
  assert.deepEqual(plain(t.calls.setFlag), [[READ_FLAG, 0.8]]);
});

// --- with the real estimator ---

// Speech-like samples at `sampleRate`: voiced syllables (12 harmonics of 120 Hz under a raised
// cosine, each 75% of its period) from 0.5 s, at `rateFor(t)` syllables a second.
function syllables(sampleRate, seconds, rateFor) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let t = 0.5; t < seconds - 0.5; ) {
    const period = 1 / rateFor(t);
    const from = Math.round(t * sampleRate);
    const length = Math.round(period * 0.75 * sampleRate);
    for (let k = 0; k < length && from + k < out.length; k += 1) {
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / length);
      let tone = 0;
      for (let h = 1; h <= 12; h += 1) {
        tone += Math.sin((2 * Math.PI * 120 * h * (from + k)) / sampleRate) / h;
      }
      out[from + k] = 0.15 * envelope * tone;
    }
    t += period;
  }
  return out;
}

// Records `samples` through the real estimator: before each tick of the clock one more block, so
// at every whole second the row reads exactly that much audio (1024 samples is 62.5 ms at
// 16384 Hz). Returns the row's text at each whole second.
async function recordThroughEstimator(t, samples) {
  await t.startRecording();
  const texts = [];
  const blockMs = (1024 / 16384) * 1000;
  for (let from = 0; from + 1024 <= samples.length; from += 1024) {
    block(t, samples.subarray(from, from + 1024));
    t.clock.advance(blockMs);
    if (Math.round(t.clock.performance.now()) % SECOND === 0) {
      texts.push(rowView(t).text);
    }
  }
  return texts;
}

// Practice on the real estimator at 16384 Hz, with a kept Talk factor of 0.69.
function withRealEstimator() {
  return setup({ realDelivery: true, audio: { sampleRate: 16384 }, flags: { [TALK_FLAG]: 0.69 } });
}

test("with the real estimator the row waits for 5 s of speech, then shows a number rounded to 5", async () => {
  const t = withRealEstimator();
  await t.show();
  const texts = await recordThroughEstimator(t, syllables(16384, 12, () => 4));
  assert.deepEqual(texts.slice(0, 5), Array(5).fill(WAITING), "1 to 5 s: not 5 s of speech yet");
  const numbers = texts.slice(5).map((text) => /^About (\d+) wpm On target$/.exec(text));
  assert.ok(numbers.every(Boolean), JSON.stringify(texts.slice(5)));
  for (const [, wpm] of numbers) {
    assert.equal(Number(wpm) % 5, 0, wpm);
    // 4 syllables a second at 0.69 words a syllable is 165.6 wpm.
    assert.ok(Math.abs(Number(wpm) - 165.6) <= 15, wpm);
  }
});

test("with the real estimator a new cue waits until the number has called for it for 3 s", async () => {
  const t = withRealEstimator();
  await t.show();
  // 4 syllables a second for 10 s (about 165 wpm), then 5.5 (about 228 wpm).
  const rate = (at) => (at < 10.5 ? 4 : 5.5);
  const texts = await recordThroughEstimator(t, syllables(16384, 24, rate));
  const readings = texts
    .map((text) => /^About (\d+) wpm (On target|Slow down|Speed up)$/.exec(text))
    .filter(Boolean)
    .map(([, wpm, cue]) => ({ wpm: Number(wpm), cue }));
  // The band is 140 to 160: Slow down is called for over 170.
  const over = readings.findIndex((reading) => reading.wpm > 170);
  assert.ok(over > 0, JSON.stringify(readings));
  assert.ok(readings.slice(over, over + 4).every((reading) => reading.wpm > 170));
  assert.deepEqual(
    readings.slice(over - 1, over + 4).map((reading) => reading.cue),
    ["On target", "On target", "On target", "On target", "Slow down"],
  );
});
