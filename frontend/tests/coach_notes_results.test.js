// Tests for the coach notes on Results (docs/PLAN.md T41): the rule tips are drawn at once, the
// cited notes from POST /api/advice take their place when they arrive, a failed request keeps
// the tips, a slow reply never paints over a newer take, and the request names the speaker's
// tier. ui.js, delivery.js, tips.js and results.js run for real; app.store, app.auth and the
// document are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);
const RANK_SOURCE = read("rank.js");

const PASSAGES = [{ id: "gettysburg", targetWpm: [130, 150] }];
const OCT = (day, hour) => "2026-10-" + String(day).padStart(2, "0") + "T" + hour + ":00:00Z";

const REPLY = {
  tips: [
    {
      entry_id: "filler-001",
      text: "Stay silent where the um would go.",
      drill: "Read one paragraph aloud and pause at each comma.",
      citation: {
        label: "Lisa B. Marshall, Um, How Do I Stop (2017)",
        url: "https://example.org/um",
        type: "organization",
      },
    },
    {
      entry_id: "pause-002",
      text: "Breathe at the period, not inside the sentence.",
      drill: "",
      citation: {
        label: "Smith and Lee, Pausing (2019)",
        url: "https://example.org/p",
        type: "peer_reviewed",
      },
    },
    {
      entry_id: "general-003",
      text: "Know how your next point opens.",
      drill: "",
      citation: { label: "A Debate Coach, Openings (n.d.)", url: "ftp://nowhere", type: "coach" },
    },
  ],
  source: "ai",
};

// A take of `count` half-second words, every index in `ums` an "um", on the Gettysburg band.
function takeOf(id, createdAt, count, ums) {
  return {
    id,
    createdAt,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: count * 0.5,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: (ums || []).includes(index) ? "um" : "word",
      start: index * 0.5,
      end: (index + 1) * 0.5,
    })),
  };
}

// A promise with its settle handles, to hold a reply open.
function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Mounts Results against the fakes. store.get serves `sessions` by id, store.list returns them
// newest first and counts its calls, flags live in a Map, and auth.request hands each call to
// `reply(call)` for its {status, body}. `withRank` loads rank.js too. `calls.draws` counts the
// times the take is drawn: every draw empties the body and starts again with the meta line.
function mount(sessions, reply, options) {
  const settings = options || {};
  const calls = { lists: 0, requests: [], draws: 0 };
  const flags = new Map(settings.flags || []);
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => {
          calls.lists += 1;
          return Promise.resolve([...newestFirst]);
        },
        getFlag: (key) => Promise.resolve(flags.get(key)),
        setFlag: (key, value) => {
          flags.set(key, value);
          return Promise.resolve();
        },
      },
      auth: {
        request: (method, url, body) => {
          const call = { method, url, body: JSON.parse(JSON.stringify(body)) };
          calls.requests.push(call);
          return reply(call);
        },
      },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  if (settings.withRank) {
    vm.runInNewContext(RANK_SOURCE, context, { filename: "rank.js" });
  }
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  const append = body.appendChild.bind(body);
  body.appendChild = (child) => {
    if (child.classList && child.classList.contains("results__meta")) {
      calls.draws += 1;
    }
    return append(child);
  };
  root.appendChild(body);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body, calls, flags, app: context.app };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

// The section headings that are direct children of the body: Transcript, then Tips or Coach
// notes. The timeline's heading sits inside its own section.
function headingsOf(body) {
  return body.children.filter((node) => node.tagName === "h2").map((node) => node.textContent);
}

function cardsOf(body) {
  return body.children.filter((node) => node.classList.contains("tip-card"));
}

const CURRENT = takeOf("current", OCT(10, "10"), 40, [2, 5, 9]);
const EARLIER = takeOf("earlier", OCT(9, "10"), 40, [1, 2, 3, 4]);

