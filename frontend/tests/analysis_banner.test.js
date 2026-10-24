// Tests for a take analyzed in the background (frontend/screens/practice.js, owner's report of
// 2026-10-18): Stop hands a normal take to a job and Practice is free at once, the top banner
// (app.ui.banner) says how the job is doing over every screen, and Results opens when the take
// is saved, at once while Practice waits in idle, else from the banner's "See results". A level
// take still uploads in place, where the Level screen waits on it. The harness mounts Practice
// against the fakes; the banner is mounted into a node built by the same fake document.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYSIS,
  JUDGED_PATH,
  MESSAGES,
  SAVED_ID,
  flush,
  levelRequest,
  plain,
  setup,
  stateBlock,
} = require("./practice-harness");

const SECOND = 1000;
const EIGHT_SECONDS = 8 * SECOND;
const STORE_BLOCKED = "Close other Speech Coach tabs to finish updating, then try again.";

// A banner mounted to a node from the harness's document, with helpers to read it.
function withBanner(options) {
  const t = setup(options);
  const node = t.app.ui.el("div", { class: "banner" });
  node.hidden = true;
  t.app.ui.banner.mount(node);
  t.banner = node;
  // Practice is on show, as after the router's boot route.
  t.practice.show({});
  return t;
}

// Record is ignored for a moment after a Stop (a bouncing thumb), so a test that records again
// moves the clock on first.
const STOP_GRACE_MS = 500;
async function recordAnotherTake(t, ms) {
  t.clock.advance(STOP_GRACE_MS);
  await t.recordTake(ms);
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

// {kind, title, body, actions: [label]} as painted, or null while the banner is down.
function bannerView(t) {
  const node = t.banner;
  if (node.hidden) {
    return null;
  }
  const text = part(node, "banner__text");
  const actions = part(node, "banner__actions");
  return {
    kind: node.dataset.kind,
    title: part(text, "banner__title").textContent,
    body: part(text, "banner__body").textContent,
    actions: actions ? actions.children.map(textOf) : [],
  };
}

function bannerButton(t, label) {
  const actions = part(t.banner, "banner__actions");
  return actions.children.find((button) => textOf(button) === label);
}

function resultsRoutes(t) {
  return t.calls.go.filter((call) => call.name === "results");
}

// --- Stop hands the take over ---

test("Stop after 5 s leaves Practice idle at 0:00 and puts up the working banner", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  assert.equal(t.root.dataset.state, "idle", "Practice is free for the next take");
  assert.equal(stateBlock(t), null, "no Analyzing block in the record zone");
  assert.equal(t.practice.state, "idle");
  assert.equal(t.calls.analyze.length, 1, "the take is sent at once");
  assert.deepEqual(bannerView(t), {
    kind: "working",
    title: "Analyzing your speech",
    body: "Your 0:08 take. Usually 5 to 15 seconds.",
    actions: [],
  });
  assert.deepEqual(resultsRoutes(t), [], "nothing opens before the reply");
});

test("the clock reads 0:00 again as soon as the take leaves the screen", async () => {
  const t = withBanner();
  await t.recordTake(12 * SECOND);
  const timer = t.body.children.find((child) => child.classList.contains("practice__timer"));
  assert.equal(part(timer, "timer").textContent, "0:00");
});

test("a reply while Practice waits in idle opens Results at once and takes the banner down", async () => {
  const t = withBanner();
  const marked = [];
  t.app.screens.results = { markFresh: (id) => marked.push(id) };
  await t.recordTake(EIGHT_SECONDS);
  t.resolveUpload();
  await flush();
  assert.deepEqual(plain(t.calls.save[0].transcript), ANALYSIS.transcript);
  assert.deepEqual(marked, [SAVED_ID]);
  assert.deepEqual(plain(resultsRoutes(t)), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.ok(t.calls.announce.includes("Results ready"));
  assert.equal(bannerView(t), null);
});

// Your day opens on a drawn topic (tester feedback spec, section 2.2): "Second topic." at 0.5.
test("the session saved from the background carries the take as it was recorded", async () => {
  const t = withBanner({ random: () => 0.5 });
  await t.recordTake(EIGHT_SECONDS);
  t.resolveUpload();
  await flush();
  const [session] = t.calls.save;
  assert.equal(session.passageId, "free-talk");
  assert.equal(session.passageTitle, "Your day");
  assert.equal(session.durationSeconds, 8);
  assert.equal(session.topic, "Second topic.");
  assert.equal("path" in session, false, "a normal take has no level path");
});

// --- the speaker is elsewhere, or busy ---

test("a reply while Practice is hidden waits in the green banner; See results opens it", async () => {
  const t = withBanner();
  const marked = [];
  t.app.screens.results = { markFresh: (id) => marked.push(id) };
  await t.recordTake(EIGHT_SECONDS);
  t.practice.hide();
  t.resolveUpload();
  await flush();
  assert.deepEqual(resultsRoutes(t), [], "nothing is pulled from under the speaker");
  assert.deepEqual(bannerView(t), {
    kind: "ready",
    title: "Results ready",
    body: "Your 0:08 take is ready to read.",
    actions: ["See results"],
  });
  assert.deepEqual(marked, [], "the take is marked fresh only as Results opens");

  const said = t.calls.announce.filter((text) => text === "Results ready").length;
  assert.equal(said, 1, "said once, as the take turned ready");
  bannerButton(t, "See results").click();
  assert.deepEqual(marked, [SAVED_ID]);
  assert.deepEqual(plain(resultsRoutes(t)), [{ name: "results", params: { id: SAVED_ID } }]);
  assert.equal(t.calls.announce.filter((text) => text === "Results ready").length, said);
  assert.equal(bannerView(t), null);
});

test("coming back to Practice with a take ready keeps the banner up and opens idle", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.practice.hide();
  t.resolveUpload();
  await flush();
  t.practice.show({});
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(bannerView(t).kind, "ready");
  assert.deepEqual(resultsRoutes(t), []);
});

