// Tests for a phone voice that stays silent (owner's report of 2026-10-18: the Words to check
// chips said nothing on an iPhone). app.ui.speak no longer cancels an idle synthesizer first
// (WebKit leaves the next utterance without its events, sometimes silent), resumes one left
// paused, keeps the utterance referenced, and reports one outcome to its caller: "ended",
// "failed", or "silent" when nothing started within three seconds, cancelling then. Results
// puts a note under the chips on "silent" or "failed" and takes it down once a word is said.
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
const RESULTS_SOURCE = read("screens/results.js");

const NOTE =
  "Your phone's voice did not start. Check the silent switch and the volume, then tap " +
  "again. If it stays silent, open Speech Coach in Safari rather than the home-screen app.";

// A synthesizer whose state the test sets, and timers the test fires by hand.
function fakeSpeech(state = {}) {
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
    speaking: Boolean(state.speaking),
    pending: Boolean(state.pending),
    paused: Boolean(state.paused),
    cancel: () => log.push(["cancel"]),
    resume: () => log.push(["resume"]),
    speak: (utterance) => {
      spoken.push(utterance);
      log.push(["speak", utterance.text]);
    },
  };
  return { log, spoken, synth, Utterance };
}

function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fire() {
      const due = [...timers.entries()];
      timers.clear();
      due.forEach(([, timer]) => timer.callback());
    },
    pending: () => [...timers.values()].map((timer) => timer.ms),
  };
}

function loadUi(speech, timers) {
  const announced = [];
  const context = {
    app: {},
    document: fakeDocument({ live: new FakeElement("div") }),
    speechSynthesis: speech.synth,
    SpeechSynthesisUtterance: speech.Utterance,
  };
  if (timers) {
    context.setTimeout = timers.setTimeout;
    context.clearTimeout = timers.clearTimeout;
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  context.app.ui.announce = (text) => announced.push(text);
  return { ui: context.app.ui, context, announced };
}

test("an idle voice is spoken to without a cancel first; a busy one is cut off", () => {
  const idle = fakeSpeech();
  loadUi(idle).ui.speak("market");
  assert.deepEqual(idle.log, [["speak", "market"]]);

  const busy = fakeSpeech({ speaking: true });
  loadUi(busy).ui.speak("market");
  assert.deepEqual(busy.log, [["cancel"], ["speak", "market"]]);

  const queued = fakeSpeech({ pending: true });
  loadUi(queued).ui.speak("market");
  assert.deepEqual(queued.log, [["cancel"], ["speak", "market"]]);
});

test("a synthesizer left paused is resumed before the word is queued", () => {
  const paused = fakeSpeech({ paused: true });
  loadUi(paused).ui.speak("market");
  assert.deepEqual(paused.log, [["resume"], ["speak", "market"]]);
});

test("the outcome is ended when the voice ends, and when it is cut off by another word", () => {
  const speech = fakeSpeech();
  const { ui } = loadUi(speech);
  const outcomes = [];
  ui.speak("market", (outcome) => outcomes.push(outcome));
  speech.spoken[0].onend();
  ui.speak("weather", (outcome) => outcomes.push(outcome));
  speech.spoken[1].onerror({ error: "canceled" });
  ui.speak("house", (outcome) => outcomes.push(outcome));
  speech.spoken[2].onerror({ error: "interrupted" });
  assert.deepEqual(outcomes, ["ended", "ended", "ended"]);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.SPEECH_OUTCOMES)), {
    ended: "ended",
    failed: "failed",
    silent: "silent",
  });
});

test("the outcome is failed when the voice refuses, and reported once", () => {
  const speech = fakeSpeech();
  const { ui } = loadUi(speech);
  const outcomes = [];
  ui.speak("market", (outcome) => outcomes.push(outcome));
  speech.spoken[0].onerror({ error: "not-allowed" });
  speech.spoken[0].onend();
  assert.deepEqual(outcomes, ["failed"]);
});

test("a voice that never starts within three seconds is silent: cancelled, reported once", () => {
  const speech = fakeSpeech();
  const timers = fakeTimers();
  const { ui } = loadUi(speech, timers);
  const outcomes = [];
  ui.speak("market", (outcome) => outcomes.push(outcome));
  assert.deepEqual(timers.pending(), [3000]);
  timers.fire();
  assert.deepEqual(outcomes, ["silent"]);
  assert.deepEqual(speech.log, [["speak", "market"], ["cancel"]]);
  // The cancel's own events change nothing.
  speech.spoken[0].onerror({ error: "canceled" });
  speech.spoken[0].onend();
  assert.deepEqual(outcomes, ["silent"]);
});

test("onstart calls off the watchdog, so a long word is never cut short", () => {
  const speech = fakeSpeech();
  const timers = fakeTimers();
  const { ui } = loadUi(speech, timers);
  const outcomes = [];
  ui.speak("market", (outcome) => outcomes.push(outcome));
  speech.spoken[0].onstart();
  assert.deepEqual(timers.pending(), []);
  timers.fire();
  assert.deepEqual(outcomes, []);
  speech.spoken[0].onend();
  assert.deepEqual(outcomes, ["ended"]);
  assert.deepEqual(speech.log, [["speak", "market"]]);
});

