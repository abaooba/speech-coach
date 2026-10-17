// Tests for the moments half of frontend/tips.js (guided coach, spec Phase 5 item 3):
// adviceRequest sends the take's moments (cut to the server's caps) and caps the shown ids so the
// body always fits the 64,000-byte limit; parseCoachNotes reads the reply's headline and each
// tip's moment_ids; coachNotes sends the moments app.coach finds for the take.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { loadCoach, spoken, plain } = require("./coach-harness");

const FRONTEND_DIR = path.join(__dirname, "..");
const TIPS_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "tips.js"), "utf8");
const BODY_LIMIT_BYTES = 64000;

function loadTips(extras) {
  const app = { ...(extras || {}) };
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  return app.tips;
}

const SESSION = { id: "take-1", transcript: [{ text: "We", start: 0, end: 0.2 }] };
const REPORT = { speakingSeconds: 61.5, wordsPerMinute: 148.2, fillerCount: 1 };

function moment(kind, number, extra) {
  return {
    id: kind + "-" + number,
    kind,
    at: number,
    clock: "0:0" + (number % 10),
    seconds: null,
    text: "um",
    before: "so I",
    after: "think that",
    expected: null,
    hint: false,
    ...extra,
  };
}

const VALID_TIP = {
  entry_id: "filler-001",
  text: "Stay silent where the um would go.",
  drill: "",
  citation: { label: "Lisa B. Marshall, Um (2017)", url: "https://example.org/um", type: "book" },
};

// --- adviceRequest ---

test("without moments the body has no moments key; an empty list is sent as []", () => {
  const tips = loadTips();
  assert.ok(!("moments" in plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", []))));
  const clean = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], []));
  assert.deepEqual(clean.moments, []);
});

test("moments go in as given, in the server's field order and shape", () => {
  const tips = loadTips();
  const list = [moment("filler", 1), moment("long-pause", 1, { seconds: 5.4, text: "" })];
  const body = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], list));
  assert.deepEqual(body.moments, list);
  assert.deepEqual(Object.keys(body.moments[0]).sort(), [
    "after", "at", "before", "clock", "expected", "hint", "id", "kind", "seconds", "text",
  ]);
});

test("text fields are cut to 120, 60 and 40 characters, keeping the near side of the context", () => {
  const tips = loadTips();
  const long = moment("misread", 1, {
    text: "t".repeat(200),
    before: "a".repeat(30) + "b".repeat(60),
    after: "c".repeat(60) + "d".repeat(30),
    expected: "e".repeat(90),
  });
  const [sent] = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], [long])).moments;
  assert.equal(sent.text.length, 120);
  assert.equal(sent.before, "b".repeat(60));
  assert.equal(sent.after, "c".repeat(60));
  assert.equal(sent.expected.length, 40);
});

test("a cut never leaves half an emoji", () => {
  const tips = loadTips();
  const emoji = moment("filler", 1, { text: "😀".repeat(70) });
  const [sent] = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], [emoji])).moments;
  assert.equal(Array.from(sent.text).length, 70);
  assert.doesNotMatch(sent.text, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.equal(sent.text.length, 140);
});

test("at most 40 moments are sent, the first 40; a bad moment is left out", () => {
  const tips = loadTips();
  const many = Array.from({ length: 45 }, (_, i) => moment("filler", i + 1));
  const sent = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], many)).moments;
  assert.equal(sent.length, 40);
  assert.equal(sent[39].id, "filler-40");
  const bad = [
    moment("filler", 1),
    { ...moment("filler", 2), id: "pause-2" },
    { ...moment("filler", 3), id: "filler-1000" },
    { ...moment("filler", 4), clock: "0:75" },
    { ...moment("filler", 5), kind: "debate" },
    { ...moment("filler", 6), at: -1 },
    null,
    "x",
    moment("filler", 1),
  ];
  const kept = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], bad)).moments;
  assert.deepEqual(kept.map((m) => m.id), ["filler-1"], "each id once, invalid ones dropped");
});

test("seconds and expected are numbers or null; hint is a boolean", () => {
  const tips = loadTips();
  const odd = moment("pause", 1, { seconds: "3", expected: 4, hint: "yes", text: undefined });
  const [sent] = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", [], [odd])).moments;
  assert.equal(sent.seconds, null);
  assert.equal(sent.expected, null);
  assert.equal(sent.hint, false);
  assert.equal(sent.text, "");
});

test("40 full moments plus the capped shown ids fit the 64,000-byte limit", () => {
  const tips = loadTips();
  // The widest text JSON can hold per character short of an escape: 3 bytes in UTF-8.
  const wide = (n) => "字".repeat(n);
  const full = Array.from({ length: 40 }, (_, i) =>
    moment("misread", i + 1, {
      text: wide(120),
      before: wide(60),
      after: wide(60),
      expected: wide(40),
      seconds: 1234.5,
    }),
  );
  const longTranscript = { id: "x".repeat(100), transcript: [{ text: wide(1500) }] };
  const ids = Array.from({ length: 3000 }, (_, i) => "library-" + String(i).padStart(3, "0"));
  const body = tips.adviceRequest(longTranscript, REPORT, [140, 160], "Intermediate", ids, full);
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  assert.ok(bytes < BODY_LIMIT_BYTES, "body is " + bytes + " bytes");
  assert.equal(body.moments.length, 40);
  assert.equal(body.shown_ids.length, 600);
  assert.equal(body.shown_ids[599], "library-2999", "the newest ids are kept");
});

