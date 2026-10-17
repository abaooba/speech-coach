// Tests for the "may have been unclear" hint on Results (docs/superpowers/specs/
// 2026-10-17-guided-coach-design.md Phase 5 item 2): a word the transcriber rated a coin flip or
// worse gets .tok--unclear (a dotted box) and ", may have been unclear" in its label, the legend
// says what the box means, and a "Words to check" row of chips above the transcript says each
// unclear word, and each misread script word, with the phone's built-in voice. The row is gone
// where the browser has no voice. Nothing here is counted. ui.js, delivery.js and results.js run
// for real in a vm against the shared fake DOM; speechSynthesis is a fake.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const DELIVERY_SOURCE = read("delivery.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));

const LEGEND_UNCLEAR = " Dotted boxes: may have been unclear — a hint, not counted.";

// A fake speechSynthesis: logs cancel() and speak(), keeps the last utterance so a test can end
// it, and an utterance constructor that keeps text, lang and rate.
function fakeSpeech() {
  const log = [];
  const spoken = [];
  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
    }
  }
  const synth = {
    cancel: () => log.push(["cancel"]),
    speak: (utterance) => {
      spoken.push(utterance);
      log.push(["speak", utterance.text, utterance.lang, utterance.rate]);
    },
  };
  return { log, spoken, synth, Utterance };
}

function words(texts, confidences) {
  return texts.map((text, index) => {
    const word = { text, start: index * 0.5, end: index * 0.5 + 0.4 };
    if (confidences && Object.hasOwn(confidences, index)) {
      word.confidence = confidences[index];
    }
    return word;
  });
}

const SENTENCE =
  "So this morning I went to the market near my house and we talked about the weather.".split(" ");
// market (7) and weather. (16) were a coin flip; "So" is a habit word and never hinted.
const CONFIDENCES = { 0: 0.1, 7: 0.31, 16: 0.42 };

function session(overrides, metrics) {
  return {
    id: "s1",
    createdAt: "2026-10-17T09:12:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 9,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [], ...(metrics || {}) },
    transcript: words(SENTENCE, CONFIDENCES),
    ...(overrides || {}),
  };
}