test("the tips are drawn at once and the coach notes take their place on arrival", async () => {
  const replied = deferred();
  const { results, body, calls } = mount([EARLIER, CURRENT], () => replied.promise);
  const shown = results.show({ id: "current" });
  await flush();
  assert.deepEqual(headingsOf(body), ["Transcript", "Tips"]);
  assert.ok(cardsOf(body).length >= 1, "the rule tips show while the notes are on their way");

  replied.resolve({ status: 200, body: REPLY });
  await shown;
  assert.deepEqual(headingsOf(body), ["Transcript", "Coach notes"]);
  assert.equal(
    byClass(body, "coach-notes__lead").textContent,
    "Written for this take by Claude, from the research library.",
  );
  assert.equal(calls.lists, 1, "one list serves the last take and the tier");
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.requests[0].method, "POST");
  assert.equal(calls.requests[0].url, "/api/advice");

  const cards = cardsOf(body);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((card) => byClass(card, "tip-card__text").textContent),
    REPLY.tips.map((tip) => tip.text),
  );
  assert.ok(byClass(cards[0], "tip-card__text").tagName === "p");

  const drill = byClass(cards[0], "tip-card__drill");
  assert.equal(fullText(drill), "Drill: Read one paragraph aloud and pause at each comma.");
  assert.equal(byClass(drill, "tip-card__drill-label").textContent, "Drill:");
  assert.equal(byClass(cards[1], "tip-card__drill"), undefined, "no drill line without a drill");

  const source = byClass(cards[0], "tip-card__source");
  assert.equal(source.children[0].textContent, "Source:");
  const link = byClass(source, "tip-card__link");
  assert.equal(link.tagName, "a");
  assert.equal(link.getAttribute("href"), "https://example.org/um");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  assert.equal(link.textContent, "Lisa B. Marshall, Um, How Do I Stop (2017)");
  assert.equal(fullText(link), "Lisa B. Marshall, Um, How Do I Stop (2017), opens in a new tab");
  assert.equal(byClass(source, "tip-card__badge"), undefined, "no badge for an organization");

  const reviewed = byClass(cards[1], "tip-card__source");
  assert.equal(byClass(reviewed, "tip-card__badge").textContent, "Peer reviewed");
  assert.equal(byClass(reviewed, "tip-card__link").getAttribute("href"), "https://example.org/p");

  const unlinked = byClass(cards[2], "tip-card__source");
  assert.equal(byClass(unlinked, "tip-card__link"), undefined, "an ftp url is not a link");
  assert.equal(unlinked.children[1].tagName, "span");
  assert.equal(unlinked.children[1].textContent, "A Debate Coach, Openings (n.d.)");
  assert.equal(byClass(unlinked, "tip-card__badge"), undefined);

  const last = body.children[body.children.length - 1];
  assert.ok(last.classList.contains("results__actions"), "the action bar still ends the page");
});

test("the request carries the take's numbers, band, shown ids and a Novice tier", async () => {
  const flags = [["coachNotesShown", ["seen-1", "seen-2"]]];
  const { results, calls } = mount([EARLIER, CURRENT], () => ({ status: 200, body: REPLY }), {
    flags,
  });
  await results.show({ id: "current" });
  const [{ body }] = calls.requests;
  assert.equal(body.session_id, "current");
  assert.equal(body.tier, "Novice", "rank.js is not loaded, so the server's default tier");
  assert.deepEqual(body.shown_ids, ["seen-1", "seen-2"]);
  assert.deepEqual(body.summary.target_wpm, [130, 150]);
  assert.equal(body.summary.duration_seconds, 20, "40 half-second words");
  assert.equal(body.summary.filler_count, 3);
  assert.equal(body.summary.restart_count, 0);
  assert.equal(body.summary.mid_sentence_pause_count, 0);
  assert.equal(body.summary.long_pause_count, 0);
  assert.equal(body.summary.words_per_minute, 111, "37 words in 20 seconds; ums are not words");
  assert.ok(body.summary.transcript_excerpt.startsWith("word word um word"));
});

test("with rank.js loaded the request names the speaker's tier from their takes", async () => {
  const clean = Array.from({ length: 10 }, (_, i) => takeOf("t" + i, OCT(1 + i, "10"), 360));
  const { results, calls } = mount(clean, () => ({ status: 200, body: REPLY }), {
    withRank: true,
  });
  await results.show({ id: "t9" });
  assert.equal(calls.lists, 1);
  assert.equal(
    calls.requests[0].body.tier,
    "Master",
    "ten clean three-minute takes at 120 wpm, 10 under the band: 98 points each, a 98 rating",
  );
});

test("a sample is listed too, for the tier, and asks for notes like any take", async () => {
  const sample = { ...takeOf("sample", OCT(11, "10"), 40, [2]), passageTitle: "Sample: Congress" };
  const { results, body, calls } = mount([EARLIER, sample], () => ({ status: 200, body: REPLY }));
  await results.show({ id: "sample" });
  assert.equal(calls.lists, 1);
  assert.equal(calls.requests.length, 1);
  assert.equal(byClass(body, "metric-grid__note"), undefined, "a sample compares with nothing");
  assert.ok(headingsOf(body).includes("Coach notes"));
});

test("the library's own words get their own lead", async () => {
  const library = { ...REPLY, source: "library" };
  const { results, body } = mount([CURRENT], () => ({ status: 200, body: library }));
  await results.show({ id: "current" });
  assert.equal(
    byClass(body, "coach-notes__lead").textContent,
    "The research library's own words, picked for this take.",
  );
});

