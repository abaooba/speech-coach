// Review fix tests for what the Upload failed notice says when the save is refused because an
// older Speech Coach tab blocks the database upgrade (frontend/screens/practice.js; DESIGN.md
// sections 2 and 8). While that tab stays open, app.store rejects every call with one sentence
// that says what to do (store.js UPGRADE_BLOCKED_MESSAGE): "Close other Speech Coach tabs to
// finish updating, then try again." A take whose save fails that way shows that sentence, word for
// word: a normal take in the top banner (app.ui.banner), since its analysis runs in the background
// and Practice stays idle, and a level take in the Upload failed block in the record zone, since
// a level take still uploads in place. Either way the speaker closes the other tab and taps Retry,
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

// The level take's block: its title, its sentence and its two actions' labels.
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

// A normal take is analyzed in the background and reports in the top banner, so the harness
// gets a banner node from its own fake document, and Practice is put on show as after the
// router's boot route (a reply while Practice waits in idle opens Results at once).
function withBanner() {
  const t = setup();
  const node = t.app.ui.el("div", { class: "banner" });
  node.hidden = true;
  t.app.ui.banner.mount(node);
  t.banner = node;
  t.practice.show({});
  return t;
}

function textOf(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node.textContent;
  }
  return node.children.map(textOf).join("");
}

function part(node, name) {
  return node.children.find((child) => child.classList.contains(name));
}

// The banner's title, its sentence and its actions' labels in the block's shape, so the normal
// and level tests compare against the same expected copy; null while the banner is down.
function bannerFailure(t) {
  const node = t.banner;
  if (node.hidden) {
    return null;
  }
  const text = part(node, "banner__text");
  const actions = part(node, "banner__actions");
  const labels = actions ? actions.children.map(textOf) : [];
  return {
    title: part(text, "banner__title").textContent,
    body: part(text, "banner__body").textContent,
    action: labels[0] ?? null,
    secondary: labels[1] ?? null,
  };
}

function bannerButton(t, label) {
  const actions = part(t.banner, "banner__actions");
  return actions.children.find((button) => textOf(button) === label);
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

test("a normal take refused by the blocked store says so in the banner", async () => {
  const t = withBanner();
  let blocked = true;
  const attempts = blockedSave(t, () => blocked);
  await t.recordTake(30000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.practice.state, "idle", "Practice shows no block for a background take");
  assert.equal(stateBlock(t), null);
  assert.equal(t.banner.dataset.kind, "failed");
  assert.deepEqual(bannerFailure(t), BLOCKED_FAILURE);

  // Each Retry while the other tab is open says it again, with no second analysis.
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.deepEqual(bannerFailure(t), BLOCKED_FAILURE);
  assert.equal(t.calls.analyze.length, 1);

  // The other tab closes; Retry saves the same take and opens its Results, Practice being idle.
  blocked = false;
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2], attempts[0], "the very session the first save was given");
  assert.equal(t.calls.analyze.length, 1, "the audio went to the backend once");
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.practice.state, "idle");
  assert.equal(bannerFailure(t), null, "the banner is down once Results opens");
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

test("the blocked store's sentence stays in the banner while the speaker is away", async () => {
  const t = withBanner();
  blockedSave(t, () => true);
  await t.recordTake(30000);
  t.resolveUpload(ANALYSIS);
  await flush();
  t.practice.hide();
  assert.deepEqual(bannerFailure(t), BLOCKED_FAILURE, "the banner is global, so it stays up");
  t.practice.show({});
  assert.deepEqual(bannerFailure(t), BLOCKED_FAILURE);
  assert.equal(t.practice.state, "idle", "Practice itself opens idle, with no block");
  assert.equal(stateBlock(t), null);
});

test("only that exact sentence passes through: any other save failure is fixed copy", async () => {
  for (const message of [
    "UnknownError: IndexedDB went away",
    BLOCKED + " (VersionError)",
    "Could not open the session database",
  ]) {
    const t = withBanner();
    blockedSave(t, () => true, message);
    await t.recordTake(30000);
    t.resolveUpload(ANALYSIS);
    await flush();
    assert.equal(bannerFailure(t).body, MESSAGES.provider, message);
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
