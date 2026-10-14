// Review fix tests for what the Upload failed block says when the save is refused because an
// older Speech Coach tab blocks the database upgrade (frontend/screens/practice.js; DESIGN.md
// sections 2 and 8). While that tab stays open, app.store rejects every call with one sentence
// that says what to do (store.js UPGRADE_BLOCKED_MESSAGE): "Close other Speech Coach tabs to
// finish updating, then try again." A take whose save fails that way shows that sentence, word for
// word, in normal mode and in level mode, so the speaker closes the other tab and taps Retry,
// which saves the same take without a second analysis. Any other failure still reads as the
// provider sentence, never the exception's own words (fix_practice_upload_failure_copy.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { byClass } = require("./fake-dom");
const {
  ANALYSIS,
  MESSAGES,
  SAVED_ID,
  flush,
  labelOf,
  levelRequest,
  plain,
  setup,
  stateBlock,
} = require("./practice-harness");

// The sentence as store.js rejects with it, read from its source, so the two never drift apart.
const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");
const BLOCKED = /UPGRADE_BLOCKED_MESSAGE =\s*"([^"]+)";/.exec(STORE_SOURCE)[1];

test("store.js's blocked-upgrade sentence is the one DESIGN.md section 2 names", () => {
  assert.equal(BLOCKED, "Close other Speech Coach tabs to finish updating, then try again.");
});

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

const BLOCKED_FAILURE = {
  title: "Upload failed",
  body: BLOCKED,
  action: "Retry upload",
  secondary: "Record a new take",
};

// A save that rejects as the blocked store does while `blocked()` is true, then succeeds.
function blockedSave(t, blocked, message = BLOCKED) {
  const attempts = [];
  t.app.store.save = (session) => {
    attempts.push(session);
    return blocked() ? Promise.reject(new Error(message)) : Promise.resolve(SAVED_ID);
  };
  return attempts;
}

test("a normal take refused by the blocked store says to close the other tabs", async () => {
  const t = setup();
  let blocked = true;
  const attempts = blockedSave(t, () => blocked);
  await t.recordTake(30000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.practice.state, "error");
  assert.deepEqual(failure(t), BLOCKED_FAILURE);

  // Each Retry while the other tab is open says it again, with no second analysis.
  stateBlock(t).action.click();
  await flush();
  assert.deepEqual(failure(t), BLOCKED_FAILURE);
  assert.equal(t.calls.analyze.length, 1);

  // The other tab closes; Retry saves the same take and opens its Results.
  blocked = false;
  stateBlock(t).action.click();
  await flush();
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2], attempts[0], "the very session the first save was given");
  assert.equal(t.calls.analyze.length, 1, "the audio went to the backend once");
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.practice.state, "idle");
});

test("a level take refused by the blocked store says it too, and is judged once", async () => {
  const t = setup();
  let blocked = true;
  blockedSave(t, () => blocked);
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(failure(t), BLOCKED_FAILURE);
  assert.equal(log.onSaved.length, 0);

  blocked = false;
  stateBlock(t).action.click();
  await flush();
  assert.equal(log.judge.length, 1, "the take is judged once");
  assert.equal(log.onSaved.length, 1, "then handed back to the Level screen");
});

test("the blocked store's sentence comes back after the speaker leaves and returns", async () => {
  const t = setup();
  blockedSave(t, () => true);
  await t.recordTake(30000);
  t.resolveUpload(ANALYSIS);
  await flush();
  t.practice.hide();
  t.practice.show({});
  assert.deepEqual(failure(t), BLOCKED_FAILURE);
});

test("only that exact sentence passes through: any other save failure is fixed copy", async () => {
  for (const message of [
    "UnknownError: IndexedDB went away",
    BLOCKED + " (VersionError)",
    "Could not open the session database",
  ]) {
    const t = setup();
    blockedSave(t, () => true, message);
    await t.recordTake(30000);
    t.resolveUpload(ANALYSIS);
    await flush();
    assert.equal(failure(t).body, MESSAGES.provider, message);
  }
});

test("a judge that throws reads as the provider sentence, whatever its words", async () => {
  const t = setup();
  const { request } = levelRequest({
    judge() {
      throw new Error(BLOCKED);
    },
  });
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(failure(t).body, MESSAGES.provider, "the store was never asked");
  assert.equal(t.calls.save.length, 0);
});
