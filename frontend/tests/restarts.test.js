// Tests for showing restarts on Results (queue task T29). Every backend repeat ({text, at}: a
// phrase said twice, a restart after abandoned words, a cut-off restart, or a script restart)
// marks the words of its SECOND copy with .tok--restart, adds a Restart entry to the transcript
// legend, and draws a thin --pause tick on the speech timeline at its `at`, with a legend chip
// and a line in the hidden list of moments. Checked on made-up takes, on the owner's two real
// 2026-10-11 takes and on the script restarts backend/tests/test_script_align.py pins.
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

// A real take's words in clip seconds (the fixtures keep AssemblyAI's milliseconds).
function realTake(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
  return raw.words.map((word) => ({
    text: word.text,
    start: word.start / 1000,
    end: word.end / 1000,
  }));
}

// backend metrics.find_repeats (and, with the uniforms script, script_align) on these takes.
const UNIFORMS_WORDS = realTake("take_2026_10_11_uniforms.json");
const UNIFORMS_REPEATS = [{ text: "the few decisions a", at: 33.41 }];
const NERVOUS_WORDS = realTake("take_2026_10_11_nervous.json");
const NERVOUS_REPEATS = [{ text: "I kinda ner", at: 27.379 }];
// The test clip's words are already in seconds.
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "test_clip_assemblyai.json"), "utf8"),
).words;
const CLIP_REPEATS = [{ text: "and I", at: 16.515 }];

// Words every half second, a quarter second long, as backend/tests/test_script_align.py
// builds them.
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
    createdAt: "2026-10-11T19:00:00.000Z",
    passageId: "talk",
    passageTitle: "Talk",
    durationSeconds: 60,
    metrics: { pauses: [], repeats, fillers: {}, pace_windows: [] },
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

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function wordSpans(body) {
  return byClass(body, "transcript").children.filter((node) => node.tagName === "span");
}

// The text of every transcript word marked as a restart, in reading order.
function restartWords(body) {
  return wordSpans(body)
    .filter((span) => span.classList.contains("tok--restart"))
    .map((span) => span.textContent);
}

// SVG nodes take their class through setAttribute, so the strip is found by that attribute.
function stripOf(body) {
  return byClass(body, "timeline").children.find(
    (node) => node.getAttribute && node.getAttribute("class") === "timeline__strip",
  );
}

function restartTicks(body) {
  return stripOf(body).children.filter(
    (mark) => mark.getAttribute("class") === "timeline__restart",
  );
}

function cssRule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.-]/g, (char) => "\\" + char);
  const match = css.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
  return match ? match[1] : null;
}

const ONE_REPEAT_WORDS = spoken("We need, uh, we need a plan that works today.");
const ONE_REPEAT = [{ text: "We need", at: 0 }];

test("one repeat: its second copy's words carry tok--restart and a restart label", async () => {
  const body = await showSession(sessionWith(ONE_REPEAT_WORDS, ONE_REPEAT));
  const spans = wordSpans(body);
  assert.deepEqual(
    spans.map((span) => [span.textContent, span.className]),
    [
      ["We", "tok"],
      ["need,", "tok"],
      ["uh,", "tok tok--filler"],
      ["we", "tok tok--restart"],
      ["need", "tok tok--restart"],
      ["a", "tok"],
      ["plan", "tok"],
      ["that", "tok"],
      ["works", "tok"],
      ["today.", "tok"],
    ],
  );
  assert.equal(spans[3].getAttribute("aria-label"), "we, restart");
  assert.equal(spans[4].getAttribute("aria-label"), "need, restart");
  assert.equal(spans[0].getAttribute("aria-label"), null, "the first copy is a plain word");
});

test("one repeat: a thin --pause tick on the timeline at the repeat's at", async () => {
  const words = spoken("So today, we need, uh, we need a plan that works today.");
  const body = await showSession(sessionWith(words, [{ text: "we need", at: 1 }]));
  const ticks = restartTicks(body);
  assert.equal(ticks.length, 1);
  const tick = ticks[0];
  assert.equal(tick.tagName, "rect");
  assert.equal(tick.getAttribute("fill"), "var(--pause)");
  // The take runs from 0 to 5.75 s; 1 s in is 320 * 1 / 5.75 = 55.65 units, centered.
  assert.equal(tick.getAttribute("x"), "55.15");
  assert.equal(tick.getAttribute("width"), "1", "thinner than a 2-unit filler tick");
  assert.equal(tick.getAttribute("y"), "0", "taller than a filler tick, so it shows past one");
  assert.equal(tick.getAttribute("height"), "40");
});

