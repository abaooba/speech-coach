// Tests for the Level screen's Review step (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8): after take 1 the feedback (the
// target, take 1's number against it, the change line, the live catch, three moments, the cited
// tip) and its button; then the review (the moments with Play 3 s and What happened? chips, the
// fix chips, the privacy line, the next take), focus and announcements on each new step, and the
// line that stands in for the Play buttons without take 1's audio. The screen runs for real
// through tests/level-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  at,
  createWorld,
  talkResult,
  readResult,
  savedTake,
  wordsOver,
  find,
  findAll,
  byTag,
  hasClass,
  textOf,
  visibleText,
  control,
} = require("./level-harness");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearedOn(ids, day = "2026-10-10") {
  return ids.map((levelId) => ({ levelId, clearedAt: at(day) }));
}

// Yesterday's take: 12 fillers in a minute and a half, 8.0 a minute.
function fillersYesterday() {
  return [
    savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
  ];
}

const PRIVACY =
  "Take 1's audio stays in this phone's memory for this level only, then it is deleted. " +
  "It is never saved.";

function primary(world) {
  return find(world.body, "btn--primary");
}

async function fillersThreeAfterTakeOne(take1 = talkResult({ fillers: 10 }), extra = {}) {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  world.tap("Record take 1");
  const saved = await world.finishTake(take1, extra);
  return Object.assign(world, { take1, saved });
}

// --- Feedback --------------------------------------------------------------------------------

test("after take 1 the Review step opens on take 1's feedback", async () => {
  const world = await fillersThreeAfterTakeOne();
  const current = find(world.body, "level-steps__item--current");
  assert.equal(textOf(find(current, "level-steps__label")), "Review");
  assert.equal(current.getAttribute("aria-current"), "step");

  const step = find(world.body, "level-step");
  const [targetCard, takeCard] = findAll(step, "level-card");
  assert.ok(hasClass(targetCard, "level-target"));
  assert.equal(textOf(find(targetCard, "level-target__headline")), "6 or fewer");
  assert.equal(findAll(targetCard, "level-example").length, 2);
  assert.equal(find(targetCard, "level-why"), null, "the why line is for the Goal");

  assert.ok(hasClass(takeCard, "level-take"));
  assert.equal(textOf(find(takeCard, "level-take__title")), "Take 1");
  assert.equal(textOf(find(takeCard, "level-take__value")), "6.7");
  assert.equal(textOf(find(takeCard, "level-take__unit")), "fillers a minute");
  assert.equal(textOf(find(takeCard, "level-take__target")), "target 6");
});

test("the change line compares take 1 with the latest earlier take", async () => {
  const world = await fillersThreeAfterTakeOne();
  const change = find(world.body, "level-change");
  assert.ok(hasClass(change, "level-change--better"));
  assert.equal(visibleText(change).trim(), "1.3 fewer than yesterday");
  assert.equal(byTag(change, "svg")[0].getAttribute("data-icon"), "triangle-down");

  const worse = await fillersThreeAfterTakeOne(talkResult({ fillers: 13 }));
  const line = find(worse.body, "level-change");
  assert.ok(hasClass(line, "level-change--worse"));
  assert.equal(visibleText(line).trim(), "0.7 more than yesterday");
  assert.equal(byTag(line, "svg")[0].getAttribute("data-icon"), "triangle-up");

  const same = await fillersThreeAfterTakeOne(talkResult({ fillers: 12 }));
  const flat = find(same.body, "level-change");
  assert.ok(hasClass(flat, "level-change--same"));
  assert.equal(visibleText(flat).trim(), "Same as yesterday");
  assert.equal(byTag(flat, "svg")[0].getAttribute("data-icon"), "dash");
});

