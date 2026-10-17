// Tests that the guided-coach copy says what the app does (docs/superpowers/specs/
// 2026-10-17-guided-coach-design.md Phase 6): the onboarding promise and privacy lines, and the
// same facts in how.html, the root README, frontend/README.md and DESIGN.md. The sentences below
// are the ones a reader relies on: no account, the grammar check only when tapped, hints never
// counted, the coach's moments going to Anthropic. The older pins stay in onboarding.test.js,
// coach_notes_privacy.test.js and coach_notes_docs.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const REPO_DIR = path.join(FRONTEND_DIR, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const readRepo = (file) => fs.readFileSync(path.join(REPO_DIR, file), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");

const PROMISE = "No account needed. Your takes are saved on your phone, and only there.";
const MAX_WORDS_PER_SENTENCE = 14;

function mountOnboarding() {
  const document = fakeDocument();
  const app = { screens: {}, store: { setFlag: () => Promise.resolve() }, router: { go() {} } };
  const context = { app, document };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read(path.join("screens", "onboarding.js")), context, {
    filename: "onboarding.js",
  });
  const section = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  section.appendChild(body);
  app.screens.onboarding.mount(section);
  return { body, COPY: app.screens.onboarding.COPY };
}

function textOf(node) {
  return (node.textContent || "") + (node.children || []).map(textOf).join("");
}

// how.html as a reader sees it: no tags, no comments, one space between words.
function howText() {
  return flat(
    read("how.html")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

test("the onboarding promise says no account and that takes live on the phone only", () => {
  const { COPY } = mountOnboarding();
  assert.equal(COPY.promiseTitle + " " + COPY.promiseBody, PROMISE);
  assert.equal(COPY.promise, PROMISE);
});

test("the promise card sits right under the lead, with the phone-lock icon", () => {
  const { body, COPY } = mountOnboarding();
  assert.deepEqual(
    body.children.map((child) => child.tagName + "." + child.className),
    [
      "p.onboarding__lead",
      "div.onboarding__promise",
      "ul.onboarding__list",
      "p.onboarding__privacy",
      "button.btn btn--primary btn--block",
    ],
  );
  const card = byClass(body, "onboarding__promise");
  const icon = card.children[0];
  assert.equal(icon.getAttribute("data-icon"), "phone-lock");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  const [title, text] = card.children[1].children;
  assert.equal(title.className, "onboarding__promise-title");
  assert.equal(textOf(title), COPY.promiseTitle);
  assert.equal(text.className, "onboarding__promise-body");
  assert.equal(textOf(text), COPY.promiseBody);
});

test("the onboarding privacy line is the spec's, sentence by sentence", () => {
  const { COPY } = mountOnboarding();
  [
    "Your recording goes to AssemblyAI to be turned into words.",
    "The app then asks AssemblyAI to delete it.",
    "During a Path level, take 1 stays in this phone's memory for replay.",
    "Coach notes send part of your transcript to Anthropic.",
    "They also send the moments the app found.",
    "The grammar check sends your transcript only when you tap it.",
  ].forEach((sentence) => assert.ok(COPY.privacy.includes(sentence), sentence));
  assert.ok(!/stay on this device|stored only/.test(COPY.privacy));
});

test("every onboarding promise and privacy sentence is under 15 words", () => {
  const { COPY } = mountOnboarding();
  for (const text of [COPY.promiseTitle, COPY.promiseBody, COPY.privacy]) {
    text
      .split(/[.?!](?:\s+|$)/)
      .filter((sentence) => sentence.trim() !== "")
      .forEach((sentence) => {
        const words = sentence.trim().split(/\s+/).length;
        assert.ok(words <= MAX_WORDS_PER_SENTENCE, words + " words: " + sentence);
      });
  }
});

test("how.html says the coach sees moments, hints are never counted and the check is opt-in", () => {
  const text = howText();
  [
    "The coach also gets the moments the app found.",
    "Each one is its words, the words around it and its time.",
    "The grammar and vocabulary check is optional.",
    "It sends your transcript to Anthropic only when you tap it.",
    "Dotted boxes mark words the transcriber was unsure of.",
    "They are hints. They never count in a card, a tip, a score or your rank.",
    "Tap a word under Words to check to hear it.",
    "Your device’s built-in voice says it. The app sends nothing.",
    "There is no account and no sign-in.",
    "Takes are saved in this browser on your phone.",
    "Clearing site data deletes them. There is no backup.",
  ].forEach((sentence) => assert.ok(text.includes(sentence), sentence));
});

test("how.html's new sentences are short and have no exclamation mark", () => {
  const text = howText();
  const start = text.indexOf("The coach also gets the moments");
  assert.ok(start !== -1);
  const sentences = text
    .slice(start, start + 1200)
    .split(/(?<=[.?])\s+/)
    .slice(0, 6);
  sentences.forEach((sentence) => {
    assert.ok(!sentence.includes("!"));
    assert.ok(sentence.split(" ").length < 15, sentence);
  });
});

test("the root README Privacy section covers moments, the grammar check and no account", () => {
  const readme = flat(readRepo("README.md"));
  const start = readme.indexOf("## Privacy");
  const privacy = readme.slice(start, readme.indexOf("## AI disclosure"));
  [
    "the moments the app found",
    "the server passes all of it to Anthropic",
    "`POST /api/language-check`",
    "only when you tap",
    "up to 8,000 characters",
    "There is no account and no sign-in.",
    "Clearing the browser's site data deletes them",
    "There is no backup.",
    "never counted",
  ].forEach((phrase) => assert.ok(privacy.includes(phrase), phrase));
  assert.ok(!privacy.includes("stored only in IndexedDB"));
});

test("frontend/README.md describes the sheet, the moments and the hints", () => {
  const readme = flat(read("README.md"));
  [
    "app.sheet",
    "Words to check",
    "hint",
    "never counted",
    "only when the speaker taps",
  ].forEach((phrase) => assert.ok(readme.includes(phrase), phrase));
});

test("DESIGN.md documents the sheet, the Coach card, .tok--unclear and word confidence", () => {
  const design = flat(read("DESIGN.md"));
  [
    "**Sheet** `.sheet`",
    "**Coach card** `.coach-card`",
    "**Unclear word** `.tok--unclear`",
    "{text, start, end, confidence?}",
    "`--shadow-sheet`",
    "`--r-sheet`",
    "`--scrim`",
    "one exception to one primary button per screen",
    "`phone-lock`",
    "**Onboarding promise** `.onboarding__promise`",
  ].forEach((phrase) => assert.ok(design.includes(phrase), phrase));
});
