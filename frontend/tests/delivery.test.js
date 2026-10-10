// Tests for frontend/delivery.js, the delivery rules: which words are hesitation sounds or
// verbal habits, and the report Results, tips and Progress read (pace without hesitations,
// fillers per minute, mid-sentence pauses, the longest clean stretch). The module is pure, so
// it loads into a bare vm context with an empty app and no browser fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DELIVERY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "delivery.js"), "utf8");

// The real AssemblyAI word list for samples/test-clip.m4a, and the backend metrics for it
// (backend/tests/test_metrics.py pins every one of these numbers).
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};

function load() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

// Objects built inside the vm realm have a foreign prototype; a JSON round-trip makes them
// comparable with deepEqual.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Words 0.3 s long with 0.1 s between them; `extraGapBefore` maps a word index to extra
// silence before that word, for the pause cues.
function timed(sentence, extraGapBefore = {}) {
  let clock = 0;
  return sentence.split(" ").map((text, index) => {
    clock += extraGapBefore[index] || 0;
    const word = { text, start: round(clock), end: round(clock + 0.3) };
    clock += 0.4;
    return word;
  });
}

function round(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

// The words classify() marked, as "text:kind" strings in order.
function marked(delivery, words) {
  const kinds = delivery.classify(words);
  return words.flatMap((word, index) => (kinds[index] ? [word.text + ":" + kinds[index]] : []));
}

test("delivery.js assigns exactly app.delivery with analyze, classify and isHesitation", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  assert.deepEqual(Object.keys(app), ["delivery"]);
  for (const name of ["analyze", "classify", "isHesitation"]) {
    assert.equal(typeof app.delivery[name], "function", name);
  }
});

test("isHesitation knows um, uh, er, ah, hm and their stretched spellings, nothing else", () => {
  const delivery = load();
  for (const word of ["um", "Um,", "umm", "uhm", "uh", "Uhh.", "er", "erm", "ah", "hm", "hmmm"]) {
    assert.equal(delivery.isHesitation(word), true, word);
  }
  for (const word of ["mhm", "uh-huh", "mm-hmm", "huh", "umbrella", "m", "a", "", undefined]) {
    assert.equal(delivery.isHesitation(word), false, String(word));
  }
});

test("on the real clip: nine hesitations, and 'so,' and 'basically,' are the only habits", () => {
  const delivery = load();
  const kinds = delivery.classify(CLIP_WORDS);
  assert.equal(kinds.length, CLIP_WORDS.length);
  assert.equal(kinds.filter((kind) => kind === "hesitation").length, 9);
  assert.deepEqual(
    CLIP_WORDS.flatMap((word, index) => (kinds[index] === "habit" ? [word.text] : [])),
    ["so,", "basically,"],
  );
  const likeIndex = CLIP_WORDS.findIndex((word) => word.text === "like");
  assert.equal(kinds[likeIndex], null, "'I like to play tennis' is a verb");
  const farIndex = CLIP_WORDS.findIndex((word) => word.text === "far.");
  assert.equal(kinds[farIndex - 1], null, "'good so far' is not a habit");
});

test("like counts when a comma, an um or a 0.25 s pause sets it off", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("It was, like, a disaster.")), ["like,:habit"]);
  assert.deepEqual(marked(delivery, timed("It was um like really big.")), [
    "um:hesitation",
    "like:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("Like, the plan fails.")), ["Like,:habit"]);
  assert.deepEqual(marked(delivery, timed("Um, like, the plan fails.")), [
    "Um,:hesitation",
    "like,:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("It was like really big.", { 2: 0.25 })), ["like:habit"]);
  assert.deepEqual(marked(delivery, timed("It was like really big.", { 2: 0.1 })), []);
});

test("like after I, looks or just is a verb or comparison, even with an um in between", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("I like this plan.")), []);
  assert.deepEqual(marked(delivery, timed("I, um, like this plan.")), ["um,:hesitation"]);
  assert.deepEqual(marked(delivery, timed("It looks like, um, a problem.")), ["um,:hesitation"]);
  assert.deepEqual(marked(delivery, timed("Just like the evidence says.")), []);
  assert.deepEqual(marked(delivery, timed("Like my opponent said, the plan fails.")), []);
  assert.deepEqual(marked(delivery, timed("Um like the evidence says, no.")), ["Um:hesitation"]);
});

test("you know counts when set off after know; not 'the drill', 'let you know', a question", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("You know, the drill.")), [
    "You:habit",
    "know,:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("It is, you know, hard.")), ["you:habit", "know,:habit"]);
  assert.deepEqual(marked(delivery, timed("You know the drill.")), []);
  assert.deepEqual(marked(delivery, timed("I'll let you know.")), []);
  assert.deepEqual(marked(delivery, timed("Do you know why?")), []);
});

test("so counts only when an um or a half-second hang follows it", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("Hey, so, um, we start.")), [
    "so,:habit",
    "um,:hesitation",
  ]);
  assert.deepEqual(marked(delivery, timed("So the impact is clear.", { 1: 0.5 })), ["So:habit"]);
  for (const sentence of [
    "So the impact is extinction.",
    "So, the impact is extinction.",
    "I like this plan, so the impact is clear.",
    "It is good so far.",
    "I think so.",
  ]) {
    assert.deepEqual(marked(delivery, timed(sentence)), [], sentence);
  }
  assert.deepEqual(marked(delivery, timed("So the impact is clear.", { 1: 0.3 })), []);
});

test("actually and basically count only where a sentence or clause begins", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("Basically, the plan fails.")), ["Basically,:habit"]);
  assert.deepEqual(marked(delivery, timed("Actually the card says otherwise.")), [
    "Actually:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("The plan basically fails.")), []);
  assert.deepEqual(marked(delivery, timed("It is actually true.")), []);
});