test("take 1's card lists up to three moments, their times and words, slips marked", async () => {
  const world = await fillersThreeAfterTakeOne();
  const card = find(world.body, "level-take");
  assert.equal(textOf(find(card, "level-card__title")), "Three moments to look at");
  const items = findAll(card, "level-moments__item");
  const report = world.app.delivery.analyze(world.take1.transcript, world.take1.metrics);
  const moments = plain(world.app.loop.momentsFor("fillers-3", report, world.take1.transcript, 0));
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => [
      textOf(find(item, "level-moments__time")),
      visibleText(find(item, "level-moments__words")),
    ]),
    moments.map((moment) => [moment.time, moment.text]),
  );
  assert.deepEqual(
    [
      textOf(find(items[0], "level-moments__time")),
      visibleText(find(items[0], "level-moments__words")),
    ],
    ["0:03", "word3 word4 um word6 word7"],
  );
  const mark = find(items[0], "tok--filler");
  assert.equal(visibleText(mark), "um");
  assert.equal(textOf(find(mark, "sr-only")), ", filler");
});

test("the level's tip follows take 1's card, with its source", async () => {
  const world = await fillersThreeAfterTakeOne();
  const tip = world.app.path.playById("fillers-3").tip;
  const card = find(world.body, "level-tip");
  assert.ok(hasClass(card, "tip-card"));
  assert.equal(visibleText(find(card, "level-tip__text")).trim(), tip.text);
  const bulb = byTag(find(card, "level-tip__text"), "svg")[0];
  assert.equal(bulb.getAttribute("data-icon"), "lightbulb");
  const link = find(card, "level-source__link");
  assert.equal(link.getAttribute("href"), tip.url);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  assert.equal(visibleText(link), tip.label);
  assert.equal(visibleText(primary(world)).trim(), "Review 3 moments (30 s)");
});

test("Fillers level 3's feedback says how many fillers were caught live", async () => {
  const world = await fillersThreeAfterTakeOne(talkResult({ fillers: 10 }), {
    liveTaps: [3.5, 12, 30],
  });
  assert.equal(textOf(find(world.body, "level-take__caught")), "You caught 3 of 10 live.");

  const other = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-3"]) });
  await other.open("fillers-4");
  other.tap("Record take 1");
  await other.finishTake(talkResult({ fillers: 10 }), { liveTaps: [3.5] });
  assert.equal(find(other.body, "level-take__caught"), null, "only level 3 taps live");
});

test("one or two moments are counted in words, and the review's time with them", async () => {
  const titleOf = (world) => textOf(find(find(world.body, "level-take"), "level-card__title"));
  const two = await fillersThreeAfterTakeOne(talkResult({ fillers: 2 }));
  assert.equal(titleOf(two), "Two moments to look at");
  assert.equal(visibleText(primary(two)).trim(), "Review 2 moments (20 s)");
  two.tap("Review 2 moments (20 s)");
  const header = find(two.body, "level-review__header");
  assert.equal(textOf(find(header, "level-heading")), "Look at 2 moments");
  assert.equal(textOf(find(header, "level-review__about")), "about 20 s");

  const one = await fillersThreeAfterTakeOne(talkResult({ fillers: 1 }));
  assert.equal(titleOf(one), "One moment to look at");
  assert.equal(visibleText(primary(one)).trim(), "Review 1 moment (10 s)");
});

test("a take 1 with nothing to look at goes straight to take 2", async () => {
  const world = await fillersThreeAfterTakeOne(talkResult({ fillers: 0 }));
  assert.equal(find(world.body, "level-moments"), null);
  assert.equal(visibleText(primary(world)).trim(), "Go to take 2");
  world.tap("Go to take 2");
  assert.equal(world.practice.requests.length, 2);
  assert.equal(world.request().title, "Take 2 of 2");
});

test("a take 1 without speech says so where its number would be", async () => {
  const world = await fillersThreeAfterTakeOne({
    transcript: [],
    metrics: { pauses: [], repeats: [], fillers: {} },
    durationSeconds: 8,
  });
  assert.equal(textOf(find(world.body, "level-take__value")), "—");
  assert.equal(textOf(find(world.body, "level-take__note")), "No speech was found in this take.");
});

// --- Review ----------------------------------------------------------------------------------

