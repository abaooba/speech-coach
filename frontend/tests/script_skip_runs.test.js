// Tests for long runs of skipped script words on Results (PLAN.md T35, review fix). A take that
// stops early, or starts partway into its script, leaves the script's unread tail or head as
// skips (backend/script_align.py analyze_reading lists every one, all at one `at`). Up to
// MAX_SKIPS_SHOWN_ONE_BY_ONE adjacent skips are still drawn word by word; a longer run is one
// marker that says how many words were skipped and shows the first and last three, so the
// transcript is not buried under struck-through words. Every script block below is what
// analyze_reading returns for those words and the "Rebuttal: school uniforms" passage, unless a
// test says it is made up.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "delivery.js", path.join("screens", "results.js")].map((file) => [
  file,
  read(file),
]);
const CSS = read("styles.css");
const PASSAGES = [{ id: "talk", targetWpm: [140, 160] }];

const LEGEND_SKIP = " Struck-through words were skipped.";

// The owner's real 2026-10-11 read of the uniforms passage, in clip seconds.
const UNIFORMS_WORDS = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "take_2026_10_11_uniforms.json"), "utf8"),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));

// Script words `first` onward, each skipped at `at`, as analyze_reading lists them.
function skippedRun(text, first, at) {
  return text.split(" ").map((word, offset) => ({ word, index: first + offset, at }));
}

// The take stopped after its first 60 words ("... parents still buy", which ends at 23.317):
// the passage's last 50 words (indexes 59 to 108) were never reached.
const STOPPED_EARLY_WORDS = UNIFORMS_WORDS.slice(0, 60);
const STOPPED_EARLY_SKIPPED = skippedRun(
  "everyday clothes for evenings and weekends which makes the uniform an added cost not a " +
    "replacement Consider what we lose Choosing how to present yourself is one of the few " +
    "decisions a student makes every day Taking that away teaches compliance not confidence " +
    "The proposal fails on its own terms",
  59,
  23.317,
);

// The take started at its word 40 ("a dress code", starting at 15.667): the passage's first 39
// words (indexes 0 to 38) were never read. It still says "make" for "makes".
const STARTED_LATE_WORDS = UNIFORMS_WORDS.slice(40);
const STARTED_LATE_SKIPPED = skippedRun(
  "My opponents claim that uniforms erase bullying but the evidence says otherwise Students " +
    "who want to single someone out will find a reason whether it is shoes a backpack or a " +
    "phone The real problem is school culture and",
  0,
  15.667,
);
const STARTED_LATE_MISREAD = { word: "makes", index: 66, at: 26.492, said: "make" };

function readingSession(words, script) {
  const block = { restarts: [], skipped: [], misread: [], ...script };
  return {
    id: "s1",
    createdAt: "2026-10-11T19:00:00.000Z",
    passageId: "talk",
    passageTitle: "Talk",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [], script: block },
    transcript: words,
  };
}

function loadApp(session) {
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
  return context.app;
}

async function showSession(session) {
  const app = loadApp(session);
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.results.mount(root);
  await app.screens.results.show({ id: session.id });
  return body;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function transcriptSpans(body) {
  return byClass(body, "transcript").children.filter((node) => node.tagName === "span");
}

// The text a screen reader or a copy reads from a node: its own text, then its children's.
function textOf(node) {
  return node.textContent + (node.children || []).map(textOf).join("");
}

// Words every half second, a quarter second long.
function spoken(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: index * 0.5,
    end: index * 0.5 + 0.25,
  }));
}

