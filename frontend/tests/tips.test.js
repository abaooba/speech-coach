// Tests for frontend/tips.js (app.tips.select). The module is loaded with vm.runInNewContext
// with a bare `app` object. One neutral baseline stays clean under every rule, including the
// three T12 adds later (likes, pause-none, pace-uneven); each rule test clones it and changes
// only the field that rule reads, so no other rule can fire by accident.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TIPS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "tips.js"), "utf8");

// In-target pace, no fillers, one ordinary pause, no repeats, a flat pace curve.
const BASELINE = {
  words_per_minute: 150,
  duration: 15,
  word_count: 38,
  fillers: { um: 0, uh: 0, hmm: 0, like: 0, "you know": 0, so: 0, basically: 0, actually: 0 },
  pauses: [[5, 1.6]],
  repeats: [],
  pace_windows: [
    { start: 0, end: 10, wpm: 150 },
    { start: 10, end: 15, wpm: 150 },
  ],
};

const DEFAULT_TARGET = [140, 160];
const CLEAN_TIP = { id: "clean", text: "Clean run. Push the pace a little next time." };
const MAX_TIPS = 2;

// Section 8 of DESIGN.md: under 15 words a sentence, no exclamation marks.
const MAX_SENTENCE_WORDS = 15;

const RULE_COPY = {
  "pace-fast": "You are above target pace. Breathe at each period.",
  "pace-slow": "You are under target pace. Shorten the pauses between ideas.",
  "fillers-high": "Replace um with a silent beat. Judges hear silence as confidence.",
  "pause-long": "One pause ran past 3 seconds. Glance at your next point before you stop talking.",
  repeats: "You restarted phrases three times. Finish the sentence, then fix it.",
  clean: CLEAN_TIP.text,
};

// One change per rule that makes exactly that rule fire against the default target.
const TRIGGERS = {
  "pace-fast": { words_per_minute: 176 },
  "pace-slow": { words_per_minute: 124 },
  "fillers-high": { fillers: { ...BASELINE.fillers, um: 2 } },
  "pause-long": { pauses: [[5, 3.2]] },
  repeats: { repeats: [{ text: "and I", at: 2 }, { text: "we", at: 6 }, { text: "so the", at: 9 }] },
};

function loadTips() {
  const context = { app: {} };
  vm.runInNewContext(TIPS_SOURCE, context, { filename: "tips.js" });
  return { app: context.app, tips: context.app.tips };
}

function metricsWith(overrides) {
  return { ...structuredClone(BASELINE), ...(overrides || {}) };
}

// The vm context has its own Array and Object; copying into this realm's lets deepEqual compare.
function plain(tips) {
  return Array.from(tips, (tip) => ({ id: tip.id, text: tip.text }));
}

function ids(tips) {
  return Array.from(tips, (tip) => tip.id);
}

function texts(tips) {
  return Array.from(tips, (tip) => tip.text);
}

test("tips.js assigns exactly app.tips with a select function", () => {
  const { app, tips } = loadTips();
  assert.deepEqual(Object.keys(app), ["tips"]);
  assert.equal(typeof tips.select, "function");
});

test("the unmodified baseline gets exactly the clean tip", () => {
  const { tips } = loadTips();
  assert.deepEqual(plain(tips.select(metricsWith())), [CLEAN_TIP]);
});

test("the baseline is clean with an explicit default target and with no options at all", () => {
  const { tips } = loadTips();
  const explicit = tips.select(metricsWith(), { targetWpm: DEFAULT_TARGET });
  assert.deepEqual(plain(explicit), [CLEAN_TIP]);
  assert.deepEqual(plain(tips.select(metricsWith(), {})), [CLEAN_TIP]);
});

for (const [id, change] of Object.entries(TRIGGERS)) {
  test(`${id} fires first when only its field changes, with its fixed copy`, () => {
    const { tips } = loadTips();
    const selected = tips.select(metricsWith(change));
    assert.equal(selected[0].id, id);
    assert.equal(selected[0].text, RULE_COPY[id]);
    assert.equal(selected.length, 1, "nothing else should fire on the baseline");
  });
}

test("pace-fast needs more than hi + 15: 175 is still clean against 140 to 160", () => {
  const { tips } = loadTips();
  assert.deepEqual(plain(tips.select(metricsWith({ words_per_minute: 175 }))), [CLEAN_TIP]);
  assert.equal(ids(tips.select(metricsWith({ words_per_minute: 175.6 })))[0], "pace-fast");
});

test("pace-slow needs less than lo - 15: 125 is still clean against 140 to 160", () => {
  const { tips } = loadTips();
  assert.deepEqual(plain(tips.select(metricsWith({ words_per_minute: 125 }))), [CLEAN_TIP]);
  assert.equal(ids(tips.select(metricsWith({ words_per_minute: 124.4 })))[0], "pace-slow");
});

test("options.targetWpm replaces the default range for both pace rules", () => {
  const { tips } = loadTips();
  const slow = tips.select(metricsWith(), { targetWpm: [170, 190] });
  assert.equal(slow[0].id, "pace-slow");
  const fast = tips.select(metricsWith(), { targetWpm: [120, 130] });
  assert.equal(fast[0].id, "pace-fast");
  const inside = tips.select(metricsWith({ words_per_minute: 176 }), { targetWpm: [165, 175] });
  assert.deepEqual(plain(inside), [CLEAN_TIP]);
});