test("a transcript with no punctuation still never counts 'I like', and pauses still work", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("i like this plan so the impact is clear")), []);
  assert.deepEqual(marked(delivery, timed("it was like really big", { 2: 0.3 })), ["like:habit"]);
});

test("analyze on the clip: pace without ums, fillers per minute, breaks and clean stretch", () => {
  const delivery = load();
  const report = delivery.analyze(CLIP_WORDS, CLIP_METRICS);
  assert.equal(report.fillerCount, 11);
  assert.equal(report.hesitationCount, 9);
  assert.deepEqual(plain(report.habitCounts), {
    like: 0,
    so: 1,
    "you know": 0,
    actually: 0,
    basically: 1,
  });
  assert.deepEqual(plain(report.topHabit), { text: "so", count: 1 });
  assert.equal(report.speakingSeconds, 30.908);
  assert.equal(report.wordsPerMinute, 75.7, "39 words that are not um or uh over 30.908 s");
  assert.equal(report.fillersPerMinute, 21.4, "11 fillers over 30.908 s");
  assert.equal(report.midSentencePauseCount, 3);
  assert.equal(report.longestMidSentencePause, 2.5);
  assert.deepEqual(plain(report.cleanStretch), { start: 5.436, end: 10.352, seconds: 4.9 });
  assert.equal(report.repeatCount, 1);
  assert.deepEqual(
    plain(report.fillers.slice(0, 2)),
    [
      { index: 1, text: "so", kind: "habit", start: 1.723, end: CLIP_WORDS[1].end },
      { index: 2, text: "um", kind: "hesitation", start: 2.417, end: CLIP_WORDS[2].end },
    ],
  );
});

test("a pause after a sentence-ending word is not a break and does not cut the stretch", () => {
  const delivery = load();
  const words = timed("We win. The plan works today.", { 2: 2 });
  const report = delivery.analyze(words, { pauses: [[words[1].end, 2.1]], repeats: [] });
  assert.deepEqual(
    plain(report.pauses),
    [{ at: words[1].end, length: 2.1, midSentence: false }],
  );
  assert.equal(report.midSentencePauseCount, 0);
  assert.equal(report.cleanStretch.seconds, 4.3, "the whole take, first start to last end");
});

test("a mid-sentence pause and a restart each cut the clean stretch", () => {
  const delivery = load();
  const words = timed("The plan works because the the cost is low.", { 3: 2 });
  const pause = [words[2].end, 2.1];
  const report = delivery.analyze(words, {
    pauses: [pause],
    repeats: [{ text: "the", at: words[4].start }],
  });
  assert.equal(report.midSentencePauseCount, 1);
  // Cuts: the pause [1.1, 3.2] and the restart [3.6, 4.0]; the longest clean run is the
  // restarted "the cost is low." from 4.0 to 5.5.
  assert.deepEqual(plain(report.cleanStretch), { start: 4, end: 5.5, seconds: 1.5 });
});

test("an energy-only pause between word ends is placed after the last word ending by it", () => {
  const delivery = load();
  const words = timed("Our plan solves the harm.", { 3: 2.5 });
  const report = delivery.analyze(words, { pauses: [[words[2].end + 0.4, 2]], repeats: [] });
  assert.equal(report.pauses[0].midSentence, true, "'solves' does not end a sentence");
});

test("without words, analyze falls back to the backend tallies", () => {
  const delivery = load();
  const report = delivery.analyze([], CLIP_METRICS);
  assert.equal(report.fillerCount, 13);
  assert.equal(report.hesitationCount, 9);
  assert.equal(report.wordsPerMinute, 93.2);
  assert.equal(report.fillersPerMinute, 25.2);
  assert.equal(report.midSentencePauseCount, 3, "every pause counts when no word can place it");
  assert.equal(report.longestMidSentencePause, 2.5);
  assert.equal(report.cleanStretch, null);
  assert.deepEqual(plain(report.kinds), []);
});

test("analyze never throws on missing or malformed input and never changes its inputs", () => {
  const delivery = load();
  const words = CLIP_WORDS.map((word) => ({ ...word }));
  const metrics = JSON.parse(JSON.stringify(CLIP_METRICS));
  const before = JSON.stringify({ words, metrics });
  delivery.analyze(words, metrics);
  assert.equal(JSON.stringify({ words, metrics }), before);

  const empty = delivery.analyze(undefined, undefined);
  assert.equal(empty.fillerCount, 0);
  assert.equal(empty.wordsPerMinute, 0);
  assert.equal(empty.topHabit, null);
  const junk = delivery.analyze([{ text: null }, { start: "x" }], { pauses: [null, [1], "x"] });
  assert.equal(junk.pauses.length, 0);
  assert.equal(junk.fillerCount, 0);
  const holes = delivery.analyze([null, { text: "um", start: 1, end: 1.2 }, undefined], {
    pauses: [],
    repeats: [null, { text: "the" }, { text: "we", at: "1" }],
  });
  assert.equal(holes.hesitationCount, 1);
  assert.equal(holes.repeatCount, 0);
});

test("a ten-minute, 1,500-word take is analyzed in well under 100 ms", () => {
  const delivery = load();
  const sentence = "So, um, the plan works because, like, the cost is very low. ";
  const words = timed(sentence.repeat(125).trim());
  const pauses = Array.from({ length: 40 }, (_, k) => [words[k * 30].end, 1.6]);
  const started = process.hrtime.bigint();
  const report = delivery.analyze(words, { pauses, repeats: [] });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(report.kinds.length, 1500);
  assert.ok(elapsedMs < 100, "took " + elapsedMs.toFixed(1) + " ms");
});