test("a take that stops early shows its unread script as one marker, not 50 words", async () => {
  const body = await showSession(
    readingSession(STOPPED_EARLY_WORDS, { skipped: STOPPED_EARLY_SKIPPED }),
  );
  const spans = transcriptSpans(body);
  assert.deepEqual(
    spans.filter((span) => span.classList.contains("tok--skipped")),
    [],
    "no word-by-word skips",
  );
  const runs = spans.filter((span) => span.classList.contains("skip-run"));
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal(spans.indexOf(run), spans.length - 1, "after the last word said");
  assert.equal(spans[spans.length - 2].textContent, "buy");
  assert.equal(textOf(run), "50 words skipped: everyday clothes for … its own terms");
  assert.deepEqual(
    run.children
      .filter((node) => node.tagName === "span")
      .map((node) => [node.className, node.textContent]),
    [
      ["skip-run__count", "50 words skipped:"],
      ["tok--skipped", "everyday clothes for … its own terms"],
    ],
  );
  assert.equal(
    spans.filter((span) => span.classList.contains("tok")).length,
    STOPPED_EARLY_WORDS.length,
    "every spoken word, and only those",
  );
  assert.ok(byClass(body, "transcript__legend").textContent.includes(LEGEND_SKIP));
});

test("a take that starts partway in shows the unread opening as one marker first", async () => {
  const body = await showSession(
    readingSession(STARTED_LATE_WORDS, {
      skipped: STARTED_LATE_SKIPPED,
      misread: [STARTED_LATE_MISREAD],
    }),
  );
  const spans = transcriptSpans(body);
  assert.equal(spans[0].className, "skip-run");
  assert.equal(textOf(spans[0]), "39 words skipped: My opponents claim … school culture and");
  assert.equal(spans[1].textContent, "a", "the first word said comes right after it");
  const misread = spans.filter((span) => span.classList.contains("tok--misread"));
  assert.deepEqual(
    misread.map((span) => span.textContent),
    ["make"],
  );
});

test("buildTranscriptPlan: up to 8 adjacent skips stay word by word, 9 become one run", () => {
  const app = loadApp(null);
  const { buildTranscriptPlan } = app.screens.results;
  const words = spoken("We know that.");
  const eight = "one two three four five six seven eight".split(" ");
  const nine = [...eight, "nine"];
  const planOf = (skipped) =>
    plain(
      buildTranscriptPlan(words, [], [], {
        misreads: [],
        skips: skipped.map((word) => ({ at: 1.25, word })),
      }),
    );
  assert.deepEqual(
    planOf(eight).slice(3),
    eight.map((text) => ({ type: "skip", text })),
  );
  assert.deepEqual(planOf(nine).slice(3), [
    { type: "skip", text: "one two three … seven eight nine", count: 9 },
  ]);
});

test("buildTranscriptPlan: runs in different places are judged apart (made up)", () => {
  const app = loadApp(null);
  const words = spoken("We know that nation.");
  const nine = "a b c d e f g h i".split(" ");
  const plan = plain(
    app.screens.results.buildTranscriptPlan(words, [[0.75, 1.0]], [], {
      skips: [
        ...nine.map((word) => ({ at: 0, word })),
        { at: 0.75, word: "that" },
        { at: 0.75, word: "that" },
      ],
    }),
  );
  assert.deepEqual(plan, [
    { type: "skip", text: "a b c … g h i", count: 9 },
    { type: "word", text: "We", filler: false, kind: null },
    { type: "word", text: "know", filler: false, kind: null },
    { type: "skip", text: "that" },
    { type: "skip", text: "that" },
    { type: "pause", length: 1.0 },
    { type: "word", text: "that", filler: false, kind: null },
    { type: "word", text: "nation.", filler: false, kind: null },
  ]);
});

test("styles: the run's count is muted and not struck through", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const match = css.match(/\.skip-run__count\s*\{([^}]*)\}/);
  assert.ok(match, ".skip-run__count has a rule");
  assert.match(match[1], /color:\s*var\(--muted\)/);
  assert.doesNotMatch(match[1], /line-through/);
});

test("DESIGN.md describes the skip run and where a skip inside a dash-joined word goes", () => {
  const design = read("DESIGN.md");
  assert.match(design, /`\.skip-run`/);
  assert.match(design, /50 words skipped: everyday clothes for … its own terms/);
  assert.match(design, /inside a dash-joined word[^.]*is drawn after the whole word/);
});
