// Review fix tests for Practice's read-only answer to "do you still hold this level request?"
// (frontend/screens/practice.js, spec docs/superpowers/specs/2026-10-14-loop-path.md sections 7
// and 8). The Level screen keeps its run, and take 1's audio, on #/practice only while Practice
// holds one of the run's requests: the request on screen, or the one a recorded take still
// answers (an upload in flight, or one that failed and waits for Retry). A request Practice let
// go (handed back, left, or dropped on leaving the screen with no take held) is not held, and in
// normal mode nothing is. Practice runs for real through tests/practice-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ANALYSIS, flush, levelRequest, parts, setup, stateBlock } = require("./practice-harness");

test("Practice holds a request from startLevelTake until it hands its take back", async () => {
  const t = setup();
  const { request } = levelRequest();
  assert.equal(t.practice.holdsLevelRequest(request), false, "not handed over yet");
  t.startLevel(request);
  assert.equal(t.practice.holdsLevelRequest(request), true, "the banner shows it");
  await t.startRecording();
  assert.equal(t.practice.holdsLevelRequest(request), true, "its take records");
  t.clock.advance(12000);
  await t.stopRecording();
  assert.equal(t.practice.state, "uploading");
  assert.equal(t.practice.holdsLevelRequest(request), true, "its take uploads");
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.practice.state, "idle");
  assert.equal(t.practice.holdsLevelRequest(request), false, "handed back with its take");
});

test("Leave level lets the request go", () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  parts(t).leave.click();
  assert.equal(t.practice.holdsLevelRequest(request), false);
});

test("leaving Practice with no take held lets the request go", () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  t.practice.hide();
  assert.equal(t.practice.holdsLevelRequest(request), false);
});

test("a take whose upload failed keeps its request held, on screen or not", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  assert.equal(t.practice.state, "error");
  t.practice.hide();
  assert.equal(t.practice.holdsLevelRequest(request), true, "Retry still answers it");
  t.practice.show({});
  stateBlock(t).action.click();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.onSaved.length, 1);
  assert.equal(t.practice.holdsLevelRequest(request), false, "answered at last");
});

test("a newer request takes the place of one whose failed take it lets go", async () => {
  const t = setup();
  const first = levelRequest().request;
  const second = levelRequest({ title: "Take 2 of 2" }).request;
  t.startLevel(first);
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  t.startLevel(second);
  assert.equal(t.practice.holdsLevelRequest(first), false);
  assert.equal(t.practice.holdsLevelRequest(second), true);
});

test("in normal mode no request is held, and nothing that is not one ever is", async () => {
  const t = setup();
  for (const value of [null, undefined, {}, "fillers-3"]) {
    assert.equal(t.practice.holdsLevelRequest(value), false, String(value));
  }
  await t.recordTake(12000);
  assert.equal(t.practice.state, "uploading");
  assert.equal(t.practice.holdsLevelRequest(null), false, "a normal take answers no request");
  assert.equal(t.practice.holdsLevelRequest(undefined), false);
});
