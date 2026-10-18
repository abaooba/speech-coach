// Tests for the Coach card at the top of Results (frontend/screens/coachcard.js,
// docs/superpowers/specs/2026-10-17-guided-coach-design.md Phase 5 item 7, and the design's
// build notes section 2): the first block after the meta line, drawn at once from the rule
// takeaway and the rule tips, upgraded in place when the coach notes arrive (Claude's headline,
// tips with moment chips that jump to the transcript, the drill, the citation and its badge),
// one tip open at a time, a take bar marking where each tip's moments fall, and the language
// check in its footer. ui.js, sheet.js, delivery.js, coach.js, language.js, tips.js, results.js
// and coachcard.js run for real; app.store, app.api and the document are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = [
  "ui.js",
  "sheet.js",
  "delivery.js",
  "coach.js",
  "language.js",
  "tips.js",
  path.join("screens", "results.js"),
  path.join("screens", "coachcard.js"),
].map((file) => [file, read(file)]);
const CSS = read("styles.css");

// The shared fake element with focus, contains() and a parent link, so the fake document can
// find an element by id anywhere under the root and keep an activeElement.
class FocusElement extends FakeElement {
  constructor(tagName, namespaceURI, page) {
    super(tagName, namespaceURI);
    this.page = page;
    this.parent = null;
  }

  appendChild(child) {
    if (child && typeof child === "object") {
      child.parent = this;
    }
    return super.appendChild(child);
  }

  focus() {
    this.page.focusLog.push(this);
  }

  scrollIntoView(options) {
    this.page.scrolls.push([this, options]);
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }
}

