// Tests for frontend/language.js (app.language), the opt-in grammar and vocabulary check of one
// take (docs/superpowers/specs/2026-10-17-guided-coach-design.md Phase 4): which takes get the
// button, the request body, how the reply is checked, the one request per take kept in the
// store flag languageCheck:<id>, the word-level diff that marks a fix's changed words, and the
// "Grammar & vocabulary" block drawn from a result. ui.js, delivery.js and language.js run for
// real in a vm; app.store, app.api, speechSynthesis and the document are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const DELIVERY_SOURCE = read("delivery.js");
const LANGUAGE_SOURCE = read("language.js");

const PASSAGES = [
  { id: "free-talk", kind: "prompt", targetWpm: [140, 160] },
  { id: "explainer", kind: "passage", targetWpm: [140, 160] },
];
const COLD_READS = [{ id: "cold-1", kind: "passage", targetWpm: [140, 160] }];
const RETIRED = [{ id: "congress-speech", kind: "passage", targetWpm: [130, 150] }];

function fakeStore(failing) {
  const flags = new Map();
  return {
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
}

// Answers every postJson call with `reply` ({status, body}), or rejects with it when it is an
// Error, logging each call.
function fakeApi(reply) {
  const calls = [];
  return {
    calls,
    postJson: (url, body) => {
      calls.push({ url, body: JSON.parse(JSON.stringify(body)) });
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
}

// A fake speechSynthesis that logs cancel() and speak(), and the utterance constructor.
function fakeSpeech() {
  const log = [];
  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
    }
  }
  const synth = {
    cancel: () => log.push(["cancel"]),
    speak: (utterance) =>
      log.push(["speak", utterance.text, utterance.lang, utterance.rate]),
  };
  return { log, synth, Utterance };
}

function load(options) {
  const settings = options || {};
  const passages = PASSAGES.map((entry) => ({ ...entry }));
  passages.coldReads = () => COLD_READS.map((entry) => ({ ...entry }));
  passages.benchmark = () => ({
    read: { id: "benchmark-read", kind: "passage" },
    talk: { id: "benchmark-talk", kind: "prompt" },
  });
  passages.retired = () => RETIRED.map((entry) => ({ ...entry }));
  const context = {
    app: {
      screens: {},
      passages,
      store: settings.store,
      api: settings.api,
    },
    document: fakeDocument(),
  };
  if (settings.speech) {
    context.speechSynthesis = settings.speech.synth;
    context.SpeechSynthesisUtterance = settings.speech.Utterance;
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(LANGUAGE_SOURCE, context, { filename: "language.js" });
  return context.app;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
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

function words(texts) {
  return texts.map((text, index) => ({ text, start: index * 0.4, end: index * 0.4 + 0.3 }));
}

const TWENTY = "I went to the market near my house and I wanted to buy a few things for dinner"
  .split(" ")
  .concat(["tonight", "again"]);

function take(overrides) {
  return {
    id: "take-1",
    passageId: "free-talk",
    metrics: { pauses: [] },
    transcript: words(TWENTY),
    ...(overrides || {}),
  };
}

const OK_REPLY = {
  status: "ok",
  fixes: [
    { said: "I take the bus to work", better: "I took the bus to work", why: "Past tense." },
    { said: "I listened a podcast", better: "I listened to a podcast", why: "Listen to it." },
  ],
  words: [{ said: "very friendly", options: ["warm", "welcoming", "cheerful"] }],
  rewrites: [{ said: "after that I take the bus", better: "After that I took the bus." }],
  praise: null,
};

// --- which takes get the button ---

test("a free-talk take of 20 words or more can be checked", () => {
  const { language } = load();
  assert.equal(TWENTY.length, 20);
  assert.equal(language.canCheck(take()), true);
});

test("a take under 20 words, or with only fillers making up the 20, cannot", () => {
  const { language } = load();
  assert.equal(language.canCheck(take({ transcript: words(TWENTY.slice(0, 19)) })), false);
  const padded = words(TWENTY.slice(0, 18).concat(["um", "uh", "um"]));
  assert.equal(language.canCheck(take({ transcript: padded })), false, "um and uh are not words");
});

test("a Read take cannot: a passage, a cold read, the benchmark read, a retired passage", () => {
  const { language } = load();
  for (const passageId of ["explainer", "cold-1", "benchmark-read", "congress-speech"]) {
    assert.equal(language.canCheck(take({ passageId })), false, passageId);
  }
  assert.equal(language.canCheck(take({ passageId: "benchmark-talk" })), true);
  assert.equal(language.canCheck(take({ passageId: "unknown-id" })), true, "unknown is talk");
});

test("a take that followed a script (metrics.script) cannot, whatever its passage", () => {
  const { language } = load();
  const scripted = take({ metrics: { pauses: [], script: { misread: [], skipped: [] } } });
  assert.equal(language.canCheck(scripted), false);
});

test("no take, no id or no words cannot", () => {
  const { language } = load();
  assert.equal(language.canCheck(null), false);
  assert.equal(language.canCheck(undefined), false);
  assert.equal(language.canCheck(take({ id: "" })), false);
  assert.equal(language.canCheck(take({ transcript: [] })), false);
  assert.equal(language.canCheck(take({ transcript: "words" })), false);
});

// --- the request ---

test("the request body is the take's id and its words joined by spaces", () => {
  const { language } = load();
  const body = plain(language.requestBody(take()));
  assert.deepEqual(Object.keys(body), ["session_id", "transcript"]);
  assert.equal(body.session_id, "take-1");
  assert.equal(body.transcript, TWENTY.join(" "));
});

test("the transcript drops NUL and is cut at 8,000 characters, never half an emoji", () => {
  const { language } = load();
  const nul = take({ transcript: [{ text: "we\u0000win", start: 0, end: 1 }] });
  assert.equal(language.requestBody(nul).transcript, "wewin");
  const long = Array.from({ length: 3000 }, (_, index) => ({ text: "word", start: index }));
  assert.equal(Array.from(language.requestBody(take({ transcript: long })).transcript).length, 8000);
  const emoji = [{ text: "a".repeat(7999) + "😀😀", start: 0, end: 1 }];
  const cut = language.requestBody(take({ transcript: emoji })).transcript;
  assert.equal(Array.from(cut).length, 8000);
  assert.ok(cut.endsWith("😀"), "a whole emoji, never one half of it");
});

// --- the reply ---

test("parse keeps an ok reply in the shape the card draws", () => {
  const { language } = load();
  assert.deepEqual(plain(language.parse(OK_REPLY)), OK_REPLY);
});

test("parse gives null for an unavailable reply or one that is not a check", () => {
  const { language } = load();
  for (const reply of [
    { status: "unavailable" },
    null,
    "ok",
    [],
    { status: "ok", fixes: "none" },
    { status: "ok", words: {} },
    { status: "ok", rewrites: 3 },
  ]) {
    assert.equal(language.parse(reply), null, JSON.stringify(reply));
  }
});

test("parse fills missing lists, drops broken items and keeps the caps", () => {
  const { language } = load();
  const parsed = plain(
    language.parse({
      status: "ok",
      fixes: [
        { said: "  ", better: "x", why: "y" },
        { said: "a", better: "b" },
        { said: "c", better: "d", why: 7 },
        { said: "e", better: "f", why: "g" },
        { said: "h", better: "i", why: "j" },
        "fix",
      ],
      words: [
        { said: "good", options: ["great", "", 4, "fine", "solid", "neat"] },
        { said: "bad", options: [] },
        { said: "nice", options: ["kind"] },
        { said: "big", options: ["large"] },
      ],
      praise: "  Clear.  ",
    }),
  );
  assert.deepEqual(parsed.fixes, [
    { said: "a", better: "b", why: "" },
    { said: "c", better: "d", why: "" },
    { said: "e", better: "f", why: "g" },
  ]);
  assert.deepEqual(parsed.words, [
    { said: "good", options: ["great", "fine", "solid"] },
    { said: "nice", options: ["kind"] },
  ]);
  assert.deepEqual(parsed.rewrites, []);
  assert.equal(parsed.praise, "Clear.");
  assert.equal(language.parse({ status: "ok", praise: 3 }).praise, null);
});

// --- one request per take, kept ---

test("check posts once, keeps the result under languageCheck:<id> and reopening asks nothing", async () => {
  const store = fakeStore();
  const api = fakeApi({ status: 200, body: OK_REPLY });
  const { language } = load({ store, api });
  const first = await language.check(take());
  assert.deepEqual(plain(first), OK_REPLY);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].url, "/api/language-check");
  assert.deepEqual(api.calls[0].body, { session_id: "take-1", transcript: TWENTY.join(" ") });
  assert.deepEqual(plain(store.flags.get("languageCheck:take-1")), OK_REPLY);

  const again = await language.check(take());
  assert.deepEqual(plain(again), OK_REPLY);
  assert.equal(api.calls.length, 1, "the kept result, no second request");
  assert.deepEqual(plain(await language.cached(take())), OK_REPLY);
});

test("two checks of one take at once share one request", async () => {
  const store = fakeStore();
  const api = fakeApi({ status: 200, body: OK_REPLY });
  const { language } = load({ store, api });
  const [a, b] = await Promise.all([language.check(take()), language.check(take())]);
  assert.equal(api.calls.length, 1);
  assert.deepEqual(plain(a), plain(b));
});

test("an unavailable, failed or broken reply is unavailable and nothing is kept", async () => {
  for (const reply of [
    { status: 200, body: { status: "unavailable" } },
    { status: 0, body: null },
    { status: 400, body: { detail: "too long" } },
    { status: 200, body: "<html>" },
    new Error("network"),
  ]) {
    const store = fakeStore();
    const api = fakeApi(reply);
    const { language } = load({ store, api });
    const result = await language.check(take());
    assert.deepEqual(plain(result), { status: "unavailable" });
    assert.equal(store.flags.size, 0, "a failure is never kept, so Try again asks again");
    await language.check(take());
    assert.equal(api.calls.length, 2, "and the next check asks again");
  }
});

test("a store that cannot be read still checks, and a result it cannot keep is still shown", async () => {
  const store = fakeStore(true);
  const api = fakeApi({ status: 200, body: OK_REPLY });
  const { language } = load({ store, api });
  assert.deepEqual(plain(await language.check(take())), OK_REPLY);
  assert.equal(await language.cached(take()), null);
});

test("without app.api or app.store, or for a take that cannot be checked, nothing is asked", async () => {
  const api = fakeApi({ status: 200, body: OK_REPLY });
  const noStore = load({ api });
  assert.deepEqual(plain(await noStore.language.check(take())), { status: "unavailable" });
  const noApi = load({ store: fakeStore() });
  assert.deepEqual(plain(await noApi.language.check(take())), { status: "unavailable" });
  const both = load({ store: fakeStore(), api });
  const short = take({ transcript: words(TWENTY.slice(0, 5)) });
  assert.deepEqual(plain(await both.language.check(short)), { status: "unavailable" });
  assert.equal(api.calls.length, 0);
  assert.equal(await both.language.cached(null), null);
});

test("a kept flag that is not a result is ignored and the take is asked about", async () => {
  const store = fakeStore();
  store.flags.set("languageCheck:take-1", { status: "unavailable" });
  const api = fakeApi({ status: 200, body: OK_REPLY });
  const { language } = load({ store, api });
  assert.equal(await language.cached(take()), null);
  await language.check(take());
  assert.equal(api.calls.length, 1);
});

// --- the changed words of a fix ---

test("changedWords marks the words of `better` that `said` lacks, in runs", () => {
  const { language } = load();
  assert.deepEqual(plain(language.changedWords("I take the bus to work", "I took the bus to work")), [
    { text: "I", changed: false },
    { text: "took", changed: true },
    { text: "the bus to work", changed: false },
  ]);
  assert.deepEqual(plain(language.changedWords("I listened a podcast", "I listened to a podcast")), [
    { text: "I listened", changed: false },
    { text: "to", changed: true },
    { text: "a podcast", changed: false },
  ]);
  assert.deepEqual(plain(language.changedWords("buy the few things", "buy a few things")), [
    { text: "buy", changed: false },
    { text: "a", changed: true },
    { text: "few things", changed: false },
  ]);
});

test("changedWords compares without case or punctuation and copes with nothing", () => {
  const { language } = load();
  assert.deepEqual(plain(language.changedWords("so, it was okay", "So it was okay.")), [
    { text: "So it was okay.", changed: false },
  ]);
  assert.deepEqual(plain(language.changedWords("", "All new words")), [
    { text: "All new words", changed: true },
  ]);
  assert.deepEqual(plain(language.changedWords("x", "")), []);
});

// --- the block ---

test("build draws the title, one block per non-empty list and the note", () => {
  const { language } = load({ speech: fakeSpeech() });
  const block = language.build(language.parse(OK_REPLY));
  assert.equal(block.className, "lang-check");
  const title = byClass(block, "lang-check__title");
  assert.equal(title.tagName, "h3");
  assert.equal(title.textContent, "Grammar & vocabulary");
  assert.equal(title.getAttribute("tabindex"), "-1", "focus can land here, Tab never stops");
  const blocks = block.children.filter((child) => child.classList.contains("lang-block"));
  assert.deepEqual(
    blocks.map((part) => fullText(byClass(part, "lang-block__label"))),
    ["Grammar2", "Stronger words", "Say it better"],
    "only Grammar carries a count",
  );
  assert.equal(byClass(byClass(blocks[0], "lang-block__label"), "lang-block__count").textContent, "2");
  const note = block.children[block.children.length - 1];
  assert.equal(note.className, "lang-check__note");
  assert.equal(note.textContent, "Checked by Anthropic. Hints only: nothing here changes your score.");
  assert.equal(byClass(block, "lang-check__praise"), undefined, "praise only when nothing to fix");
});

test("a fix reads 'You said', the old words, an arrow, 'Better', the new with marks, then why", () => {
  const { language } = load();
  const block = language.build(language.parse(OK_REPLY));
  const fix = findAll(block, "lang-fix")[0];
  const line = byClass(fix, "lang-fix__line");
  assert.equal(line.tagName, "p");
  const said = byClass(line, "lang-fix__said");
  assert.equal(fullText(said), "You said: I take the bus to work");
  assert.equal(byClass(said, "sr-only").textContent, "You said: ");
  const arrow = line.children.find((child) => child.tagName === "svg");
  assert.equal(arrow.getAttribute("aria-hidden"), "true");
  const better = byClass(line, "lang-fix__better");
  assert.equal(fullText(better), "Better: I took the bus to work");
  const marks = better.children.filter((child) => child.tagName === "mark");
  assert.deepEqual(marks.map((mark) => [mark.className, mark.textContent]), [
    ["lang-fix__hl", "took"],
  ]);
  assert.equal(byClass(fix, "lang-fix__why").textContent, "Past tense.");
});

test("stronger words show the said phrase and its options as plain pills", () => {
  const { language } = load();
  const block = language.build(language.parse(OK_REPLY));
  const row = findAll(block, "lang-word")[0];
  assert.equal(byClass(row, "lang-word__said").textContent, "very friendly");
  assert.deepEqual(
    row.children.filter((child) => child.classList.contains("lang-pill")).map((pill) => [
      pill.tagName,
      pill.textContent,
    ]),
    [
      ["span", "warm"],
      ["span", "welcoming"],
      ["span", "cheerful"],
    ],
    "pills are not buttons",
  );
});

test("Say it better shows the sentence as said and the rewrite, and nothing else", () => {
  // The "Hear it" button that used to follow the rewrite is gone (owner's report of
  // 2026-10-18: it stayed silent on iPhone), with or without a voice on the phone.
  const speech = fakeSpeech();
  const { language } = load({ speech });
  const block = language.build(language.parse(OK_REPLY));
  const say = findAll(block, "lang-say")[0];
  assert.deepEqual(
    say.children.map((child) => [child.tagName, child.className]),
    [
      ["p", "lang-say__orig"],
      ["p", "lang-say__better"],
    ],
  );
  assert.equal(byClass(say, "lang-say__orig").textContent, "after that I take the bus");
  assert.equal(byClass(say, "lang-say__better").textContent, "After that I took the bus.");
  assert.equal(fullText(say).includes("Hear it"), false);
  assert.deepEqual(speech.log, [], "nothing is spoken");
});

test("without speechSynthesis Say it better draws the same two lines", () => {
  const { language } = load();
  const block = language.build(language.parse(OK_REPLY));
  const say = findAll(block, "lang-say")[0];
  assert.deepEqual(
    say.children.map((child) => child.className),
    ["lang-say__orig", "lang-say__better"],
  );
});

test("nothing to fix shows the praise, or the fallback line, and the note", () => {
  const { language } = load();
  const praised = language.build(language.parse({ status: "ok", praise: "Clear and natural." }));
  const praise = byClass(praised, "lang-check__praise");
  assert.equal(fullText(praise), "Clear and natural.");
  assert.equal(praise.children[0].getAttribute("data-icon"), "check");
  assert.equal(findAll(praised, "lang-block").length, 0);

  const empty = language.build(language.parse({ status: "ok" }));
  assert.equal(
    fullText(byClass(empty, "lang-check__praise")),
    "Clear and correct. Nothing to fix in this take.",
  );
  assert.ok(byClass(empty, "lang-check__note"));
});

test("language.js assigns app.language only and loads before any store or api exists", async () => {
  const context = { app: {} };
  vm.runInNewContext(LANGUAGE_SOURCE, context, { filename: "language.js" });
  assert.deepEqual(Object.keys(context.app), ["language"]);
  assert.deepEqual(plain(await context.app.language.check(take())), { status: "unavailable" });
  await flush();
});
