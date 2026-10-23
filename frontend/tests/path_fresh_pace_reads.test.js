// Tests for the Path's fresh Pace reads in frontend/path.js (spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 4, which builds section 3
// of docs/superpowers/specs/2026-10-18-fresh-reads-and-rehearsal-design.md): every read of Pace
// level 1, Pace level 2 and the Pace crown is a cold read drawn by pickColdRead's rule, so a read
// drawn over the takes before it never repeats one while another is unread; a ladder read's set
// seconds are its passage's words at the read's target pace, rounded up, resolved by takeAt from
// the material it is given and null without one; the material key stays "ladder"; evaluate
// judges a ladder read without its material; and the Goal says each read is of a new passage.
// passages.js, delivery.js and path.js load into a vm in index.html's order.
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
const PATH = APP.path;
const COLD_READS = Array.from(APP.passages.coldReads());
const COLD_READ_IDS = COLD_READS.map((passage) => passage.id);
const LADDER_PLAYS = ["pace-1", "pace-2", "pace_crown"];

// Every ladder read as [play, take index, target pace]: Pace level 1 at 150 and its retries the
// same, Pace level 2 at 140 then 160 and its retried pair the same again, the crown at 180.
const LADDER_READS = [
  ["pace-1", 0, 150],
  ["pace-1", 1, 150],
  ["pace-1", 2, 150],
  ["pace-1", 3, 150],
  ["pace-2", 0, 140],
  ["pace-2", 1, 160],
  ["pace-2", 2, 140],
  ["pace-2", 3, 160],
  ["pace_crown", 0, 180],
];

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function wordCount(text) {
  return text.trim().split(/\s+/).length;
}

// A passage as materialFor hands it to the Level screen.
function materialOn(passage, band) {
  return {
    kind: "passage",
    id: passage.id,
    title: passage.title,
    text: passage.text,
    targetWpm: band,
    topic: null,
  };
}

// A saved read of `passageId`, as app.store.list() hands it back.
function readOf(passageId, createdAt) {
  return {
    id: "read-" + createdAt,
    createdAt,
    passageId,
    passageTitle: "Cold read",
    durationSeconds: 60,
    metrics: { pauses: [], repeats: [] },
    transcript: [],
  };
}

// A baseline with every number at a steady speaker's.
function steady() {
  return {
    takes: 5,
    minutes: 5,
    fillersPerMinute: 0,
    restartsPerMinute: 0,
    shortMidPerMinute: 0,
    longPausesPerMinute: 0,
    wpm: 150,
    cleanStretchSeconds: 20,
    weightedPerMinute: 0,
    otherPerMinute: { restarts: 0, fillers: 0, "long-pauses": 0, pace: 0 },
  };
}

// Every play id: a loop and a check-back per level, two crowns, four checkpoints, the benchmark.
function allPlayIds() {
  const ids = [];
  PATH.UNITS.forEach((entry) => {
    entry.levels.forEach((level) => ids.push(level.id, level.id + "_checkback"));
  });
  return ids.concat(
    ["fillers_crown", "pace_crown"],
    ["restarts", "fillers", "long-pauses", "pace"].map((id) => id + "_checkpoint"),
    ["benchmark"],
  );
}

// `count` words read at exactly `wpm` from 1 s, each 80% of its step long.
function wordsAt(count, wpm) {
  const step = (count * 60) / wpm / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: "word" + index,
    start: 1 + index * step,
    end: 1 + index * step + step * 0.8,
  }));
}

// The report of a read that followed its script, with a restart at each word index given.
function readReport(count, wpm, restartsAt = []) {
  const transcript = wordsAt(count, wpm);
  const restarts = restartsAt.map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  const metrics = {
    pauses: [],
    repeats: restarts,
    fillers: {},
    script: { restarts, skipped: [], misread: [] },
  };
  return APP.delivery.analyze(transcript, metrics);
}

// --- The level data ---------------------------------------------------------------------------

test("the material key stays ladder: Pace levels 1 and 2 and the Pace crown", () => {
  assert.equal(PATH.levelById("pace-1").material, "ladder");
  assert.equal(PATH.levelById("pace-2").material, "ladder");
  assert.equal(PATH.playById("pace_crown").material, "ladder");
  const ladders = allPlayIds().filter((id) => PATH.playById(id).material === "ladder");
  assert.deepEqual(ladders, LADDER_PLAYS, "nothing else reads the ladder");
});