test("the review looks at the moments, each with Play 3 s and What happened? chips", async () => {
  const world = await fillersThreeAfterTakeOne();
  world.tap("Review 3 moments (30 s)");
  const header = find(world.body, "level-review__header");
  assert.equal(textOf(find(header, "level-heading")), "Look at 3 moments");
  assert.equal(textOf(find(header, "level-review__about")), "about 30 s");
  const cards = findAll(world.body, "level-moment");
  assert.equal(cards.length, 3);
  const firstTime = textOf(find(cards[0], "level-moment__time"));
  assert.equal(firstTime, "0:03");
  assert.equal(visibleText(find(cards[0], "level-moment__words")), "word3 word4 um word6 word7");
  assert.equal(visibleText(find(cards[0], "level-play")).trim(), "Play 3 s");
  assert.equal(byTag(find(cards[0], "level-play"), "svg")[0].getAttribute("data-icon"), "play");
  assert.equal(textOf(find(cards[0], "level-moment__ask")), "What happened?");
  const group = find(cards[0], "level-chips");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-label"), "What happened at 0:03?");
  const chips = findAll(group, "chip");
  assert.deepEqual(
    chips.map((chip) => [textOf(chip), chip.getAttribute("aria-pressed")]),
    [
      ["Lost my point", "false"],
      ["Searching for a word", "false"],
      ["Nerves", "false"],
      ["Planned breath", "false"],
    ],
  );
});

test("What happened? is one choice per moment, and a second tap clears it", async () => {
  const world = await fillersThreeAfterTakeOne();
  world.tap("Review 3 moments (30 s)");
  const [first, second] = findAll(world.body, "level-moment");
  const chipsOf = (card) => findAll(find(card, "level-chips"), "chip");
  const pressed = (card) =>
    chipsOf(card)
      .filter((chip) => chip.getAttribute("aria-pressed") === "true")
      .map(textOf);
  chipsOf(first)[2].click();
  assert.deepEqual(pressed(first), ["Nerves"]);
  assert.ok(hasClass(chipsOf(first)[2], "chip--selected"));
  chipsOf(first)[0].click();
  assert.deepEqual(pressed(first), ["Lost my point"]);
  assert.ok(!hasClass(chipsOf(first)[2], "chip--selected"));
  assert.deepEqual(pressed(second), [], "each moment keeps its own choice");
  chipsOf(first)[0].click();
  assert.deepEqual(pressed(first), []);
});

test("the fix for take 2 is a single choice, kept for take 2's banner", async () => {
  const world = await fillersThreeAfterTakeOne();
  world.tap("Review 3 moments (30 s)");
  const title = find(world.body, "level-review__fix-title");
  assert.equal(textOf(title), "Your fix for take 2");
  const groups = findAll(world.body, "level-chips");
  const fixes = groups[groups.length - 1];
  assert.equal(fixes.getAttribute("aria-labelledby"), title.getAttribute("id"));
  assert.deepEqual(
    findAll(fixes, "chip").map(textOf),
    plain(world.app.path.playById("fillers-3").fixes),
  );
  world.tap("Slow the first 3 words");
  world.tap("Jot 3 points first");
  assert.deepEqual(
    findAll(fixes, "chip")
      .filter((chip) => chip.getAttribute("aria-pressed") === "true")
      .map(textOf),
    ["Jot 3 points first"],
  );
  world.tap("Say it again");
  assert.equal(
    world.request().body,
    "Your fix: Jot 3 points first. Take 2 counts: 6 or fewer fillers a minute.",
  );
});

test("the privacy line says take 1's audio stays in memory for this level only", async () => {
  const world = await fillersThreeAfterTakeOne();
  world.tap("Review 3 moments (30 s)");
  const line = find(world.body, "level-privacy");
  assert.equal(visibleText(line).trim(), PRIVACY);
  assert.equal(byTag(line, "svg")[0].getAttribute("data-icon"), "lock");
  assert.equal(visibleText(primary(world)).trim(), "Say it again");
});