test("a reply while another take records waits in the banner and leaves the take alone", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.clock.advance(STOP_GRACE_MS);
  await t.startRecording();
  assert.equal(t.root.dataset.state, "recording", "a Record tap while analyzing starts a take");
  t.resolveUpload();
  await flush();
  assert.equal(t.root.dataset.state, "recording");
  assert.equal(t.clock.activeIntervals(), 1, "the clock still runs");
  assert.deepEqual(resultsRoutes(t), []);
  assert.equal(bannerView(t).kind, "ready");
});

test("a reply while an error block shows waits in the banner", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.clock.advance(STOP_GRACE_MS);
  t.recordButton.click();
  t.denyMic();
  await flush();
  assert.equal(t.root.dataset.state, "error");
  t.resolveUpload();
  await flush();
  assert.deepEqual(resultsRoutes(t), []);
  assert.equal(bannerView(t).kind, "ready");
  assert.equal(stateBlock(t).title, "Microphone blocked", "the block stays");
});

test("a reply while a level is on screen waits in the banner, since Practice is the level's", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  const { request } = levelRequest();
  t.startLevel(request);
  assert.equal(t.root.dataset.state, "idle");
  t.resolveUpload();
  await flush();
  assert.deepEqual(resultsRoutes(t), []);
  assert.equal(bannerView(t).kind, "ready");
});

// --- more than one take ---

test("a second take while the first is analyzed counts them; the first opens Results when it is in", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  await recordAnotherTake(t, 20 * SECOND);
  assert.equal(t.calls.analyze.length, 2);
  assert.deepEqual(bannerView(t), {
    kind: "working",
    title: "Analyzing 2 takes",
    body: "Usually 5 to 15 seconds each.",
    actions: [],
  });
  t.resolveUpload();
  await flush();
  assert.equal(resultsRoutes(t).length, 1, "the first take opens");
  assert.deepEqual(bannerView(t), {
    kind: "working",
    title: "Analyzing your speech",
    body: "Your 0:20 take. Usually 5 to 15 seconds.",
    actions: [],
  });
});

test("two takes ready while away: See results opens the oldest, then the banner names the next", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  await recordAnotherTake(t, 20 * SECOND);
  t.practice.hide();
  t.resolveUpload();
  await flush();
  t.resolveUpload();
  await flush();
  assert.deepEqual(bannerView(t), {
    kind: "ready",
    title: "2 takes ready",
    body: "See results opens the oldest first.",
    actions: ["See results"],
  });
  bannerButton(t, "See results").click();
  assert.equal(resultsRoutes(t).length, 1);
  assert.deepEqual(bannerView(t), {
    kind: "ready",
    title: "Results ready",
    body: "Your 0:20 take is ready to read.",
    actions: ["See results"],
  });
});

// --- failures ---

test("a network failure turns the banner red with the fixed sentence, Retry upload and Record a new take", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("network");
  await flush();
  assert.deepEqual(bannerView(t), {
    kind: "failed",
    title: "Upload failed",
    body: MESSAGES.network,
    actions: ["Retry upload", "Record a new take"],
  });
  assert.equal(t.root.dataset.state, "idle", "Practice shows no block for it");
  assert.equal(stateBlock(t), null);
  assert.deepEqual(resultsRoutes(t), []);
});

