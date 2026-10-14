// Tests for Practice's level mode (frontend/screens/practice.js; spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 7): the Level screen asks for one take
// through app.screens.practice.startLevelTake(request), and Practice shows the request's
// banner, records on its material within its seconds, has the request judge the take, saves it
// with its `path`, and hands it back through onSaved instead of opening Results. The harness in
// practice-harness.js mounts the screen against the shared fake DOM; the Level screen is a fake
// request whose judge, onSaved and onLeave log their calls.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const { byClass } = require("./fake-dom");
const {
  ANALYSIS,
  IMPROMPTU_TOPIC,
  JUDGED_PATH,
  PASSAGE_MATERIAL,
  SAVED_ID,
  bodyClasses,
  flush,
  labelOf,
  levelRequest,
  parts,
  plain,
  reaches,
  setup,
  stateBlock,
} = require("./practice-harness");

// Normal mode's body, top to bottom (DESIGN.md section 3); level mode adds to it and gives it
// back unchanged.
const NORMAL_BODY = [
  "segmented",
  "chip-row",
  "passage-card",
  "practice__timer",
  "btn-record",
  "btn-record__label",
  "practice__hint",
  "practice__state",
];

const LEAVE_LEVEL = "Leave level";
const HEARD_ONE = "Heard one";
const HEARD_ONE_LABEL = "I heard a filler";

// --- The request and the banner -------------------------------------------------------------

test("practice.js exports startLevelTake and still touches no DOM at load time", () => {
  const context = { app: { screens: {} } };
  const source = fs.readFileSync(path.join(__dirname, "..", "screens", "practice.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "practice.js" });
  const practice = context.app.screens.practice;
  assert.equal(typeof practice.startLevelTake, "function");
  assert.equal(practice.state, "idle");
});

test("startLevelTake holds the request and goes to #/practice", () => {
  const t = setup();
  const { request } = levelRequest();
  t.practice.startLevelTake(request);
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }]);
  assert.equal(parts(t).banner, null, "the router's show() paints it");
  t.practice.show({});
  assert.ok(parts(t).banner, "the banner shows once Practice is shown");
});

test("the banner shows the request's eyebrow, title and body, then Leave level", () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  const p = parts(t);
  assert.equal(p.banner.tagName, "section");
  assert.deepEqual(
    p.banner.children.map((child) => child.tagName + "." + child.className),
    [
      "p.practice__banner-eyebrow",
      "h2.practice__banner-title",
      "p.practice__banner-body",
      "button.btn btn--ghost practice__banner-leave",
    ],
  );
  assert.equal(p.eyebrow.textContent, "Path: Fillers, level 3");
  assert.equal(p.bannerTitle.textContent, "Take 1 of 2");
  assert.equal(
    p.bannerBody.textContent,
    "Talk for 90 s. Take 2 counts: 6 or fewer fillers a minute.",
  );
  assert.equal(p.leave.textContent, LEAVE_LEVEL);
  assert.equal(p.leave.getAttribute("type"), "button");
  assert.equal(p.leave.hidden, false);
});

test("the banner takes the switch's and the chips' place, right above the card", () => {
  const t = setup();
  assert.deepEqual(bodyClasses(t), NORMAL_BODY, "normal mode keeps its eight parts");
  const { request } = levelRequest();
  t.startLevel(request);
  assert.deepEqual(bodyClasses(t), [
    "segmented",
    "chip-row",
    "practice__banner",
    "passage-card",
    "practice__timer",
    "btn-record",
    "btn-record__label",
    "practice__hint",
    "practice__state",
  ]);
});

test("level mode hides the switch, the chips, New topic, the script box and the sample", () => {
  const t = setup();
  let p = parts(t);
  assert.equal(p.modeSwitch.hidden, false);
  assert.equal(p.chipRow.hidden, false);
  assert.equal(p.newTopic.hidden, false, "Your day has topics to cycle");
  assert.equal(p.scriptBox.hidden, false, "Talk shows the script box");
  assert.equal(p.sample.hidden, false);

  const { request } = levelRequest();
  t.startLevel(request);
  p = parts(t);
  assert.equal(p.modeSwitch.hidden, true);
  assert.equal(p.chipRow.hidden, true);
  assert.equal(p.newTopic.hidden, true);
  assert.equal(p.scriptBox.hidden, true);
  assert.equal(p.sample.hidden, true);
  assert.equal(p.hintText.textContent, "Tap to record. Stop uploads automatically.");
});

