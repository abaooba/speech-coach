// Tests for T32: a pause of 5 seconds or more counts wherever it falls, even after a full stop,
// while shorter pauses still count only mid-sentence. Checked in the app.delivery report, on the
// owner's real 2026-10-11 church take, and in every place that reads the report: the Results
// cards, headline, timeline and transcript, the tips, the styles and the docs.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const DELIVERY_SOURCE = read("delivery.js");
const TIPS_SOURCE = read("tips.js");
const SCREEN_SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);
const CSS = read("styles.css");

// The church take as the API stores it ({text, start, end} in seconds) and its backend pauses.
// After "sad." the owner froze for 5.19 s; the other two pauses follow a period and are short.
const CHURCH_TRANSCRIPT = JSON.parse(
  fs.readFileSync(
    path.join(
      FRONTEND_DIR, "..", "backend", "tests", "fixtures", "take_2026_10_11_nervous.json",
    ),
    "utf8",
  ),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));
const CHURCH_PAUSES = [
  [25.305, 2.074],
  [35.738, 5.19],
  [46.717, 3.543],
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// Words 0.3 s long with 0.1 s between them, except that `gapAfter` maps a word's index to the
// silence after it: the pause the take's metrics then report as [that word's end, gap].
function spoken(sentence, gapAfter = {}) {
  let clock = 0;
  return sentence.split(" ").map((text, index) => {
    const word = { text, start: round3(clock), end: round3(clock + 0.3) };
    clock = word.end + (gapAfter[index] || 0.1);
    return word;
  });
}

const SENTENCE = "We win. The plan works today.";

function loadDelivery() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

function loadTips() {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  return app.tips;
}

function analyzeWithGap(gapAfter, length) {
  const words = spoken(SENTENCE, { [gapAfter]: length });
  const pause = [words[gapAfter].end, length];
  return { words, pause, report: loadDelivery().analyze(words, { pauses: [pause], repeats: [] }) };
}

test("delivery names the 5 second bar it counts long pauses from", () => {
  assert.equal(loadDelivery().LONG_PAUSE_SECONDS, 5);
});

test("a 6 s pause after a period counts as a long pause and cuts the clean stretch", () => {
  const { words, report } = analyzeWithGap(1, 6);
  assert.deepEqual(plain(report.pauses), [
    { at: words[1].end, length: 6, midSentence: false, long: true },
  ]);
  assert.equal(report.pauseCount, 1);
  assert.equal(report.longPauseCount, 1);
  assert.equal(report.longestPause, 6);
  assert.equal(report.midSentencePauseCount, 0, "it is still not a mid-sentence pause");
  assert.equal(report.longestMidSentencePause, 0);
  // Cut [0.7, 6.7]: the longest clean run is "The plan works today." from 6.7 to 8.2.
  assert.deepEqual(plain(report.cleanStretch), { start: 6.7, end: 8.2, seconds: 1.5 });
});

test("a 2 s pause after a period still does not count", () => {
  const { words, report } = analyzeWithGap(1, 2);
  assert.deepEqual(plain(report.pauses), [
    { at: words[1].end, length: 2, midSentence: false, long: false },
  ]);
  assert.equal(report.pauseCount, 0);
  assert.equal(report.longPauseCount, 0);
  assert.equal(report.longestPause, 0);
  assert.equal(report.cleanStretch.seconds, 4.2, "the whole take, first start to last end");
});

test("a 2 s pause mid-sentence counts as before, and is not long", () => {
  const { report } = analyzeWithGap(3, 2);
  assert.equal(report.pauses[0].midSentence, true);
  assert.equal(report.pauses[0].long, false);
  assert.equal(report.pauseCount, 1);
  assert.equal(report.midSentencePauseCount, 1);
  assert.equal(report.longestMidSentencePause, 2);
  assert.equal(report.longPauseCount, 0);
  assert.equal(report.longestPause, 2);
  assert.deepEqual(plain(report.cleanStretch), { start: 0, end: 1.5, seconds: 1.5 });
});

test("the bar is 5 s inclusive: 5 s after a period counts, 4.9 s does not", () => {
  assert.equal(analyzeWithGap(1, 5).report.pauseCount, 1);
  assert.equal(analyzeWithGap(1, 5).report.pauses[0].long, true);
  assert.equal(analyzeWithGap(1, 4.9).report.pauseCount, 0);
  assert.equal(analyzeWithGap(1, 4.9).report.pauses[0].long, false);
});

test("a long mid-sentence pause is one pause, both mid-sentence and long", () => {
  const { report } = analyzeWithGap(3, 7);
  assert.equal(report.pauseCount, 1, "never counted twice");
  assert.equal(report.midSentencePauseCount, 1);
  assert.equal(report.longPauseCount, 1);
  assert.equal(report.longestPause, 7);
});

// Silence before the first word or after the last is not a pause (backend/metrics.py), but
// pauses.js can still report one: a tap on the mic before a slow start opens its speech span.
function withEdgeSilence(where) {
  const words = spoken(SENTENCE).map((word) => ({
    text: word.text,
    start: round3(word.start + 6.5),
    end: round3(word.end + 6.5),
  }));
  const last = words[words.length - 1].end;
  const pause = where === "before" ? [0.2, 6.3] : [last, 6];
  return { words, pause };
}

for (const where of ["before", "after"]) {
  test(`a 6 s silence ${where} the speech is not a long pause and is not counted`, () => {
    const { words, pause } = withEdgeSilence(where);
    const report = loadDelivery().analyze(words, { pauses: [pause], repeats: [] });
    assert.deepEqual(plain(report.pauses), [
      { at: pause[0], length: pause[1], midSentence: false, long: false },
    ]);
    assert.equal(report.pauseCount, 0);
    assert.equal(report.longPauseCount, 0);
    assert.equal(report.longestPause, 0);
    assert.equal(report.cleanStretch.seconds, 2.3, "the whole take, first start to last end");
    const ids = plain(loadTips().select(report, { targetWpm: [140, 160] })).map((tip) => tip.id);
    assert.ok(!ids.includes("freeze"), `tips ${ids.join(", ")} call the edge silence a freeze`);
  });
}

test("a pause that reads 5.0 s is long: the bar applies to the length shown, to a tenth", () => {
  const { report } = analyzeWithGap(1, 4.96);
  assert.equal(report.pauses[0].long, true);
  assert.equal(report.pauseCount, 1);
  assert.equal(report.longestPause, 5);
  assert.equal(analyzeWithGap(1, 4.94).report.pauses[0].long, false, "4.94 s reads 4.9 s");
  assert.equal(analyzeWithGap(1, 4.94).report.pauseCount, 0);
});

test("without words every pause still counts, and the long ones are flagged", () => {
  const report = loadDelivery().analyze([], { pauses: [[10, 6], [20, 2]], duration: 30 });
  assert.deepEqual(
    plain(report.pauses).map((pause) => [pause.midSentence, pause.long]),
    [
      [true, true],
      [true, false],
    ],
  );
  assert.equal(report.pauseCount, 2);
  assert.equal(report.longPauseCount, 1);
  assert.equal(report.longestPause, 6);
});

test("the church take: the 5.2 s freeze after 'sad.' counts as the take's one long pause", () => {
  const report = loadDelivery().analyze(CHURCH_TRANSCRIPT, {
    pauses: CHURCH_PAUSES,
    repeats: [{ text: "I kinda ner", at: 27.379 }],
  });
  assert.deepEqual(
    plain(report.pauses).map((pause) => [pause.at, pause.midSentence, pause.long]),
    [
      [25.305, false, false],
      [35.738, false, true],
      [46.717, false, false],
    ],
  );
  assert.equal(report.pauseCount, 1);
  assert.equal(report.longPauseCount, 1);
  assert.equal(report.longestPause, 5.2);
});

// ---- Results ----------------------------------------------------------------------------

function sessionWith(words, pauses, extra = {}) {
  return {
    id: "s1",
    createdAt: "2026-10-11T10:00:00.000Z",
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 10,
    metrics: { pauses, repeats: [], fillers: {}, pace_windows: [], ...extra },
    transcript: words.map((word) => ({ ...word })),
  };
}

function longAfterPeriod() {
  const words = spoken(SENTENCE, { 1: 6 });
  return sessionWith(words, [[words[1].end, 6]]);
}

function screenContext(session) {
  const context = {
    app: {
      screens: {},
      passages: [{ id: "gettysburg", targetWpm: [130, 150] }],
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SCREEN_SOURCES.forEach(([file, source]) => {
    vm.runInNewContext(source, context, { filename: file });
  });
  return context.app;
}

async function showSession(session) {
  const app = screenContext(session);
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.results.mount(root);
  await app.screens.results.show({ id: session.id });
  return body;
}

function fullText(node) {
  if (node.nodeType === 3) {
    return node.textContent;
  }
  return node.children.length > 0 ? node.children.map(fullText).join("") : node.textContent;
}

test("summarize counts the long pause on the pauses card and as the longest pause", () => {
  const summary = screenContext(null).screens.results.summarize(longAfterPeriod());
  assert.equal(summary.pauseCount, 1);
  assert.equal(summary.longestPause, 6);
  assert.equal(summary.longPauseCount, 1);
});

test("the pauses card shows the long pause after a period", async () => {
  const body = await showSession(longAfterPeriod());
  const card = byClass(body, "stat-strip").children[2];
  assert.equal(byClass(card, "stat__value").children[0].textContent, "1");
});

test("the headline never calls a take with a freeze pause-free, and asks to shorten it", () => {
  const results = screenContext(null).screens.results;
  const summary = results.summarize(longAfterPeriod());
  summary.wpm = 140;
  const headline = results.headlineFor(summary, null);
  assert.notEqual(headline.strength, "No pause breaks a sentence.");
  assert.equal(headline.focus, "Next take, keep every pause under 5 seconds.");

  // A take saved without words: its pause cannot be placed, but it is still long.
  const tallies = results.summarize(
    sessionWith([], [[10, 6]], { words_per_minute: 140, duration: 60, word_count: 140 }),
  );
  assert.equal(
    results.headlineFor(tallies, null).focus,
    "Next take, keep every pause under 5 seconds.",
  );
});

test("a short mid-sentence pause keeps the old focus", () => {
  const results = screenContext(null).screens.results;
  const words = spoken(SENTENCE, { 3: 2 });
  const summary = results.summarize(sessionWith(words, [[words[3].end, 2]]));
  summary.wpm = 140;
  assert.equal(
    results.headlineFor(summary, null).focus,
    "Next take, save pauses for the ends of sentences.",
  );
});

test("timelineSegments includes the long pause after a period and flags it", () => {
  const app = screenContext(null);
  const session = longAfterPeriod();
  const report = app.delivery.analyze(session.transcript, session.metrics);
  const segments = plain(app.screens.results.timelineSegments(report));
  assert.deepEqual(
    segments.pauses.map((pause) => [pause.time, pause.seconds, pause.long]),
    [[0.7, 6, true]],
  );
});

// The speech map's cards: [kind, clock, label, context (marks in brackets)] each.
function mapBody(body) {
  const stage = byClass(byClass(body, "speech-map"), "speech-map__stage");
  return byClass(stage, "speech-map__body");
}

function mapRows(body) {
  return byClass(mapBody(body), "speech-map__moments").children.map((row) => {
    const [head, context] = row.children[0].children;
    const words = context.children.map((node) =>
      node.nodeType === 3 ? node.textContent : "[" + node.textContent + "]",
    );
    return [
      row.className.replace("moment moment--", ""),
      ...head.children.map((part) => part.textContent),
      (context.textContent || "") + words.join(""),
    ];
  });
}

function mapLabel(body) {
  return byClass(mapBody(body), "speech-map__moments").getAttribute("aria-label");
}

function railMarks(body) {
  const rail = mapBody(body).children.find(
    (node) => node.getAttribute("class") === "speech-map__rail",
  );
  return rail.children.filter((node) => /speech-map__mark/.test(node.getAttribute("class")));
}

test("the map draws a long pause as its own card, named, with the words around it", async () => {
  const body = await showSession(longAfterPeriod());
  const rows = mapRows(body);
  assert.ok(!rows.some(([kind]) => kind === "pause"), "not a plain mid-sentence pause");
  assert.deepEqual(rows, [
    ["long-pause", "0:00", "Long pause · 6.0 s", "…win. [6.0 s] The plan…"],
    ["clean", "0:06 to 0:08", "Clean stretch · 1.5 s", "No filler, pause or restart."],
  ]);
  assert.equal(
    mapLabel(body),
    "Speech map from 0:00 to 0:08: no fillers, no mid-sentence pauses, 1 long pause, " +
      "a 1.5 second clean stretch",
  );
});

test("the long-pause block on the rail is as long as the pause, in its colour", async () => {
  const session = longAfterPeriod();
  const body = await showSession(session);
  const [block, clean] = railMarks(body);
  assert.equal(block.getAttribute("class"), "speech-map__mark speech-map__mark--long-pause");
  assert.equal(block.getAttribute("fill"), "var(--pause-long)");
  // Two cards make a 120px rail over the take; the pause runs from "win." for 6 s.
  const words = session.transcript;
  const start = words[0].start;
  const seconds = words[words.length - 1].end - start;
  const at = (time) => String(Math.round(((time - start) / seconds) * 120 * 10) / 10);
  assert.equal(block.getAttribute("y"), at(words[1].end));
  assert.equal(
    Number(block.getAttribute("y")) + Number(block.getAttribute("height")),
    Number(at(words[1].end + 6)),
  );
  assert.equal(clean.getAttribute("y"), at(words[1].end + 6), "the clean stretch starts there");
  assert.equal(rule(".moment--long-pause .moment__card")["border-left-color"], "var(--pause-long)");
  assert.equal(rule(".moment--long-pause .moment__kind").color, "var(--pause-long)");
});

test("the transcript marks the long pause after the period, with its own aria-label", async () => {
  const body = await showSession(longAfterPeriod());
  const spans = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  assert.deepEqual(
    spans.map((span) => span.textContent),
    ["We", "win.", "6.0 s long pause", "The", "plan", "works", "today."],
  );
  const marker = spans[2];
  assert.equal(marker.className, "tok--pause tok--pause-long num");
  assert.equal(marker.getAttribute("aria-label"), "long pause, 6.0 seconds");
});

test("a 2 s pause after a period still gets no marker, row or count", async () => {
  const words = spoken(SENTENCE, { 1: 2 });
  const body = await showSession(sessionWith(words, [[words[1].end, 2]]));
  const spans = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  assert.ok(spans.every((span) => !span.classList.contains("tok--pause")));
  assert.ok(!mapRows(body).some(([kind]) => kind.includes("pause")), "no pause row");
  assert.ok(!mapLabel(body).includes("long pause"));
});

test("a 6 s silence before the first word gets no marker, row or count", async () => {
  const { words, pause } = withEdgeSilence("before");
  const body = await showSession(sessionWith(words, [pause]));
  const spans = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  assert.ok(spans.every((span) => !span.classList.contains("tok--pause")));
  assert.ok(!mapRows(body).some(([kind]) => kind.includes("pause")), "no pause row");
  assert.ok(!mapLabel(body).includes("long pause"));
  const card = byClass(body, "stat-strip").children[2];
  assert.equal(byClass(card, "stat__value").children[0].textContent, "0");
});

test("a 4.96 s pause after a period is marked as the long pause it reads as", async () => {
  const words = spoken(SENTENCE, { 1: 4.96 });
  const body = await showSession(sessionWith(words, [[words[1].end, 4.96]]));
  const spans = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  const marker = spans[2];
  assert.equal(marker.textContent, "5.0 s long pause");
  assert.equal(marker.className, "tok--pause tok--pause-long num");
});

// ---- Tips -------------------------------------------------------------------------------

const NEUTRAL = {
  wordsPerMinute: 150,
  fillersPerMinute: 0,
  fillers: [],
  topHabit: null,
  longestMidSentencePause: 0,
  repeatCount: 0,
  pauses: [],
};

test("a long pause after a period gets the freeze tip, naming its length and moment", () => {
  const tips = loadTips();
  const report = {
    ...NEUTRAL,
    pauses: [
      { at: 35.738, length: 5.19, midSentence: false, long: true },
      { at: 50, length: 2, midSentence: false, long: false },
    ],
  };
  const selected = plain(tips.select(report));
  assert.deepEqual(selected, [
    { id: "freeze", text: "You froze for 5.2 seconds at 0:35. Know how your next point opens." },
  ]);
});

test("a long mid-sentence pause gets break-long only, never the freeze tip too", () => {
  const tips = loadTips();
  const report = {
    ...NEUTRAL,
    longestMidSentencePause: 6,
    pauses: [{ at: 3, length: 6, midSentence: true, long: true }],
  };
  assert.deepEqual(plain(tips.select(report)).map((tip) => tip.id), ["break-long"]);
});

test("the church take's report gets the freeze tip", () => {
  const delivery = loadDelivery();
  const report = delivery.analyze(CHURCH_TRANSCRIPT, { pauses: CHURCH_PAUSES, repeats: [] });
  const ids = plain(loadTips().select(report, { targetWpm: [140, 160] })).map((tip) => tip.id);
  assert.ok(ids.includes("freeze"), ids.join(", "));
});

// ---- Styles and docs --------------------------------------------------------------------

function tokenValues(name) {
  return [...CSS.matchAll(new RegExp(name + ":\\s*(#[0-9A-Fa-f]{3,8});", "g"))].map((m) => m[1]);
}

function rule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((part) => part.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) {
      const declarations = {};
      match[2].split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      });
      return declarations;
    }
  }
  assert.fail(`styles.css needs a rule for ${selector}`);
}

test("--pause-long is a token in light and in both identical dark blocks", () => {
  const values = tokenValues("--pause-long");
  assert.equal(values.length, 3, "light :root, dark by device, dark forced");
  assert.notEqual(values[0], values[1]);
  assert.equal(values[1], values[2]);
  assert.ok(read("DESIGN.md").includes("| `--pause-long` |"));
});

test("the long-pause card and transcript marker use the token", () => {
  assert.equal(rule(".moment--long-pause .moment__kind").color, "var(--pause-long)");
  const marker = rule(".tok--pause-long");
  assert.equal(marker.color, "var(--pause-long)");
  assert.equal(marker.border, "1px solid var(--pause-long)");
});

test("how.html says a 5 s pause counts anywhere, and lists the freeze tip", () => {
  const html = read("how.html");
  assert.ok(html.includes("A pause of 5 s or more counts wherever it falls"));
  assert.ok(html.includes("A pause between sentences lasts 5 seconds or more."));
});
