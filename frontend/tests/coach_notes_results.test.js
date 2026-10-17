// Tests for the coach notes on Results (docs/PLAN.md T41): the rule tips are drawn at once in
// the Coach card, the cited notes from POST /api/advice take their place there when they arrive
// (guided-coach owner decision 2026-10-17: the card at the top replaced the Tips and Coach notes
// sections), a failed request keeps the tips, a slow reply never paints over a newer take, the
// request names the speaker's tier, and the notes' arrival keeps keyboard focus and is
// announced. ui.js, delivery.js, tips.js, results.js and coachcard.js run for real; app.store,
// app.api and the document are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");

// The shared fake element, extended here as practice_revamp.test.js extends it: it takes
// focus(), logging it, and answers contains() for itself and anything below it.
class FocusElement extends FakeElement {
  constructor(tagName, namespaceURI, focusLog) {
    super(tagName, namespaceURI);
    this.focusLog = focusLog;
  }

  focus() {
    this.focusLog.push(this);
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }
}

// The document of the shared fake DOM with focus: its activeElement is the element focused
// last (null before any focus() call), and getElementById finds the #live region that
// app.ui.announce writes.
function focusDocument(focusLog, live) {
  return {
    get activeElement() {
      return focusLog.length > 0 ? focusLog[focusLog.length - 1] : null;
    },
    createElement: (tagName) => new FocusElement(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new FocusElement(tagName, namespaceURI, focusLog),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => (id === "live" ? live : null),
  };
}

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = [
  "ui.js",
  "delivery.js",
  "tips.js",
  path.join("screens", "results.js"),
  path.join("screens", "coachcard.js"),
].map((file) => [file, read(file)]);
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
// newest first and counts its calls, flags live in a Map, and api.postJson hands each call to
// `reply(call)` for its {status, body}. `withRank` loads rank.js too. `calls.draws` counts the
// times the take is drawn: every draw empties the body and starts again with the meta line.
// The section holds the screen's h1 above the body, as index.html does; `focused()` reads the
// document's activeElement and `live` is the live region.
function mount(sessions, reply, options) {
  const settings = options || {};
  const calls = { lists: 0, requests: [], draws: 0 };
  const flags = new Map(settings.flags || []);
  const focusLog = [];
  const live = new FakeElement("div");
  const document = focusDocument(focusLog, live);
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
      api: {
        postJson: (url, body) => {
          const call = { method: "POST", url, body: JSON.parse(JSON.stringify(body)) };
          calls.requests.push(call);
          return reply(call);
        },
      },
      router: { go() {} },
    },
    document,
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  if (settings.withRank) {
    vm.runInNewContext(RANK_SOURCE, context, { filename: "rank.js" });
  }
  const root = new FocusElement("section", null, focusLog);
  const title = new FocusElement("h1", null, focusLog);
  title.textContent = "Results";
  root.appendChild(title);
  const body = new FocusElement("div", null, focusLog);
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
  const focused = () => document.activeElement;
  return { results, title, body, calls, flags, app: context.app, focused, live };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

// The Coach card at the top of the body (exactly one).
function cardOf(body) {
  const cards = body.children.filter((node) => node.classList.contains("coach-card"));
  assert.equal(cards.length, 1, "exactly one Coach card");
  return cards[0];
}

// True once the coach notes are in the card: their by-line says who wrote them. While the rule
// tips show, the card has no by-line.
function notesShown(body) {
  return Boolean(byClass(cardOf(body), "coach-card__by"));
}

// The card's tips, rule tips or notes: one li each.
function tipsOf(body) {
  const list = byClass(cardOf(body), "coach-card__tips");
  return list ? list.children : [];
}

// Where a tip's own parts are: the open tip itself, or a folded tip's hidden body.
function partsOf(tip) {
  return tip.classList.contains("coach-tip--open") ? tip : byClass(tip, "coach-tip__body");
}

const CURRENT = takeOf("current", OCT(10, "10"), 40, [2, 5, 9]);
const EARLIER = takeOf("earlier", OCT(9, "10"), 40, [1, 2, 3, 4]);

test("the tips are drawn at once and the coach notes take their place on arrival", async () => {
  const replied = deferred();
  const { results, body, calls } = mount([EARLIER, CURRENT], () => replied.promise);
  const shown = results.show({ id: "current" });
  await flush();
  assert.equal(notesShown(body), false);
  assert.ok(tipsOf(body).length >= 1, "the rule tips show while the notes are on their way");

  replied.resolve({ status: 200, body: REPLY });
  await shown;
  assert.equal(notesShown(body), true);
  assert.equal(
    byClass(cardOf(body), "coach-card__by").textContent,
    "Written for this take by Claude, from the research library.",
  );
  assert.equal(calls.lists, 1, "one list serves the last take and the tier");
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.requests[0].method, "POST");
  assert.equal(calls.requests[0].url, "/api/advice");

  const list = byClass(cardOf(body), "coach-card__tips");
  assert.equal(list.tagName, "ol", "one list holds every note");
  assert.equal(list.getAttribute("role"), "list", "Safari drops a list's role with its style");
  const notes = tipsOf(body);
  assert.equal(notes.length, 3, "the notes, and no rule tip left");
  notes.forEach((note) => {
    assert.equal(note.tagName, "li");
    assert.ok(note.classList.contains("coach-tip"));
  });
  const parts = notes.map(partsOf);
  assert.deepEqual(
    parts.map((part) => byClass(part, "coach-tip__text").textContent),
    REPLY.tips.map((tip) => tip.text),
  );
  assert.equal(byClass(parts[0], "coach-tip__text").tagName, "p");

  const drill = byClass(parts[0], "coach-tip__drill");
  assert.equal(byClass(drill, "coach-tip__drill-title").textContent, "Try this");
  assert.equal(
    byClass(drill, "coach-tip__drill-text").textContent,
    "Read one paragraph aloud and pause at each comma.",
  );
  assert.equal(byClass(parts[1], "coach-tip__drill"), undefined, "no drill block without one");

  const source = byClass(parts[0], "coach-tip__cite");
  assert.equal(source.tagName, "p");
  const link = source.children[0];
  assert.equal(link.tagName, "a");
  assert.equal(link.getAttribute("href"), "https://example.org/um");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  assert.equal(link.textContent, "Lisa B. Marshall, Um, How Do I Stop (2017)");
  // The hidden new-tab note sits inside the <a>, so it is part of the link's accessible name.
  assert.equal(
    fullText(link),
    "Lisa B. Marshall, Um, How Do I Stop (2017), opens in a new tab",
    "the new-tab note is inside the link",
  );
  assert.equal(byClass(source, "badge-peer"), undefined, "no pill for an organization");

  const reviewed = byClass(parts[1], "coach-tip__cite");
  assert.equal(
    fullText(reviewed),
    "Smith and Lee, Pausing (2019), opens in a new tabPeer-reviewed",
    "the pill comes after the link",
  );
  assert.equal(fullText(byClass(reviewed, "badge-peer")), "Peer-reviewed");
  assert.equal(reviewed.children[0].getAttribute("href"), "https://example.org/p");

  const unlinked = byClass(parts[2], "coach-tip__cite");
  assert.ok(!unlinked.children.some((child) => child.tagName === "a"), "an ftp url is not a link");
  assert.equal(fullText(unlinked), "A Debate Coach, Openings (n.d.)");
  assert.equal(byClass(unlinked, "badge-peer"), undefined);

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
  assert.equal(byClass(body, "stat-strip__note"), undefined, "a sample compares with nothing");
  assert.equal(notesShown(body), true);
});