test("Leave level clears the request, returns to normal idle and calls onLeave once", () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  parts(t).leave.click();

  assert.deepEqual(log.onLeave, [[]], "onLeave is called once, with nothing");
  assert.equal(t.practice.state, "idle");
  assert.deepEqual(bodyClasses(t), NORMAL_BODY, "the banner leaves the body");
  const p = parts(t);
  for (const part of ["modeSwitch", "chipRow", "newTopic", "scriptBox", "sample"]) {
    assert.equal(p[part].hidden, false, `${part} is back`);
  }
  assert.equal(p.cardTitle.textContent, "Your day");
  assert.equal(p.cardText.textContent, "First topic.");
  assert.equal(p.limit.textContent, "/ 1:00", "the selected entry's limit is back");
  assert.equal(log.judge.length, 0);
  assert.equal(log.onSaved.length, 0);

  t.practice.hide();
  t.practice.show({});
  assert.equal(parts(t).banner, null, "a later visit stays in normal mode");
});

test("focus on Leave level moves to the Talk / Read switch that takes the banner's place", () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  const p = parts(t);
  p.leave.focus();
  p.leave.click();
  assert.equal(t.focused[t.focused.length - 1], p.talk, "the selected tab takes focus");
});

test("focus in an error block, which Leave level clears, also moves to the switch", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(3000);
  const title = byClass(t.stateEl.children[0], "state__title");
  assert.equal(t.focused[t.focused.length - 1], title, "the error title took focus");
  parts(t).leave.click();
  assert.equal(t.focused[t.focused.length - 1], parts(t).talk);
});

test("a Leave level tap while the take records changes nothing", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.startRecording();
  const leave = parts(t).leave;
  assert.equal(leave.hidden, true);
  leave.click();
  assert.equal(t.practice.state, "recording");
  assert.deepEqual(log.onLeave, []);
  assert.ok(parts(t).banner, "the request is still held");
});

test("startLevelTake refuses a request without a material or its three callbacks", () => {
  const t = setup();
  const { request } = levelRequest();
  const broken = [
    null,
    "fillers-3",
    { ...request, material: null },
    { ...request, judge: undefined },
    { ...request, onSaved: "go back" },
    { ...request, onLeave: undefined },
  ];
  // The error comes from the vm's realm, so it is matched by name rather than by instanceof.
  for (const candidate of broken) {
    assert.throws(() => t.practice.startLevelTake(candidate), { name: "TypeError" });
  }
  assert.deepEqual(t.calls.go, [], "nothing routes");
  t.practice.show({});
  assert.equal(parts(t).banner, null, "nothing is held");
});

test("Leave level shows when the nav does: in idle and error, never while a take runs", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  const leave = parts(t).leave;
  assert.equal(leave.hidden, false, "idle");
  await t.startRecording();
  assert.equal(leave.hidden, true, "recording");
  t.clock.advance(8000);
  await t.stopRecording();
  assert.equal(t.practice.state, "uploading");
  assert.equal(leave.hidden, true, "uploading");
  t.rejectUpload("network");
  await flush();
  assert.equal(t.practice.state, "error");
  assert.equal(leave.hidden, false, "error");
});

test("viewFor says when Leave level and the live tap show", () => {
  const { practice } = setup();
  assert.equal(practice.viewFor("idle").showLeaveLevel, true);
  assert.equal(practice.viewFor("recording").showLeaveLevel, false);
  assert.equal(practice.viewFor("uploading").showLeaveLevel, false);
  assert.equal(practice.viewFor("error").showLeaveLevel, true);
  assert.equal(practice.viewFor("idle").showLiveTap, false);
  assert.equal(practice.viewFor("recording").showLiveTap, true);
  assert.equal(practice.viewFor("uploading").showLiveTap, false);
  assert.equal(practice.viewFor("error").showLiveTap, false);
});

// --- The material and the limit -------------------------------------------------------------

test("the card shows the material's title, its band and its topic", () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  const p = parts(t);
  assert.equal(p.cardTitle.textContent, "Impromptu");
  assert.equal(p.cardTarget.textContent, "Target 140 to 160 wpm");
  assert.equal(p.cardText.textContent, IMPROMPTU_TOPIC);
});