test("a read's review names read 2 and reads it again", async () => {
  const world = createWorld({ history: [], cleared: clearedOn(["restarts-2"]) });
  await world.open("restarts-3");
  world.tap("Record read 1");
  await world.finishTake(readResult({ restartsAt: [20, 60], misreadAt: [100] }));
  const card = find(world.body, "level-take");
  assert.equal(textOf(find(card, "level-take__title")), "Read 1");
  assert.equal(textOf(find(card, "level-take__value")), "3");
  assert.equal(textOf(find(card, "level-take__unit")), "slips");
  assert.equal(textOf(find(card, "level-take__target")), "target 2");
  assert.equal(findAll(card, "tok--restart").length, 2);
  assert.equal(findAll(card, "tok--misread").length, 1);
  world.tap("Review 3 moments (30 s)");
  assert.equal(textOf(find(world.body, "level-review__fix-title")), "Your fix for read 2");
  world.tap("Read a phrase ahead");
  world.tap("Read it again");
  assert.equal(world.request().title, "Read 2 of 2");
  assert.equal(
    world.request().body,
    "Your fix: Read a phrase ahead. Read 2 counts: 2 or fewer slips.",
  );
});

test("a pace third outside the band is flagged in the moments", async () => {
  // 40 words in the first 10 s (240 wpm), then 50 over the next 20 s (150 wpm).
  const fast = wordsOver(40, 10);
  const steady = wordsOver(50, 20, {}, 11).map((word, index) =>
    Object.assign(word, { text: "steady" + index }),
  );
  const transcript = fast.concat(steady);
  const world = createWorld({ history: [] });
  await world.open("pace-1");
  world.tap("Record read 1");
  await world.finishTake({
    transcript,
    metrics: {
      pauses: [],
      repeats: [],
      fillers: {},
      script: { restarts: [], skipped: [], misread: [] },
    },
    durationSeconds: 32,
  });
  const items = findAll(world.body, "level-moments__item");
  assert.equal(items.length, 3);
  const flagged = find(items[0], "level-moment__off");
  assert.ok(flagged, "the fast first third is flagged");
  assert.equal(textOf(find(flagged, "sr-only")), ", outside the band");
  assert.equal(byTag(flagged, "svg")[0].getAttribute("data-icon"), "alert");
  assert.equal(find(items[1], "level-moment__off"), null);
});

// --- Focus and announcements -----------------------------------------------------------------

test("each new step takes focus on its heading and is announced", async () => {
  const world = await fillersThreeAfterTakeOne();
  const takeTitle = find(world.body, "level-take__title");
  assert.equal(world.focusLog[world.focusLog.length - 1], takeTitle);
  assert.equal(takeTitle.getAttribute("tabindex"), "-1");
  assert.equal(world.announcements[world.announcements.length - 1], "Step 3 of 5: Review. Take 1");
  assert.ok(world.scrolls > 0, "a new step starts at the top");

  world.tap("Review 3 moments (30 s)");
  const reviewTitle = find(find(world.body, "level-review__header"), "level-heading");
  assert.equal(world.focusLog[world.focusLog.length - 1], reviewTitle);
  assert.equal(
    world.announcements[world.announcements.length - 1],
    "Step 3 of 5: Review. Look at 3 moments",
  );
});

test("the Goal of a new run moves nothing: the router focuses the h1", async () => {
  const world = createWorld({ history: fillersYesterday(), cleared: clearedOn(["fillers-2"]) });
  await world.open("fillers-3");
  assert.deepEqual(world.focusLog, []);
  assert.deepEqual(world.announcements, []);
});

test("coming back to the same step moves nothing", async () => {
  const world = await fillersThreeAfterTakeOne();
  world.tap("Review 3 moments (30 s)");
  const focused = world.focusLog.length;
  const spoken = world.announcements.length;
  world.router.go("practice");
  await world.open("fillers-3");
  const header = find(world.body, "level-review__header");
  assert.equal(textOf(find(header, "level-heading")), "Look at 3 moments");
  assert.equal(world.focusLog.length, focused);
  assert.equal(world.announcements.length, spoken);
});

// --- Without take 1's audio ------------------------------------------------------------------

test("without take 1's audio the Play buttons give way to one line", async () => {
  const world = await fillersThreeAfterTakeOne(talkResult({ fillers: 10 }), { blob: null });
  world.tap("Review 3 moments (30 s)");
  assert.equal(
    textOf(find(world.body, "level-review__gone")),
    "Take 1's audio is gone: it is kept only while this level is open.",
  );
  assert.equal(findAll(world.body, "level-play").length, 0);
  assert.equal(findAll(world.body, "level-moment").length, 3, "the moments stay");
  assert.ok(control(world.body, "Say it again"));
});
