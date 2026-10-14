// No rank on the Path (owner decision 3; spec docs/superpowers/specs/2026-10-14-loop-path.md
// section 9: "No rank, tier, rating or rank streak appears on this screen"). path-screen-harness.js
// loads rank.js and rankcard.js where index.html will, so app.rank and app.rankCard are there for
// the screen to reach, as they are in the app, and it records every call into either. A rank card
// drawn behind a guard, as Progress draws one, would be caught by its calls; a tier chip, or a
// "3-day streak" chip, by its words, taken from rank.js's own tier names.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mountPath,
  settle,
  record,
  take,
  miss,
  sitting,
  words,
  all,
  classOf,
  everything,
  find,
  unitsOf,
  nodesOf,
} = require("./path-screen-harness");

// The rank's words, besides each tier's name.
const RANK_WORDS = ["rank", "tier", "rating", "streak"];

// A Path with every state drawn at once: cleared levels with a half and a gold ring, check-backs
// due, a crown part earned and one complete, checkpoints cleared and cleared in the room, a
// resting level, two benchmark sittings and takes on three days this week.
function richPath() {
  const umEverySixth = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [index * 6, "um"]),
  );
  return {
    cleared: [
      record("fillers-1", "2026-10-01"),
      record("fillers-1_cb1", "2026-10-03"),
      record("fillers-1_cb2", "2026-10-09"),
      record("fillers-2", "2026-10-05"),
      record("fillers-3", "2026-10-06"),
      record("fillers_crown-1", "2026-10-07"),
      record("fillers_crown-2", "2026-10-08"),
      record("pace-1", "2026-10-02"),
      record("pace-1_cb1", "2026-10-04"),
      record("pace-2", "2026-10-03"),
      record("pace-3", "2026-10-04"),
      record("pace_crown-1", "2026-10-05"),
      record("pace-4", "2026-10-06"),
      record("pace-5", "2026-10-07"),
      record("pace_checkpoint", "2026-10-08"),
      record("pace_checkpoint_room", "2026-10-08"),
      record("restarts-1", "2026-10-12"),
    ],
    sessions: [
      ...sitting("2026-09-20", { restartsAt: [10, 20, 30], umsAt: [5, 25] }),
      ...sitting("2026-10-06", { restartsAt: [10], umsAt: [5] }),
      miss("long-pauses-1", "2026-10-14", 2),
      miss("long-pauses-1", "2026-10-14", 3),
      miss("long-pauses-1", "2026-10-14", 4),
      take({ day: "2026-10-12", transcript: words(120, umEverySixth) }),
      take({ day: "2026-10-13" }),
    ],
  };
}

// Opens every node's card, unit by unit, so every card's words have been drawn and shown.
function openEveryCard(body) {
  unitsOf(body).forEach((unit) => nodesOf(unit).forEach((node) => node.click()));
}

// The rank words found among every word the screen holds: its h1, text shown or not, and every
// aria-label. Each tier name and rank word is looked for case-blind, inside other words too.
function rankWordsIn(app, root) {
  const banned = Array.from(app.rank.TIERS, (tier) => tier.name).concat(RANK_WORDS);
  const said = everything(root).toLowerCase();
  return banned.filter((word) => said.includes(word.toLowerCase()));
}

// Every element dressed as part of a rank card (rankcard.js's classes all start "rank-").
function rankElementsIn(root) {
  return all(root, (element) => /(^|\s)rank-/.test(classOf(element)));
}

test("the harness loads rank.js and rankcard.js, as index.html will", () => {
  const { app } = mountPath();
  assert.deepEqual(
    Array.from(app.rank.TIERS, (tier) => tier.name),
    ["Novice", "Contender", "Varsity", "Elite", "Champion", "Master", "Flawless"],
  );
  assert.equal(typeof app.rankCard.model, "function");
  assert.equal(typeof app.rankCard.build, "function");
});

test("a call into app.rank or app.rankCard is recorded, so a guarded one cannot hide", () => {
  const { app, rankCalls } = mountPath();
  app.rank.rating([]);
  app.rankCard.model([], { screen: "progress", today: new Date() });
  assert.deepEqual(rankCalls, ["rank.rating", "rankCard.model"]);
});

test("drawing the Path and opening every card never calls app.rank or app.rankCard", async () => {
  const { app, screen, body, rankCalls } = mountPath(richPath());
  await screen.show({});
  openEveryCard(body);
  assert.equal(unitsOf(body).length, app.path.UNITS.length, "the whole Path was drawn");
  assert.deepEqual(rankCalls, []);
});

test("no tier name, rank, tier, rating or streak is anywhere on the Path", async () => {
  const { app, screen, root, body } = mountPath(richPath());
  await screen.show({});
  openEveryCard(body);
  const said = everything(root);
  assert.match(said, /Locked in/, "the rich states are drawn");
  assert.match(said, /2 of 5 earned/);
  assert.match(said, /Crown earned/);
  assert.match(said, /Cleared in the room/);
  assert.match(said, /Back tomorrow/);
  assert.match(said, /Since your first/);
  assert.match(said, /This week: 3 of 4 days/);
  assert.deepEqual(rankWordsIn(app, root), []);
  assert.deepEqual(rankElementsIn(root), []);
});

test("the loading and error states carry no rank either", async () => {
  const loading = mountPath();
  loading.store.hold = true;
  const showing = loading.screen.show({});
  assert.ok(find(loading.body, "state--loading"));
  assert.deepEqual(rankWordsIn(loading.app, loading.root), []);
  loading.store.release();
  await showing;

  const failing = mountPath({ fail: "list" });
  await failing.screen.show({});
  await settle();
  assert.ok(find(failing.body, "state--error"));
  assert.deepEqual(rankWordsIn(failing.app, failing.root), []);
  assert.deepEqual(failing.rankCalls, []);
});