test("a passage material shows its title and its text, with its own band", () => {
  const t = setup();
  const { request } = levelRequest({
    material: { ...PASSAGE_MATERIAL, targetWpm: [150, 170] },
  });
  t.startLevel(request);
  const p = parts(t);
  assert.equal(p.cardTitle.textContent, "Courts and cameras");
  assert.equal(p.cardTarget.textContent, "Target 150 to 170 wpm");
  assert.equal(p.cardText.textContent, PASSAGE_MATERIAL.text);
});

test("entering level mode scrolls the card's text back to the top", () => {
  const t = setup();
  const text = parts(t).cardText;
  text.scrollTop = 60;
  const { request } = levelRequest();
  t.startLevel(request);
  assert.equal(text.scrollTop, 0);
});

test("the limit comes from request.seconds: '/ 1:30' and a bar that fills toward it", async () => {
  const t = setup();
  const { request } = levelRequest({ seconds: 90 });
  t.startLevel(request);
  const p = parts(t);
  assert.equal(p.limit.textContent, "/ 1:30");
  assert.equal(p.limit.hidden, false);
  assert.equal(p.limitBar.hidden, false);
  assert.equal(p.limitFill.getAttribute("style"), "transform: scaleX(0)");

  await t.startRecording();
  t.clock.advance(45000);
  assert.equal(p.limitFill.getAttribute("style"), "transform: scaleX(0.5)");
  assert.ok(!p.limitBar.classList.contains("practice__limit-bar--over"));
  t.clock.advance(45000);
  assert.ok(p.limitBar.classList.contains("practice__limit-bar--over"), "over at 1:30");
  assert.equal(t.practice.state, "recording", "the limit never stops a take");
});

test("a read on a passage with no limit of its own still takes the request's seconds", () => {
  const t = setup();
  const { request } = levelRequest({ material: { ...PASSAGE_MATERIAL }, seconds: 75 });
  t.startLevel(request);
  assert.equal(parts(t).limit.textContent, "/ 1:15");
});

// --- The take ---------------------------------------------------------------------------------

test("a passage material is sent as the take's script", async () => {
  const t = setup();
  const { request } = levelRequest({ material: { ...PASSAGE_MATERIAL } });
  t.startLevel(request);
  await t.recordTake(12000);
  assert.equal(t.calls.analyze.length, 1);
  assert.equal(t.calls.analyze[0].script, PASSAGE_MATERIAL.text);
});

test("a prompt material sends no script, even with one left in Talk's box", async () => {
  const t = setup();
  parts(t).scriptInput.value = "My prepared case, word for word.";
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  assert.equal(t.calls.analyze[0].script, "");

  const normal = setup();
  parts(normal).scriptInput.value = "My prepared case, word for word.";
  await normal.recordTake(12000);
  assert.equal(normal.calls.analyze[0].script, "My prepared case, word for word.", "normal mode");
});

test("judge gets {transcript, metrics, durationSeconds} once the upload succeeds", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12340);
  assert.equal(log.judge.length, 0, "nothing is judged before the analysis is back");
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.judge.length, 1);
  assert.deepEqual(plain(log.judge[0]), {
    transcript: ANALYSIS.transcript,
    metrics: ANALYSIS.metrics,
    durationSeconds: 12.3,
  });
});

test("judge sees the metrics after app.pauses reconciled them, as the save does", async () => {
  const reconciled = { words_per_minute: 150, pauses: [[1, 2]] };
  const pauses = {
    start() {},
    stop: () => [0.2, 0.9],
    reconcile: () => reconciled,
  };
  const t = setup({ pauses });
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(9000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.judge[0].metrics, reconciled);
  assert.equal(t.calls.save[0].metrics, reconciled);
});

test("the session saves the material's id, title and topic, and the path judge returned", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.deepEqual(plain(t.calls.save[0]), {
    passageId: "impromptu",
    passageTitle: "Impromptu",
    durationSeconds: 12,
    metrics: ANALYSIS.metrics,
    transcript: ANALYSIS.transcript,
    topic: IMPROMPTU_TOPIC,
    path: JUDGED_PATH,
  });
});