test("Retry upload re-sends the same blob and script; a reply then opens Results", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("provider");
  await flush();
  assert.equal(bannerView(t).body, MESSAGES.provider);
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob);
  assert.equal(t.calls.analyze[1].script, t.calls.analyze[0].script);
  assert.equal(bannerView(t).kind, "working");
  t.resolveUpload();
  await flush();
  assert.equal(resultsRoutes(t).length, 1);
  assert.equal(bannerView(t), null);
});

test("an unknown failure reads as the provider sentence; a thrown non-Error too", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("unknown");
  await flush();
  assert.equal(bannerView(t).body, MESSAGES.provider);
  t.app.api.analyze = () => Promise.reject("boom");
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.deepEqual(bannerView(t), {
    kind: "failed",
    title: "Upload failed",
    body: MESSAGES.provider,
    actions: ["Retry upload", "Record a new take"],
  });
});

test("Record a new take drops the failed take, takes the banner down and goes to Practice", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.practice.hide();
  t.rejectUpload("network");
  await flush();
  bannerButton(t, "Record a new take").click();
  assert.equal(bannerView(t), null);
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }]);
  t.practice.show({});
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(stateBlock(t), null, "nothing of the take comes back");
});

test("a backend too short shows Too short in the banner with Record again only; the take goes", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("too_short");
  await flush();
  assert.deepEqual(bannerView(t), {
    kind: "failed",
    title: "Too short",
    body: MESSAGES.too_short,
    actions: ["Record again"],
  });
  bannerButton(t, "Record again").click();
  assert.equal(bannerView(t), null);
  assert.equal(t.calls.analyze.length, 1, "nothing is re-sent");
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }]);
});

test("a failed save keeps the analysis: Retry saves again without sending audio", async () => {
  const t = withBanner();
  let refuse = true;
  t.app.store.save = (session) => {
    t.calls.save.push(session);
    return refuse ? Promise.reject(new Error("quota")) : Promise.resolve(SAVED_ID);
  };
  await t.recordTake(EIGHT_SECONDS);
  t.resolveUpload();
  await flush();
  assert.equal(bannerView(t).body, MESSAGES.provider, "a save failure is fixed copy");
  refuse = false;
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.equal(t.calls.analyze.length, 1, "no second upload");
  assert.equal(t.calls.save.length, 2);
  assert.equal(resultsRoutes(t).length, 1);
});

test("the blocked store's own sentence passes through to the banner", async () => {
  const t = withBanner();
  t.app.store.save = () => Promise.reject(new Error(STORE_BLOCKED));
  await t.recordTake(EIGHT_SECONDS);
  t.resolveUpload();
  await flush();
  assert.equal(bannerView(t).body, STORE_BLOCKED);
});

test("a failure outranks a take ready, and the ready one is back once it is dealt with", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  await recordAnotherTake(t, 20 * SECOND);
  t.practice.hide();
  t.resolveUpload();
  await flush();
  assert.equal(bannerView(t).kind, "ready");
  t.rejectUpload("network");
  await flush();
  assert.equal(bannerView(t).kind, "failed");
  bannerButton(t, "Record a new take").click();
  assert.equal(bannerView(t).kind, "ready");
  assert.equal(bannerView(t).body, "Your 0:08 take is ready to read.");
});

// --- leaving and level mode ---

test("hide() during a job neither stops it nor releases anything; the mic is long gone", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.practice.hide();
  assert.equal(t.clock.activeIntervals(), 0);
  t.resolveUpload();
  await flush();
  assert.equal(t.calls.save.length, 1, "the job ran to the save");
});

test("a level take still uploads in place: Analyzing block, state uploading, no banner", async () => {
  const t = withBanner();
  const { request, log } = levelRequest();
  t.startLevel(request);
  await t.recordTake(EIGHT_SECONDS);
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(stateBlock(t).title, "Analyzing your speech");
  assert.equal(bannerView(t), null);
  t.resolveUpload();
  await flush();
  assert.equal(log.onSaved.length, 1, "the take goes back to the Level screen");
  assert.deepEqual(plain(t.calls.save[0].path), JUDGED_PATH);
  assert.deepEqual(resultsRoutes(t), []);
  assert.equal(bannerView(t), null);
});

test("a failed level upload keeps its block in place, with Retry, and no banner", async () => {
  const t = withBanner();
  const { request } = levelRequest();
  t.startLevel(request);
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("network");
  await flush();
  assert.equal(t.root.dataset.state, "error");
  assert.equal(stateBlock(t).title, "Upload failed");
  assert.equal(bannerView(t), null);
  stateBlock(t).action.click();
  await flush();
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(t.calls.analyze.length, 2);
});

