// Tests that the change line compares like with like both ways (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8: "the latest earlier own take that has
// this value (for reads, the latest earlier take that followed a script; for talks, the latest
// earlier take that did not)"). fix_loop_change_line_reads.test.js pins the reads; this file pins
// the talks: a scripted read saved between two talks never stands in for the speaker's last talk,
// since a read's fillers and clean stretch say nothing about talking. Reads keep comparing only
// with reads. passages.js, delivery.js, path.js and loop.js load into a vm in index.html's order;
// every report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const TODAY = "2026-10-14"; // a Wednesday
// What the backend adds to a take it lined up against the script it was sent and found the take
// follows: a read, or a talk given from a pasted script. A free talk has no such block.
const SCRIPT_FOLLOWED = { restarts: [], skipped: [], misread: [] };
// A cold read's length in words, as the Restarts reads are.
const READ_WORDS = 109;

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js", "loop.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const LOOP = APP.loop;

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// An ISO time at `hour` local time on a local calendar day.
function at(day, hour) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour).toISOString();
}

// `count` words from 1 s, the last ending exactly `seconds` after the first starts, each 80% of
// its step long; `say` swaps in other text by index ("um").
function wordsOver(count, seconds, say = {}) {
  const step = seconds / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// A stored take as app.store.list() hands it back; with `script`, one that followed its script.
// The rules never read the passage id.
function take({ transcript, repeats = [], script, createdAt }) {
  const metrics = { pauses: [], repeats };
  if (script) {
    metrics.script = script;
  }
  return {
    id: "take-" + createdAt,
    createdAt,
    passageId: script ? "a-passage" : "a-prompt",
    passageTitle: "Practice",
    durationSeconds: 90,
    metrics,
    transcript,
  };
}

// A minute of free talk, 150 words with `fillers` ums among them, saved at `hour` today.
function talkWithFillers(fillers, hour) {
  const say = {};
  for (let n = 0; n < fillers; n += 1) {
    say[5 + n * 15] = "um";
  }
  return take({ transcript: wordsOver(150, 60, say), createdAt: at(TODAY, hour) });
}

// Free talk without a filler, pause or restart for `seconds`: one clean stretch that long.
function cleanTalk(seconds, hour) {
  return take({ transcript: wordsOver(150, seconds), createdAt: at(TODAY, hour) });
}

// A cold read over `seconds` that followed its script, without a filler or pause, restarting at
// each word index in `restartsAt` (each a slip), saved at `hour` today.
function scriptedRead({ seconds, restartsAt = [], hour }) {
  const transcript = wordsOver(READ_WORDS, seconds);
  const restarts = restartsAt.map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  return take({
    transcript,
    repeats: restarts,
    script: Object.assign({}, SCRIPT_FOLLOWED, { restarts }),
    createdAt: at(TODAY, hour),
  });
}

// The change line feedbackFor gives `take1`, take 1 of a play, against `history` today.
function changeFor(playId, take1, history) {
  const report = APP.delivery.analyze(take1.transcript, take1.metrics);
  const context = { history, today: TODAY, takeId: take1.id };
  return plain(LOOP.feedbackFor(playId, report, context).change);
}

test("a Fillers talk after a scripted read compares with the earlier talk, not the read", () => {
  // 5.0 fillers a minute at 9, a read without one at 10, then take 1 at 9.0 a minute.
  const take1 = talkWithFillers(9, 11);
  const history = [take1, scriptedRead({ seconds: 44, hour: 10 }), talkWithFillers(5, 9)];
  assert.deepEqual(changeFor("fillers-2", take1, history), {
    text: "4.0 more than earlier today",
    direction: "worse",
    trend: "up",
  });
});

test("a Long pauses talk after a cold read compares with the earlier talk, not the read", () => {
  // A talk held 18.5 s clean at 9 and a cold read 43.6 s at 10: take 1's 20.5 s is 2 s longer
  // than the talk, which is better, not 23.1 s shorter than the read.
  const take1 = cleanTalk(20.5, 11);
  const history = [take1, scriptedRead({ seconds: 43.6, hour: 10 }), cleanTalk(18.5, 9)];
  assert.deepEqual(changeFor("long-pauses-1", take1, history), {
    text: "2 s longer than earlier today",
    direction: "better",
    trend: "up",
  });
});

test("a talk with only scripted takes before it has no change line", () => {
  const take1 = talkWithFillers(9, 11);
  const history = [take1, scriptedRead({ seconds: 44, hour: 10 })];
  assert.equal(changeFor("fillers-2", take1, history), null);
  const clean = cleanTalk(20.5, 11);
  const read = scriptedRead({ seconds: 43.6, hour: 10 });
  assert.equal(changeFor("long-pauses-1", clean, [clean, read]), null);
});

test("a read still compares only with earlier reads, never with the talk between them", () => {
  // Read 1 with 2 slips at 12; a talk without a restart at 11; a read with 4 slips at 10.
  const read1 = scriptedRead({ seconds: 44, restartsAt: [10, 50], hour: 12 });
  const earlierRead = scriptedRead({ seconds: 44, restartsAt: [10, 30, 50, 70], hour: 10 });
  const history = [read1, talkWithFillers(5, 11), earlierRead];
  assert.deepEqual(changeFor("restarts-1", read1, history), {
    text: "2 fewer than earlier today",
    direction: "better",
    trend: "down",
  });
  assert.equal(changeFor("restarts-1", read1, [read1, talkWithFillers(5, 11)]), null);
});
