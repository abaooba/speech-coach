// Tests for showing misreads and skips on Results (PLAN.md T35). A take read from a script
// carries a metrics.script block (backend/script_align.py analyze_reading): `misread` entries
// ({word, index, at, said}) mark the spoken word with .tok--misread and an aria-label naming the
// script word; `skipped` entries ({word, index, at}) are drawn where they belong as struck-through
// .tok--skipped markers, which are not words. The legend names each style only when the
// transcript shows it, and a take without a script block renders exactly as before. Every
// script block below is what analyze_reading returns for those words and that script, unless a
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

const LEGEND_BASE =
  "Highlighted words are hesitations: um, uh, mhm. Underlined words are verbal habits.";
const LEGEND_RESTART = " Purple underlined words are restarts.";
const LEGEND_MISREAD = " Wavy underlined words are misreads.";
const LEGEND_SKIP = " Struck-through words were skipped.";

// A real take's words in clip seconds (the fixtures keep AssemblyAI's milliseconds).
function realTake(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
  return raw.words.map((word) => ({
    text: word.text,
    start: word.start / 1000,
    end: word.end / 1000,
  }));
}

// The owner's real 2026-10-11 read of the "Rebuttal: school uniforms" passage. Against that
// passage it says "make" for "makes" and restarts "the few decisions a".
const UNIFORMS_WORDS = realTake("take_2026_10_11_uniforms.json");
const UNIFORMS_RESTARTS = [{ text: "the few decisions a", at: 33.41 }];
const UNIFORMS_MISREAD = { word: "makes", index: 66, at: 26.492, said: "make" };

// The same take with "Consider what we lose." cut out (its words 76 to 79): the four script
// words are skipped right after "replacement.", which ends at 29.157.
const UNIFORMS_CUT_WORDS = [...UNIFORMS_WORDS.slice(0, 76), ...UNIFORMS_WORDS.slice(80)];
const UNIFORMS_SKIPPED = [
  { word: "Consider", index: 75, at: 29.157 },
  { word: "what", index: 76, at: 29.157 },
  { word: "we", index: 77, at: 29.157 },
  { word: "lose", index: 78, at: 29.157 },
];

// Words every half second, a quarter second long, as backend/tests/test_script_align.py
// builds them. Read against "We know that that nation can long endure, and we say so today."
function spoken(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: index * 0.5,
    end: index * 0.5 + 0.25,
  }));
}

function sessionWith(words, metrics) {
  return {
    id: "s1",
    createdAt: "2026-10-11T19:00:00.000Z",
    passageId: "talk",
    passageTitle: "Talk",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [], ...metrics },
    transcript: words,
  };
}

// A take read from a script: analyze_reading lists its script restarts as repeats too.
function readingSessionWith(words, script, extraMetrics) {
  const block = { restarts: [], skipped: [], misread: [], ...script };
  return sessionWith(words, { repeats: block.restarts, script: block, ...extraMetrics });
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

function spansWith(body, className) {
  return transcriptSpans(body).filter((span) => span.classList.contains(className));
}

function legendText(body) {
  return byClass(body, "transcript__legend").textContent;
}

// Every transcript node as its text (a text node) or [tag, class, label, text], for comparing
// two renders.
function transcriptShape(body) {
  return byClass(body, "transcript").children.map((node) =>
    node.tagName === undefined
      ? node.textContent
      : [node.tagName, node.className, node.getAttribute("aria-label"), node.textContent],
  );
}

function cssRule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.-]/g, (char) => "\\" + char);
  const match = css.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
  return match ? match[1] : null;
}

