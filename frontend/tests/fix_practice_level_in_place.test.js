// Review fix: a level request that comes while Practice is already on screen
// (frontend/screens/practice.js; spec docs/superpowers/specs/2026-10-14-loop-path.md section 7).
// startLevelTake goes to #/practice, but from #/practice that changes no hash, so the router
// never calls show(): Practice paints the request itself, as show() would, the moment it comes.
// A Level screen may ask for its next take from onSaved ("Read 2 · Read 3") or for another play
// from onLeave, and the speaker must see the banner before the next Record tap. The harness's
// startLevel() calls show() for them; these tests call startLevelTake alone, as the real router
// leaves it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { byClass } = require("./fake-dom");
const {
  ANALYSIS,
  IMPROMPTU_TOPIC,
  JUDGED_PATH,
  PASSAGE_MATERIAL,
  flush,
  levelRequest,
  parts,
  plain,
  setup,
  stateBlock,
} = require("./practice-harness");

const NEXT_TITLE = "Take 2 of 2";
const NEXT_BODY = "Your fix: Pause instead of um. Take 2 counts: 6 or fewer fillers a minute.";

// What level mode shows and hides, read off the parts.
function levelView(t) {
  const p = parts(t);
  return {
    banner: Boolean(p.banner),
    title: p.bannerTitle ? p.bannerTitle.textContent : null,
    switchHidden: p.modeSwitch.hidden,
    chipsHidden: p.chipRow.hidden,
    newTopicHidden: p.newTopic.hidden,
    scriptHidden: p.scriptBox.hidden,
    sampleHidden: p.sample.hidden,
    cardTitle: p.cardTitle.textContent,
  };
}

function lastFocused(t) {
  return t.focused[t.focused.length - 1];
}

test("a request from onSaved shows its banner at once, with no show() from the router", async () => {
  const t = setup();
  const next = levelRequest({ title: NEXT_TITLE, body: NEXT_BODY });
  const first = levelRequest({
    onSaved() {
      t.practice.startLevelTake(next.request);
    },
  });
  t.startLevel(first.request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();

  assert.deepEqual(levelView(t), {
    banner: true,
    title: NEXT_TITLE,
    switchHidden: true,
    chipsHidden: true,
    newTopicHidden: true,
    scriptHidden: true,
    sampleHidden: true,
    cardTitle: "Impromptu",
  });
  const p = parts(t);
  assert.equal(p.bannerBody.textContent, NEXT_BODY);
  assert.equal(p.cardText.textContent, IMPROMPTU_TOPIC);
  assert.equal(p.limit.textContent, "/ 1:30");
  assert.equal(p.timer.textContent, "0:00");
  assert.equal(p.leave.hidden, false);
  assert.equal(t.practice.state, "idle");
});

test("the take after that answers the request whose banner it was recorded under", async () => {
  const t = setup();
  const next = levelRequest({ title: NEXT_TITLE });
  const firstSaved = [];
  const first = levelRequest({
    onSaved(saved) {
      firstSaved.push(saved);
      t.practice.startLevelTake(next.request);
    },
  });
  t.startLevel(first.request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(firstSaved.length, 1);

  await t.recordTake(9000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(first.log.judge.length, 1, "the first request judged only its own take");
  assert.equal(next.log.judge.length, 1);
  assert.equal(next.log.onSaved.length, 1);
  assert.deepEqual(plain(t.calls.save[1].path), JUDGED_PATH);
  assert.equal(parts(t).banner, null, "the answered request is let go");
});

test("a request from onLeave shows the other play's banner at once", () => {
  const t = setup();
  const other = levelRequest({
    eyebrow: "Path: Pace, level 1",
    title: "Read 1 of 2",
    material: { ...PASSAGE_MATERIAL },
  });
  const first = levelRequest({
    onLeave() {
      t.practice.startLevelTake(other.request);
    },
  });
  t.startLevel(first.request);
  parts(t).leave.click();

  const view = levelView(t);
  assert.equal(view.banner, true);
  assert.equal(view.title, "Read 1 of 2");
  assert.equal(view.switchHidden, true);
  assert.equal(view.cardTitle, PASSAGE_MATERIAL.title);
  assert.equal(parts(t).eyebrow.textContent, "Path: Pace, level 1");
  assert.equal(parts(t).cardText.textContent, PASSAGE_MATERIAL.text);
});

test("a request while Practice shows normal mode replaces the switch with the banner at once", async () => {
  const t = setup();
  t.practice.show({});
  const { request, log } = levelRequest();
  t.practice.startLevelTake(request);

  assert.deepEqual(levelView(t), {
    banner: true,
    title: "Take 1 of 2",
    switchHidden: true,
    chipsHidden: true,
    newTopicHidden: true,
    scriptHidden: true,
    sampleHidden: true,
    cardTitle: "Impromptu",
  });
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }], "it still asks for #/practice");

  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.judge.length, 1);
  assert.equal(t.calls.save[0].passageId, "impromptu");
});

