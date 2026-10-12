// Tests that the frontend reads mhm in a repeat the way the backend does (Phase 1 loose end
// after T31). backend/metrics.py REPEAT_SKIP_WORDS and frontend/delivery.js skip the same
// hesitation set when they match a repeated phrase: um, uh, hmm and mhm in every spelling
// ("Mhm,", "mhmm", "mm-hmm", "mm-hm", "uh-huh"). So an mhm never uses up the words Results
// searches for a second copy, and never becomes part of one.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const DELIVERY_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "delivery.js"), "utf8");
const METRICS_SOURCE = fs.readFileSync(
  path.join(FRONTEND_DIR, "..", "backend", "metrics.py"),
  "utf8",
);

const MHM_SPELLINGS = ["mhm", "Mhm,", "mhmm", "mm-hmm", "Mm-hmm,", "mm-hm", "uh-huh,"];

function loadDelivery() {
  const context = { app: {} };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  return context.app.delivery;
}

// Words every half second, a quarter second long.
function spoken(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: index * 0.5,
    end: index * 0.5 + 0.25,
  }));
}

function secondCopy(sentence, repeat) {
  const report = loadDelivery().analyze(spoken(sentence), { pauses: [], repeats: [repeat] });
  return [...report.restarts[0].secondCopy];
}

// The quoted words in `name = <open> ... <close>` of a source file.
function quotedList(source, pattern) {
  const match = source.match(pattern);
  assert.ok(match, "list not found: " + pattern);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((quoted) => quoted[1]);
}

test("delivery.js skips the same hesitation set as backend REPEAT_SKIP_WORDS", () => {
  const backend = quotedList(METRICS_SOURCE, /^REPEAT_SKIP_WORDS = \(([^)]*)\)/m);
  const frontend = quotedList(DELIVERY_SOURCE, /const REPEAT_SKIP_WORDS = \[([^\]]*)\]/);
  assert.deepEqual(backend, ["um", "uh", "hmm", "mhm"]);
  assert.deepEqual(frontend, backend);
});

test("both sides read the same spellings as mhm", () => {
  const backend = METRICS_SOURCE.match(/_AGREEMENT_SOUND = re\.compile\(r"([^"]+)"\)/);
  const frontend = DELIVERY_SOURCE.match(/const AGREEMENT_SOUND = \/([^/]+)\/;/);
  assert.ok(backend && frontend, "both define the agreement sound pattern");
  assert.equal(frontend[1], backend[1]);
});

for (const mhm of MHM_SPELLINGS) {
  test(`"${mhm}" after a cut-off does not use up the words searched for the restart`, () => {
    // I kinda ner— | mhm | like, you know, | I'm kinda nervous
    const sentence = `I kinda ner— ${mhm} like, you know, I'm kinda nervous`;
    assert.deepEqual(secondCopy(sentence, { text: "I kinda ner", at: 0 }), [7, 8, 9]);
  });

  test(`"${mhm}" inside a second copy is skipped like an uh, not part of the copy`, () => {
    const repeat = { text: "the few decisions a", at: 0 };
    const withMhm = `the few decisions a day— uh, the few, ${mhm} decisions a student`;
    const withUh = "the few decisions a day— uh, the few, uh, decisions a student";
    assert.deepEqual(secondCopy(withMhm, repeat), [6, 7, 9, 10]);
    assert.deepEqual(secondCopy(withMhm, repeat), secondCopy(withUh, repeat));
  });
}

test("like is not a hesitation: it still counts as a word between the copies", () => {
  // I kinda ner— | like, so, you know, | I'm: I'm is the fifth word after the cut.
  const sentence = "I kinda ner— like, so, you know, I'm kinda nervous";
  assert.deepEqual(secondCopy(sentence, { text: "I kinda ner", at: 0 }), []);
});
