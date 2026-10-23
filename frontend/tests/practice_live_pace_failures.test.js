// Tests for the live pace capture when part of a take cannot start (frontend/screens/practice.js;
// spec docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7, Capture and
// Display). A recorder that cannot start means no take: the live pace capture, the microphone and
// the pause sampler all go at once, the block a refused microphone shows takes the record zone,
// and the next take's capture is the only one left open. A context that refuses to resume never
// hands over a block, so its capture goes too and the row hides for the rest of the take; so
// does one whose resume() has not answered by 0:03, since no block has reached it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { byClass } = require("./fake-dom");
const { flush } = require("./practice-harness");
const { SECOND, assertReleased, block, graph, paceRow, setup } = require("./live-pace-harness");

const MIC_BLOCKED_TITLE = "Microphone blocked";
const MIC_BLOCKED_BODY =
  "Microphone is blocked. Allow it in your browser settings, then try again.";
const MIC_BLOCKED_ACTION = "Try again";

// A pause sampler that logs its calls in the setup's log, beside each AudioContext made.
function loggedPauses(log) {
  return {
    start() {
      log.push("pauses.start");
    },
    stop() {
      log.push("pauses.stop");
      return [];
    },
    reconcile: (metrics) => metrics,
  };
}

// The ways a browser can refuse to record a stream it has granted: the recorder's start()
// throws, the recorder cannot be made for it, or there is no MediaRecorder at all.
const RECORDER_FAILURES = [
  [
    "start() throws",
    (t) => {
      t.MediaRecorder.prototype.start = () => {
        throw new Error("start refused");
      };
    },
  ],
  [
    "the recorder cannot be made",
    (t) => {
      t.context.MediaRecorder = class {
        static isTypeSupported() {
          return true;
        }

        constructor() {
          throw new Error("type refused");
        }
      };
    },
  ],
  [
    "the browser has no MediaRecorder",
    (t) => {
      delete t.context.MediaRecorder;
    },
  ],
];

// The block in the record zone: its title, its body and its action.
function errorBlock(t) {
  const block = byClass(t.body, "practice__state").children[0];
  const action = byClass(block, "state__action");
  return {
    title: byClass(block, "state__title").textContent,
    body: byClass(block, "state__body").textContent,
    action,
    actionLabel: action.children.length > 0 ? action.children[0].textContent : action.textContent,
  };
}

for (const [name, refuse] of RECORDER_FAILURES) {
  test(`a recorder that cannot start (${name}) lets the capture, the mic and the sampler go`, async () => {
    const t = setup({ pauses: loggedPauses });
    refuse(t);
    await t.startRecording();
    assert.equal(t.AudioContext.instances.length, 1, "the capture had started");
    assertReleased(graph(t));
    assert.ok(t.streams[0].tracks.every((track) => track.stopped), "the mic is let go");
    assert.deepEqual(t.log, ["pauses.start", "AudioContext", "pauses.stop"]);
    assert.equal(t.clock.activeIntervals(), 0, "no clock runs");
    assert.ok(!t.calls.announce.includes("Recording started"));
    // The take never began, which the screen says as it does for a refused microphone.
    assert.equal(t.root.dataset.state, "error");
    const block = errorBlock(t);
    assert.equal(block.title, MIC_BLOCKED_TITLE);
    assert.equal(block.body, MIC_BLOCKED_BODY);
    assert.equal(block.actionLabel, MIC_BLOCKED_ACTION);
    assert.equal(paceRow(t).hidden, true);
    t.clock.advance(10 * SECOND);
    assert.equal(t.calls.analyze.length, 0, "nothing is sent");
  });
}

test("after a recorder that could not start, Try again and a new take leave one context open", async () => {
  const t = setup();
  const start = t.MediaRecorder.prototype.start;
  t.MediaRecorder.prototype.start = () => {
    throw new Error("start refused");
  };
  await t.startRecording();
  assert.equal(t.root.dataset.state, "error");
  t.MediaRecorder.prototype.start = start;
  errorBlock(t).action.click();
  assert.equal(t.root.dataset.state, "idle");
  await t.startRecording();
  assert.equal(t.root.dataset.state, "recording");
  const [first, second] = t.AudioContext.instances;
  assert.equal(t.AudioContext.instances.length, 2);
  assert.equal(first.closes, 1, "the failed take's context is closed");
  assert.equal(second.closes, 0, "the new take's context runs");
  assert.deepEqual(
    t.AudioContext.instances.filter((context) => context.state !== "closed"),
    [second],
  );
  assert.equal(typeof graph(t).processor.onaudioprocess, "function");
  assert.equal(paceRow(t).hidden, false);
  assert.ok(t.streams[0].tracks.every((track) => track.stopped), "the first stream is let go");
  assert.ok(t.streams[1].tracks.every((track) => !track.stopped), "the new one records");
});

// --- a context that will not resume ---

test("a context that refuses to resume lets its capture go, and the row hides for the take", async () => {
  const t = setup({ audio: { state: "suspended", rejectResume: true } });
  await t.show();
  await t.startRecording();
  await flush();
  const g = graph(t);
  assert.equal(g.context.resumes, 1, "it was asked once");
  assertReleased(g);
  assert.equal(paceRow(t).hidden, true);
  t.clock.advance(8 * SECOND);
  assert.equal(paceRow(t).hidden, true, "for the whole take");
  assert.equal(t.root.dataset.state, "recording", "the take records on");
  assert.equal(t.clock.activeIntervals(), 1, "the clock's one tick");
  await t.stopRecording();
  t.app.delivery.nextFactor = 0.75;
  t.resolveUpload();
  await flush();
  assert.equal(t.calls.save.length, 1, "the take is saved");
  assert.equal(t.app.delivery.tunings.length, 0, "a capture that heard nothing tunes nothing");
  assert.deepEqual(t.calls.setFlag, []);
});

test("a context that resumes late, once asked, keeps its capture and the row", async () => {
  const t = setup({ audio: { state: "suspended", holdResume: true } });
  await t.startRecording();
  const g = graph(t);
  t.clock.advance(2 * SECOND);
  g.context.answerResume(true);
  await flush();
  assert.equal(g.context.closes, 0);
  assert.equal(typeof g.processor.onaudioprocess, "function");
  assert.equal(paceRow(t).hidden, false);
  // Resumed, it hands over blocks, so 0:03 keeps it too.
  block(t);
  t.clock.advance(4 * SECOND);
  assert.equal(g.context.closes, 0, "still open at 0:06");
  assert.equal(paceRow(t).hidden, false);
});

test("a refusal that comes after its take has ended leaves the next take's capture alone", async () => {
  const t = setup({ audio: { state: "suspended", holdResume: true } });
  await t.startRecording();
  const first = graph(t);
  t.clock.advance(3 * SECOND);
  assert.equal(first.context.closes, 1, "no block by 0:03 let the first capture go");
  t.clock.advance(3 * SECOND);
  await t.stopRecording();
  assert.equal(first.context.closes, 1, "Stop found it gone");
  t.clock.advance(SECOND);
  await t.startRecording();
  const second = graph(t);
  assert.notEqual(second.context, first.context);
  first.context.answerResume(false);
  await flush();
  assert.equal(second.context.closes, 0, "the new take's context is left open");
  assert.equal(typeof second.processor.onaudioprocess, "function");
  assert.equal(paceRow(t).hidden, false);
  second.context.answerResume(true);
  await flush();
  assert.equal(paceRow(t).hidden, false);
});
