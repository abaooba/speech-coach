// Tests that a screen reader hears the restarts on the speech timeline (Phase 1 loose end after
// T29). The strip draws each restart as a thin line; its aria-label now counts them ("1
// restart", after the pauses) and the hidden list of moments names each one in time order,
// as 'Restart “the few decisions a” at 0:33', at the start of the abandoned first copy. A take
// without restarts reads as before. Checked on the owner's real 2026-10-11 uniforms take and on
// a made-up take with two restarts.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures");
const SOURCES = ["ui.js", "delivery.js", path.join("screens", "results.js")].map((file) => [
  file,
  fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8"),
]);

// The uniforms take's words in clip seconds, and the repeat backend metrics.find_repeats finds.
const UNIFORMS_WORDS = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "take_2026_10_11_uniforms.json"), "utf8"),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));
const UNIFORMS_REPEATS = [{ text: "the few decisions a", at: 33.41 }];

// Words every half second, a quarter second long.
function spoken(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: index * 0.5,
    end: index * 0.5 + 0.25,
  }));
}

function sessionWith(words, repeats) {
  return {
    id: "s1",
    createdAt: "2026-10-12T10:00:00.000Z",
    passageId: "talk",
    passageTitle: "Talk",
    durationSeconds: 60,
    metrics: { pauses: [], repeats, fillers: {}, pace_windows: [] },
    transcript: words,
  };
}

async function showTimeline(session) {
  const context = {
    app: {
      screens: {},
      passages: [{ id: "talk", targetWpm: [140, 160] }],
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
  return byClass(body, "timeline");
}

function stripLabel(timeline) {
  const strip = timeline.children.find(
    (node) => node.getAttribute && node.getAttribute("class") === "timeline__strip",
  );
  return strip.getAttribute("aria-label");
}

function moments(timeline) {
  return byClass(timeline, "timeline__moments").children.map((item) => item.textContent);
}

test("the uniforms take: the hidden list names the restart where its first copy began", async () => {
  const timeline = await showTimeline(sessionWith(UNIFORMS_WORDS, UNIFORMS_REPEATS));
  const list = moments(timeline);
  assert.equal(list.filter((text) => text.startsWith("Restart")).length, 1);
  assert.ok(list.includes("Restart “the few decisions a” at 0:33"), list.join(" | "));
});

test("the uniforms take: the strip's label counts the restart", async () => {
  const label = stripLabel(await showTimeline(sessionWith(UNIFORMS_WORDS, UNIFORMS_REPEATS)));
  assert.match(label, /, 1 restart, (a|an|no) /, label);
});

test("restarts sit among the other moments in time order", async () => {
  const words = spoken("We need, uh, we need a plan. The plan, um, the plan works today.");
  const repeats = [
    { text: "We need", at: words[0].start },
    { text: "The plan", at: words[7].start },
  ];
  const timeline = await showTimeline(sessionWith(words, repeats));
  assert.deepEqual(moments(timeline), [
    "Restart “We need” at 0:00",
    "Filler “uh” at 0:01",
    "Clean stretch from 0:01 to 0:03, 2 seconds",
    "Restart “The plan” at 0:03",
    "Filler “um” at 0:04",
  ]);
  assert.equal(
    stripLabel(timeline),
    "Speech timeline from 0:00 to 0:06: 2 fillers, no mid-sentence pauses, 2 restarts, " +
      "a 2 second clean stretch",
  );
});

test("a take without restarts keeps its label and list free of them", async () => {
  const words = spoken("We need a plan that works today.");
  const timeline = await showTimeline(sessionWith(words, []));
  assert.ok(!stripLabel(timeline).includes("restart"));
  assert.ok(!moments(timeline).some((text) => text.startsWith("Restart")));
});