test("the real uniforms take: 'make' is a misread naming the script's 'makes'", async () => {
  const session = readingSessionWith(UNIFORMS_WORDS, {
    restarts: UNIFORMS_RESTARTS,
    misread: [UNIFORMS_MISREAD],
  });
  const body = await showSession(session);
  const misread = spansWith(body, "tok--misread");
  assert.equal(misread.length, 1);
  assert.equal(misread[0].textContent, "make");
  assert.equal(misread[0].className, "tok tok--misread");
  assert.equal(misread[0].getAttribute("aria-label"), "make, misread, script says makes");
  assert.deepEqual(spansWith(body, "tok--skipped"), []);
  assert.equal(
    spansWith(body, "tok--restart").length,
    4,
    "the restart is still marked beside the misread",
  );
  assert.equal(legendText(body), LEGEND_BASE + LEGEND_RESTART + LEGEND_MISREAD);
});

test("a skipped line is drawn struck through where it belongs, before the next word", async () => {
  const session = readingSessionWith(UNIFORMS_CUT_WORDS, {
    restarts: UNIFORMS_RESTARTS,
    skipped: UNIFORMS_SKIPPED,
    misread: [UNIFORMS_MISREAD],
  });
  const body = await showSession(session);
  const spans = transcriptSpans(body);
  const skipped = spansWith(body, "tok--skipped");
  assert.deepEqual(
    skipped.map((span) => [span.textContent, span.className, span.getAttribute("aria-label")]),
    [
      ["Consider", "tok--skipped", "skipped: Consider"],
      ["what", "tok--skipped", "skipped: what"],
      ["we", "tok--skipped", "skipped: we"],
      ["lose", "tok--skipped", "skipped: lose"],
    ],
  );
  const first = spans.indexOf(skipped[0]);
  assert.deepEqual(
    spans.slice(first - 1, first + 5).map((span) => span.textContent),
    ["replacement.", "Consider", "what", "we", "lose", "Choosing"],
  );
  assert.equal(legendText(body), LEGEND_BASE + LEGEND_RESTART + LEGEND_MISREAD + LEGEND_SKIP);
});

test("skipped words are not spoken words: the cards and the word count do not change", async () => {
  const withSkips = readingSessionWith(UNIFORMS_CUT_WORDS, {
    restarts: UNIFORMS_RESTARTS,
    skipped: UNIFORMS_SKIPPED,
  });
  const withoutSkips = readingSessionWith(UNIFORMS_CUT_WORDS, { restarts: UNIFORMS_RESTARTS });
  const app = loadApp(null);
  const summary = app.screens.results.summarize(withSkips);
  const baseline = app.screens.results.summarize(withoutSkips);
  for (const key of ["wpm", "fillersPerMinute", "pauseCount", "cleanStretchSeconds"]) {
    assert.equal(summary[key], baseline[key], key);
  }
  const body = await showSession(withSkips);
  const words = transcriptSpans(body).filter((span) => span.classList.contains("tok"));
  assert.equal(words.length, UNIFORMS_CUT_WORDS.length, "every spoken word, and only those");
  assert.ok(words.every((span) => !span.classList.contains("tok--skipped")));
});

test("a skip before the first word goes first, and one mid-take after its word", async () => {
  const words = spoken("know that nation can short endure, and we say so today.");
  const session = readingSessionWith(words, {
    skipped: [
      { word: "We", index: 0, at: 0.0 },
      { word: "that", index: 2, at: 0.25 },
    ],
    misread: [{ word: "long", index: 6, at: 2.0, said: "short" }],
  });
  const body = await showSession(session);
  assert.deepEqual(
    transcriptSpans(body)
      .slice(0, 7)
      .map((span) => [span.textContent, span.className]),
    [
      ["We", "tok--skipped"],
      ["know", "tok"],
      ["that", "tok--skipped"],
      ["that", "tok"],
      ["nation", "tok"],
      ["can", "tok"],
      ["short", "tok tok--misread"],
    ],
  );
  assert.equal(
    spansWith(body, "tok--misread")[0].getAttribute("aria-label"),
    "short, misread, script says long",
  );
});