test("judge runs before the save, and the save before onSaved", async () => {
  const t = setup();
  const order = [];
  const { request } = levelRequest({
    judge() {
      order.push(["judge", t.calls.save.length]);
      return { ...JUDGED_PATH };
    },
    onSaved() {
      order.push(["onSaved", t.calls.save.length]);
    },
  });
  t.startLevel(request);
  await t.recordTake(7000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(order, [
    ["judge", 0],
    ["onSaved", 1],
  ]);
});

test("onSaved gets {id, session, blob, contentType, liveTaps}: the blob the upload sent", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();

  assert.equal(log.onSaved.length, 1);
  const saved = log.onSaved[0];
  assert.deepEqual(Object.keys(saved).sort(), ["blob", "contentType", "id", "liveTaps", "session"]);
  assert.equal(saved.id, SAVED_ID);
  assert.deepEqual(plain(saved.session), plain(t.calls.save[0]));
  assert.equal(saved.blob, t.calls.analyze[0].blob, "the very blob that was uploaded");
  assert.equal(saved.contentType, "audio/webm");
  assert.equal(saved.blob.type, "audio/webm");
  assert.deepEqual(plain(saved.liveTaps), [], "no live tap on this level");
  assert.ok(!reaches(t.calls.save, saved.blob), "the audio is never saved");
});

test("a saved level take never goes to Results: no route and no 'Results ready'", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }], "only startLevelTake's route");
  assert.ok(!t.calls.announce.includes("Results ready"));
});

test("onSaved finds Practice back in normal idle, the request let go", async () => {
  const t = setup();
  let seen = null;
  const { request } = levelRequest({
    onSaved() {
      seen = {
        state: t.practice.state,
        body: bodyClasses(t),
        timer: parts(t).timer.textContent,
      };
    },
  });
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(seen, { state: "idle", body: NORMAL_BODY, timer: "0:00" });

  t.practice.hide();
  t.practice.show({});
  assert.equal(parts(t).banner, null, "the next visit is a normal one");
});

test("Practice keeps no take after onSaved: nothing is held for a retry", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.onSaved.length, 1);

  t.practice.hide();
  t.practice.show({});
  assert.equal(t.practice.state, "idle");
  assert.equal(stateBlock(t), null, "no Upload failed block can come back with it");
  assert.equal(t.calls.analyze.length, 1);
});

// --- Normal mode ------------------------------------------------------------------------------

test("normal mode still saves without a path and goes to Results", async () => {
  const t = setup();
  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.ok(!("path" in t.calls.save[0]), "a plain take has no path");
  assert.equal(t.calls.announce[t.calls.announce.length - 1], "Results ready");
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
});

test("normal mode never hands the blob anywhere but the upload", async () => {
  const t = setup();
  await t.recordTake(12000);
  const blob = t.calls.analyze[0].blob;
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.ok(blob, "the upload sent a blob");
  assert.ok(!reaches(t.calls.save, blob), "not saved");
  assert.ok(!reaches(t.calls.go, blob), "not routed");
  assert.ok(!reaches(t.calls.announce, blob), "not announced");
  assert.equal(t.calls.analyze.length, 1);
});

// --- Live tap ---------------------------------------------------------------------------------

test("with liveTap, Heard one joins the body right under the record button's label", () => {
  const t = setup();
  const { request } = levelRequest({ liveTap: true });
  t.startLevel(request);
  const classes = bodyClasses(t);
  assert.equal(classes.indexOf("practice__live-tap"), classes.indexOf("btn-record__label") + 1);
  assert.equal(classes.indexOf("practice__hint"), classes.indexOf("practice__live-tap") + 1);

  const p = parts(t);
  assert.equal(p.liveTap.hidden, true, "idle: it shows only while recording");
  assert.equal(p.liveTapButton.tagName, "button");
  assert.equal(p.liveTapButton.getAttribute("type"), "button");
  assert.equal(p.liveTapButton.className, "btn btn--secondary practice__live-tap-button");
  assert.equal(p.liveTapButton.textContent, HEARD_ONE);
  assert.equal(p.liveTapButton.getAttribute("aria-label"), HEARD_ONE_LABEL);
  const countId = p.liveTapCount.getAttribute("id");
  assert.ok(countId, "the count has an id");
  assert.equal(p.liveTapButton.getAttribute("aria-describedby"), countId);
});