test("a request while an error block shows clears it to the level's idle at 0:00", async () => {
  const t = setup();
  t.practice.show({});
  t.recordButton.click();
  t.denyMic();
  await flush();
  assert.equal(stateBlock(t).title, "Microphone blocked");

  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.equal(t.practice.state, "idle");
  assert.equal(stateBlock(t), null);
  assert.ok(parts(t).banner);
  assert.equal(parts(t).timer.textContent, "0:00");
});

test("a too-short take's time goes back to 0:00 when a request comes in place", async () => {
  const t = setup();
  t.practice.show({});
  await t.recordTake(3000);
  stateBlock(t).action.click();
  assert.equal(parts(t).timer.textContent, "0:03", "normal idle keeps a too-short time");

  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.equal(parts(t).timer.textContent, "0:00");
});

test("while a take uploads, a request in place waits: the upload keeps its own banner", async () => {
  const t = setup();
  const first = levelRequest();
  t.startLevel(first.request);
  await t.recordTake(12000);
  const next = levelRequest({ title: NEXT_TITLE });
  t.practice.startLevelTake(next.request);
  assert.equal(t.practice.state, "uploading");
  assert.equal(parts(t).bannerTitle.textContent, "Take 1 of 2");

  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(first.log.onSaved.length, 1);
  assert.equal(parts(t).bannerTitle.textContent, NEXT_TITLE, "then the newer banner shows");
});

test("while a take records, a request in place leaves the take and its screen as they are", async () => {
  const t = setup();
  const first = levelRequest();
  t.startLevel(first.request);
  await t.startRecording();
  t.clock.advance(4000);
  const next = levelRequest({ title: NEXT_TITLE });
  t.practice.startLevelTake(next.request);
  assert.equal(t.practice.state, "recording");
  assert.equal(parts(t).bannerTitle.textContent, "Take 1 of 2");
  assert.equal(parts(t).timer.textContent, "0:04", "the clock runs on");
});

test("Practice off screen still waits for the router's show(), after hide() too", () => {
  const t = setup();
  t.practice.show({});
  t.practice.hide();
  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.equal(parts(t).banner, null, "nothing is painted on a screen the router hid");
  t.practice.show({});
  assert.ok(parts(t).banner);
});

// --- Focus ------------------------------------------------------------------------------------

test("focus left on nothing after the hand-back moves to the next banner's title", async () => {
  const t = setup();
  const next = levelRequest({ title: NEXT_TITLE });
  const first = levelRequest({
    onSaved() {
      t.practice.startLevelTake(next.request);
    },
  });
  t.startLevel(first.request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();

  const title = parts(t).bannerTitle;
  assert.equal(lastFocused(t), title);
  assert.equal(title.getAttribute("tabindex"), "-1", "focusable from script, never a Tab stop");
});

test("focus on the switch that the banner hides moves to the banner's title", () => {
  const t = setup();
  t.practice.show({});
  parts(t).talk.focus();
  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.equal(lastFocused(t), parts(t).bannerTitle);
});

test("Leave level's focus, handed to the switch, follows the banner that comes back", () => {
  const t = setup();
  const other = levelRequest({ title: "Read 1 of 2", material: { ...PASSAGE_MATERIAL } });
  const first = levelRequest({
    onLeave() {
      t.practice.startLevelTake(other.request);
    },
  });
  t.startLevel(first.request);
  const leave = parts(t).leave;
  leave.focus();
  leave.click();
  assert.equal(lastFocused(t), parts(t).bannerTitle);
});

test("focus in an error block the request clears moves to the banner's title", async () => {
  const t = setup();
  t.practice.show({});
  t.recordButton.click();
  t.denyMic();
  await flush();
  const errorTitle = byClass(t.stateEl.children[0], "state__title");
  assert.equal(lastFocused(t), errorTitle, "the error title took focus");

  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.equal(lastFocused(t), parts(t).bannerTitle);
});

test("focus on a part that stays, such as Record, stays where it is", () => {
  const t = setup();
  t.practice.show({});
  t.recordButton.focus();
  const focusCalls = t.focused.length;
  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.equal(t.focused.length, focusCalls, "nothing else is focused");
  assert.equal(lastFocused(t), t.recordButton);
});

test("the router's own show() leaves focus to the router, as before", () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  assert.deepEqual(t.focused, [], "Practice moves no focus when the router shows it");
});