test("the library's own words get their own lead", async () => {
  const library = { ...REPLY, source: "library" };
  const { results, body } = mount([CURRENT], () => ({ status: 200, body: library }));
  await results.show({ id: "current" });
  assert.equal(
    byClass(cardOf(body), "coach-card__by").textContent,
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
    assert.equal(notesShown(body), false);
    assert.ok(byClass(body, "stat-strip__note"), "the comparison with the last take still drew");
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
  assert.equal(notesShown(body), true);
  assert.equal(tipsOf(body).length, 3);
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
  assert.equal(notesShown(body), true);
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
  assert.equal(notesShown(body), false);
  const pace = fullText(byClass(byClass(body, "stat-strip").children[0], "stat__value"));

  slow.resolve({ status: 200, body: REPLY });
  await first;
  assert.equal(notesShown(body), false);
  const after = fullText(byClass(byClass(body, "stat-strip").children[0], "stat__value"));
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

test("without tips.js's coachNotes, or without app.api, the screen keeps the tips", async () => {
  const bare = mount([CURRENT], () => ({ status: 200, body: REPLY }));
  delete bare.app.tips.coachNotes;
  await bare.results.show({ id: "current" });
  assert.equal(notesShown(bare.body), false);

  const guestless = mount([CURRENT], () => ({ status: 200, body: REPLY }));
  delete guestless.app.api;
  await guestless.results.show({ id: "current" });
  assert.equal(notesShown(guestless.body), false);
  assert.equal(guestless.calls.requests.length, 0);
});

// The History button of the action bar now in the body: a control the third draw replaces.
function historyButton(body) {
  return byClass(body, "results__actions").children[0];
}

test("focus in the body moves to the Coach heading, and the notes are announced", async () => {
  const replied = deferred();
  const page = mount([EARLIER, CURRENT], () => replied.promise);
  const shown = page.results.show({ id: "current" });
  await flush();
  historyButton(page.body).focus();
  assert.equal(page.live.textContent, "");

  replied.resolve({ status: 200, body: REPLY });
  await shown;
  const heading = page.focused();
  assert.equal(heading.tagName, "h2");
  assert.equal(heading.textContent, "Coach");
  assert.equal(heading.getAttribute("tabindex"), "-1", "focusable, never a Tab stop");
  assert.ok(page.body.contains(heading), "the heading the third draw put in the body");
  assert.equal(page.live.textContent, "Coach notes ready.");
});

test("focus outside the body stays put, and the notes are announced all the same", async () => {
  // The router leaves focus on the h1 after a screen change; a page just opened has none.
  for (const focusTitle of [true, false]) {
    const replied = deferred();
    const page = mount([EARLIER, CURRENT], () => replied.promise);
    const shown = page.results.show({ id: "current" });
    if (focusTitle) {
      page.title.focus();
    }
    await flush();
    replied.resolve({ status: 200, body: REPLY });
    await shown;
    assert.equal(page.focused(), focusTitle ? page.title : null);
    assert.equal(notesShown(page.body), true);
    assert.equal(page.live.textContent, "Coach notes ready.");
  }
});

test("notes kept from an earlier visit are announced as they replace the tips", async () => {
  const flags = [["coachNotes:current", REPLY]];
  const page = mount([CURRENT], () => ({ status: 0, body: null }), { flags });
  await page.results.show({ id: "current" });
  assert.equal(page.live.textContent, "Coach notes ready.");
});

test("no notes, no announcement, and focus stays on its control", async () => {
  const replied = deferred();
  const page = mount([EARLIER, CURRENT], () => replied.promise);
  const shown = page.results.show({ id: "current" });
  await flush();
  const button = historyButton(page.body);
  button.focus();

  replied.resolve({ status: 500, body: { detail: "down" } });
  await shown;
  assert.equal(page.focused(), button);
  assert.ok(page.body.contains(button), "the tips' draw is still the one shown");
  assert.equal(page.live.textContent, "");
});

test("notes that arrive after the speaker left Results draw nothing and say nothing", async () => {
  const replied = deferred();
  const page = mount([EARLIER, CURRENT], () => replied.promise);
  const shown = page.results.show({ id: "current" });
  await flush();
  page.results.hide();

  replied.resolve({ status: 200, body: REPLY });
  await shown;
  assert.equal(page.calls.draws, 2, "the hidden screen is not drawn again");
  assert.equal(notesShown(page.body), false);
  assert.equal(page.live.textContent, "", "nothing is announced over another screen");

  await page.results.show({ id: "current" });
  assert.equal(page.calls.requests.length, 1, "Claude's notes were kept while the speaker was away");
  assert.equal(notesShown(page.body), true);
  assert.equal(page.live.textContent, "Coach notes ready.");
});
