// Tests that nothing a speaker sees steers toward debate (the owner's rule of 2026-10-14, in
// CLAUDE.md's Project paragraph): Speech Coach is for non-native speakers and anyone who wants
// to speak more fluidly. No debate format, case, rebuttal, resolution, side, cross-examination,
// round, judge or ballot appears on the Loop Path or the How we measure page, and no Path tip
// or "why this works" line cites a debate source. passages.js, delivery.js and path.js load
// into a vm in index.html's order; the research library is read from
// backend/advice/library.json and how.html as text.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const LIBRARY = new Map(
  JSON.parse(
    fs.readFileSync(path.join(FRONTEND_DIR, "..", "backend", "advice", "library.json"), "utf8"),
  ).map((entry) => [entry.id, entry]),
);

// The words that steer toward debate: its name and its formats, then its parts and its people.
const DEBATE_WORDS = [
  /debat\w*/i,
  /\bNSDA\b/,
  /\bforensics?\b/i,
  /\bpublic forum\b/i,
  /\blincoln[- ]douglas\b/i,
  /\bcongress(?:ional)?\b/i,
  /\bworld schools\b/i,
  /\bextemp\b/i,
  /\brebuttals?\b/i,
  /\bconstructives?\b/i,
  /\bcross[- ]?exam/i,
  /\bresolutions?\b/i,
  /\baffirm(?:s|ed|ing|ative)?\b/i,
  /\bnegat(?:e|es|ed|ing|ive)\b/i,
  /\bopponents?\b/i,
  /\bcases?\b/i,
  /\bcontentions?\b/i,
  /\bjudges?\b/i,
  /\bballots?\b/i,
  /\brounds?\b/i,
];

// Every debate word in `text`, as found.
function debateWordsIn(text) {
  return DEBATE_WORDS.flatMap((word) => {
    const found = String(text).match(word);
    return found ? [found[0]] : [];
  });
}

function assertNoDebateWords(where, text) {
  const found = debateWordsIn(text);
  const shown = String(text).length > 200 ? found.join(", ") : `"${text}"`;
  assert.deepEqual(found, [], `${where}: ${shown}`);
}

// Every string inside `value`, at any depth, with the path it was found at.
function stringsIn(value, where) {
  if (typeof value === "string") {
    return [[where, value]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringsIn(item, `${where}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => stringsIn(item, `${where}.${key}`));
  }
  return [];
}

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const PATH = APP.path;

// Every play the Path can start: a loop and a check-back per level, the crowns, the
// checkpoints and the benchmark.
function allPlays() {
  const ids = ["benchmark"];
  PATH.UNITS.forEach((unit) => {
    unit.levels.forEach((level) => ids.push(level.id, level.id + "_checkback"));
    ids.push(unit.id + "_checkpoint");
    if (unit.crown) {
      ids.push(unit.crown.id);
    }
  });
  return ids.map((id) => PATH.playById(id));
}

test("the debate words are caught, and everyday words are not", () => {
  assert.deepEqual(debateWordsIn("My opponents' case fails, so the judge should negate.").sort(), [
    "case",
    "judge",
    "negate",
    "opponents",
  ]);
  assert.deepEqual(debateWordsIn("Weigh the round and vote on the ballot.").sort(), [
    "ballot",
    "round",
  ]);
  assert.deepEqual(debateWordsIn("National Speech & Debate Association"), ["Debate"]);
  assert.deepEqual(
    debateWordsIn("Listeners judged slower speech less fluent; use your judgment."),
    [],
    "judged and judgment are everyday words",
  );
});

test("no unit, level or play on the Path holds a debate word", () => {
  for (const unit of PATH.UNITS) {
    stringsIn(JSON.parse(JSON.stringify(unit)), unit.id).forEach(([where, text]) =>
      assertNoDebateWords(where, text),
    );
  }
  for (const play of allPlays()) {
    stringsIn(JSON.parse(JSON.stringify(play)), play.id).forEach(([where, text]) =>
      assertNoDebateWords(where, text),
    );
  }
});

// The words of a tip and a why line are checked with the plays above; this checks who they cite:
// the source's author, credentials, title, publisher and link, as library.json records them.
test("no Path tip or why line cites a debate source", () => {
  const cited = new Set();
  for (const unit of PATH.UNITS) {
    cited.add(unit.why.entry);
    Array.from(unit.levels).forEach((level) => cited.add(level.tip.entry));
  }
  assert.equal(cited.size, 24, "four why lines and twenty tips");
  for (const id of cited) {
    const entry = LIBRARY.get(id);
    assert.ok(entry, `library.json has no entry ${id}`);
    const { author, credentials, title, publisher, url } = entry.source;
    [author, credentials, title, publisher, url].forEach((text) => assertNoDebateWords(id, text));
  }
});

// how.html as a speaker reads it: the text between the tags, and where each link goes.
function howPage() {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, "how.html"), "utf8");
  const text = html
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
  const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  return { text, links };
}

test("the How we measure page holds no debate word and links no debate source", () => {
  const { text, links } = howPage();
  assert.ok(text.includes("How we measure"), "the page's text was read");
  assertNoDebateWords("how.html", text);
  links.forEach((link) => assertNoDebateWords("how.html link", link));
});

// Practice's "See a sample result" saves sample-session.json as a take, so its title shows in
// History and on Results and its words in the transcript.
test("the bundled sample is an everyday take on a Practice prompt", () => {
  const sampleFile = path.join(FRONTEND_DIR, "sample-session.json");
  const sample = JSON.parse(fs.readFileSync(sampleFile, "utf8"));
  const prompt = Array.from(APP.passages).find((entry) => entry.id === sample.passageId);
  assert.ok(prompt, `the sample's ${sample.passageId} is a Practice entry`);
  assert.equal(prompt.kind, "prompt");
  assert.equal(sample.passageTitle, "Sample: " + prompt.title);
  assertNoDebateWords("the sample's title", sample.passageTitle);
  assertNoDebateWords("the sample's words", sample.transcript.map((word) => word.text).join(" "));
});
