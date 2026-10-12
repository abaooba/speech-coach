// Tests for restarts on the Results transcript (queue task T29). The backend reports each
// repeat as {text, at}, where `at` is the start of the FIRST copy; the transcript marks the
// words of the SECOND copy, the place the speaker started the phrase over, with .tok--restart
// and an aria-label that ends in ", restart". The take from 2026-10-11, "the few decisions a
// day, uh, the few decisions a student", is the case that queued this task.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);

// One word every half second, each 0.4 s long, as backend/tests/test_metrics_restarts.py
// builds them, so word n starts at n * 0.5 s.
function timed(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }));
}

// What find_repeats returns for this sentence: the phrase starts at word 2, "the", at 1.0 s.
const FEW_DECISIONS = timed(
  "one of the few decisions a day, uh, the few decisions a student makes every day",
);
const FEW_DECISIONS_REPEAT = { text: "the few decisions a", at: 1.0 };

function loadPure() {
  const context = { app: { screens: {}, passages: [], ui: {}, store: {}, router: {} } };
  vm.runInNewContext(read("delivery.js"), context, { filename: "delivery.js" });
  vm.runInNewContext(read(path.join("screens", "results.js")), context, {
    filename: "results.js",
  });
  return context.app.screens.results;
}

// The indexes, in the word list, of the plan's words that carry restart: true.
function restartIndexes(plan) {
  const wordItems = Array.from(plan).filter((item) => item.type === "word");
  return wordItems.flatMap((item, index) => (item.restart === true ? [index] : []));
}

test("the second 'the few decisions a' is the restart, not the first copy", () => {
  const { buildTranscriptPlan } = loadPure();
  const plan = buildTranscriptPlan(FEW_DECISIONS, [], [FEW_DECISIONS_REPEAT]);
  assert.deepEqual(restartIndexes(plan), [8, 9, 10, 11]);
  assert.deepEqual(
    restartIndexes(plan).map((index) => FEW_DECISIONS[index].text),
    ["the", "few", "decisions", "a"],
  );
});

test("an immediate repeat marks its second copy and never the um between the copies", () => {
  const { buildTranscriptPlan } = loadPure();
  const words = timed("and I, uh, and I, studying");
  const plan = buildTranscriptPlan(words, [], [{ text: "and I", at: 0 }]);
  assert.deepEqual(restartIndexes(plan), [3, 4]);
});

test("a hesitation inside the second copy is skipped and keeps only its filler style", () => {
  const { buildTranscriptPlan } = loadPure();
  const words = timed("we need to, we, um, need to act");
  const plan = buildTranscriptPlan(words, [], [{ text: "we need to", at: 0 }]);
  assert.deepEqual(restartIndexes(plan), [3, 5, 6]);
  assert.equal(plan[4].text, "um,");
  assert.equal(plan[4].restart, undefined);
});

test("a word said three times has two repeats and marks the second and third copies", () => {
  const { buildTranscriptPlan } = loadPure();
  const words = timed("the the the end");
  const repeats = [
    { text: "the", at: 0 },
    { text: "the", at: 0.5 },
  ];
  assert.deepEqual(restartIndexes(buildTranscriptPlan(words, [], repeats)), [1, 2]);
});

test("case and punctuation never stop a copy from matching", () => {
  const { buildTranscriptPlan } = loadPure();
  const words = timed("The plan, um, the plan works.");
  const plan = buildTranscriptPlan(words, [], [{ text: "The plan", at: 0 }]);
  assert.deepEqual(restartIndexes(plan), [3, 4]);
});

test("without repeats no word carries a restart flag, so the plan keeps its shape", () => {
  const { buildTranscriptPlan } = loadPure();
  const twoArgs = buildTranscriptPlan(FEW_DECISIONS, []);
  const empty = buildTranscriptPlan(FEW_DECISIONS, [], []);
  for (const plan of [twoArgs, empty]) {
    assert.ok(plan.every((item) => !Object.hasOwn(item, "restart")));
  }
});