test("the timeline legend gains a Restart chip and the moments name the restart", async () => {
  const body = await showSession(sessionWith(ONE_REPEAT_WORDS, ONE_REPEAT));
  const timeline = byClass(body, "timeline");
  const legend = byClass(timeline, "timeline__legend");
  assert.deepEqual(legend.children.map(fullText), [
    "Filler",
    "Mid-sentence pause",
    "Restart",
    "Clean stretch",
  ]);
  const chip = legend.children[2];
  assert.equal(chip.className, "timeline__key");
  assert.equal(chip.children[0].className, "timeline__swatch timeline__swatch--restart");
  assert.equal(chip.children[0].getAttribute("aria-hidden"), "true");
  const moments = byClass(timeline, "timeline__moments").children.map((item) => item.textContent);
  assert.ok(moments.includes("Restart “We need” at 0:00"), moments.join(" | "));
  assert.match(stripOf(body).getAttribute("aria-label"), /, 1 restart, /);
});

test("the transcript legend sentence adds a Restart entry when a restart is shown", async () => {
  const body = await showSession(sessionWith(ONE_REPEAT_WORDS, ONE_REPEAT));
  assert.equal(
    byClass(body, "transcript__legend").textContent,
    "Highlighted words are ums and uhs. Underlined words are verbal habits. " +
      "Purple underlined words are restarts.",
  );
});

test("a take without repeats gets no restart class, tick, chip or legend entry", async () => {
  const body = await showSession(sessionWith(ONE_REPEAT_WORDS, []));
  assert.deepEqual(restartWords(body), []);
  assert.deepEqual(restartTicks(body), []);
  const legend = byClass(byClass(body, "timeline"), "timeline__legend");
  assert.ok(!legend.children.map(fullText).includes("Restart"));
  assert.ok(!byClass(body, "transcript__legend").textContent.includes("restart"));
  assert.ok(!stripOf(body).getAttribute("aria-label").includes("restart"));
});

test("the real uniforms take: the second 'the few decisions a' is underlined", async () => {
  const body = await showSession(sessionWith(UNIFORMS_WORDS, UNIFORMS_REPEATS));
  assert.deepEqual(restartWords(body), ["the", "few", "decisions", "a"]);
  const spans = wordSpans(body);
  const marked = spans.filter((span) => span.classList.contains("tok--restart"));
  const firstMarked = spans.indexOf(marked[0]);
  assert.deepEqual(
    spans.slice(firstMarked - 6, firstMarked + 5).map((span) => span.textContent),
    ["the", "few", "decisions", "a", "day—", "uh,", "the", "few", "decisions", "a", "student"],
    "the first copy and the abandoned 'day—' stay plain",
  );
  assert.equal(restartTicks(body).length, 1);
});

test("the real nervous take: a cut-off restart marks the words said after the cut", async () => {
  const body = await showSession(sessionWith(NERVOUS_WORDS, NERVOUS_REPEATS));
  assert.deepEqual(restartWords(body), ["I'm", "kinda", "nervous"]);
  const spans = wordSpans(body);
  const ner = spans.find((span) => span.textContent === "ner—");
  assert.equal(ner.className, "tok", "the cut-off fragment is the first copy");
  assert.equal(restartTicks(body).length, 1);
});

test("the test clip: the 'and I,' said after 'uh,' is the restart", async () => {
  const body = await showSession(sessionWith(CLIP_WORDS, CLIP_REPEATS));
  assert.deepEqual(restartWords(body), ["and", "I,"]);
  const spans = wordSpans(body);
  const firstMarked = spans.findIndex((span) => span.classList.contains("tok--restart"));
  assert.equal(spans[firstMarked - 1].textContent, "uh,");
});