test("a ladder read holds its band and no set seconds of its own", () => {
  const listed = (id) =>
    plain(PATH.levelById(id).takes).map(({ seconds, band }) => ({ seconds, band }));
  assert.deepEqual(listed("pace-1"), [
    { seconds: null, band: [140, 160] },
    { seconds: null, band: [140, 160] },
  ]);
  assert.deepEqual(listed("pace-2"), [
    { seconds: null, band: [130, 150] },
    { seconds: null, band: [150, 170] },
  ]);
  assert.deepEqual(plain(PATH.playById("pace_crown").takes), [
    { seconds: null, scored: true, read: true, band: [170, 190], label: "Take" },
  ]);
  LADDER_READS.forEach(([id, index]) => {
    const label = id + " take " + (index + 1);
    assert.equal(PATH.takeAt(id, index).seconds, null, label);
    assert.equal(PATH.takeAt(id, index, { baseline: steady() }).seconds, null, label);
  });
});

test("every other take keeps its own seconds, with a material or without one", () => {
  const material = materialOn(COLD_READS[0], [140, 160]);
  allPlayIds()
    .filter((id) => !LADDER_PLAYS.includes(id))
    .forEach((id) => {
      PATH.playById(id, { baseline: steady() }).takes.forEach((take, index) => {
        assert.equal(typeof take.seconds, "number", id + " take " + (index + 1));
        const given = PATH.takeAt(id, index, { baseline: steady(), material });
        assert.equal(given.seconds, take.seconds, id + " take " + (index + 1));
      });
    });
  assert.equal(PATH.takeAt("restarts-1", 3, { material }).seconds, 90, "a cold-read retry");
});

// --- Set seconds ------------------------------------------------------------------------------

test("takeAt times a ladder read to its passage: its words at the read's pace, rounded up", () => {
  COLD_READS.forEach((passage) => {
    const material = materialOn(passage, [140, 160]);
    LADDER_READS.forEach(([id, index, wpm]) => {
      const take = plain(PATH.takeAt(id, index, { material }));
      const label = passage.id + ", " + id + " take " + (index + 1);
      assert.equal(take.seconds, Math.ceil((wordCount(passage.text) * 60) / wpm), label);
      assert.deepEqual(take.band, [wpm - 10, wpm + 10], label);
      assert.equal(take.read, true, label);
    });
  });
  // A 164-word cold read takes 66 s at 150 wpm, a 142-word one 57 s.
  const longest = COLD_READS.find((passage) => wordCount(passage.text) === 164);
  const shortest = COLD_READS.find((passage) => wordCount(passage.text) === 142);
  assert.equal(PATH.takeAt("pace-1", 0, { material: longest }).seconds, 66);
  assert.equal(PATH.takeAt("pace-1", 0, { material: shortest }).seconds, 57);
});

test("the seconds follow whichever passage is read, counting words split on whitespace", () => {
  // The 109-word explainer the ladder used to read comes out at the seconds it had.
  const explainer = APP.passages.find((entry) => entry.id === "explainer-rainbows");
  assert.deepEqual(
    LADDER_READS.map(([id, index]) => PATH.takeAt(id, index, { material: explainer }).seconds),
    [44, 44, 44, 44, 47, 41, 47, 41, 37],
  );
  const spaced = { text: "  Read   these words\nas they\tstand.  " };
  assert.equal(PATH.takeAt("pace-1", 0, { material: spaced }).seconds, Math.ceil((6 * 60) / 150));
  assert.equal(PATH.takeAt("pace_crown", 0, { material: spaced }).seconds, 2);
});

test("without a passage's text a ladder read's seconds stay null", () => {
  [undefined, null, {}, { text: "" }, { text: "   " }, { text: 42 }, "a passage"].forEach(
    (material) => {
      LADDER_READS.forEach(([id, index]) => {
        const take = PATH.takeAt(id, index, { material });
        assert.equal(take.seconds, null, JSON.stringify(material) + " " + id);
      });
    },
  );
});

test("a resolved ladder take cannot be changed by a caller", () => {
  const take = PATH.takeAt("pace-2", 1, { material: materialOn(COLD_READS[0], [150, 170]) });
  assert.ok(Object.isFrozen(take) && Object.isFrozen(take.band));
});

// --- The draw ---------------------------------------------------------------------------------

test("every ladder read's material is the cold read pickColdRead draws, at its read's band", () => {
  for (const draw of [0, 0.3, 0.6, 0.99]) {
    const picked = PATH.pickColdRead([], () => draw);
    LADDER_READS.forEach(([id, index, wpm]) => {
      assert.deepEqual(
        plain(PATH.materialFor(id, [], () => draw, index)),
        materialOn(picked, [wpm - 10, wpm + 10]),
        id + " take " + (index + 1) + " at " + draw,
      );
    });
  }
  const history = [readOf(COLD_READ_IDS[0], "2026-10-13T10:00:00.000Z")];
  LADDER_READS.forEach(([id, index]) => {
    const drawn = PATH.materialFor(id, history, () => 0, index);
    assert.equal(drawn.id, PATH.pickColdRead(history, () => 0).id, id);
    assert.equal(drawn.id, COLD_READ_IDS[1], id);
  });
});

