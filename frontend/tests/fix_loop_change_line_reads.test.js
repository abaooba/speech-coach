// Tests that a read's change line compares only with earlier reads (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 8: "the latest earlier own take that has
// this value (for reads, the latest earlier take that followed a script)"). That holds for every
// read, the Pace ladder reads judged on their pace as well as the Restarts reads judged on their
// slips: a talk's pace is not a read's, so "30 wpm faster than yesterday" against a free talk
// says nothing about the reading. passages.js, delivery.js, path.js and loop.js load into a vm in
// index.html's order; every report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const TODAY = "2026-10-14"; // a Wednesday

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

// `count` words read at exactly `wpm` from 1 s, each 80% of its step long.
function wordsAt(count, wpm) {
  const step = ((60 / wpm) * count) / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// A stored take as app.store.list() hands it back.
function take({ transcript, script, passageId, createdAt }) {
  const metrics = { pauses: [], repeats: [] };
  if (script) {
    metrics.script = script;
  }
  return {
    id: "take-" + createdAt,
    createdAt,
    passageId,
    passageTitle: "Practice",
    durationSeconds: 60,
    metrics,
    transcript,
  };
}

// The ladder passage (109 words) read at `wpm` on `day`, scored against its script.
function ladderRead(wpm, day, hour = 10) {
  return take({
    transcript: wordsAt(109, wpm),
    script: { restarts: [], skipped: [], misread: [] },
    passageId: "rebuttal-uniforms",
    createdAt: at(day, hour),
  });
}

// A minute of free talk at `wpm` on `day`, sent without a script.
function freeTalk(wpm, day, hour = 10) {
  return take({ transcript: wordsAt(wpm, wpm), passageId: "free-talk", createdAt: at(day, hour) });
}

// The change line feedbackFor gives `take1`, read 1 of a play, against `history` today.
function changeFor(playId, take1, history) {
  const report = APP.delivery.analyze(take1.transcript, take1.metrics);
  const context = { history, today: TODAY, takeId: take1.id };
  return plain(LOOP.feedbackFor(playId, report, context).change);
}

test("a ladder read's change line never compares with an earlier free talk", () => {
  const read1 = ladderRead(150, TODAY, 12);
  assert.equal(changeFor("pace-1", read1, [read1, freeTalk(120, "2026-10-13")]), null);
});

test("a ladder read compares with the latest earlier read that followed a script", () => {
  const read1 = ladderRead(150, TODAY, 12);
  const history = [read1, freeTalk(120, "2026-10-13"), ladderRead(140, "2026-10-12")];
  assert.deepEqual(changeFor("pace-1", read1, history), {
    text: "10 wpm faster than Monday",
    direction: "same",
    trend: "up",
  });
});

test("Pace level 2's read 1 is set against Monday's read in its own band, not the talk", () => {
  // Read 1's band is 130 to 150: 150 is inside it, Monday's 160 was 10 over.
  const read1 = ladderRead(150, TODAY, 12);
  const history = [read1, freeTalk(155, "2026-10-13"), ladderRead(160, "2026-10-12")];
  assert.deepEqual(changeFor("pace-2", read1, history), {
    text: "10 wpm slower than Monday",
    direction: "better",
    trend: "down",
  });
});