test("a misread half of a dash-joined word marks that word", async () => {
  const words = spoken("We know that that nation can short-endure, and we say so today.");
  const session = readingSessionWith(words, {
    misread: [{ word: "long", index: 6, at: 3.0, said: "short" }],
  });
  const body = await showSession(session);
  const misread = spansWith(body, "tok--misread");
  assert.deepEqual(
    misread.map((span) => [span.textContent, span.getAttribute("aria-label")]),
    [["short-endure,", "short-endure, misread, script says long"]],
  );
});

test("a misread word inside a restart keeps both styles and both labels (made up)", async () => {
  // A made-up script block: the backend reports this combination when a restart's second copy
  // misreads a script word; the drawing must keep both marks.
  const words = spoken("We need, uh, we needs a plan that works today.");
  const session = readingSessionWith(words, {
    restarts: [{ text: "We need", at: 0 }],
    misread: [{ word: "need", index: 1, at: words[4].start, said: "needs" }],
  });
  const body = await showSession(session);
  const needs = transcriptSpans(body).find((span) => span.textContent === "needs");
  assert.equal(needs.className, "tok tok--restart tok--misread");
  assert.equal(needs.getAttribute("aria-label"), "needs, restart, misread, script says need");
});

test("a skip and a counted pause in the same place: the skip comes first (made up)", async () => {
  // Made-up pause: the read skips "long" right after "can", where a 1 s pause also begins.
  const words = spoken("We know that that nation can endure, and we said today.");
  const session = readingSessionWith(
    words,
    {
      skipped: [
        { word: "long", index: 6, at: 2.75 },
        { word: "say", index: 10, at: 4.25 },
      ],
      misread: [{ word: "so", index: 11, at: 4.5, said: "said" }],
    },
    { pauses: [[2.75, 1.0]] },
  );
  const body = await showSession(session);
  const nodes = transcriptSpans(body).map((span) => span.textContent);
  const can = nodes.indexOf("can");
  assert.deepEqual(nodes.slice(can, can + 4), ["can", "long", "1.0 s pause", "endure,"]);
  const we = nodes.indexOf("we");
  assert.deepEqual(nodes.slice(we, we + 4), ["we", "say", "said", "today."]);
});

test("a take without a script block renders exactly as before", async () => {
  const plainSession = sessionWith(UNIFORMS_WORDS, { repeats: UNIFORMS_RESTARTS });
  const body = await showSession(plainSession);
  assert.deepEqual(spansWith(body, "tok--misread"), []);
  assert.deepEqual(spansWith(body, "tok--skipped"), []);
  assert.equal(legendText(body), LEGEND_BASE + LEGEND_RESTART);
  const emptyBlock = await showSession(
    readingSessionWith(UNIFORMS_WORDS, { restarts: UNIFORMS_RESTARTS }),
  );
  assert.deepEqual(transcriptShape(emptyBlock), transcriptShape(body));
  assert.equal(legendText(emptyBlock), legendText(body));
});

test("buildTranscriptPlan without script slips gives the same plan as before", () => {
  const app = loadApp(null);
  const { buildTranscriptPlan } = app.screens.results;
  const words = spoken("We know that that nation can long endure.");
  const before = plain(buildTranscriptPlan(words, [[1.25, 0.5]], [2]));
  assert.deepEqual(plain(buildTranscriptPlan(words, [[1.25, 0.5]], [2], {})), before);
  assert.ok(before.every((item) => !("misread" in item) && item.type !== "skip"));
});

test("buildTranscriptPlan: misread words name their script word, skips are their own items", () => {
  const app = loadApp(null);
  const words = spoken("know that nation can short endure.");
  const plan = plain(
    app.screens.results.buildTranscriptPlan(words, [], [], {
      misreads: [{ wordIndex: 4, word: "long" }],
      skips: [
        { at: 0, word: "We" },
        { at: 0.25, word: "that" },
      ],
    }),
  );
  assert.deepEqual(plan.slice(0, 3), [
    { type: "skip", text: "We" },
    { type: "word", text: "know", filler: false, kind: null },
    { type: "skip", text: "that" },
  ]);
  assert.deepEqual(plan[6], {
    type: "word",
    text: "short",
    filler: false,
    kind: null,
    misread: "long",
  });
});