test("fillers-high adds every filler key together over the duration", () => {
  const { tips } = loadTips();
  // 1 "you know" and 1 "like" in 15 seconds is 8 per minute.
  const mixed = metricsWith({ fillers: { ...BASELINE.fillers, "you know": 1, like: 1 } });
  assert.equal(tips.select(mixed)[0].id, "fillers-high");
});

test("fillers-high needs more than 6 per minute: 2 fillers in 20 seconds is exactly 6", () => {
  const { tips } = loadTips();
  const atLimit = metricsWith({ duration: 20, fillers: { ...BASELINE.fillers, um: 2 } });
  assert.deepEqual(plain(tips.select(atLimit)), [CLEAN_TIP]);
});

test("fillers-high never fires when the duration is 0", () => {
  const { tips } = loadTips();
  const noTime = metricsWith({ duration: 0, fillers: { ...BASELINE.fillers, um: 5 } });
  assert.deepEqual(plain(tips.select(noTime)), [CLEAN_TIP]);
});

test("pause-long reads the longest pause, wherever it sits in the list", () => {
  const { tips } = loadTips();
  const later = metricsWith({ pauses: [[5, 1.6], [9, 3.4], [12, 2]] });
  assert.equal(tips.select(later)[0].id, "pause-long");
  assert.deepEqual(plain(tips.select(metricsWith({ pauses: [[5, 3]] }))), [CLEAN_TIP]);
  assert.deepEqual(plain(tips.select(metricsWith({ pauses: [] }))), [CLEAN_TIP]);
});

test("repeats needs three: two restarts are still clean", () => {
  const { tips } = loadTips();
  const two = metricsWith({ repeats: [{ text: "and I", at: 2 }, { text: "we", at: 6 }] });
  assert.deepEqual(plain(tips.select(two)), [CLEAN_TIP]);
});

test("pace-fast and fillers-high together come out in that order, and only those two", () => {
  const { tips } = loadTips();
  const both = metricsWith({ ...TRIGGERS["pace-fast"], ...TRIGGERS["fillers-high"] });
  const selected = tips.select(both);
  assert.deepEqual(ids(selected), ["pace-fast", "fillers-high"]);
  assert.equal(selected.length, 2);
  assert.deepEqual(texts(selected), [RULE_COPY["pace-fast"], RULE_COPY["fillers-high"]]);
});

test("at most two tips when four rules fire, keeping the two highest priorities", () => {
  const { tips } = loadTips();
  const four = metricsWith({
    ...TRIGGERS["pace-fast"],
    ...TRIGGERS["fillers-high"],
    ...TRIGGERS["pause-long"],
    ...TRIGGERS.repeats,
  });
  const selected = tips.select(four);
  assert.equal(selected.length, MAX_TIPS);
  assert.deepEqual(ids(selected), ["pace-fast", "fillers-high"]);
});

test("lower rules keep their relative order: pause-long before repeats", () => {
  const { tips } = loadTips();
  const two = metricsWith({ ...TRIGGERS["pause-long"], ...TRIGGERS.repeats });
  assert.deepEqual(ids(tips.select(two)), ["pause-long", "repeats"]);
  const other = metricsWith({ ...TRIGGERS["fillers-high"], ...TRIGGERS.repeats });
  assert.deepEqual(ids(tips.select(other)), ["fillers-high", "repeats"]);
});

test("the clean tip never joins a firing rule", () => {
  const { tips } = loadTips();
  for (const change of Object.values(TRIGGERS)) {
    assert.ok(!ids(tips.select(metricsWith(change))).includes("clean"));
  }
});

test("every tip is short second-person copy: under 15 words a sentence, no exclamation", () => {
  const { tips } = loadTips();
  const changes = [...Object.values(TRIGGERS), {}];
  const seen = new Map();
  for (const change of changes) {
    for (const tip of tips.select(metricsWith(change))) {
      seen.set(tip.id, tip.text);
    }
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(RULE_COPY).sort());
  for (const [id, text] of seen) {
    assert.ok(!text.includes("!"), `${id} has an exclamation mark`);
    const sentences = text.split(/[.?]\s*/).filter(Boolean);
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      assert.ok(words < MAX_SENTENCE_WORDS, `${id}: "${sentence}" has ${words} words`);
    }
  }
});

test("select returns fresh objects and never changes the metrics it reads", () => {
  const { tips } = loadTips();
  const metrics = metricsWith(TRIGGERS["pace-fast"]);
  const before = JSON.stringify(metrics);
  const first = tips.select(metrics);
  const second = tips.select(metrics);
  assert.equal(JSON.stringify(metrics), before);
  assert.notEqual(first[0], second[0], "each call builds its own tip objects");
  first[0].text = "changed";
  assert.equal(tips.select(metrics)[0].text, RULE_COPY["pace-fast"]);
});

test("missing or malformed metrics still yield one to two well-formed tips, never a throw", () => {
  const { tips } = loadTips();
  const inputs = [
    undefined,
    null,
    {},
    { fillers: null, pauses: "none", repeats: 7, words_per_minute: "fast", duration: NaN },
    { pauses: [null, [1], ["x", "y"]], fillers: { um: "3" } },
  ];
  for (const input of inputs) {
    let selected;
    assert.doesNotThrow(() => {
      selected = tips.select(input);
    });
    assert.ok(Array.isArray(selected));
    assert.ok(selected.length >= 1 && selected.length <= MAX_TIPS);
    for (const tip of selected) {
      assert.equal(typeof tip.id, "string");
      assert.equal(typeof tip.text, "string");
      assert.ok(Object.hasOwn(RULE_COPY, tip.id), `unknown id ${tip.id}`);
    }
  }
});
