// Tests that the speech map shows the restarts (Phase 1 loose end after T29). Each restart is a
// card at the start of its abandoned first copy, "Restart" after its clock, the words from that
// copy through the second marked in the context ("the few decisions a day— uh, the few decisions
// a"); the list's label counts them ("1 restart", after the pauses) and the cards sit among the
// other moments in time order. A take without restarts reads as before. Checked on the owner's
// real 2026-10-11 uniforms take and on a made-up take with two restarts.
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

async function showMap(session) {
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
  const stage = byClass(byClass(body, "speech-map"), "speech-map__stage");
  return byClass(byClass(stage, "speech-map__body"), "speech-map__moments");
}

function mapLabel(list) {
  return list.getAttribute("aria-label");
}

// Each card as its clock, its kind and its context, the marked words in brackets: "0:33
// Restart …one of [the] [few] [decisions] [a] [day—] [uh,] [the] [few] [decisions] [a]
// student makes…".
function rows(list) {
  return list.children.map((row) => {
    const [head, context] = row.children[0].children;
    const words = context.children.map((node) =>
      node.nodeType === 3 ? node.textContent : "[" + node.textContent + "]",
    );
    const text = (context.textContent || "") + words.join("");
    return [...head.children.map((part) => part.textContent), text].join(" ");
  });
}

test("the uniforms take: a Restart row where the first copy began, with both copies", async () => {
  const list = await showMap(sessionWith(UNIFORMS_WORDS, UNIFORMS_REPEATS));
  const restarts = list.children.filter((row) => row.classList.contains("moment--restart"));
  assert.equal(restarts.length, 1);
  assert.ok(
    rows(list).includes(
      "0:33 Restart …one of [the] [few] [decisions] [a] [day—] [uh,] [the] [few] " +
        "[decisions] [a] student makes…",
    ),
    rows(list).join(" | "),
  );
});

test("the uniforms take: the list's label counts the restart", async () => {
  const label = mapLabel(await showMap(sessionWith(UNIFORMS_WORDS, UNIFORMS_REPEATS)));
  assert.match(label, /, 1 restart, (a|an|no) /, label);
});

test("restarts sit among the other moments in time order", async () => {
  const words = spoken("We need, uh, we need a plan. The plan, um, the plan works today.");
  const repeats = [
    { text: "We need", at: words[0].start },
    { text: "The plan", at: words[7].start },
  ];
  const list = await showMap(sessionWith(words, repeats));
  assert.deepEqual(rows(list), [
    "0:00 Restart [We] [need,] [uh,] [we] [need] a plan.…",
    "0:01 Filler We need, [uh,] we need a…",
    "0:01 to 0:03 Clean stretch · 2 s Without a filler, pause or restart.",
    "0:03 Restart …a plan. [The] [plan,] [um,] [the] [plan] works today.",
    "0:04 Filler …plan. The plan, [um,] the plan works…",
  ]);
  assert.deepEqual(
    list.children.map((row) => row.className),
    [
      "moment moment--restart",
      "moment moment--filler",
      "moment moment--clean",
      "moment moment--restart",
      "moment moment--filler",
    ],
  );
  assert.equal(
    mapLabel(list),
    "Speech map from 0:00 to 0:06: 2 fillers, no mid-sentence pauses, 2 restarts, " +
      "a 2 second clean stretch",
  );
});

test("a take without restarts keeps its label and list free of them", async () => {
  const words = spoken("We need a plan that works today.");
  const list = await showMap(sessionWith(words, []));
  assert.ok(!mapLabel(list).includes("restart"));
  assert.ok(!list.children.some((row) => row.classList.contains("moment--restart")));
  assert.ok(!rows(list).some((text) => text.includes("Restart")));
});