function findById(node, id) {
  if (node.getAttribute && node.getAttribute("id") === id) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

// Words half a second apart, each 0.35 s long; "|" leaves a 5.4 s gap after the word before it.
const TEXT =
  "So this morning I woke up early and, um, I went to the market near my house. I wanted to " +
  "buy the few— the few things for dinner. The seller was very friendly and we talked about the " +
  "weather. Um, after that I take the bus to work, and | the traffic was really bad today. " +
  "Like, it took me almost forty minutes. But I listened a podcast about cooking, so it was okay.";

function yourDay(id, createdAt, overrides) {
  let time = 0;
  const words = [];
  TEXT.split(" ").forEach((token) => {
    if (token === "|") {
      time += 5.4;
      return;
    }
    words.push({ text: token, start: round(time), end: round(time + 0.35) });
    time += 0.5;
  });
  const and = words.findIndex((word, index) => word.text === "and" && words[index + 1].text === "the");
  const restartAt = words.find((word, index) => word.text === "the" && words[index + 1].text === "few—");
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 42,
    metrics: {
      pauses: [[words[and].end, round(words[and + 1].start - words[and].end)]],
      repeats: [{ at: restartAt.start, text: "the few" }],
      fillers: {},
      pace_windows: [],
    },
    transcript: words,
    ...(overrides || {}),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

const OCT = (day, hour) => "2026-10-" + String(day).padStart(2, "0") + "T" + hour + ":00:00Z";
const CURRENT = yourDay("current", OCT(17, "09"));
const EARLIER = yourDay("earlier", OCT(16, "09"));

// The fixture's moments, as app.coach lists them: filler-1 0:04 "um", restart-1 0:10 "the few—
// the few", filler-2 0:19 "um", long-pause-1 0:24 (5.6 s after "and"), filler-3 0:32 "like".
const RULE_HEADLINE =
  "Your longest pause was 5.6 s, at 0:24 after “and”. Finish the thought, then pause.";
const AI_HEADLINE =
  "You restarted “the few— the few” at 0:10. Pause before a sentence instead of starting twice.";

const REPLY = {
  headline: { text: AI_HEADLINE, moment_id: "restart-1" },
  tips: [
    {
      entry_id: "restart-004",
      text: "At 0:10 you said “the few— the few”. Pause silently before the phrase.",
      drill: "Circle every repeated word in a recording, then record those sentences again.",
      citation: {
        label: "Clark & Wasow, Cognitive Psychology, 1998",
        url: "https://example.org/cw",
        type: "peer_reviewed",
      },
      moment_ids: ["restart-1"],
    },
    {
      entry_id: "pause-010",
      text: "Your 5.6 s pause at 0:24 came after “and”. Finish the thought first.",
      drill: "",
      citation: { label: "Andrew Dlugan, Speech Pauses, 2012", url: "https://example.org/d", type: "organization" },
      moment_ids: ["long-pause-1"],
    },
    {
      entry_id: "filler-002",
      text: "Your “um” at 0:04 and 0:19 filled a breath. Close your mouth there.",
      drill: "",
      citation: { label: "A library entry (n.d.)", url: "ftp://nowhere", type: "coach" },
      moment_ids: ["filler-1", "filler-2"],
    },
  ],
  source: "ai",
};

const LANGUAGE_RESULT = {
  status: "ok",
  fixes: [{ said: "I take the bus to work", better: "I took the bus to work", why: "Past tense." }],
  words: [],
  rewrites: [],
  praise: null,
};

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

// Mounts Results. `advice(call)` and `language(call)` answer POST /api/advice and
// /api/language-check with {status, body}; the store keeps flags in a Map.
function mount(sessions, handlers, options) {
  const settings = options || {};
  const replies = handlers || {};
  const calls = { advice: [], language: [], draws: 0 };
  const flags = new Map(settings.flags || []);
  const page = { focusLog: [], scrolls: [], root: null };
  const live = new FocusElement("div", null, page);
  live.setAttribute("id", "live");
  const document = {
    get activeElement() {
      return page.focusLog.length > 0 ? page.focusLog[page.focusLog.length - 1] : null;
    },
    createElement: (tagName) => new FocusElement(tagName, null, page),
    createElementNS: (ns, tagName) => new FocusElement(tagName, ns, page),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => (id === "live" ? live : findById(page.root, id)),
  };
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const passages = [
    { id: "free-talk", kind: "prompt", targetWpm: [140, 160] },
    { id: "explainer", kind: "passage", targetWpm: [140, 160] },
  ];
  const context = {
    app: {
      screens: {},
      passages,
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => Promise.resolve([...newestFirst]),
        getFlag: (key) => Promise.resolve(flags.get(key)),
        setFlag: (key, value) => {
          flags.set(key, value);
          return Promise.resolve();
        },
      },
      api: {
        postJson: (url, body) => {
          const call = { url, body: JSON.parse(JSON.stringify(body)) };
          if (url === "/api/advice") {
            calls.advice.push(call);
            return Promise.resolve(replies.advice ? replies.advice(call) : { status: 0, body: null });
          }
          calls.language.push(call);
          return Promise.resolve(replies.language ? replies.language(call) : { status: 0, body: null });
        },
      },
      router: { go() {} },
    },
    document,
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  if (settings.withoutCoach) {
    delete context.app.coach;
  }
  const root = new FocusElement("section", null, page);
  page.root = root;
  const title = new FocusElement("h1", null, page);
  root.appendChild(title);
  const body = new FocusElement("div", null, page);
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
  return { results, body, calls, flags, app: context.app, focused, live, page, title };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function findAll(node, name, found = []) {
  (node.children || []).forEach((child) => {
    if (child.classList && child.classList.contains(name)) {
      found.push(child);
    }
    findAll(child, name, found);
  });
  return found;
}

function find(node, name) {
  return findAll(node, name)[0];
}

function cardOf(body) {
  const cards = body.children.filter((node) => node.classList.contains("coach-card"));
  assert.equal(cards.length, 1, "exactly one Coach card");
  return cards[0];
}

function tipsOf(card) {
  return byClass(card, "coach-card__tips").children;
}

function outline(node) {
  return node.tagName + "." + node.className;
}

// --- place and outline ---

test("the Coach card is the first block after the meta line; the old headline and Tips are gone", async () => {
  const { results, body } = mount([CURRENT]);
  await results.show({ id: "current" });
  const names = body.children.map(outline);
  assert.deepEqual(names.slice(0, 4), [
    "p.results__meta num",
    "section.coach-card",
    "section.speech-map",
    "div.stat-strip",
  ]);
  assert.ok(!names.includes("section.headline"), "the coach headline takes the old one's place");
  assert.ok(!names.some((name) => name.includes("tip-card")), "no Tips section at the bottom");
  assert.ok(!names.some((name) => name.includes("coach-notes")));
  assert.deepEqual(
    body.children.filter((node) => node.tagName === "h2").map((node) => node.textContent),
    ["Transcript"],
    "the Coach heading lives inside its card",
  );
  assert.equal(names[names.length - 1], "div.results__actions");
});

test("the card is a labelled section with an h2 Coach heading that script can focus", async () => {
  const { results, body } = mount([CURRENT]);
  await results.show({ id: "current" });
  const card = cardOf(body);
  assert.equal(card.tagName, "section");
  assert.equal(card.getAttribute("aria-labelledby"), "coach-title");
  const head = byClass(card, "coach-card__head");
  const heading = head.children[0];
  assert.equal(heading.tagName, "h2");
  assert.equal(heading.className, "results__heading coach-card__title");
  assert.equal(heading.getAttribute("id"), "coach-title");
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(heading.textContent, "Coach");
});

// --- the instant state ---

test("at once: the rule takeaway as the headline, the rule tips, and a status while notes come", async () => {
  const replied = deferred();
  const { results, body } = mount([CURRENT], { advice: () => replied.promise });
  const shown = results.show({ id: "current" });
  await flush();
  const card = cardOf(body);
  const status = byClass(byClass(card, "coach-card__head"), "coach-card__status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(fullText(status), "Writing notes on this take…");
  assert.ok(byClass(status, "spinner"), "a small spinner before the words");
  const headline = byClass(card, "coach-card__headline");
  assert.equal(headline.tagName, "p");
  assert.equal(fullText(headline), RULE_HEADLINE);
  const quote = byClass(headline, "coach-card__quote");
  assert.equal(quote.textContent, "“and”");
  assert.ok(quote.classList.contains("coach-card__quote--pause"), "a pause's words stay plain");
  const tips = tipsOf(card);
  assert.equal(byClass(card, "coach-card__tips").tagName, "ol");
  assert.equal(byClass(card, "coach-card__tips").getAttribute("role"), "list");
  assert.equal(tips.length, 2);
  assert.equal(
    byClass(tips[0], "coach-tip__text").textContent,
    "You are under target pace. Shorten the pauses between ideas.",
  );
  replied.resolve({ status: 0, body: null });
  await shown;
});

test("a rule tip about fillers points at the take's filler moments", async () => {
  const { results, body } = mount([CURRENT]);
  await results.show({ id: "current" });
  const [, fillers] = tipsOf(cardOf(body));
  const row = byClass(fillers, "coach-tip__row");
  assert.equal(fullText(byClass(byClass(row, "coach-tip__lines"), "coach-tip__kind")), "0:04, 0:19 and 0:32 · Filler");
  row.click();
  const open = tipsOf(cardOf(body))[1];
  const chips = findAll(open, "moment-chip");
  assert.deepEqual(chips.map((chip) => chip.getAttribute("aria-label")), [
    "Show 0:04 um in transcript",
    "Show 0:19 um in transcript",
    "Show 0:32 like in transcript",
  ]);
});

test("when the notes fail, the status goes and the rule content stays, with no extra draw", async () => {
  const { results, body, calls } = mount([EARLIER, CURRENT], {
    advice: () => ({ status: 500, body: { detail: "down" } }),
  });
  await results.show({ id: "current" });
  const card = cardOf(body);
  assert.equal(byClass(byClass(card, "coach-card__head"), "coach-card__status"), undefined);
  assert.equal(fullText(byClass(card, "coach-card__headline")), RULE_HEADLINE);
  assert.equal(tipsOf(card).length, 2);
  assert.equal(calls.draws, 2);
});

test("without app.coach the card still draws the rule tips, with no headline", async () => {
  const { results, body } = mount([CURRENT], {}, { withoutCoach: true });
  await results.show({ id: "current" });
  const card = cardOf(body);
  assert.equal(byClass(card, "coach-card__headline"), undefined);
  assert.equal(tipsOf(card).length, 2);
  assert.equal(byClass(card, "coach-card__bar"), undefined, "no moments, no take bar");
});

// --- the notes arrive ---

test("Claude's notes replace the headline and tips in place; the status goes and it is said", async () => {
  const replied = deferred();
  const { results, body, live } = mount([CURRENT], { advice: () => replied.promise });
  const shown = results.show({ id: "current" });
  await flush();
  replied.resolve({ status: 200, body: REPLY });
  await shown;
  const card = cardOf(body);
  assert.equal(byClass(byClass(card, "coach-card__head"), "coach-card__status"), undefined);
  const headline = byClass(card, "coach-card__headline");
  assert.equal(fullText(headline), AI_HEADLINE);
  const quote = byClass(headline, "coach-card__quote");
  assert.equal(quote.textContent, "“the few— the few”");
  assert.ok(quote.classList.contains("coach-card__quote--restart"), "the restart's own mark");
  // The open tip shows its text; a folded one its moments' words.
  const shownText = (tip) =>
    tip.classList.contains("coach-tip--open")
      ? byClass(tip, "coach-tip__text").textContent
      : fullText(find(tip, "coach-tip__words"));
  assert.deepEqual(tipsOf(card).map(shownText), [
    REPLY.tips[0].text,
    "…to work, and 5.6 s the traffic…",
    "um I went to… · um after that I…",
  ]);
  assert.equal(
    byClass(card, "coach-card__by").textContent,
    "Written for this take by Claude, from the research library.",
  );
  assert.equal(live.textContent, "Coach notes ready.");
});

test("the library's own words get their own line", async () => {
  const library = { ...REPLY, source: "library" };
  const { results, body } = mount([CURRENT], { advice: () => ({ status: 200, body: library }) });
  await results.show({ id: "current" });
  assert.equal(
    byClass(cardOf(body), "coach-card__by").textContent,
    "The research library's own words, picked for this take.",
  );
});

test("the open tip: its moment chip, the text, Try this, and the citation with its badge", async () => {
  const { results, body } = mount([CURRENT], { advice: () => ({ status: 200, body: REPLY }) });
  await results.show({ id: "current" });
  const [open, second, third] = tipsOf(cardOf(body));
  assert.equal(open.tagName, "li");
  assert.equal(open.className, "coach-tip coach-tip--open");
  assert.equal(second.className, "coach-tip");
  const chips = byClass(open, "coach-tip__moments").children;
  assert.equal(chips.length, 1);
  assert.equal(chips[0].tagName, "button");
  assert.equal(chips[0].getAttribute("type"), "button");
  assert.equal(chips[0].getAttribute("aria-label"), "Show 0:10 restart in transcript");
  assert.equal(fullText(chips[0]), "0:10 Restart");
  assert.ok(byClass(chips[0], "moment-mark--restart"));
  const drill = byClass(open, "coach-tip__drill");
  assert.equal(byClass(drill, "coach-tip__drill-title").textContent, "Try this");
  assert.equal(byClass(drill, "coach-tip__drill-text").textContent, REPLY.tips[0].drill);
  const cite = byClass(open, "coach-tip__cite");
  const link = cite.children.find((child) => child.tagName === "a");
  assert.equal(link.getAttribute("href"), "https://example.org/cw");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  assert.equal(fullText(link), "Clark & Wasow, Cognitive Psychology, 1998, opens in a new tab");
  const badge = byClass(cite, "badge-peer");
  assert.equal(fullText(badge), "Peer-reviewed");
  assert.equal(badge.children[0].getAttribute("data-icon"), "check");
  assert.equal(byClass(third, "coach-tip__body").getAttribute("hidden"), "", "folded body hidden");
});

test("a folded row names its moments and their words, and controls its hidden body", async () => {
  const { results, body } = mount([CURRENT], { advice: () => ({ status: 200, body: REPLY }) });
  await results.show({ id: "current" });
  const [, pause, fillers] = tipsOf(cardOf(body));
  const row = byClass(pause, "coach-tip__row");
  assert.equal(row.tagName, "button");
  assert.equal(row.getAttribute("type"), "button");
  assert.equal(row.getAttribute("aria-expanded"), "false");
  assert.equal(row.getAttribute("aria-controls"), "coach-tip-2-body");
  assert.equal(byClass(pause, "coach-tip__body").getAttribute("id"), "coach-tip-2-body");
  assert.ok(byClass(row, "moment-mark--long"));
  const lines = byClass(row, "coach-tip__lines");
  assert.equal(fullText(byClass(lines, "coach-tip__kind")), "0:24 Long pause · 5.6 s");
  const words = byClass(lines, "coach-tip__words");
  assert.ok(find(words, "tok--pause-long"), "the pause pill of the transcript");
  const chevron = row.children[row.children.length - 1];
  assert.equal(chevron.getAttribute("data-icon"), "chevron-down");
  const fillerLines = byClass(byClass(fillers, "coach-tip__row"), "coach-tip__lines");
  assert.equal(fullText(byClass(fillerLines, "coach-tip__kind")), "0:04 and 0:19 · Filler");
  assert.equal(findAll(fillerLines, "tok--filler").length, 2);
});

test("tapping a folded row opens that tip, folds the others and focuses its first moment", async () => {
  const { results, body, focused } = mount([CURRENT], { advice: () => ({ status: 200, body: REPLY }) });
  await results.show({ id: "current" });
  byClass(tipsOf(cardOf(body))[2], "coach-tip__row").click();
  const tips = tipsOf(cardOf(body));
  assert.deepEqual(tips.map((tip) => tip.className), ["coach-tip", "coach-tip", "coach-tip coach-tip--open"]);
  assert.equal(byClass(tips[0], "coach-tip__row").getAttribute("aria-expanded"), "false");
  const chips = byClass(tips[2], "coach-tip__moments").children;
  assert.deepEqual(chips.map((chip) => fullText(chip)), ["0:04 um", "0:19 um"]);
  assert.equal(focused(), chips[0], "focus lands on the newly open tip's first moment");
});

test("the take bar marks every tip's moments where they fall, the open tip's ringed", async () => {
  const { results, body } = mount([CURRENT], { advice: () => ({ status: 200, body: REPLY }) });
  await results.show({ id: "current" });
  const bar = byClass(cardOf(body), "coach-card__bar");
  assert.equal(bar.getAttribute("aria-hidden"), "true");
  const marks = byClass(bar, "coach-card__track").children;
  assert.deepEqual(
    marks.map((mark) => [mark.className, mark.getAttribute("style")]),
    [
      ["coach-card__mark coach-card__mark--restart coach-card__mark--open", "left: 25.1%"],
      ["coach-card__mark coach-card__mark--long", "left: 58.4%; width: 13.4%"],
      ["coach-card__mark coach-card__mark--filler", "left: 9.6%"],
      ["coach-card__mark coach-card__mark--filler", "left: 46.7%"],
    ],
  );
  const ends = byClass(bar, "coach-card__ends").children.map((end) => end.textContent);
  assert.deepEqual(ends, ["0:00", "0:41"]);
  byClass(tipsOf(cardOf(body))[1], "coach-tip__row").click();
  const after = byClass(byClass(cardOf(body), "coach-card__bar"), "coach-card__track").children;
  assert.deepEqual(
    after.filter((mark) => mark.classList.contains("coach-card__mark--open")).map((mark) => mark.className),
    ["coach-card__mark coach-card__mark--long coach-card__mark--open"],
  );
});

test("a moment chip shows its moment in the transcript: focus, flash and a spoken note", async () => {
  const { results, body, focused, live } = mount([CURRENT], { advice: () => ({ status: 200, body: REPLY }) });
  await results.show({ id: "current" });
  const chip = byClass(byClass(tipsOf(cardOf(body))[0], "coach-tip__moments"), "moment-chip");
  chip.click();
  const mark = focused();
  assert.equal(mark.textContent, "the", "the restart's second copy, as the speech map marks it");
  assert.ok(mark.classList.contains("tok--restart"));
  assert.ok(mark.classList.contains("tok--shown"));
  assert.equal(live.textContent, "Shown in transcript.");
});

test("focus in the body moves to the Coach heading when the notes redraw it", async () => {
  const replied = deferred();
  const page = mount([EARLIER, CURRENT], { advice: () => replied.promise });
  const shown = page.results.show({ id: "current" });
  await flush();
  byClass(page.body, "results__actions").children[0].focus();
  replied.resolve({ status: 200, body: REPLY });
  await shown;
  const heading = page.focused();
  assert.equal(heading.getAttribute("id"), "coach-title");
  assert.ok(page.body.contains(heading));
});

// --- the language check in the footer ---

test("the footer offers the check on a free-talk take of 20 words or more", async () => {
  const { results, body } = mount([CURRENT]);
  await results.show({ id: "current" });
  const foot = find(cardOf(body), "coach-card__foot");
  const button = byClass(foot, "coach-card__check");
  assert.equal(button.tagName, "button");
  assert.equal(button.className, "btn btn--secondary btn--block coach-card__check");
  assert.equal(fullText(button), "Check grammar & vocabulary");
  assert.equal(button.children[0].getAttribute("data-icon"), "text-check");
  assert.equal(byClass(foot, "coach-card__note").textContent, "Sends your transcript to Anthropic for one check.");
});

test("no check on a Read take or a take under 20 words", async () => {
  const read = yourDay("read", OCT(17, "10"), { passageId: "explainer" });
  const short = yourDay("short", OCT(17, "11"));
  short.transcript = short.transcript.slice(0, 12);
  short.metrics = { pauses: [], repeats: [], fillers: {}, pace_windows: [] };
  const { results, body } = mount([read, short]);
  for (const id of ["read", "short"]) {
    await results.show({ id });
    assert.equal(find(cardOf(body), "coach-card__check"), undefined, id);
    assert.equal(find(cardOf(body), "coach-card__foot"), undefined, id);
  }
});

test("the check: a busy button, then the result in the footer's place, announced and focused", async () => {
  const replied = deferred();
  const { results, body, calls, flags, live, focused } = mount([CURRENT], {
    language: () => replied.promise,
  });
  await results.show({ id: "current" });
  const button = find(cardOf(body), "coach-card__check");
  button.focus();
  button.click();
  await flush();
  const busy = find(cardOf(body), "coach-card__check");
  assert.equal(busy.disabled, true);
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assert.equal(fullText(busy), "Checking grammar & vocabulary…");
  assert.ok(byClass(busy, "spinner"));
  assert.equal(calls.language.length, 1);
  assert.equal(calls.language[0].body.session_id, "current");

  replied.resolve({ status: 200, body: LANGUAGE_RESULT });
  await flush();
  await flush();
  const card = cardOf(body);
  assert.equal(find(card, "coach-card__check"), undefined, "the button gives way to the result");
  const block = find(card, "lang-check");
  assert.ok(block);
  assert.equal(focused(), byClass(block, "lang-check__title"));
  assert.equal(live.textContent, "Grammar & vocabulary ready.");
  assert.ok(flags.has("languageCheck:current"));
});

test("a check that fails says so, and Try again asks again", async () => {
  let reply = { status: 200, body: { status: "unavailable" } };
  const { results, body, calls, live } = mount([CURRENT], { language: () => reply });
  await results.show({ id: "current" });
  find(cardOf(body), "coach-card__check").click();
  await flush();
  await flush();
  const error = find(cardOf(body), "lang-check__error");
  assert.equal(fullText(error), "Couldn't check right now, try again later.");
  assert.equal(error.children[0].getAttribute("data-icon"), "alert");
  assert.equal(live.textContent, "Couldn't check right now, try again later.");
  const retry = find(cardOf(body), "lang-check__retry");
  assert.equal(retry.className, "btn btn--secondary btn--block lang-check__retry");
  assert.equal(fullText(retry), "Try again");
  assert.equal(retry.children[0].getAttribute("data-icon"), "rotate-ccw");
  reply = { status: 200, body: LANGUAGE_RESULT };
  retry.click();
  await flush();
  await flush();
  assert.equal(calls.language.length, 2);
  assert.ok(find(cardOf(body), "lang-check"));
});

test("a kept result is drawn on the next visit with no request and no loading", async () => {
  const flags = [["languageCheck:current", LANGUAGE_RESULT]];
  const { results, body, calls } = mount([CURRENT], {}, { flags });
  await results.show({ id: "current" });
  await flush();
  assert.ok(find(cardOf(body), "lang-check"));
  assert.equal(find(cardOf(body), "coach-card__check"), undefined);
  assert.equal(calls.language.length, 0);
});

test("the result survives the notes' redraw", async () => {
  const replied = deferred();
  const flags = [["languageCheck:current", LANGUAGE_RESULT]];
  const { results, body } = mount([CURRENT], { advice: () => replied.promise }, { flags });
  const shown = results.show({ id: "current" });
  await flush();
  await flush();
  replied.resolve({ status: 200, body: REPLY });
  await shown;
  assert.ok(find(cardOf(body), "lang-check"));
});

test("startLanguageCheck runs the check from outside the card (the sheet's link)", async () => {
  const { results, body, calls } = mount([CURRENT], {
    language: () => ({ status: 200, body: LANGUAGE_RESULT }),
  });
  await results.show({ id: "current" });
  results.startLanguageCheck();
  await flush();
  await flush();
  assert.equal(calls.language.length, 1);
  assert.ok(find(cardOf(body), "lang-check"));
});

// --- styles ---

function ruleFor(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("(?:^|\\})\\s*" + escaped + "\\s*\\{([^}]*)\\}").exec(css);
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("the card is an accent edge with no box, and every control is a 44px target", () => {
  const card = ruleFor(".coach-card");
  assert.match(card, /border-left: 4px solid var\(--accent\)/);
  assert.match(card, /padding-left: var\(--s-4\)/);
  assert.doesNotMatch(card, /background/);
  assert.match(ruleFor(".coach-card__headline"), /font-size: var\(--fs-h2\)/);
  assert.match(ruleFor(".moment-chip"), /min-height: 44px/);
  assert.match(ruleFor(".coach-tip__row"), /min-height: 56px/);
  assert.match(ruleFor(".lang-say__hear"), /min-height: 44px/);
  assert.match(ruleFor(".word-chip"), /min-height: 44px/);
  assert.match(ruleFor(".tok--unclear"), /outline: 1px dotted var\(--muted\)/);
  assert.match(ruleFor(".coach-tip__drill"), /background: var\(--accent-soft\)/);
  assert.match(ruleFor(".badge-peer"), /background: var\(--ok-bg\)/);
});
