// Tests that two of DESIGN.md section 2's contract lines say what the code does. The
// app.api.analyze line takes the parameters api.js declares, `script` among them, and gives the
// browser's deadline as ANALYZE_TIMEOUT_MS sets it with the backend's shorter one
// (TRANSCRIBE_DEADLINE_SECONDS, 150 s), whose "provider" error arrives first. The
// app.delivery.analyze line names every field the report carries and the fields of each pause,
// read from a real report: delivery.js is pure, so it loads into a bare vm context.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const DESIGN = read("DESIGN.md");
const API_SOURCE = read("api.js");
const DELIVERY_SOURCE = read("delivery.js");

const MS_PER_SECOND = 1000;
// The backend's whole budget for one transcription (TRANSCRIBE_DEADLINE_SECONDS).
const BACKEND_DEADLINE_SECONDS = 150;

// A take of four words with a mid-sentence pause and a 5.1 s pause after a full stop, read from a
// script with one restart, one misread and one skipped word.
const WORDS = [
  { text: "The", start: 0, end: 0.2 },
  { text: "plan", start: 1.4, end: 1.7 },
  { text: "fails.", start: 1.7, end: 2.1 },
  { text: "Next", start: 7.2, end: 7.5 },
];
const METRICS = {
  duration: 7.5,
  words_per_minute: 32,
  pauses: [
    [0.2, 1.2],
    [2.1, 5.1],
  ],
  fillers: {},
  repeats: [{ text: "the", at: 0 }],
  script: {
    restarts: [{ text: "the", at: 0 }],
    skipped: [{ word: "really", index: 2, at: 1.7 }],
    misread: [{ word: "next", index: 4, at: 7.2, said: "Next" }],
  },
};

// The text of DESIGN.md's section `number`, up to the next "## " heading.
function section(number) {
  const start = DESIGN.indexOf("\n## " + number + ". ");
  assert.ok(start !== -1, "DESIGN.md has section " + number);
  const end = DESIGN.indexOf("\n## ", start + 1);
  return DESIGN.slice(start, end === -1 ? undefined : end);
}

// Section 2's contract bullet that opens with `call`.
function contract(call) {
  const line = section(2)
    .split("\n")
    .find((text) => text.startsWith("- `" + call));
  assert.ok(line, "section 2 has a contract line for " + call);
  return line;
}

function loadDelivery() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

test("the app.api.analyze contract takes the parameters api.js declares", () => {
  const parameters = API_SOURCE.match(/async function analyze\(([^)]*)\)/)[1];
  assert.equal(parameters, "blob, contentType, script");
  assert.ok(contract("app.api.analyze(").startsWith("- `app.api.analyze(" + parameters + ") -> "));
});

test("the app.api.analyze contract says what script is and when it is sent", () => {
  const line = contract("app.api.analyze(");
  assert.match(line, /`script` is the text the take was read from/);
  assert.match(line, /the `script` form field/);
  assert.match(line, /`metrics\.script`/);
});

test("the app.api.analyze contract gives both deadlines, the backend's first", () => {
  const line = contract("app.api.analyze(");
  const timeoutMs = Number(API_SOURCE.match(/const ANALYZE_TIMEOUT_MS = (\d+);/)[1]);
  const browser = line.match(/still open (\d+) s after it starts \(`ANALYZE_TIMEOUT_MS`/);
  assert.ok(browser, "the line gives ANALYZE_TIMEOUT_MS in seconds");
  assert.equal(Number(browser[1]), timeoutMs / MS_PER_SECOND);
  const backend = line.match(/(\d+) s in all \(`TRANSCRIBE_DEADLINE_SECONDS`\)/);
  assert.ok(backend, "the line gives the backend's deadline");
  assert.equal(Number(backend[1]), BACKEND_DEADLINE_SECONDS);
  assert.ok(Number(backend[1]) < Number(browser[1]));
  assert.match(line, /its own `"provider"` error arrives first/);
  assert.doesNotMatch(line, /two minutes/);
});

test("the app.delivery.analyze contract names every field of the report", () => {
  const delivery = loadDelivery();
  const line = contract("app.delivery.analyze(");
  const fields = new Set([
    ...Object.keys(delivery.analyze(WORDS, METRICS)),
    ...Object.keys(delivery.analyze([], METRICS)),
  ]);
  assert.ok(fields.has("longPauseCount") && fields.has("misreads"), "a full report");
  const missing = [...fields].filter((field) => !line.includes("`" + field + "`"));
  assert.deepEqual(missing, []);
});

test("the app.delivery.analyze contract gives each pause's fields in order", () => {
  const report = loadDelivery().analyze(WORDS, METRICS);
  assert.equal(report.pauses.length, 2);
  const shape = contract("app.delivery.analyze(").match(/`pauses` \(`\{([^}]*)\}`/);
  assert.ok(shape, "the line gives the shape of a pause");
  assert.deepEqual(shape[1].split(", "), Object.keys(report.pauses[0]));
  assert.equal(report.pauses[1].long, true, "the 5.1 s pause is long");
});