test("without liveTap there is no Heard one, not even while recording", async () => {
  const t = setup();
  const { request } = levelRequest({ liveTap: false });
  t.startLevel(request);
  await t.startRecording();
  assert.equal(parts(t).liveTap, null);
});

test("each Heard one tap keeps the clock's seconds to a tenth and counts '3 heard'", async () => {
  const t = setup();
  const { request, log } = levelRequest({ liveTap: true });
  t.startLevel(request);
  await t.startRecording();
  const p = parts(t);
  assert.equal(p.liveTap.hidden, false, "recording shows it");
  assert.equal(p.liveTapCount.textContent, "0 heard");

  t.clock.advance(2340);
  p.liveTapButton.click();
  assert.equal(p.liveTapCount.textContent, "1 heard");
  t.clock.advance(2720);
  p.liveTapButton.click();
  t.clock.advance(4000);
  p.liveTapButton.click();
  assert.equal(p.liveTapCount.textContent, "3 heard");
  assert.equal(t.practice.state, "recording", "a tap never stops the take");

  t.clock.advance(3000);
  await t.stopRecording();
  assert.equal(p.liveTap.hidden, true, "uploading: the tap is over");
  p.liveTapButton.click();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(plain(log.onSaved[0].liveTaps), [2.3, 5.1, 9.1]);
});

test("a new take starts its taps over: a too-short take's taps are dropped with it", async () => {
  const t = setup();
  const { request, log } = levelRequest({ liveTap: true });
  t.startLevel(request);
  await t.startRecording();
  t.clock.advance(1000);
  parts(t).liveTapButton.click();
  t.clock.advance(2000);
  await t.stopRecording();
  assert.equal(stateBlock(t).title, "Too short");

  stateBlock(t).action.click();
  await t.startRecording();
  assert.equal(parts(t).liveTapCount.textContent, "0 heard");
  t.clock.advance(4000);
  parts(t).liveTapButton.click();
  t.clock.advance(4000);
  await t.stopRecording();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(plain(log.onSaved[0].liveTaps), [4]);
});

test("Retry upload hands back the taps of the take it re-sends", async () => {
  const t = setup();
  const { request, log } = levelRequest({ liveTap: true });
  t.startLevel(request);
  await t.startRecording();
  t.clock.advance(6500);
  parts(t).liveTapButton.click();
  t.clock.advance(2000);
  await t.stopRecording();
  t.rejectUpload("network");
  await flush();
  stateBlock(t).action.click();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(plain(log.onSaved[0].liveTaps), [6.5]);
});

// --- Errors keep the request ------------------------------------------------------------------

test("Too short keeps the request: Record again returns to the level, not to normal mode", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(3000);
  assert.equal(stateBlock(t).title, "Too short");
  assert.ok(parts(t).banner, "the banner stays over the error");
  assert.equal(labelOf(stateBlock(t).action), "Record again");

  stateBlock(t).action.click();
  assert.equal(t.practice.state, "idle");
  assert.ok(parts(t).banner);
  assert.equal(parts(t).cardText.textContent, IMPROMPTU_TOPIC);

  await t.recordTake(12000);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.judge.length, 1);
  assert.equal(log.onSaved.length, 1);
});

test("a backend too short drops the take but keeps the request", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(9000);
  t.rejectUpload("too_short");
  await flush();
  assert.equal(stateBlock(t).title, "Too short");
  assert.equal(log.judge.length, 0);
  stateBlock(t).action.click();
  assert.ok(parts(t).banner);
  assert.equal(log.onLeave.length, 0);
});

test("Microphone blocked keeps the request", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  t.recordButton.click();
  t.denyMic();
  await flush();
  assert.equal(stateBlock(t).title, "Microphone blocked");
  assert.ok(parts(t).banner);
  stateBlock(t).action.click();
  assert.equal(t.practice.state, "idle");
  assert.ok(parts(t).banner);
  assert.equal(parts(t).limit.textContent, "/ 1:30");
});

