// Tests for the `topic` Practice saves with each take (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 6): the Talk topic on screen when the
// take was recorded, so app.path.pickTopic knows which topics a speaker has used. A take given
// no topic (a Read passage, a prompt without topics, a level's passage) saves no topic field at
// all, and a level take saves its material's topic. The harness is practice-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYSIS,
  IMPROMPTU_TOPIC,
  PASSAGE_MATERIAL,
  flush,
  levelRequest,
  parts,
  plain,
  realPassages,
  setup,
} = require("./practice-harness");

// Records a take, lets the upload succeed and returns the session Practice saved.
async function savedTake(t) {
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.calls.save.length, 1, "one take, one save");
  return t.calls.save[0];
}

function chipFor(t, id) {
  return parts(t).chips.find((chip) => chip.dataset.passageId === id);
}

test("a Talk take on a prompt with topics saves the topic on screen", async () => {
  const t = setup();
  assert.equal(parts(t).cardText.textContent, "First topic.");
  const session = await savedTake(t);
  assert.equal(session.topic, "First topic.");
  assert.equal(session.passageId, "free-talk");
  assert.equal(session.passageTitle, "Your day");
});

test("after New topic the take saves the topic it moved to", async () => {
  const t = setup();
  parts(t).newTopic.click();
  parts(t).newTopic.click();
  assert.equal(parts(t).cardText.textContent, "Third topic.");
  const session = await savedTake(t);
  assert.equal(session.topic, "Third topic.");
});

test("the whole saved session of a Talk take: the five fields and its topic", async () => {
  const t = setup();
  const session = await savedTake(t);
  assert.deepEqual(plain(session), {
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 12,
    metrics: ANALYSIS.metrics,
    transcript: ANALYSIS.transcript,
    topic: "First topic.",
  });
});

test("a prompt without topics saves no topic field", async () => {
  const t = setup();
  chipFor(t, "congress").click();
  const session = await savedTake(t);
  assert.equal(session.passageId, "congress");
  assert.ok(!("topic" in session), "no topic was given");
});

test("a Read take saves no topic field", async () => {
  const t = setup();
  parts(t).read.click();
  const session = await savedTake(t);
  assert.equal(session.passageId, "read1");
  assert.ok(!("topic" in session));
});

// Mounts the top banner (app.ui.banner) into a node from the harness's document, so a test can
// press the button a failed upload offers there, and returns the node.
function mountBanner(t) {
  const node = t.app.ui.el("div", { class: "banner" });
  node.hidden = true;
  t.app.ui.banner.mount(node);
  return node;
}

function bannerButton(node, label) {
  const actions = node.children.find((child) => child.classList.contains("banner__actions"));
  return actions.children.find((button) => button.children[0].textContent === label);
}

// A normal take is analyzed in the background: an upload that fails puts "Upload failed" in the
// top banner, not on Practice, and its "Retry upload" button sends the same take again. The topic
// saved is still the one on screen when the take was recorded, not the one Talk moved to while
// the upload was failing.
test("Retry upload from the banner saves the topic the take was recorded on", async () => {
  const t = setup();
  const banner = mountBanner(t);
  parts(t).newTopic.click();
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  assert.equal(banner.dataset.kind, "failed");
  assert.equal(t.stateEl.children.length, 0, "the failure is in the banner, not on Practice");
  parts(t).newTopic.click();
  bannerButton(banner, "Retry upload").click();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.calls.save.length, 1, "one take, one save");
  assert.equal(t.calls.save[0].topic, "Second topic.");
});

test("with the real passages, Your day's first take saves its first topic", async () => {
  const passages = realPassages();
  const t = setup({ passages });
  const yourDay = passages.find((entry) => entry.id === "free-talk");
  const session = await savedTake(t);
  assert.equal(session.passageId, "free-talk");
  assert.equal(session.topic, yourDay.topics[0]);
});

test("a level take on a prompt saves its material's topic", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  const session = await savedTake(t);
  assert.equal(session.topic, IMPROMPTU_TOPIC);
});

test("a level take on a passage saves no topic field", async () => {
  const t = setup();
  const { request } = levelRequest({ material: { ...PASSAGE_MATERIAL } });
  t.startLevel(request);
  const session = await savedTake(t);
  assert.equal(session.passageId, PASSAGE_MATERIAL.id);
  assert.equal(session.passageTitle, PASSAGE_MATERIAL.title);
  assert.ok(!("topic" in session), "a passage is given no topic");
});

test("a level take's topic is its material's, whatever topic Talk was left on", async () => {
  const t = setup();
  parts(t).newTopic.click();
  const { request } = levelRequest();
  t.startLevel(request);
  const session = await savedTake(t);
  assert.equal(session.topic, IMPROMPTU_TOPIC);
  assert.equal(session.passageId, "impromptu");
});
