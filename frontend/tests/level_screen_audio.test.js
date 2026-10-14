// Tests for take 1's replay on the Level screen (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8, "Playback" and "The run"): Play 3 s
// decodes take 1 once, on the first tap, and plays each clip from 1 s before its moment for 3 s
// through an AudioBufferSourceNode; one clip plays at a time and reads Stop while it plays; a
// failed decode falls back to an <audio> element on an object URL; Spot it plays the whole take
// and scores the Heard one taps; and the run's audio is released (playback stopped, the context
// closed, the URL revoked, the recording dropped) on the Result, on Leave level, on any route
// that is neither Practice nor this play, and when another play starts. The browser's audio is
// faked in tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  savedTake,
  find,
  findAll,
  byTag,
  textOf,
  visibleText,
  control,
} = require("./level-harness");

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

function steadyHistory() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

// Fillers level 3 in its review, after a take 1 with ten fillers.
async function inReview(options = {}) {
  const world = createWorld(
    Object.assign({ history: steadyHistory(), cleared: clearedOn(["fillers-2"]) }, options),
  );
  await world.open("fillers-3");
  world.tap("Record take 1");
  const take1 = talkResult({ fillers: 10 });
  const { session } = await world.finishTake(take1);
  world.tap("Review 3 moments (30 s)");
  const report = world.app.delivery.analyze(take1.transcript, take1.metrics);
  const moments = JSON.parse(
    JSON.stringify(world.app.loop.momentsFor("fillers-3", report, take1.transcript, 0)),
  );
  const handed = world.practice.requests[0];
  return Object.assign(world, { take1, session, moments, handed });
}

function playButtons(world) {
  return findAll(world.body, "level-play");
}

function labelOf(button) {
  return visibleText(button).trim();
}

function iconOfButton(button) {
  return byTag(button, "svg")[0].getAttribute("data-icon");
}

// --- Clips -----------------------------------------------------------------------------------

test("nothing plays on its own: no audio is touched until a Play tap", async () => {
  const world = await inReview();
  assert.equal(world.contexts.length, 0);
  assert.equal(world.audioElements.length, 0);
  assert.equal(world.objectUrls.created.length, 0);
});

test("Play 3 s decodes take 1 once and plays from 1 s before the moment for 3 s", async () => {
  const world = await inReview();
  const [first, second] = playButtons(world);
  first.click();
  assert.equal(world.contexts.length, 1, "the context is made inside the tap");
  await world.settle();
  const context = world.contexts[0];
  assert.equal(context.decodes.length, 1);
  assert.deepEqual(context.decodes[0], { bytesOf: "take-1" });
  const [clip] = context.sources;
  assert.deepEqual(clip.started, {
    when: 0,
    offset: Math.round((world.moments[0].at - 1) * 1000) / 1000,
    duration: 3,
  });
  assert.equal(clip.buffer.decodedFrom.bytesOf, "take-1");
  assert.equal(clip.connected, context.destination);
  assert.equal(labelOf(first), "Stop");
  assert.equal(iconOfButton(first), "stop");

  second.click();
  assert.equal(clip.stopped, true, "one clip plays at a time");
  assert.equal(labelOf(first), "Play 3 s");
  assert.equal(iconOfButton(first), "play");
  await world.settle();
  assert.equal(world.contexts.length, 1);
  assert.equal(context.decodes.length, 1, "take 1 is decoded once");
  assert.equal(context.sources.length, 2);
  assert.equal(
    context.sources[1].started.offset,
    Math.round((world.moments[1].at - 1) * 1000) / 1000,
  );
  assert.equal(labelOf(second), "Stop");
});

test("Stop stops the clip; a clip that ends by itself reads Play 3 s again", async () => {
  const world = await inReview();
  const [button] = playButtons(world);
  button.click();
  await world.settle();
  const context = world.contexts[0];
  button.click();
  assert.equal(context.sources[0].stopped, true);
  assert.equal(labelOf(button), "Play 3 s");

  button.click();
  await world.settle();
  assert.equal(context.sources.length, 2);
  assert.equal(labelOf(button), "Stop");
  context.sources[1].finish();
  assert.equal(labelOf(button), "Play 3 s");
});