test("analyze reports each misread with the transcript index of the word said", () => {
  const app = loadApp(null);
  const report = app.delivery.analyze(UNIFORMS_WORDS, {
    pauses: [],
    repeats: UNIFORMS_RESTARTS,
    script: { restarts: UNIFORMS_RESTARTS, skipped: [], misread: [UNIFORMS_MISREAD] },
  });
  assert.deepEqual(plain(report.misreads), [
    { at: 26.492, word: "makes", said: "make", wordIndex: 67 },
  ]);
  assert.deepEqual(plain(report.skips), []);
});

test("analyze lists skips, drops malformed slips, and has none without a script", () => {
  const app = loadApp(null);
  const report = app.delivery.analyze(UNIFORMS_CUT_WORDS, {
    pauses: [],
    script: {
      restarts: [],
      skipped: [...UNIFORMS_SKIPPED, null, { word: "x" }, { at: 3 }],
      misread: [{ word: "makes", at: "soon", said: "make" }, 7],
    },
  });
  assert.deepEqual(
    plain(report.skips),
    UNIFORMS_SKIPPED.map(({ word, at }) => ({ at, word })),
  );
  assert.deepEqual(plain(report.misreads), []);
  const free = app.delivery.analyze(UNIFORMS_WORDS, { pauses: [], repeats: [] });
  assert.deepEqual(plain(free.misreads), []);
  assert.deepEqual(plain(free.skips), []);
});

test("a misread no transcript word says is not drawn and adds no legend entry", async () => {
  const words = spoken("We know that that nation can short endure.");
  const session = readingSessionWith(words, {
    misread: [{ word: "long", index: 6, at: 9.0, said: "short" }],
  });
  const body = await showSession(session);
  assert.deepEqual(spansWith(body, "tok--misread"), []);
  assert.equal(legendText(body), LEGEND_BASE);
  const app = loadApp(null);
  const report = app.delivery.analyze(words, session.metrics);
  assert.equal(report.misreads[0].wordIndex, -1);
});

test("a take saved without words keeps its slips, with no word to mark", () => {
  const app = loadApp(null);
  const report = app.delivery.analyze([], {
    pauses: [],
    script: { restarts: [], skipped: UNIFORMS_SKIPPED, misread: [UNIFORMS_MISREAD] },
  });
  assert.equal(report.skips.length, 4);
  assert.deepEqual(plain(report.misreads), [
    { at: 26.492, word: "makes", said: "make", wordIndex: -1 },
  ]);
});

test("styles: a wavy underline for misreads, after the restart rule; skips struck through", () => {
  const misread = cssRule(".tok--misread");
  assert.ok(misread, ".tok--misread has a rule");
  assert.match(misread, /text-decoration-line:\s*underline/);
  assert.match(misread, /text-decoration-style:\s*wavy/);
  assert.doesNotMatch(misread, /text-decoration-color/, "a restart keeps its --pause color");
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    css.indexOf(".tok--misread {") > css.indexOf(".tok--restart {"),
    "the wavy style wins over the restart's dotted one on a word that is both",
  );
  const skipped = cssRule(".tok--skipped");
  assert.ok(skipped, ".tok--skipped has a rule");
  assert.match(skipped, /text-decoration:\s*line-through/);
  assert.match(skipped, /color:\s*var\(--muted\)/);
});

test("DESIGN.md lists the misread and skipped styles and their legend sentences", () => {
  const design = read("DESIGN.md");
  assert.match(design, /\*\*Misread\*\* `\.tok--misread`/);
  assert.match(design, /\*\*Skipped\*\* `\.tok--skipped`/);
  assert.match(design, /Wavy underlined words are misreads\./);
  assert.match(design, /Struck-through words were skipped\./);
});