test("Upload failed keeps the request; Retry re-sends the take and then hands it back", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  const block = stateBlock(t);
  assert.equal(block.title, "Upload failed");
  assert.equal(labelOf(block.action), "Retry upload");
  assert.equal(labelOf(block.secondary), "Record a new take");
  assert.ok(parts(t).banner);
  assert.equal(log.judge.length, 0);

  block.action.click();
  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.judge.length, 1);
  assert.equal(log.onSaved.length, 1);
  assert.equal(log.onSaved[0].blob, t.calls.analyze[0].blob);
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }]);
});

test("Record a new take keeps the request and starts the level take over", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.rejectUpload("provider");
  await flush();
  stateBlock(t).secondary.click();
  assert.equal(t.practice.state, "idle");
  assert.ok(parts(t).banner);
  assert.equal(parts(t).timer.textContent, "0:00");
});

test("Leave level after a failed upload lets the take go with the request", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  parts(t).leave.click();
  assert.deepEqual(log.onLeave, [[]]);
  assert.equal(t.practice.state, "idle");
  assert.equal(stateBlock(t), null);
  assert.equal(parts(t).timer.textContent, "0:00");

  t.practice.hide();
  t.practice.show({});
  assert.equal(t.practice.state, "idle", "no Upload failed block comes back");
  assert.equal(log.judge.length, 0);
});

test("Leave level while the mic prompt is open lets the microphone go when it answers", async () => {
  const t = setup();
  const { request } = levelRequest();
  t.startLevel(request);
  t.recordButton.click();
  parts(t).leave.click();
  t.grantMic();
  await flush();
  assert.equal(t.practice.state, "idle", "no take starts after the speaker left the level");
});

// --- Coming and going -------------------------------------------------------------------------

test("leaving Practice with no take held lets the request go", async () => {
  const idle = setup();
  const first = levelRequest();
  idle.startLevel(first.request);
  idle.practice.hide();
  idle.practice.show({});
  assert.equal(parts(idle).banner, null, "back in normal mode");
  assert.equal(first.log.onLeave.length, 0, "onLeave is for the Leave level tap");

  const recording = setup();
  const second = levelRequest();
  recording.startLevel(second.request);
  await recording.startRecording();
  recording.practice.hide();
  recording.practice.show({});
  assert.equal(recording.practice.state, "idle");
  assert.equal(parts(recording).banner, null, "the dropped take took the request with it");
});

test("leaving while the take uploads keeps the request: the take still answers it", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.practice.hide();
  t.practice.show({});
  assert.equal(t.practice.state, "uploading");
  assert.ok(parts(t).banner);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.onSaved.length, 1);
});

test("leaving after a failed upload keeps the take and its request for Retry", async () => {
  const t = setup();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  t.practice.hide();
  t.practice.show({});
  assert.equal(stateBlock(t).title, "Upload failed");
  assert.ok(parts(t).banner);
  stateBlock(t).action.click();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(log.onSaved.length, 1);
});

test("startLevelTake lets go of a take still held from before: the request asks for a new one", async () => {
  const t = setup();
  await t.recordTake(12000);
  t.rejectUpload("network");
  await flush();
  assert.equal(stateBlock(t).title, "Upload failed");

  const { request } = levelRequest();
  t.startLevel(request);
  assert.equal(t.practice.state, "idle");
  assert.equal(stateBlock(t), null);
  assert.ok(parts(t).banner);
  assert.equal(parts(t).timer.textContent, "0:00");
});

test("an upload in flight answers the request it was recorded under", async () => {
  const t = setup();
  const first = levelRequest();
  t.startLevel(first.request);
  await t.recordTake(12000);
  const second = levelRequest({ title: "Take 2 of 2" });
  t.practice.startLevelTake(second.request);
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(first.log.judge.length, 1);
  assert.equal(first.log.onSaved.length, 1);
  assert.equal(second.log.judge.length, 0);
  assert.equal(second.log.onSaved.length, 0);
  assert.equal(parts(t).bannerTitle.textContent, "Take 2 of 2", "the newer request stays");
});

test("each level take starts at 0:00 with the request's limit, as a normal take does", async () => {
  const t = setup();
  const { request } = levelRequest({ seconds: 120 });
  await t.recordTake(3000);
  stateBlock(t).action.click();
  assert.equal(parts(t).timer.textContent, "0:03", "normal idle keeps a too-short time");
  t.startLevel(request);
  const p = parts(t);
  assert.equal(p.timer.textContent, "0:00");
  assert.equal(p.limit.textContent, "/ 2:00");
});