test("a recording that cannot be decoded plays through an <audio> element instead", async () => {
  const world = await inReview({ decodeFails: true });
  const [button] = playButtons(world);
  button.click();
  await world.settle();
  assert.equal(world.contexts[0].closed, true, "the failed context is closed");
  assert.equal(world.objectUrls.created.length, 1);
  assert.equal(world.objectUrls.created[0].blob.name, "take-1");
  const [element] = world.audioElements;
  assert.equal(element.src, world.objectUrls.created[0].url);
  const offset = Math.round((world.moments[0].at - 1) * 1000) / 1000;
  assert.deepEqual(element.plays, [offset]);
  assert.equal(labelOf(button), "Stop");

  world.tick("timeout");
  assert.equal(element.paused, true, "the clip stops after 3 s");
  assert.equal(labelOf(button), "Play 3 s");

  const [, second] = playButtons(world);
  second.click();
  await world.settle();
  assert.equal(world.objectUrls.created.length, 1, "one URL serves every clip");
  assert.equal(world.audioElements.length, 1);
  assert.deepEqual(element.plays, [offset, Math.round((world.moments[1].at - 1) * 1000) / 1000]);
});

// --- Spot it ---------------------------------------------------------------------------------

async function spotItReview() {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-1"]) });
  await world.open("fillers-2");
  world.tap("Record take 1");
  const take1 = talkResult({ seconds: 60, words: 150, fillers: 6 });
  await world.finishTake(take1);
  world.tap("Review 3 moments (30 s)");
  const report = world.app.delivery.analyze(take1.transcript, take1.metrics);
  const fillers = Array.from(world.app.loop.fillerTimes(report));
  return Object.assign(world, { fillers });
}

test("Spot it comes first in Fillers level 2's review", async () => {
  const world = await spotItReview();
  const step = find(world.body, "level-step");
  const cards = findAll(step, "level-card");
  const spot = cards[0];
  assert.ok(spot.className.includes("level-spot"));
  assert.equal(textOf(find(spot, "level-card__title")), "Spot it");
  assert.equal(
    textOf(find(spot, "level-spot__how")),
    "Play take 1. Tap Heard one each time you hear a filler.",
  );
  assert.equal(labelOf(find(spot, "level-play")), "Play take 1");
  const tap = find(spot, "level-spot__tap");
  assert.equal(labelOf(tap), "Heard one");
  assert.equal(tap.disabled, true, "Heard one is live only while take 1 plays");
  assert.equal(findAll(world.body, "level-moment").length, 3, "the moments follow");
});

test("Spot it plays the whole take and scores the Heard one taps at its end", async () => {
  const world = await spotItReview();
  assert.equal(world.fillers.length, 6);
  const spot = find(world.body, "level-spot");
  const play = find(spot, "level-play");
  const tap = find(spot, "level-spot__tap");
  play.click();
  await world.settle();
  const context = world.contexts[0];
  const [whole] = context.sources;
  assert.equal(whole.started.when, 0);
  assert.equal(whole.started.offset, 0);
  assert.equal(whole.started.duration, undefined, "the whole take plays");
  assert.equal(labelOf(play), "Stop");
  assert.equal(tap.disabled, false);

  // Taps 0.6 s after four of the six fillers, and one with no filler near it.
  [0, 1, 3, 5].forEach((index) => {
    context.currentTime = world.fillers[index] + 0.6;
    tap.click();
  });
  context.currentTime = world.fillers[5] + 6;
  tap.click();
  whole.finish();
  assert.equal(textOf(find(spot, "level-spot__score")), "You caught 4 of 6.");
  assert.equal(world.announcements[world.announcements.length - 1], "You caught 4 of 6.");
  assert.equal(tap.disabled, true);
  assert.equal(labelOf(play), "Play take 1");
});

test("stopping Spot it early scores nothing; a clip and Spot it never play together", async () => {
  const world = await spotItReview();
  const spot = find(world.body, "level-spot");
  const play = find(spot, "level-play");
  const tap = find(spot, "level-spot__tap");
  play.click();
  await world.settle();
  const context = world.contexts[0];
  context.currentTime = world.fillers[0] + 0.5;
  tap.click();
  play.click();
  assert.equal(context.sources[0].stopped, true);
  assert.equal(textOf(find(spot, "level-spot__score")), "");
  assert.equal(tap.disabled, true);

  play.click();
  await world.settle();
  const clip = findAll(world.body, "level-moment").map((card) => find(card, "level-play"))[0];
  clip.click();
  assert.equal(context.sources[1].stopped, true, "a clip stops Spot it");
  assert.equal(labelOf(play), "Play take 1");
  assert.equal(tap.disabled, true);
});

// --- Release ---------------------------------------------------------------------------------