// --- parseCoachNotes ---

test("a reply with no headline gives headline null and empty momentIds", () => {
  const tips = loadTips();
  const notes = plain(tips.parseCoachNotes({ headline: null, tips: [VALID_TIP], source: "library" }));
  assert.equal(notes.headline, null);
  assert.deepEqual(notes.tips[0].momentIds, []);
  const older = plain(tips.parseCoachNotes({ tips: [VALID_TIP], source: "ai" }));
  assert.equal(older.headline, null);
});

test("the headline and each tip's moment_ids are read", () => {
  const tips = loadTips();
  const reply = {
    headline: { text: "  You restarted “the few— the few” at 0:32.  ", moment_id: "restart-1" },
    tips: [
      { ...VALID_TIP, moment_ids: ["restart-1", "filler-2"] },
      { ...VALID_TIP, entry_id: "pause-002", moment_ids: [] },
    ],
    source: "ai",
  };
  const notes = plain(tips.parseCoachNotes(reply));
  assert.deepEqual(notes.headline, {
    text: "You restarted “the few— the few” at 0:32.",
    momentId: "restart-1",
  });
  assert.deepEqual(notes.tips[0].momentIds, ["restart-1", "filler-2"]);
  assert.deepEqual(notes.tips[1].momentIds, []);
});

test("a malformed headline or moment_ids are dropped, not fatal", () => {
  const tips = loadTips();
  const odd = tips.parseCoachNotes({
    headline: { text: "   ", moment_id: "restart-1" },
    tips: [{ ...VALID_TIP, moment_ids: "restart-1" }, { ...VALID_TIP, moment_ids: ["a", 3, "b"] }],
    source: "ai",
  });
  assert.equal(odd.headline, null);
  assert.deepEqual(plain(odd.tips[0].momentIds), []);
  assert.deepEqual(plain(odd.tips[1].momentIds), ["a", "b"]);
  for (const headline of ["text", 5, [], { text: 5 }]) {
    assert.equal(tips.parseCoachNotes({ headline, tips: [VALID_TIP], source: "ai" }).headline, null);
  }
  const noId = tips.parseCoachNotes({ headline: { text: "Good pace." }, tips: [VALID_TIP], source: "ai" });
  assert.deepEqual(plain(noId.headline), { text: "Good pace.", momentId: null });
});

// --- coachNotes ---

function fakeStore() {
  const flags = new Map();
  return {
    getFlag: (key) => Promise.resolve(flags.get(key)),
    setFlag: (key, value) => {
      flags.set(key, value);
      return Promise.resolve();
    },
  };
}

function recordingApi(body) {
  const calls = [];
  return {
    calls,
    postJson: (url, sent) => {
      calls.push({ url, body: JSON.parse(JSON.stringify(sent)) });
      return Promise.resolve({ status: 200, body });
    },
  };
}

test("coachNotes sends the moments app.coach finds for the take", async () => {
  const coachApp = loadCoach();
  const words = spoken("we think um that we should go", 0);
  const report = coachApp.delivery.analyze(words, {});
  const api = recordingApi({ headline: null, tips: [VALID_TIP], source: "library" });
  const tips = loadTips({ store: fakeStore(), api, coach: coachApp.coach });
  const session = { id: "t1", transcript: words };
  const notes = await tips.coachNotes(session, report, [140, 160], "Novice");
  assert.equal(notes.source, "library");
  assert.equal(api.calls.length, 1);
  const sent = api.calls[0].body.moments;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, "filler-1");
  assert.equal(sent[0].text, "um");
});

test("a clean take sends an empty moments list", async () => {
  const coachApp = loadCoach();
  const words = spoken("we should go to the market today", 0);
  const report = coachApp.delivery.analyze(words, {});
  const api = recordingApi({ headline: null, tips: [VALID_TIP], source: "library" });
  const tips = loadTips({ store: fakeStore(), api, coach: coachApp.coach });
  await tips.coachNotes({ id: "t2", transcript: words }, report, null, "Novice");
  assert.deepEqual(api.calls[0].body.moments, []);
});

test("without app.coach the request has no moments and still works", async () => {
  const api = recordingApi({ tips: [VALID_TIP], source: "library" });
  const tips = loadTips({ store: fakeStore(), api });
  const notes = await tips.coachNotes(SESSION, REPORT, null, "Novice");
  assert.equal(notes.source, "library");
  assert.ok(!("moments" in api.calls[0].body));
});

test("if app.coach throws, the notes are still asked for, without moments", async () => {
  const api = recordingApi({ tips: [VALID_TIP], source: "library" });
  const coach = { coachMoments: () => { throw new Error("boom"); } };
  const tips = loadTips({ store: fakeStore(), api, coach });
  const notes = await tips.coachNotes(SESSION, REPORT, null, "Novice");
  assert.equal(notes.source, "library");
  assert.ok(!("moments" in api.calls[0].body));
});