test("a failed or empty request keeps the tips and draws the take twice at most", async () => {
  for (const reply of [
    { status: 0, body: null },
    { status: 500, body: { detail: "down" } },
    { status: 200, body: { tips: [], source: "ai" } },
    { status: 200, body: "<html>" },
  ]) {
    const { results, body, calls } = mount([EARLIER, CURRENT], () => reply);
    await results.show({ id: "current" });
    assert.equal(calls.requests.length, 1);
    assert.deepEqual(headingsOf(body), ["Transcript", "Tips"]);
    assert.equal(byClass(body, "coach-notes__lead"), undefined);
    assert.ok(byClass(body, "metric-grid__note"), "the comparison with the last take still drew");
    assert.equal(calls.draws, 2, "the take at once, then with the comparison; no third draw");
  }
});

test("notes that arrive draw the take a third time, after the comparison", async () => {
  const { results, calls } = mount([EARLIER, CURRENT], () => ({ status: 200, body: REPLY }));
  await results.show({ id: "current" });
  assert.equal(calls.draws, 3);

  const alone = mount([CURRENT], () => ({ status: 200, body: REPLY }));
  await alone.results.show({ id: "current" });
  assert.equal(alone.calls.draws, 2, "with no last take there is no comparison draw");
});

test("notes kept from an earlier visit show without a request", async () => {
  const flags = [["coachNotes:current", REPLY]];
  const { results, body, calls } = mount([CURRENT], () => ({ status: 0, body: null }), { flags });
  await results.show({ id: "current" });
  assert.equal(calls.requests.length, 0);
  assert.deepEqual(headingsOf(body), ["Transcript", "Coach notes"]);
  assert.equal(cardsOf(body).length, 3);
});

test("the reply is kept and the ids shown are recorded for the next take", async () => {
  const { results, flags } = mount([CURRENT], () => ({ status: 200, body: REPLY }));
  await results.show({ id: "current" });
  assert.deepEqual(flags.get("coachNotes:current"), REPLY);
  assert.deepEqual(JSON.parse(JSON.stringify(flags.get("coachNotesShown"))), [
    "filler-001",
    "pause-002",
    "general-003",
  ]);
});

test("the library's own words are not kept: reopening the take asks again", async () => {
  const library = { ...REPLY, source: "library" };
  const { results, body, calls, flags } = mount([CURRENT], () => ({
    status: 200,
    body: library,
  }));
  await results.show({ id: "current" });
  assert.deepEqual(headingsOf(body), ["Transcript", "Coach notes"]);
  assert.equal(flags.get("coachNotes:current"), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(flags.get("coachNotesShown"))), [
    "filler-001",
    "pause-002",
    "general-003",
  ]);

  await results.show({ id: "current" });
  assert.equal(calls.requests.length, 2);
  assert.deepEqual(calls.requests[1].body.shown_ids, ["filler-001", "pause-002", "general-003"]);
});

test("a slow reply from an earlier visit never draws over a newer take", async () => {
  const slow = deferred();
  const replies = { current: () => slow.promise, earlier: () => ({ status: 0, body: null }) };
  const { results, body, calls } = mount([EARLIER, CURRENT], (call) =>
    replies[call.body.session_id](),
  );
  const first = results.show({ id: "current" });
  await flush();
  await results.show({ id: "earlier" });
  assert.deepEqual(headingsOf(body), ["Transcript", "Tips"]);
  const pace = fullText(byClass(byClass(body, "metric-grid").children[0], "metric-card__value"));

  slow.resolve({ status: 200, body: REPLY });
  await first;
  assert.deepEqual(headingsOf(body), ["Transcript", "Tips"]);
  const after = fullText(byClass(byClass(body, "metric-grid").children[0], "metric-card__value"));
  assert.equal(after, pace, "the earlier take is still the one shown");
  assert.equal(calls.requests.length, 2);
});

test("a take the speaker leaves before its list arrives asks for no notes", async () => {
  const { results, calls, app } = mount([EARLIER, CURRENT], () => ({ status: 200, body: REPLY }));
  const listed = deferred();
  app.store.list = () => {
    calls.lists += 1;
    return listed.promise;
  };
  const left = results.show({ id: "current" });
  await flush();
  app.store.list = () => Promise.resolve([EARLIER, CURRENT]);
  await results.show({ id: "earlier" });
  listed.resolve([EARLIER, CURRENT]);
  await left;
  assert.deepEqual(
    calls.requests.map((call) => call.body.session_id),
    ["earlier"],
    "only the take still shown asked for notes",
  );
});

test("without tips.js's coachNotes, or without auth, the screen keeps the tips", async () => {
  const bare = mount([CURRENT], () => ({ status: 200, body: REPLY }));
  delete bare.app.tips.coachNotes;
  await bare.results.show({ id: "current" });
  assert.deepEqual(headingsOf(bare.body), ["Transcript", "Tips"]);

  const guestless = mount([CURRENT], () => ({ status: 200, body: REPLY }));
  delete guestless.app.auth;
  await guestless.results.show({ id: "current" });
  assert.deepEqual(headingsOf(guestless.body), ["Transcript", "Tips"]);
  assert.equal(guestless.calls.requests.length, 0);
});