test("the Result releases take 1's audio: URL revoked, element let go, no recording", async () => {
  const world = await inReview({ decodeFails: true });
  const [button] = playButtons(world);
  button.click();
  await world.settle();
  const [element] = world.audioElements;
  const url = world.objectUrls.created[0].url;
  world.tap("Say it again");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(textOf(find(world.body, "level-result__title")), "Level cleared");
  assert.deepEqual(world.objectUrls.revoked, [url]);
  assert.equal(element.paused, true);
  assert.equal(element.hasAttribute("src"), false);
  assert.ok(element.loads > 0, "the element lets go of the recording");

  // A Play button kept from the review finds no recording to decode.
  button.click();
  await world.settle();
  assert.equal(world.contexts.length, 1);
  assert.equal(world.objectUrls.created.length, 1);
});

test("the Result closes a decoded take's context", async () => {
  const world = await inReview();
  const [button] = playButtons(world);
  button.click();
  await world.settle();
  const context = world.contexts[0];
  world.tap("Say it again");
  assert.equal(context.closed, false, "recording take 2 keeps take 1's audio");
  await world.finishTake(talkResult({ fillers: 8 }));
  assert.equal(context.closed, true);
  assert.equal(context.sources[0].stopped, true);
});

test("Leave level ends the run: the audio is released and nothing replays", async () => {
  const world = await inReview();
  const [button] = playButtons(world);
  button.click();
  await world.settle();
  const context = world.contexts[0];
  world.tap("Say it again");
  world.request().onLeave();
  assert.equal(context.closed, true);
  button.click();
  await world.settle();
  assert.equal(world.contexts.length, 1);
  assert.equal(context.decodes.length, 1);
  // The level starts again at its Goal.
  await world.open("fillers-3");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
});

test("a route away from Practice and this play releases the audio", async () => {
  const world = await inReview();
  playButtons(world)[0].click();
  await world.settle();
  const context = world.contexts[0];
  world.router.go("history");
  assert.equal(context.closed, true);
  assert.equal(context.sources[0].stopped, true);
});

test("a route away from Practice releases it too, even with the screen hidden", async () => {
  const world = await inReview();
  playButtons(world)[0].click();
  await world.settle();
  const context = world.contexts[0];
  world.tap("Say it again");
  assert.equal(context.closed, false);
  world.router.go("progress");
  assert.equal(context.closed, true);
});

test("another play starting releases the audio and starts at its own Goal", async () => {
  const world = await inReview();
  playButtons(world)[0].click();
  await world.settle();
  const context = world.contexts[0];
  world.router.go("level", { id: "fillers-2" });
  await world.settle();
  assert.equal(context.closed, true);
  assert.equal(world.heading.textContent, "Fillers, level 2");
  assert.equal(textOf(find(world.body, "level-heading")), "Goal");
});

test("Practice and this play keep the run: the review and its decoded audio stay", async () => {
  const world = await inReview();
  const choice = findAll(find(world.body, "level-moment"), "chip")[1];
  choice.click();
  playButtons(world)[0].click();
  await world.settle();
  const context = world.contexts[0];
  world.tap("Say it again");
  await world.open("fillers-3");
  assert.equal(context.closed, false);
  const header = find(world.body, "level-review__header");
  assert.equal(textOf(find(header, "level-heading")), "Look at 3 moments");
  const kept = findAll(find(world.body, "level-moment"), "chip")[1];
  assert.equal(kept.getAttribute("aria-pressed"), "true", "the choices are kept");
  playButtons(world)[0].click();
  await world.settle();
  assert.equal(context.decodes.length, 1, "no second decode");
  assert.equal(context.sources.length, 2);
});

test("a decode still running when the run ends plays nothing and closes its context", async () => {
  const world = await inReview();
  playButtons(world)[0].click();
  world.router.go("path");
  await world.settle();
  const context = world.contexts[0];
  assert.equal(context.closed, true);
  assert.equal(context.sources.length, 0);
  assert.equal(world.audioElements.length, 0);
});

test("only take 1 of a loop is kept: one-take plays keep no recording", async () => {
  const world = createWorld({ history: steadyHistory(), cleared: clearedOn(["fillers-3"]) });
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await world.finishTake(talkResult({ fillers: 4 }));
  assert.equal(findAll(world.body, "level-play").length, 0);
  assert.equal(world.contexts.length, 0);
  assert.equal(control(world.body, "Back to path") !== null, true);
});
