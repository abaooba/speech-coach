// Tests that frontend/delivery.js counts agreement sounds (mhm, mm-hmm, uh-huh) as hesitations,
// including on the owner's real 2026-10-11 church take, fed to analyze() in the shape Results
// passes it: the /api/analyze transcript (seconds) and the backend metrics.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DELIVERY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "delivery.js"), "utf8");

// The church take as AssemblyAI returned it (times in ms), turned into the transcript the API
// stores: {text, start, end} in seconds, as backend/providers/assemblyai.py to_word does.
const CHURCH_TRANSCRIPT = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname, "..", "..", "backend", "tests", "fixtures", "take_2026_10_11_nervous.json",
    ),
    "utf8",
  ),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));

// backend metrics.analyze() of the same take (backend/tests/test_metrics_mhm.py pins the
// fillers; the pauses and repeat are the backend's for these words).
const CHURCH_METRICS = {
  words_per_minute: 145.7,
  duration: 61.764,
  word_count: 150,
  pauses: [
    [25.305, 2.074],
    [35.738, 5.19],
    [46.717, 3.543],
  ],
  fillers: {
    um: 2, uh: 0, hmm: 0, mhm: 1, like: 1, "you know": 0, so: 2, basically: 0, actually: 1,
  },
  repeats: [{ text: "I kinda ner", at: 27.379 }],
  pace_windows: [],
};

function load() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

test("isHesitation counts mhm, mm-hmm, uh-huh and their spellings, with punctuation", () => {
  const delivery = load();
  for (const word of ["mhm", "Mhm.", "mhmm", "mm-hmm", "Mm-hmm,", "mm-hm", "uh-huh", "Uh-huh!"]) {
    assert.equal(delivery.isHesitation(word), true, word);
  }
  for (const word of ["huh", "Huh?", "mm", "hum", "uh-oh"]) {
    assert.equal(delivery.isHesitation(word), false, word);
  }
});

test("a 'Mhm.' between sentences is one hesitation filler", () => {
  const delivery = load();
  const words = ["I", "would", "be", "sad.", "Mhm.", "I", "didn't", "eat"].map((text, i) => ({
    text,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));
  const report = delivery.analyze(words, { pauses: [], repeats: [] });
  assert.equal(report.kinds[4], "hesitation");
  assert.equal(report.hesitationCount, 1);
  assert.equal(report.fillers.length, 1);
  assert.equal(report.fillers[0].text, "mhm");
});

test("the church take has three hesitations: um, Mhm and Um", () => {
  const delivery = load();
  const report = delivery.analyze(CHURCH_TRANSCRIPT, CHURCH_METRICS);
  assert.equal(report.hesitationCount, 3);
  const hesitations = report.fillers.filter((event) => event.kind === "hesitation");
  // Arrays built inside the vm realm have a foreign prototype; copy before deepEqual.
  assert.deepEqual([...hesitations.map((event) => event.text)], ["um", "mhm", "um"]);
});

test("a take saved without words adds the backend's mhm tally to the hesitations", () => {
  const delivery = load();
  const report = delivery.analyze([], CHURCH_METRICS);
  assert.equal(report.hesitationCount, 3);
});

test("how.html lists the agreement sounds as hesitations, not under never counts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "how.html"), "utf8");
  const table = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  const neverStart = html.indexOf("These never count");
  const never = html.slice(neverStart, html.indexOf("</ul>", neverStart));
  assert.match(table, /mhm, uh-huh, mm-hmm/);
  assert.doesNotMatch(never, /mhm|uh-huh|mm-hmm/);
  assert.match(never, /huh/);
});