test("without a banner node Practice still runs the job and opens Results", async () => {
  const t = setup();
  t.practice.show({});
  await t.recordTake(EIGHT_SECONDS);
  assert.equal(t.app.ui.banner.current().kind, "working");
  t.resolveUpload();
  await flush();
  assert.equal(resultsRoutes(t).length, 1);
  assert.equal(t.app.ui.banner.current(), null);
});

// --- the moment a take lands ---

test("every banner title but Results ready is said through the live region as it changes", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  assert.deepEqual(t.calls.announce.slice(-1), ["Analyzing your speech"]);
  t.rejectUpload("network");
  await flush();
  assert.deepEqual(t.calls.announce.slice(-1), ["Upload failed"]);
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.deepEqual(t.calls.announce.slice(-1), ["Analyzing your speech"]);
  t.resolveUpload();
  await flush();
  assert.deepEqual(t.calls.announce.slice(-1), ["Results ready"], "said once as Results opens");
});

test("a reply while the microphone prompt is open waits in the banner, so the take is not lost", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.clock.advance(STOP_GRACE_MS);
  t.recordButton.click();
  t.resolveUpload();
  await flush();
  assert.deepEqual(resultsRoutes(t), [], "Results would drop the stream the speaker allows");
  assert.equal(bannerView(t).kind, "ready");
  t.grantMic();
  await flush();
  assert.equal(t.root.dataset.state, "recording");
});

test("a second take saved right after the first opened Results waits in the banner", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  await recordAnotherTake(t, 20 * SECOND);
  // The router only sets the hash; Practice's hide() runs on the hashchange, which the fake
  // router never sends. Both replies land before it.
  t.resolveUpload();
  await flush();
  t.resolveUpload();
  await flush();
  assert.equal(resultsRoutes(t).length, 1, "the first take opens, the second never over it");
  assert.deepEqual(bannerView(t), {
    kind: "ready",
    title: "Results ready",
    body: "Your 0:20 take is ready to read.",
    actions: ["See results"],
  });
});

test("a Record tap right after Stop is a bounce and starts nothing; one later starts a take", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.recordButton.click();
  await flush();
  assert.equal(t.root.dataset.state, "idle", "no take starts within the grace");
  t.clock.advance(STOP_GRACE_MS);
  await t.startRecording();
  assert.equal(t.root.dataset.state, "recording");
});

test("a saved take lets its audio go; a failed one keeps it for Retry", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.practice.hide();
  t.rejectUpload("network");
  await flush();
  bannerButton(t, "Retry upload").click();
  await flush();
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob, "the same audio again");
  t.resolveUpload();
  await flush();
  assert.equal(bannerView(t).kind, "ready");
  // Retry can never run again for a ready take, so nothing reads the blob: the test reaches it
  // through the next step, which must not need it.
  bannerButton(t, "See results").click();
  assert.equal(resultsRoutes(t).length, 1);
});

test("Record a new take tapped from the keyboard hands focus to Record on Practice", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("network");
  await flush();
  const drop = bannerButton(t, "Record a new take");
  drop.focus();
  drop.click();
  assert.equal(t.focused[t.focused.length - 1], t.recordButton);
  assert.equal(bannerView(t), null);
});

test("Record a new take tapped elsewhere leaves focus to the route", async () => {
  const t = withBanner();
  await t.recordTake(EIGHT_SECONDS);
  t.practice.hide();
  t.rejectUpload("network");
  await flush();
  const drop = bannerButton(t, "Record a new take");
  drop.focus();
  const moves = t.focused.length;
  drop.click();
  assert.equal(t.focused.length, moves, "the route to Practice will focus its h1");
  assert.deepEqual(plain(t.calls.go), [{ name: "practice" }]);
});

test("startLevelTake lets go of a failed level take still held in place: the request asks for a new one", async () => {
  const t = withBanner();
  const first = levelRequest();
  t.startLevel(first.request);
  await t.recordTake(EIGHT_SECONDS);
  t.rejectUpload("network");
  await flush();
  assert.equal(stateBlock(t).title, "Upload failed");
  const second = levelRequest({ title: "Take 2 of 2" });
  t.startLevel(second.request);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(stateBlock(t), null, "the block went with the take");
  const timer = t.body.children.find((child) => child.classList.contains("practice__timer"));
  assert.equal(part(timer, "timer").textContent, "0:00");
  assert.equal(t.practice.holdsLevelRequest(first.request), false);
  assert.equal(t.practice.holdsLevelRequest(second.request), true);
  assert.equal(t.calls.analyze.length, 1, "nothing is re-sent for the dropped take");
  assert.equal(bannerView(t), null);
});
