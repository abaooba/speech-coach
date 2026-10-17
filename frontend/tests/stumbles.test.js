// Tests for app.delivery.findStumbles, the soft "possible stumble" hint: a word that lasts far
// longer than this speaker takes for a word that long, where a small stutter ("che— check")
// the transcriber merged into one word hides. It is only a hint: the delivery report that
// scores, ranks and tips read never sees it, and Results marks it in the transcript alone.
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
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const UI_SOURCE = read("ui.js");

// A real take as the API stores it: AssemblyAI's times are ms, the transcript's seconds.
function fixtureTranscript(name) {
  const file = path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", name);
  return JSON.parse(fs.readFileSync(file, "utf8")).words.map((word) => ({
    text: word.text,
    start: word.start / 1000,
    end: word.end / 1000,
  }));
}

const SENTENCE = (
  "For example when we have to check our phone during class the teacher takes it away " +
  "and then we lose points for the whole week which feels unfair to most students here"
).split(" ");
const CHECK = SENTENCE.indexOf("check");

// Every word lasts `perLetter` seconds a letter, 50 ms apart; `stretch` maps an index to the
// seconds that word lasts instead, as a stutter merged into it would make it.
function take(texts, perLetter, stretch) {
  const longer = stretch || {};
  let at = 0;
  return texts.map((text, index) => {
    const letters = text.replace(/[^a-z]/gi, "").length;
    const length = Object.hasOwn(longer, index) ? longer[index] : perLetter * letters;
    const word = { text, start: at, end: at + length };
    at = word.end + 0.05;
    return word;
  });
}

function delivery() {
  const context = { app: {} };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  return context.app.delivery;
}

test("a word stretched by a merged stutter is a possible stumble, and nothing else is", () => {
  // "check" at 0.06 s a letter takes 0.3 s; "che— (tiny pause) check" takes 0.75 s.
  const words = take(SENTENCE, 0.06, { [CHECK]: 0.75 });
  assert.deepEqual([...delivery().findStumbles(words)], [CHECK]);
});

test("the same take said smoothly has no stumble", () => {
  assert.deepEqual([...delivery().findStumbles(take(SENTENCE, 0.06))], []);
});

test("the bar is the speaker's own pace: a slow speaker's long words are not stumbles", () => {
  // Every word twice as long as the fast take, "check" included.
  const slow = take(SENTENCE, 0.12, { [CHECK]: 0.6 });
  assert.deepEqual([...delivery().findStumbles(slow)], []);
});

test("a word drawn out at the end of a clause is how sentences end, not a stumble", () => {
  for (const mark of [".", ",", "?", "!", ";"]) {
    const texts = [...SENTENCE];
    texts[CHECK] = "check" + mark;
    const words = take(texts, 0.06, { [CHECK]: 0.75 });
    assert.deepEqual([...delivery().findStumbles(words)], [], `"check${mark}"`);
  }
});

test("hesitations, verbal habits, cut-offs and short words are never stumbles", () => {
  const cases = [
    ["ummm", "a stretched hesitation is already a filler"],
    ["like", "a drawn-out habit is a filler, not a stumble"],
    ["chec—", "a cut-off is already a restart"],
    ["the", "a word under 4 letters is too short to tell a stumble from a stress"],
  ];
  for (const [text, why] of cases) {
    const texts = [...SENTENCE];
    texts[CHECK] = text;
    const words = take(texts, 0.06, { [CHECK]: 0.75 });
    assert.deepEqual([...delivery().findStumbles(words)], [], why);
  }
});

test("a stretch of under a quarter second is not a stumble, however fast the speaker", () => {
  // At 0.03 s a letter "check" takes 0.15 s; 0.37 s is 2.5 times that but only 0.22 s longer.
  const words = take(SENTENCE, 0.03, { [CHECK]: 0.37 });
  assert.deepEqual([...delivery().findStumbles(words)], []);
});

test("a take too short to learn the speaker's pace has no stumbles", () => {
  const short = SENTENCE.slice(0, 12);
  const words = take(short, 0.06, { [CHECK]: 0.75 });
  assert.deepEqual([...delivery().findStumbles(words)], []);
});

test("no words, or words without times, have no stumbles", () => {
  const { findStumbles } = delivery();
  assert.deepEqual([...findStumbles([])], []);
  assert.deepEqual([...findStumbles(undefined)], []);
  assert.deepEqual([...findStumbles(SENTENCE.map((text) => ({ text })))], []);
});

test("a word said slowly after a silence is a search for the word, not a stumble", () => {
  // A stutter folded into "check" starts right after "to"; here the speaker stopped 0.6 s first.
  const words = take(SENTENCE, 0.06, { [CHECK]: 0.75 }).map((word, index) =>
    index >= CHECK ? { ...word, start: word.start + 0.6, end: word.end + 0.6 } : word,
  );
  assert.deepEqual([...delivery().findStumbles(words)], []);
  const tinyGap = take(SENTENCE, 0.06, { [CHECK]: 0.75 }).map((word, index) =>
    index >= CHECK ? { ...word, start: word.start + 0.2, end: word.end + 0.2 } : word,
  );
  assert.deepEqual([...delivery().findStumbles(tinyGap)], [CHECK], "a tiny gap still counts");
});