function mount(sessions, options) {
  const settings = options || {};
  const document = fakeDocument();
  const context = {
    app: {
      screens: {},
      passages: [{ id: "free-talk", kind: "prompt", targetWpm: [140, 160] }],
      ui: {},
      store: { get: (id) => Promise.resolve(sessions[id]) },
      router: { go() {} },
    },
    document,
  };
  if (settings.speech) {
    context.speechSynthesis = settings.speech.synth;
    if (!settings.noUtterance) {
      context.SpeechSynthesisUtterance = settings.speech.Utterance;
    }
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  return { results: context.app.screens.results, body, app: context.app };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function tokens(body) {
  return byClass(body, "transcript").children.filter((node) => node.tagName === "span");
}

function outline(node) {
  return node.tagName + "." + node.className;
}

// --- the transcript mark ---

test("buildTranscriptPlan marks the unclear words, never a filler or habit", () => {
  const { results } = mount({});
  const plan = results.buildTranscriptPlan(words(SENTENCE, CONFIDENCES), []);
  const marked = Array.from(plan.filter((item) => item.unclear), (item) => item.text);
  assert.deepEqual(marked, ["market", "weather."]);
  assert.equal(plan[0].unclear, undefined, "So is a habit word: never boxed");
  assert.equal(Object.hasOwn(plan[1], "unclear"), false, "a clear word carries no key");
});

test("an unclear word is a dotted box that adds to its label; clear words are unchanged", async () => {
  const { results, body } = mount({ s1: session() });
  await results.show({ id: "s1" });
  const market = tokens(body).find((span) => span.textContent === "market");
  assert.equal(market.className, "tok tok--unclear");
  assert.equal(market.getAttribute("aria-label"), "market, may have been unclear");
  const weather = tokens(body).find((span) => span.textContent === "weather.");
  assert.equal(weather.getAttribute("aria-label"), "weather, may have been unclear");
  const plainWord = tokens(body).find((span) => span.textContent === "house");
  assert.equal(plainWord.className, "tok");
  assert.equal(plainWord.getAttribute("aria-label"), null);
});

test("the box combines with a restart's mark", () => {
  const { results } = mount({});
  const said = words(["I", "wanted", "wanted", "it"], { 2: 0.2 });
  const plan = results.buildTranscriptPlan(said, [], [2]);
  assert.equal(plan[2].restart, true);
  assert.equal(plan[2].unclear, true);
});

test("the legend says what a dotted box means only when the transcript shows one", async () => {
  const boxed = mount({ s1: session() });
  await boxed.results.show({ id: "s1" });
  const legend = byClass(boxed.body, "transcript__legend");
  assert.ok(legend.textContent.includes(LEGEND_UNCLEAR), legend.textContent);
  const clear = mount({ s1: session({ transcript: words(SENTENCE) }) });
  await clear.results.show({ id: "s1" });
  assert.ok(!byClass(clear.body, "transcript__legend").textContent.includes("Dotted boxes"));
});

test("words without confidence change nothing: same plan, same score", () => {
  const { results } = mount({});
  const withHints = results.summarize(session());
  const without = results.summarize(session({ transcript: words(SENTENCE) }));
  for (const key of ["wpm", "fillersPerMinute", "pauseCount", "cleanStretchSeconds"]) {
    assert.equal(withHints[key], without[key], key);
  }
});

// --- the words to check ---

test("wordsToCheck lists the unclear words, bare, in transcript order", () => {
  const { results } = mount({});
  const summary = results.summarize(session());
  assert.deepEqual(Array.from(results.wordsToCheck(session().transcript, summary.report)), [
    "market",
    "weather",
  ]);
});

test("misread script words join, as the script has them, deduped and at most five", () => {
  const { results } = mount({});
  const said = words(
    ["We", "walk", "to", "the", "markit", "and", "the", "station", "then", "home", "again"],
    { 7: 0.2, 9: 0.3, 10: 0.1 },
  );
  const report = {
    misreads: [
      { at: 2.0, word: "market,", said: "markit", wordIndex: 4 },
      { at: 0.5, word: "walked", said: "walk", wordIndex: 1 },
      { at: 3.5, word: "Station", said: "station", wordIndex: 7 },
      { at: 4.0, word: "then", said: "then", wordIndex: 8 },
    ],
  };
  assert.deepEqual(Array.from(results.wordsToCheck(said, report)), [
    "walked",
    "market",
    "Station",
    "then",
    "home",
  ], "a word both misread and unclear shows once, as the script has it; 'again' is the sixth");
});

test("the Words to check row sits right above the Transcript heading", async () => {
  const { results, body } = mount({ s1: session() }, { speech: fakeSpeech() });
  await results.show({ id: "s1" });
  const names = body.children.map(outline);
  const index = names.indexOf("section.words-check");
  assert.ok(index > 0, "the row is drawn");
  assert.equal(names[index + 1], "h2.results__heading transcript__heading");
  const section = body.children[index];
  const title = byClass(section, "words-check__title");
  assert.equal(title.tagName, "h3");
  assert.equal(title.textContent, "Words to check");
  const row = byClass(section, "words-check__row");
  const chips = row.children;
  assert.deepEqual(
    chips.map((chip) => [chip.tagName, chip.className, chip.getAttribute("type")]),
    [
      ["button", "word-chip", "button"],
      ["button", "word-chip", "button"],
    ],
  );
  assert.deepEqual(chips.map((chip) => chip.getAttribute("aria-label")), [
    "Hear market",
    "Hear weather",
  ]);
  assert.equal(chips[0].children[0].getAttribute("data-icon"), "speaker", "the speaker first");
  assert.equal(fullText(chips[0]), "market");
});

test("a chip says its word: cancel first, then en-US at 0.85, marked while it plays", async () => {
  const speech = fakeSpeech();
  const { results, body } = mount({ s1: session() }, { speech });
  await results.show({ id: "s1" });
  const chip = byClass(byClass(byClass(body, "words-check"), "words-check__row"), "word-chip");
  chip.click();
  assert.deepEqual(speech.log, [["cancel"], ["speak", "market", "en-US", 0.85]]);
  assert.ok(chip.classList.contains("word-chip--playing"));
  speech.spoken[0].onend();
  assert.ok(!chip.classList.contains("word-chip--playing"), "the mark goes when the voice ends");
});

test("a second chip takes the playing mark from the first", async () => {
  const speech = fakeSpeech();
  const { results, body } = mount({ s1: session() }, { speech });
  await results.show({ id: "s1" });
  const [first, second] = byClass(byClass(body, "words-check"), "words-check__row").children;
  first.click();
  second.click();
  assert.ok(!first.classList.contains("word-chip--playing"));
  assert.ok(second.classList.contains("word-chip--playing"));
});

test("no voice, no row: without speechSynthesis or without its utterance", async () => {
  for (const options of [{}, { speech: fakeSpeech(), noUtterance: true }]) {
    const { results, body } = mount({ s1: session() }, options);
    await results.show({ id: "s1" });
    assert.equal(byClass(body, "words-check"), undefined);
    assert.ok(tokens(body).some((span) => span.classList.contains("tok--unclear")), "box stays");
  }
});

test("no unclear or misread word, no row", async () => {
  const { results, body } = mount(
    { s1: session({ transcript: words(SENTENCE) }) },
    { speech: fakeSpeech() },
  );
  await results.show({ id: "s1" });
  assert.equal(byClass(body, "words-check"), undefined);
});

// --- the voice ---

test("app.ui.canSpeak needs both speechSynthesis and SpeechSynthesisUtterance", () => {
  const speech = fakeSpeech();
  const both = mount({}, { speech }).app.ui;
  assert.equal(both.canSpeak(), true);
  assert.equal(mount({}).app.ui.canSpeak(), false);
  assert.equal(mount({}, { speech, noUtterance: true }).app.ui.canSpeak(), false);
  assert.equal(mount({}).app.ui.speak("word"), false, "no voice: nothing is said");
});

test("app.ui.speak says the text and survives a voice that throws", () => {
  const speech = fakeSpeech();
  const { ui } = mount({}, { speech }).app;
  assert.equal(ui.speak("weather"), true);
  assert.deepEqual(speech.log, [["cancel"], ["speak", "weather", "en-US", 0.85]]);
  speech.synth.speak = () => {
    throw new Error("not allowed");
  };
  assert.equal(ui.speak("weather"), false);
});
