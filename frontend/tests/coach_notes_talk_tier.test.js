// Tests that the tier Results sends with the coach notes request (POST /api/advice) comes from
// Talk takes only, as the rank card's does (owner decision 2026-10-22): a take read aloud never
// lifts the tier the advice is pitched at. ui.js, passages.js, delivery.js, language.js, tips.js,
// rank.js and screens/results.js run for real; app.store, app.api and the document are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const SOURCES = [
  "ui.js",
  "passages.js",
  "delivery.js",
  "language.js",
  "tips.js",
  "rank.js",
  path.join("screens", "results.js"),
].map((file) => [file, fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8")]);

// A take of `words`, each `step` seconds apart; every index in `ums` says "um" instead.
function takeOf(id, day, passageId, words, step, ums) {
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T10:00:00Z",
    passageId,
    passageTitle: passageId,
    durationSeconds: words * step,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: words }, (_, index) => ({
      text: (ums || []).includes(index) ? "um" : "word",
      start: index * step,
      end: index * step + step - 0.05,
    })),
  };
}

// Nine clean 3-minute reads of the rainbow explainer at 150 wpm, inside its 150 to 170 band:
// each scores 100. Rated like talk they would lift the speaker to Master.
const READS = Array.from({ length: 9 }, (_, index) =>
  takeOf("read" + index, index + 1, "explainer-rainbows", 450, 0.4),
);
// One minute of talk with 20 ums among 140 words, 20 wpm under its band: it scores about 1, so
// with the 3 imaginary 40-point minutes the talk-only rating is about 30, a Novice.
const UMS = Array.from({ length: 20 }, (_, index) => index * 7 + 3);
const TALK = takeOf("talk", 10, "free-talk", 140, 0.43, UMS);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Mounts Results against fake store and api; every /api/advice body is kept in `requests`.
function mount(sessions) {
  const requests = [];
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const flags = new Map();
  const context = {
    app: {
      screens: {},
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => Promise.resolve([...newestFirst]),
        getFlag: (key) => Promise.resolve(flags.get(key)),
        setFlag: (key, value) => {
          flags.set(key, value);
          return Promise.resolve();
        },
      },
      api: {
        postJson: (url, body) => {
          requests.push({ url, body: JSON.parse(JSON.stringify(body)) });
          return Promise.resolve({ status: 503, body: {} });
        },
      },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  root.appendChild(new FakeElement("h1"));
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, requests };
}

test("a talk take's notes get the tier its talk takes earned, reads left out", async () => {
  const { results, requests } = mount([...READS, TALK]);
  await results.show({ id: "talk" });
  await flush();
  const advice = requests.filter((request) => request.url === "/api/advice");
  assert.equal(advice.length, 1);
  assert.equal(advice[0].body.tier, "Novice");
});

test("a read take's notes use the same talk-only tier", async () => {
  const { results, requests } = mount([...READS, TALK]);
  await results.show({ id: "read8" });
  await flush();
  const advice = requests.filter((request) => request.url === "/api/advice");
  assert.equal(advice.length, 1);
  assert.equal(advice[0].body.tier, "Novice");
});

test("with every take read there is no rating yet, so the notes get the default tier", async () => {
  const { results, requests } = mount(READS);
  await results.show({ id: "read8" });
  await flush();
  const advice = requests.filter((request) => request.url === "/api/advice");
  assert.equal(advice.length, 1);
  assert.equal(advice[0].body.tier, "Novice", "DEFAULT_TIER, not the 40 a rating starts at");
});