test("the owner's real takes have no possible stumble", () => {
  // The church take's longest word for its letters, "residual" (1.03 s for 8 letters), comes
  // after a 0.77 s silence: the speaker was finding the word. Its stutter, "ner—", is a restart.
  const { findStumbles } = delivery();
  assert.deepEqual([...findStumbles(fixtureTranscript("take_2026_10_11_nervous.json"))], []);
  assert.deepEqual([...findStumbles(fixtureTranscript("take_2026_10_11_uniforms.json"))], []);
});

test("a stumble is never counted: the scored delivery report is blind to it", () => {
  const { analyze } = delivery();
  const metrics = { words_per_minute: 150, duration: 20, word_count: 34, pauses: [] };
  const report = analyze(take(SENTENCE, 0.06, { [CHECK]: 0.75 }), metrics);
  assert.deepEqual(
    Object.keys(report).filter((key) => /stumble/i.test(key)),
    [],
    "nothing that scores, ranks or tips reads stumbles",
  );
  assert.equal(report.repeatCount, 0);
  assert.equal(report.fillerCount, 0);
});

// Results with the real ui.js against the fake DOM, as transcript.test.js mounts it.
function mountResults(session) {
  const context = {
    app: { screens: {}, passages: [], ui: {}, store: {}, router: {} },
    document: fakeDocument(),
  };
  context.app.store.get = () => Promise.resolve(session);
  context.app.router.go = () => {};
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  return { results: context.app.screens.results, body };
}

function sessionOf(transcript, repeats) {
  return {
    id: "s1",
    createdAt: "2026-10-17T15:00:00.000Z",
    passageId: "free-talk",
    passageTitle: "Free talk",
    durationSeconds: 20,
    metrics: {
      words_per_minute: 150,
      duration: 20,
      word_count: transcript.length,
      fillers: {},
      pauses: [],
      repeats: repeats || [],
      pace_windows: [],
    },
    transcript,
  };
}

const STUMBLE_LEGEND =
  "Gray dashed words ran long, maybe a small stumble. A hint only: they are not counted.";

test("Results marks the stumble in the transcript with a label and a legend line", async () => {
  const { results, body } = mountResults(sessionOf(take(SENTENCE, 0.06, { [CHECK]: 0.75 })));
  await results.show({ id: "s1" });
  const tokens = byClass(body, "transcript").children.filter((node) => node.nodeType !== 3);
  const marked = tokens.filter((node) => node.classList.contains("tok--stumble"));
  assert.deepEqual(
    marked.map((node) => [node.textContent, node.className, node.getAttribute("aria-label")]),
    [["check", "tok tok--stumble", "check, possible stumble"]],
  );
  assert.ok(byClass(body, "transcript__legend").textContent.includes(STUMBLE_LEGEND));
});

test("Results draws no stumble mark or legend line for a smooth take", async () => {
  const { results, body } = mountResults(sessionOf(take(SENTENCE, 0.06)));
  await results.show({ id: "s1" });
  const tokens = byClass(body, "transcript").children.filter((node) => node.nodeType !== 3);
  assert.equal(tokens.filter((node) => node.classList.contains("tok--stumble")).length, 0);
  assert.ok(!byClass(body, "transcript__legend").textContent.includes(STUMBLE_LEGEND));
});

test("a stumble is not a speech-map moment", async () => {
  const { results, body } = mountResults(sessionOf(take(SENTENCE, 0.06, { [CHECK]: 0.75 })));
  await results.show({ id: "s1" });
  const map = byClass(body, "speech-map");
  const text = map ? map.textContent : "";
  assert.ok(!/stumble/i.test(text), "the map's cards are the counted moments only");
});

test("a stretched word inside a restart's second copy is drawn as the restart alone", async () => {
  // "we have to check" said again inside the sentence: its second copy ends on "check".
  const texts = ["we", "have", "to", "check", ...SENTENCE];
  const second = 4 + CHECK;
  const words = take(texts, 0.06, { [second]: 0.75 });
  const plan = mountResults(sessionOf(words)).results.buildTranscriptPlan(
    words,
    [],
    [second - 3, second - 2, second - 1, second],
  );
  assert.equal(plan[second].restart, true);
  assert.equal(plan[second].stumble, undefined, "one mark per word, and the restart counts");
});

test("How we count explains the hint and says it never counts", () => {
  const how = read("how.html").replace(/\s+/g, " ");
  assert.ok(how.includes("“Che— check” comes back as “check”."));
  assert.ok(how.includes("a gray dashed underline: a possible stumble."));
  assert.ok(how.includes("It never counts in a card, the clean stretch, a tip or your rank."));
});
