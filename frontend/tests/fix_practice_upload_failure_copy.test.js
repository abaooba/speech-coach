// Review fix: what the Upload failed block says, and what Retry repeats, when the analysis came
// back but a later step failed (frontend/screens/practice.js; DESIGN.md sections 7 and 8). A
// level request's judge or the save may throw anything; the block still shows a fixed sentence,
// never the exception's own words. The take keeps its analysis once the backend returned it, and
// its judged session once judge returned it, so Retry never sends the audio for a second paid
// analysis, and never judges a take twice.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { byClass } = require("./fake-dom");
const {
  ANALYSIS,
  JUDGED_PATH,
  MESSAGES,
  SAVED_ID,
  flush,
  labelOf,
  levelRequest,
  plain,
  setup,
  stateBlock,
} = require("./practice-harness");

const THROWN = "Cannot read properties of null (reading 'baseline')";

// The block's title, its sentence and its two actions' labels.
function failure(t) {
  const block = stateBlock(t);
  if (block === null) {
    return null;
  }
  return {
    title: block.title,
    body: byClass(t.stateEl.children[0], "state__body").textContent,
    action: block.action && labelOf(block.action),
    secondary: block.secondary && labelOf(block.secondary),
  };
}

const PROVIDER_FAILURE = {
  title: "Upload failed",
  body: MESSAGES.provider,
  action: "Retry upload",
  secondary: "Record a new take",
};

// A judge that throws while `failing()` is true, and returns the path otherwise.
function judgeThatThrows(failing, thrown) {
  const calls = [];
  const judge = (result) => {
    calls.push(result);
    if (failing()) {
      throw thrown;
    }
    return { ...JUDGED_PATH };
  };
  return { judge, calls };
}

test("a judge that throws shows the provider sentence, not the exception's words", async () => {
  const t = setup();
  const { judge } = judgeThatThrows(() => true, new TypeError(THROWN));
  const { request, log } = levelRequest({ judge });
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();

  assert.equal(t.practice.state, "error");
  assert.deepEqual(failure(t), PROVIDER_FAILURE);
  assert.equal(t.calls.save.length, 0, "nothing is saved without a path");
  assert.equal(log.onSaved.length, 0);
});

test("a judge that throws something other than an Error still shows the block", async () => {
  for (const thrown of [null, undefined, "no baseline", { kind: "too_short" }]) {
    const t = setup();
    const { judge } = judgeThatThrows(() => true, thrown);
    const { request } = levelRequest({ judge });
    t.startLevel(request);
    await t.recordTake(12000);
    t.resolveUpload(ANALYSIS);
    await flush();
    assert.equal(t.practice.state, "error", String(thrown));
    assert.deepEqual(failure(t), PROVIDER_FAILURE, String(thrown));
  }
});

test("Retry after a judge failure judges again without sending the audio again", async () => {
  const t = setup();
  let failing = true;
  const { judge, calls } = judgeThatThrows(() => failing, new TypeError(THROWN));
  const saved = [];
  const { request } = levelRequest({ judge, onSaved: (value) => saved.push(value) });
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();

  failing = false;
  stateBlock(t).action.click();
  await flush();
  assert.equal(t.calls.analyze.length, 1, "the audio went to the backend once");
  assert.equal(calls.length, 2, "judged again");
  assert.deepEqual(plain(calls[1]), plain(calls[0]), "on the same analysis");
  assert.equal(t.calls.save.length, 1);
  assert.deepEqual(plain(t.calls.save[0].path), JUDGED_PATH);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].blob, t.calls.analyze[0].blob, "the take's own audio is handed back");
  assert.equal(t.practice.state, "idle");
});

test("each Retry while judge still throws asks the backend nothing", async () => {
  const t = setup();
  const { judge, calls } = judgeThatThrows(() => true, new Error("still broken"));
  const { request } = levelRequest({ judge });
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  for (let tap = 0; tap < 3; tap += 1) {
    stateBlock(t).action.click();
    await flush();
  }
  assert.equal(t.calls.analyze.length, 1);
  assert.equal(calls.length, 4);
  assert.deepEqual(failure(t), PROVIDER_FAILURE);
});

// Replaces the harness's save, which always succeeds, with one that fails `times` times first.
function failingSave(t, times, message) {
  const attempts = [];
  t.app.store.save = (session) => {
    attempts.push(session);
    return attempts.length <= times
      ? Promise.reject(new Error(message))
      : Promise.resolve(SAVED_ID);
  };
  return attempts;
}

test("a failed save shows the provider sentence; Retry saves the same judged session", async () => {
  const t = setup();
  const attempts = failingSave(t, 1, "QuotaExceededError: the disk is full");
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(failure(t), PROVIDER_FAILURE);
  assert.equal(log.judge.length, 1);

  stateBlock(t).action.click();
  await flush();
  assert.equal(t.calls.analyze.length, 1, "the audio went to the backend once");
  assert.equal(log.judge.length, 1, "the take is judged once");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1], attempts[0], "the very session judged the first time");
  assert.equal(log.onSaved.length, 1);
  assert.equal(log.onSaved[0].session, attempts[1]);
});

test("in normal mode too, a failed save reads as fixed copy and Retry sends no audio", async () => {
  const t = setup();
  const attempts = failingSave(t, 1, "UnknownError: IndexedDB went away");
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(failure(t), PROVIDER_FAILURE);

  stateBlock(t).action.click();
  await flush();
  assert.equal(t.calls.analyze.length, 1);
  assert.equal(attempts.length, 2);
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
});

test("a failed analysis still shows its own sentence; Retry sends the audio again", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  assert.deepEqual(failure(t), { ...PROVIDER_FAILURE, body: MESSAGES.network });

  stateBlock(t).action.click();
  assert.equal(t.calls.analyze.length, 2, "nothing came back, so the take is sent again");
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob);
});

test("Record a new take after a judge failure drops the analysis with the take", async () => {
  const t = setup();
  let failing = true;
  const { judge, calls } = judgeThatThrows(() => failing, new TypeError(THROWN));
  const { request } = levelRequest({ judge });
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  stateBlock(t).secondary.click();
  assert.equal(t.practice.state, "idle");

  failing = false;
  const second = {
    transcript: [{ text: "again", start: 0.2, end: 0.6 }],
    metrics: ANALYSIS.metrics,
  };
  await t.recordTake(9000);
  assert.equal(t.calls.analyze.length, 2, "the new take is sent");
  t.resolveUpload(second);
  await flush();
  assert.deepEqual(plain(calls[calls.length - 1].transcript), second.transcript);
});
