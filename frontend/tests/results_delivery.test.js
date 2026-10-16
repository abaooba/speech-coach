// Tests for what the Results screen draws from the app.delivery report: the four cards and
// their hints on the real clip, the transcript legend, the two highlight styles and the time
// line for a timed preset. ui.js, delivery.js, tips.js and results.js all run for real against
// the fake DOM; only app.store and app.router are stubs.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8")],
);

const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};
const CREATED_AT = "2026-10-10T19:21:00.000Z";
const PASSAGES = [
  { id: "gettysburg", targetWpm: [130, 150] },
  { id: "congress-speech", targetWpm: [130, 160], timeLimitSeconds: 180 },
];

function clipSession(overrides) {
  return {
    id: "s1",
    createdAt: CREATED_AT,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 33.1,
    metrics: JSON.parse(JSON.stringify(CLIP_METRICS)),
    transcript: CLIP_WORDS.map((word) => ({ ...word })),
    ...(overrides || {}),
  };
}

async function showSession(session) {
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return { app: context.app, body };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function cardsOf(body) {
  return byClass(body, "stat-strip").children;
}

function hintOf(card) {
  const hint = byClass(card, "stat__hint");
  return hint ? [hint.textContent, hint.className] : null;
}

test("on the real clip the cards show pace without ums, breaks and the clean stretch", async () => {
  const { body } = await showSession(clipSession());
  const cards = cardsOf(body);
  assert.deepEqual(
    cards.map((card) => fullText(byClass(card, "stat__value"))),
    ["76 wpm", "21.4 /min", "3 pauses", "4.9 s"],
  );
  assert.deepEqual(cards.map(hintOf), [
    ["Speed up", "stat__hint stat__hint--warn"],
    ["Aim for under 3", "stat__hint stat__hint--warn"],
    ["0 over 5 s", "stat__hint stat__hint--ok"],
    ["Aim past 15 s", "stat__hint stat__hint--warn"],
  ]);
});

test("the legend explains both styles and names the most-used habit", async () => {
  const { body } = await showSession(clipSession());
  assert.equal(
    byClass(body, "transcript__legend").textContent,
    "Highlighted words are hesitations: um, uh, mhm. Underlined words are verbal habits. " +
      "Purple underlined words are restarts. Most used: “so”, 1 time.",
  );
});

test("habits are underlined tokens read as verbal habits; ums keep the filler style", async () => {
  const { body } = await showSession(clipSession());
  const tokens = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  const byText = (text) => tokens.find((token) => token.textContent === text);
  assert.equal(byText("so,").className, "tok tok--habit");
  assert.equal(byText("so,").getAttribute("aria-label"), "so, verbal habit");
  assert.equal(byText("um,").className, "tok tok--filler");
  assert.equal(byText("um,").getAttribute("aria-label"), "um, filler word");
  assert.equal(byText("like").className, "tok", "'I like to play tennis' is not flagged");
});

test("the tips on the real clip name the moments", async () => {
  const { body } = await showSession(clipSession());
  const tips = body.children.filter((node) => node.className === "tip-card");
  assert.deepEqual(
    tips.map((card) => card.textContent),
    [
      "You are under target pace. Shorten the pauses between ideas.",
      "Fillers at 0:01, 0:02, 0:03 and 8 more. Next take, close your mouth and pause instead.",
    ],
  );
});

test("a preset with a time limit adds the time used to the meta line", async () => {
  const session = clipSession({ passageId: "congress-speech", passageTitle: "Congress speech" });
  const { app, body } = await showSession(session);
  assert.equal(
    fullText(byClass(body, "results__meta")),
    "Congress speech · " + app.ui.formatDate(CREATED_AT) + " · 0:30 of 3:00",
  );
});

test("a fluent take gets the ok fillers hint and no habit in the legend", async () => {
  const words = "We win because the plan solves the harm.".split(" ").map((text, index) => ({
    text,
    start: index * 0.4,
    end: index * 0.4 + 0.3,
  }));
  const session = clipSession({
    transcript: words,
    metrics: { ...CLIP_METRICS, pauses: [], repeats: [], fillers: {} },
  });
  const { body } = await showSession(session);
  assert.deepEqual(hintOf(cardsOf(body)[1]), [
    "Target under 3",
    "stat__hint stat__hint--ok",
  ]);
  assert.equal(
    byClass(body, "transcript__legend").textContent,
    "Highlighted words are hesitations: um, uh, mhm. Underlined words are verbal habits.",
  );
});