test("the ended outcome clears the watchdog too, and without timers there is none", () => {
  const speech = fakeSpeech();
  const timers = fakeTimers();
  const { ui } = loadUi(speech, timers);
  ui.speak("market");
  speech.spoken[0].onend();
  assert.deepEqual(timers.pending(), []);

  const bare = fakeSpeech();
  const outcomes = [];
  loadUi(bare).ui.speak("market", (outcome) => outcomes.push(outcome));
  bare.spoken[0].onend();
  assert.deepEqual(outcomes, ["ended"]);
});

// --- the note under Words to check ---

const SENTENCE = "So this morning I went to the market near my house".split(" ");
const CONFIDENCES = { 7: 0.31, 10: 0.4 };

function words(texts, confidences) {
  return texts.map((text, index) => {
    const word = { text, start: index * 0.5, end: index * 0.5 + 0.4 };
    if (Object.hasOwn(confidences, index)) {
      word.confidence = confidences[index];
    }
    return word;
  });
}

function mountResults(speech, timers) {
  const announced = [];
  const context = {
    app: {
      screens: {},
      passages: [{ id: "free-talk", kind: "prompt", targetWpm: [140, 160] }],
      ui: {},
      store: {
        get: () =>
          Promise.resolve({
            id: "s1",
            createdAt: "2026-10-17T09:12:00.000Z",
            passageId: "free-talk",
            passageTitle: "Your day",
            durationSeconds: 6,
            metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
            transcript: words(SENTENCE, CONFIDENCES),
          }),
      },
      router: { go() {} },
    },
    document: fakeDocument(),
    speechSynthesis: speech.synth,
    SpeechSynthesisUtterance: speech.Utterance,
  };
  if (timers) {
    context.setTimeout = timers.setTimeout;
    context.clearTimeout = timers.clearTimeout;
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  context.app.ui.announce = (text) => announced.push(text);
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  return { results: context.app.screens.results, body, announced };
}

function wordsCheck(body) {
  const section = byClass(body, "words-check");
  return {
    section,
    chips: byClass(section, "words-check__row").children,
    note: byClass(section, "words-check__note"),
  };
}

test("the note is built hidden under the chips, and stays hidden while a word is said", async () => {
  const speech = fakeSpeech();
  const { results, body } = mountResults(speech);
  await results.show({ id: "s1" });
  const { section, chips, note } = wordsCheck(body);
  assert.deepEqual(
    section.children.map((child) => child.className),
    ["words-check__title", "words-check__row", "words-check__note"],
  );
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, NOTE);
  chips[0].click();
  speech.spoken[0].onend();
  assert.equal(note.hidden, true);
  assert.ok(!chips[0].classList.contains("word-chip--playing"));
});

test("a voice that never starts shows the note, says it once, and frees the chip", async () => {
  const speech = fakeSpeech();
  const timers = fakeTimers();
  const { results, body, announced } = mountResults(speech, timers);
  await results.show({ id: "s1" });
  const { chips, note } = wordsCheck(body);
  chips[0].click();
  assert.ok(chips[0].classList.contains("word-chip--playing"));
  timers.fire();
  assert.equal(note.hidden, false);
  assert.ok(!chips[0].classList.contains("word-chip--playing"), "the mark goes with the wait");
  assert.deepEqual(announced, [NOTE]);
  chips[1].click();
  timers.fire();
  assert.deepEqual(announced, [NOTE], "a note already up is not said again");
});

test("a voice that refuses shows the note; a word that is then said takes it down", async () => {
  const speech = fakeSpeech();
  const { results, body } = mountResults(speech);
  await results.show({ id: "s1" });
  const { chips, note } = wordsCheck(body);
  chips[0].click();
  speech.spoken[0].onerror({ error: "not-allowed" });
  assert.equal(note.hidden, false);
  chips[1].click();
  speech.spoken[1].onend();
  assert.equal(note.hidden, true);
});

test("a word cut off by the next chip's tap is no failure: no note", async () => {
  const speech = fakeSpeech();
  const { results, body } = mountResults(speech);
  await results.show({ id: "s1" });
  const { chips, note } = wordsCheck(body);
  chips[0].click();
  speech.synth.speaking = true;
  chips[1].click();
  speech.spoken[0].onerror({ error: "canceled" });
  assert.equal(note.hidden, true);
  assert.ok(chips[1].classList.contains("word-chip--playing"));
  assert.deepEqual(speech.log, [["speak", "market"], ["cancel"], ["speak", "house"]]);
});

test("a voice that throws shows the note at once", async () => {
  const speech = fakeSpeech();
  speech.synth.speak = () => {
    throw new Error("not allowed");
  };
  const { results, body, announced } = mountResults(speech);
  await results.show({ id: "s1" });
  const { chips, note } = wordsCheck(body);
  chips[0].click();
  assert.equal(note.hidden, false);
  assert.ok(!chips[0].classList.contains("word-chip--playing"));
  assert.deepEqual(announced, [NOTE]);
});

test("the note's styles: small, muted, under the row, and gone while hidden", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp("(?:^|\\})\\s*" + escaped + "\\s*\\{([^}]*)\\}").exec(css);
    assert.ok(match, "styles.css has a rule for " + selector);
    return match[1];
  };
  assert.match(rule(".words-check__note"), /font-size: var\(--fs-small\)/);
  assert.match(rule(".words-check__note"), /color: var\(--muted\)/);
  assert.match(rule(".words-check__note"), /margin: var\(--s-2\) 0 0/);
  assert.match(rule(".words-check__note[hidden]"), /display: none/);
});