test("a malformed repeat or one never said again marks nothing and never throws", () => {
  const { buildTranscriptPlan } = loadPure();
  const words = timed("we win because the plan works");
  const repeats = [
    null,
    "the plan",
    { text: "the plan" },
    { text: "the plan", at: "1.5" },
    { text: "", at: 1.5 },
    { at: 1.5 },
    { text: "the plan", at: 1.5 },
    { text: "the plan", at: 99 },
  ];
  assert.deepEqual(restartIndexes(buildTranscriptPlan(words, [], repeats)), []);
  assert.deepEqual(restartIndexes(buildTranscriptPlan(words, [], "not a list")), []);
});

test("buildTranscriptPlan changes neither the words nor the repeats it reads", () => {
  const { buildTranscriptPlan } = loadPure();
  const words = FEW_DECISIONS.map((word) => ({ ...word }));
  const repeats = [{ ...FEW_DECISIONS_REPEAT }];
  const before = JSON.stringify([words, repeats]);
  buildTranscriptPlan(words, [], repeats);
  assert.equal(JSON.stringify([words, repeats]), before);
});

// The DOM half: show() against the fake document, with the real ui.js and delivery.js.
async function showSession(transcript, repeats) {
  const session = {
    id: "s1",
    createdAt: "2026-10-11T22:21:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 9,
    metrics: { pauses: [], repeats, fillers: {}, pace_windows: [] },
    transcript: transcript.map((word) => ({ ...word })),
  };
  const context = {
    app: {
      screens: {},
      passages: [{ id: "free-talk", targetWpm: [140, 160] }],
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
  return body;
}

function transcriptSpans(body) {
  return byClass(body, "transcript").children.filter((node) => node.tagName === "span");
}

test("the transcript draws the restart's words with .tok--restart and a label", async () => {
  const spans = transcriptSpans(await showSession(FEW_DECISIONS, [FEW_DECISIONS_REPEAT]));
  const drawn = spans.map((span) => [
    span.textContent,
    span.className,
    span.getAttribute("aria-label"),
  ]);
  assert.deepEqual(drawn.slice(2, 12), [
    ["the", "tok", null],
    ["few", "tok", null],
    ["decisions", "tok", null],
    ["a", "tok", null],
    ["day,", "tok", null],
    ["uh,", "tok tok--filler", "uh, filler word"],
    ["the", "tok tok--restart", "the, restart"],
    ["few", "tok tok--restart", "few, restart"],
    ["decisions", "tok tok--restart", "decisions, restart"],
    ["a", "tok tok--restart", "a, restart"],
  ]);
  assert.deepEqual(drawn[12], ["student", "tok", null]);
});

test("a verbal habit inside a restart keeps its habit style and names both", async () => {
  const words = timed("It was like, the plan, uh, like, the plan fails.");
  const spans = transcriptSpans(await showSession(words, [{ text: "like the plan", at: 1.0 }]));
  const like = spans[6];
  assert.equal(like.textContent, "like,");
  assert.equal(like.className, "tok tok--habit tok--restart");
  assert.equal(like.getAttribute("aria-label"), "like, verbal habit, restart");
  assert.equal(spans[2].className, "tok tok--habit", "the first copy is not a restart");
});

test("a take without repeats draws no restart", async () => {
  const spans = transcriptSpans(await showSession(FEW_DECISIONS, []));
  assert.ok(spans.every((span) => !span.classList.contains("tok--restart")));
});

test("styles.css draws a restart as a 2px dotted underline in the pause color", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const match = css.match(/(?:^|\})\s*\.tok--restart\s*\{([^}]*)\}/);
  assert.ok(match, "styles.css needs a .tok--restart rule");
  const rule = match[1];
  assert.match(rule, /text-decoration:\s*underline dotted var\(--pause\);/);
  assert.match(rule, /text-decoration-thickness:\s*2px;/);
  assert.match(rule, /text-underline-offset:\s*var\(--s-1\);/);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(rule), "token colors only, never raw hex");
});