test("read 2 never draws read 1's passage while another cold read is unread", () => {
  COLD_READS.forEach((first) => {
    const read1 = readOf(first.id, "2026-10-14T10:00:00.000Z");
    for (const draw of [0, 0.5, 0.999]) {
      for (const [id, index] of [
        ["pace-1", 1],
        ["pace-2", 1],
      ]) {
        const read2 = PATH.materialFor(id, [read1], () => draw, index);
        assert.notEqual(read2.id, first.id, id + " after " + first.id);
        assert.ok(COLD_READ_IDS.includes(read2.id), read2.id);
      }
    }
  });
  // With one cold read left unread, any draw takes it.
  const allButLast = COLD_READS.slice(0, -1).map((passage, index) =>
    readOf(passage.id, "2026-10-13T10:" + String(index).padStart(2, "0") + ":00.000Z"),
  );
  for (const draw of [0, 0.5, 0.999]) {
    assert.equal(PATH.materialFor("pace-1", allButLast, () => draw, 1).id, COLD_READ_IDS.at(-1));
    assert.equal(PATH.materialFor("pace_crown", allButLast, () => draw).id, COLD_READ_IDS.at(-1));
  }
});

test("ladder reads drawn over earlier takes read each cold read once, then the oldest", () => {
  const draws = [0.42, 0.07, 0.93, 0.5, 0.21, 0.999, 0];
  const history = [];
  const drawn = [];
  for (let n = 0; n < COLD_READS.length * 2; n += 1) {
    const [id, index] = LADDER_READS[n % LADDER_READS.length];
    const material = PATH.materialFor(id, history, () => draws[n % draws.length], index);
    drawn.push(material.id);
    history.unshift(readOf(material.id, new Date(Date.UTC(2026, 9, 1, 8, n)).toISOString()));
  }
  const firstRound = drawn.slice(0, COLD_READS.length);
  assert.equal(new Set(firstRound).size, COLD_READS.length, "no repeat until the pool runs out");
  assert.deepEqual(drawn.slice(COLD_READS.length), firstRound, "then the one read longest ago");
});

// --- Judging and copy -------------------------------------------------------------------------

test("evaluate judges a ladder read without its material: read through, in its band", () => {
  const read1 = PATH.evaluate("pace-1", 0, readReport(150, 150), {});
  assert.equal(read1.scored, false);
  const read2 = PATH.evaluate("pace-1", 1, readReport(150, 150), { baseline: steady() });
  assert.equal(read2.passed, true, read2.sentence);
  const fast = PATH.evaluate("pace-1", 1, readReport(150, 175), { baseline: steady() });
  assert.equal(fast.passed, false, fast.sentence);
  const pairFirst = PATH.evaluate("pace-2", 0, readReport(140, 140, [20, 60]), {
    baseline: steady(),
  });
  assert.equal(pairFirst.passed, true, pairFirst.sentence);
  const pairSecond = PATH.evaluate("pace-2", 1, readReport(160, 160), {
    baseline: steady(),
    earlier: [pairFirst],
  });
  assert.equal(pairSecond.passed, true, pairSecond.sentence);
  assert.deepEqual(Array.from(pairSecond.records), ["pace-2"]);
  const crown = PATH.evaluate("pace_crown", 0, readReport(150, 180, [40]), {});
  assert.equal(crown.passed, true, crown.sentence);
  assert.deepEqual(Array.from(crown.records), ["pace_crown-1"]);
});

test("the Goal says each ladder read is of a new passage, and the popover's words stay", () => {
  assert.equal(PATH.playById("pace-1").goal.length, "2 reads of a new passage");
  assert.equal(PATH.playById("pace-2").goal.length, "2 reads of a new passage");
  assert.equal(PATH.playById("pace_crown").goal.length, "One read of a new passage");
  assert.equal(PATH.playById("pace-1").goal.short, "150 wpm, twice");
  assert.equal(PATH.playById("pace-2").goal.short, "140, then 160 wpm");
  LADDER_PLAYS.forEach((id) => {
    const goal = PATH.playById(id).goal;
    assert.ok(!/\d+ s\b/.test(Object.values(goal).join(" ")), id + " shows no seconds");
  });
});