test("a phrase started three times marks each copy after the first", async () => {
  const words = spoken("the few — the few — the few decisions a student");
  const repeats = [
    { text: "the few", at: words[0].start },
    { text: "the few", at: words[3].start },
  ];
  const body = await showSession(sessionWith(words, repeats));
  assert.deepEqual(restartWords(body), ["the", "few", "the", "few"]);
  const spans = wordSpans(body);
  assert.deepEqual(
    [3, 4, 6, 7].map((index) => spans[index].classList.contains("tok--restart")),
    [true, true, true, true],
  );
  assert.equal(spans[2].className, "tok", "a dash on its own is not part of either copy");
  assert.equal(restartTicks(body).length, 2);
});

test("a cut-off word finished right after marks the finished word", async () => {
  const words = spoken("the evidence sa— says otherwise and the plan fails.");
  const body = await showSession(sessionWith(words, [{ text: "sa", at: words[2].start }]));
  assert.deepEqual(restartWords(body), ["says"]);
});

test("a script restart over a doubled word marks the copy read again", async () => {
  const words = spoken("Gentlemen may cry, Peace, Peace, but there Peace, but there is no peace.");
  const body = await showSession(
    sessionWith(words, [{ text: "Peace but there", at: words[4].start }]),
  );
  const spans = wordSpans(body);
  assert.deepEqual(
    spans
      .map((span, index) => [index, span.textContent, span.classList.contains("tok--restart")])
      .filter(([, , marked]) => marked)
      .map(([index, text]) => [index, text]),
    [
      [7, "Peace,"],
      [8, "but"],
      [9, "there"],
    ],
  );
});

test("a script restart whose second copy has a misread still marks it", async () => {
  const words = spoken("one of the few decisions a student uh the few decision a student makes");
  const repeats = [{ text: "the few decisions a student", at: words[2].start }];
  const body = await showSession(sessionWith(words, repeats));
  assert.deepEqual(restartWords(body), ["the", "few", "decision", "a", "student"]);
});

test("a repeat with no second copy in the words gets its tick but marks no word", async () => {
  const words = spoken("We need a plan that works today and every day.");
  const body = await showSession(sessionWith(words, [{ text: "We need", at: 0 }]));
  assert.deepEqual(restartWords(body), []);
  assert.equal(restartTicks(body).length, 1);
  assert.ok(!byClass(body, "transcript__legend").textContent.includes("restart"));
});

test("analyze reports each restart with the word indexes of its second copy", () => {
  const app = loadApp(null);
  const report = app.delivery.analyze(ONE_REPEAT_WORDS, { pauses: [], repeats: ONE_REPEAT });
  assert.deepEqual(plain(report.restarts), [{ at: 0, text: "We need", secondCopy: [3, 4] }]);
  assert.equal(report.repeatCount, 1);
  const segments = plain(app.screens.results.timelineSegments(report));
  assert.deepEqual(segments.restarts, [{ at: 0, time: 0, text: "We need" }]);
});

test("a take saved without words still lists its restarts, with no words to mark", () => {
  const app = loadApp(null);
  const report = app.delivery.analyze([], { pauses: [], repeats: ONE_REPEAT });
  assert.deepEqual(plain(report.restarts), [{ at: 0, text: "We need", secondCopy: [] }]);
});

test("styles: a dotted --pause underline on restart words and a thin --pause swatch", () => {
  const word = cssRule(".tok--restart");
  assert.ok(word, ".tok--restart has a rule");
  assert.match(word, /text-decoration:\s*underline dotted var\(--pause\)/);
  assert.match(word, /text-decoration-thickness:\s*2px/);
  assert.match(word, /text-underline-offset:\s*var\(--s-1\)/);
  const swatch = cssRule(".timeline__swatch--restart");
  assert.ok(swatch, ".timeline__swatch--restart has a rule");
  assert.match(swatch, /background:\s*var\(--pause\)/);
  assert.match(swatch, /width:\s*2px/);
});

test("DESIGN.md lists the restart style and no longer says repeats are not styled", () => {
  const design = read("DESIGN.md");
  assert.match(design, /\*\*Restart\*\* `\.tok--restart`/);
  assert.match(design, /`\.timeline__swatch--restart`/);
  assert.doesNotMatch(design, /Repeats are not styled/);
});
