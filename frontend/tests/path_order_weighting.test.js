// Tests that app.path.order (docs/PLAN.md T42) weighs each of the speaker's latest takes by its
// speaking time. A rate over several takes is then the rate over all their minutes together, so
// a few seconds of a take the speaker abandoned cannot reorder the path, and a long take counts
// for every minute of it. One take alone still ranks as backend/advice/select.py
// weakest_skills ranks it. Every report comes from the real app.delivery.analyze.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

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

function idsOf(units) {
  return Array.from(units, (unit) => unit.id);
}

// `count` words, one every `step` seconds from 1 s, each 80% of a step long; `say` swaps in
// other text by index.
function words({ count, step, say = {} }) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// A stored take on Your day (band 140 to 160) as app.store.list() hands it back.
function take({ transcript, repeats = [], createdAt }) {
  return {
    id: "take-" + createdAt,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 60,
    metrics: { pauses: [], repeats, fillers: {} },
    transcript,
  };
}

// One minute of talk at 150 wpm with 2 restarts: restarts at twice their target, no filler.
function minuteWithTwoRestarts(createdAt) {
  const transcript = words({ count: 150, step: 60 / 149.8 });
  const repeats = [20, 80].map((index) => ({
    text: "word" + index + " word" + (index + 1),
    at: transcript[index].start,
  }));
  return take({ transcript, repeats, createdAt });
}

const FOUR_RESTART_TAKES = [1, 2, 3, 4].map((day) =>
  minuteWithTwoRestarts(`2026-10-0${day}T10:00:00.000Z`),
);

test("a few seconds of a take abandoned cannot reorder the path", () => {
  // "Um, uh, okay, um, let me start over.": 4.7 s of speech ending at 5.7 s, which the backend's
  // 5 s check accepts and Practice saves. Its 3 hesitations are 38.3 a minute.
  const step = 4.7 / 7.8;
  const aborted = take({
    transcript: ["Um,", "uh,", "okay,", "um,", "let", "me", "start", "over."].map((text, i) => ({
      text,
      start: 1 + i * step,
      end: 1 + i * step + step * 0.8,
    })),
    createdAt: "2026-10-05T10:00:00.000Z",
  });
  const report = APP.delivery.analyze(aborted.transcript, aborted.metrics);
  assert.equal(report.speakingSeconds, 4.7);
  assert.equal(report.fillersPerMinute, 38.3);

  const before = idsOf(APP.path.order(FOUR_RESTART_TAKES));
  assert.deepEqual(before, ["restarts", "pace", "fillers", "long-pauses"]);
  assert.deepEqual(idsOf(APP.path.order([aborted, ...FOUR_RESTART_TAKES])), before);
});

test("a take counts for every minute: three minutes of fillers outweigh two of restarts", () => {
  // Three minutes with 18 ums (6 a minute, twice the target of 3) against two one-minute takes
  // with 2 restarts each (twice the target of 1). Over all five minutes the fillers run at 3.6
  // a minute, 0.2 past their target, and the restarts at 0.8, 0.2 short of theirs.
  const ums = Object.fromEntries(Array.from({ length: 18 }, (_, n) => [10 + n * 25, "um"]));
  const long = take({
    transcript: words({ count: 450, step: 180 / 449.8, say: ums }),
    createdAt: "2026-10-03T10:00:00.000Z",
  });
  assert.equal(APP.delivery.analyze(long.transcript, long.metrics).speakingSeconds, 180);

  const history = [long, ...FOUR_RESTART_TAKES.slice(0, 2)];
  assert.deepEqual(idsOf(APP.path.order(history)), ["fillers", "restarts", "pace", "long-pauses"]);
});
