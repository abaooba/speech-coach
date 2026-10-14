// Tests for the coach notes half of frontend/tips.js (docs/PLAN.md T41): adviceRequest builds
// the body of POST /api/advice from a take, parseCoachNotes checks the server's reply, and
// coachNotes asks once per take through app.auth.request and keeps the answer in app.store flags.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TIPS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "tips.js"), "utf8");

// A fake app.store that keeps flags in a Map and counts its calls; `failing` makes every call
// reject, as a blocked IndexedDB upgrade does.
function fakeStore(failing) {
  const flags = new Map();
  const store = {
    flags,
    getFlag: (key) =>
      failing ? Promise.reject(new Error("blocked")) : Promise.resolve(flags.get(key)),
    setFlag: (key, value) => {
      if (failing) {
        return Promise.reject(new Error("blocked"));
      }
      flags.set(key, value);
      return Promise.resolve();
    },
  };
  return store;
}

// A fake app.auth whose request() answers `reply` ({status, body}) or rejects, logging each call.
function fakeAuth(reply) {
  const calls = [];
  return {
    calls,
    request: (method, url, body) => {
      calls.push({ method, url, body: JSON.parse(JSON.stringify(body)) });
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
}

function load(extras) {
  const app = { ...(extras || {}) };
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  return app.tips;
}

// The module runs in another realm: compare through JSON so plain objects match.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const SESSION = {
  id: "take-1",
  transcript: [
    { text: "We", start: 0, end: 0.2 },
    { text: "win.", start: 0.2, end: 0.5 },
  ],
};
const REPORT = {
  speakingSeconds: 61.5,
  wordsPerMinute: 148.2,
  fillerCount: 4,
  repeatCount: 1,
  midSentencePauseCount: 2,
  longPauseCount: 0,
};
const BODY = {
  session_id: "take-1",
  summary: {
    duration_seconds: 61.5,
    words_per_minute: 148.2,
    filler_count: 4,
    restart_count: 1,
    mid_sentence_pause_count: 2,
    long_pause_count: 0,
    target_wpm: [140, 160],
    transcript_excerpt: "We win.",
  },
  tier: "Varsity",
  shown_ids: ["a", "b"],
};

const VALID_TIP = {
  entry_id: "filler-001",
  text: "Stay silent where the um would go.",
  drill: "",
  citation: { label: "Lisa B. Marshall, Um (2017)", url: "https://example.org/um", type: "book" },
};
const REPLY = {
  tips: [
    {
      entry_id: "filler-001",
      text: "  Stay silent where the um would go.  ",
      drill: "Read one paragraph aloud.",
      citation: {
        label: "Lisa B. Marshall, Um (2017)",
        url: "https://example.org/um",
        type: "organization",
      },
    },
    {
      entry_id: "pause-002",
      text: "Breathe at the period.",
      citation: { label: "Smith, Pauses (2019)", url: "ftp://bad", type: "peer_reviewed" },
    },
  ],
  source: "ai",
};
const NOTES = {
  tips: [
    {
      entryId: "filler-001",
      text: "Stay silent where the um would go.",
      drill: "Read one paragraph aloud.",
      citation: {
        label: "Lisa B. Marshall, Um (2017)",
        url: "https://example.org/um",
        type: "organization",
      },
    },
    {
      entryId: "pause-002",
      text: "Breathe at the period.",
      drill: "",
      citation: { label: "Smith, Pauses (2019)", url: null, type: "peer_reviewed" },
    },
  ],
  source: "ai",
};

test("tips.js still assigns only app.tips, now with the coach notes functions", () => {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  assert.deepEqual(Object.keys(app), ["tips"]);
  assert.deepEqual(Object.keys(app.tips).sort(), [
    "adviceRequest",
    "coachNotes",
    "parseCoachNotes",
    "select",
  ]);
});

test("adviceRequest builds the exact body of POST /api/advice", () => {
  const tips = load();
  const body = tips.adviceRequest(SESSION, REPORT, [140, 160], "Varsity", ["a", "b"]);
  assert.deepEqual(plain(body), BODY);
});

test("counts are whole and never negative, and a missing field reads 0", () => {
  const tips = load();
  const body = tips.adviceRequest(
    SESSION,
    { fillerCount: 2.6, repeatCount: -1, midSentencePauseCount: "x", speakingSeconds: -5 },
    [140, 160],
    "Novice",
    [],
  );
  assert.deepEqual(plain(body.summary), {
    duration_seconds: 0,
    words_per_minute: 0,
    filler_count: 3,
    restart_count: 0,
    mid_sentence_pause_count: 0,
    long_pause_count: 0,
    target_wpm: [140, 160],
    transcript_excerpt: "We win.",
  });
  const bare = tips.adviceRequest({ id: 7 }, undefined, undefined, undefined, undefined);
  assert.equal(bare.session_id, "7");
  assert.equal(bare.summary.filler_count, 0);
  assert.equal(bare.summary.transcript_excerpt, "");
});

test("the band is left out unless it is [lo, hi] with lo below hi", () => {
  const tips = load();
  for (const targetWpm of [undefined, null, [160, 140], [150, 150], [140], ["a", "b"], "x"]) {
    const body = plain(tips.adviceRequest(SESSION, REPORT, targetWpm, "Novice", []));
    assert.ok(!("target_wpm" in body.summary), "no band for " + JSON.stringify(targetWpm));
  }
  const strings = tips.adviceRequest(SESSION, REPORT, ["130", "150"], "Novice", []);
  assert.deepEqual(plain(strings.summary.target_wpm), [130, 150], "numeric strings are numbers");
});

test("the tier falls back to Novice, and shown ids are the last 2,000 strings", () => {
  const tips = load();
  for (const tier of [undefined, "", "   ", 7, null]) {
    assert.equal(tips.adviceRequest(SESSION, REPORT, null, tier, []).tier, "Novice");
  }
  for (const shownIds of [undefined, null, "not a list", {}]) {
    const body = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", shownIds));
    assert.deepEqual(body.shown_ids, []);
  }
  const mixed = plain(tips.adviceRequest(SESSION, REPORT, null, "Novice", ["a", 1, "b", null]));
  assert.deepEqual(mixed.shown_ids, ["a", "b"]);
  const ids = Array.from({ length: 2005 }, (_, i) => "id-" + i);
  const capped = tips.adviceRequest(SESSION, REPORT, null, "Novice", ids).shown_ids;
  assert.equal(capped.length, 2000);
  assert.equal(capped[0], "id-5");
  assert.equal(capped[1999], "id-2004");
});

test("the excerpt is the words joined by spaces, cut at 1,500, never on half an emoji", () => {
  const tips = load();
  const long = { id: "x", transcript: Array.from({ length: 400 }, () => ({ text: "abcd" })) };
  const excerpt = tips.adviceRequest(long, REPORT, null, "Novice", []).summary.transcript_excerpt;
  assert.equal(excerpt.length, 1500);
  assert.ok(excerpt.startsWith("abcd abcd "));

  // 1,498 letters and a space fill 1,499 characters, so the cut would fall inside the emoji.
  const emoji = { id: "x", transcript: [{ text: "a".repeat(1498) }, { text: "😀x" }] };
  const cut = tips.adviceRequest(emoji, REPORT, null, "Novice", []).summary.transcript_excerpt;
  assert.equal(cut.length, 1499);
  assert.ok(cut.endsWith("a "));

  const whole = { id: "x", transcript: [{ text: "a".repeat(1497) }, { text: "😀x" }] };
  const kept = tips.adviceRequest(whole, REPORT, null, "Novice", []).summary.transcript_excerpt;
  assert.equal(kept.length, 1500, "an emoji that fits whole stays");
  assert.ok(kept.endsWith("😀"));

  for (const transcript of [undefined, null, "words", [null, { text: 5 }, {}]]) {
    const body = tips.adviceRequest({ id: "x", transcript }, REPORT, null, "Novice", []);
    assert.equal(typeof body.summary.transcript_excerpt, "string");
  }
  const odd = tips.adviceRequest({ id: "x", transcript: [null, { text: 5 }, {}] }, REPORT);
  assert.equal(odd.summary.transcript_excerpt, " 5 ");
});

test("parseCoachNotes accepts the server's shape and normalizes each note", () => {
  const tips = load();
  assert.deepEqual(plain(tips.parseCoachNotes(REPLY)), NOTES);
});

test("parseCoachNotes keeps at most three notes, the first three", () => {
  const tips = load();
  const five = Array.from({ length: 5 }, (_, i) => ({ ...VALID_TIP, entry_id: "e" + i }));
  const notes = tips.parseCoachNotes({ tips: five, source: "library" });
  assert.deepEqual(
    notes.tips.map((tip) => tip.entryId),
    ["e0", "e1", "e2"],
  );
  assert.equal(notes.source, "library");
});

test("parseCoachNotes gives null for anything that is not notes", () => {
  const tips = load();
  const bad = [
    null,
    undefined,
    "text",
    42,
    [],
    {},
    { tips: [], source: "ai" },
    { tips: [VALID_TIP] },
    { tips: [VALID_TIP], source: "model" },
    { tips: "none", source: "ai" },
    { tips: [{ ...VALID_TIP, entry_id: "" }], source: "ai" },
    { tips: [{ ...VALID_TIP, entry_id: 3 }], source: "ai" },
    { tips: [{ ...VALID_TIP, text: "   " }], source: "ai" },
    { tips: [{ ...VALID_TIP, text: undefined }], source: "ai" },
    { tips: [{ ...VALID_TIP, citation: null }], source: "ai" },
    { tips: [{ ...VALID_TIP, citation: "Smith" }], source: "ai" },
    {
      tips: [{ ...VALID_TIP, citation: { label: "", url: "https://x.org", type: "book" } }],
      source: "ai",
    },
    { tips: [VALID_TIP, null], source: "library" },
    { tips: [VALID_TIP, { ...VALID_TIP, text: "" }], source: "library" },
  ];
  bad.forEach((reply) => {
    assert.equal(tips.parseCoachNotes(reply), null, "null for " + JSON.stringify(reply));
  });
});

test("a citation keeps only a web url; a missing drill or type reads as empty", () => {
  const tips = load();
  const cases = [
    ["https://example.org/a", "https://example.org/a"],
    ["http://example.org/a", "http://example.org/a"],
    ["HTTPS://EXAMPLE.ORG", "HTTPS://EXAMPLE.ORG"],
    ["javascript:alert(1)", null],
    ["ftp://example.org", null],
    ["//example.org", null],
    ["", null],
    [undefined, null],
    [7, null],
  ];
  cases.forEach(([url, expected]) => {
    const tip = { entry_id: "e", text: "t", citation: { label: " L ", url } };
    const notes = tips.parseCoachNotes({ tips: [tip], source: "ai" });
    assert.deepEqual(plain(notes.tips[0]), {
      entryId: "e",
      text: "t",
      drill: "",
      citation: { label: "L", url: expected, type: "" },
    });
  });
});

test("both pure functions return fresh objects and leave their inputs alone", () => {
  const tips = load();
  const session = JSON.parse(JSON.stringify(SESSION));
  const report = { ...REPORT };
  const shown = ["a", "b"];
  const body = tips.adviceRequest(session, report, [140, 160], "Varsity", shown);
  body.summary.filler_count = 99;
  body.shown_ids.push("z");
  assert.deepEqual(session, SESSION);
  assert.deepEqual(report, REPORT);
  assert.deepEqual(shown, ["a", "b"]);

  const reply = JSON.parse(JSON.stringify(REPLY));
  const notes = tips.parseCoachNotes(reply);
  notes.tips[0].text = "changed";
  notes.tips.pop();
  assert.deepEqual(reply, REPLY);
});

test("coachNotes asks the server once, keeps the reply and records the ids shown", async () => {
  const store = fakeStore(false);
  store.flags.set("coachNotesShown", ["pause-002", "old-1"]);
  const auth = fakeAuth({ status: 200, body: REPLY });
  const tips = load({ store, auth });

  const notes = await tips.coachNotes(SESSION, REPORT, [140, 160], "Varsity");
  assert.deepEqual(plain(notes), NOTES);
  assert.equal(auth.calls.length, 1);
  assert.equal(auth.calls[0].method, "POST");
  assert.equal(auth.calls[0].url, "/api/advice");
  assert.deepEqual(auth.calls[0].body, { ...BODY, shown_ids: ["pause-002", "old-1"] });
  assert.deepEqual(store.flags.get("coachNotes:take-1"), REPLY, "the reply, word for word");
  assert.deepEqual(
    store.flags.get("coachNotesShown"),
    ["old-1", "filler-001", "pause-002"],
    "the ids shown now move to the end, the most recently shown last",
  );
});

test("coachNotes answers from the kept reply without a request", async () => {
  const store = fakeStore(false);
  store.flags.set("coachNotes:take-1", REPLY);
  const auth = fakeAuth({ status: 200, body: { tips: [VALID_TIP], source: "library" } });
  const tips = load({ store, auth });

  const notes = await tips.coachNotes(SESSION, REPORT, [140, 160], "Varsity");
  assert.deepEqual(plain(notes), NOTES);
  assert.equal(auth.calls.length, 0);
});

test("coachNotes gives null and keeps nothing when the server sends no notes", async () => {
  const replies = [
    { status: 0, body: null },
    { status: 500, body: { detail: "down" } },
    { status: 422, body: { detail: [] } },
    { status: 200, body: null },
    { status: 200, body: { tips: [], source: "ai" } },
    { status: 200, body: "<html>" },
    new Error("fetch threw"),
    undefined,
  ];
  for (const reply of replies) {
    const store = fakeStore(false);
    store.flags.set("coachNotesShown", ["old-1"]);
    const auth = fakeAuth(reply);
    const tips = load({ store, auth });
    const notes = await tips.coachNotes(SESSION, REPORT, [140, 160], "Novice");
    assert.equal(notes, null, "null for " + String(reply && reply.status));
    assert.equal(auth.calls.length, 1);
    assert.deepEqual([...store.flags.keys()], ["coachNotesShown"], "nothing new kept");
    assert.deepEqual(store.flags.get("coachNotesShown"), ["old-1"]);
  }
});

test("coachNotes gives null without a store, without auth, or without a take id", async () => {
  const good = { store: fakeStore(false), auth: fakeAuth({ status: 200, body: REPLY }) };
  assert.equal(await load({ auth: good.auth }).coachNotes(SESSION, REPORT), null);
  assert.equal(await load({ store: good.store }).coachNotes(SESSION, REPORT), null);
  assert.equal(await load({ store: {}, auth: good.auth }).coachNotes(SESSION, REPORT), null);
  assert.equal(await load(good).coachNotes({ transcript: [] }, REPORT), null);
  assert.equal(await load(good).coachNotes(null, REPORT), null);
  assert.equal(good.auth.calls.length, 0);
});

test("an unreadable store means no request; one that cannot write still gives notes", async () => {
  const blocked = fakeStore(true);
  const auth = fakeAuth({ status: 200, body: REPLY });
  assert.equal(await load({ store: blocked, auth }).coachNotes(SESSION, REPORT), null);
  assert.equal(auth.calls.length, 0);

  const readOnly = fakeStore(false);
  readOnly.setFlag = () => Promise.reject(new Error("quota"));
  const notes = await load({ store: readOnly, auth }).coachNotes(SESSION, REPORT);
  assert.deepEqual(plain(notes), NOTES);
  assert.equal(auth.calls.length, 1);
});

test("the shown list is capped at 2,000 ids, dropping the oldest", async () => {
  const store = fakeStore(false);
  store.flags.set(
    "coachNotesShown",
    Array.from({ length: 2000 }, (_, i) => "id-" + i),
  );
  const auth = fakeAuth({ status: 200, body: REPLY });
  await load({ store, auth }).coachNotes(SESSION, REPORT, [140, 160], "Novice");
  const shown = store.flags.get("coachNotesShown");
  assert.equal(shown.length, 2000);
  assert.equal(shown[0], "id-2");
  assert.deepEqual(shown.slice(-2), ["filler-001", "pause-002"]);
});
