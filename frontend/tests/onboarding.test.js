// Tests for the Onboarding screen (frontend/screens/onboarding.js). It loads with no document to
// check its copy against DESIGN.md section 8, then mounts against the shared fake DOM with the
// real ui.js; index.html and styles.css are read as text. The boot gate in app.js that opens
// this screen on a first launch is covered in app_onboarding_gate.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const ONBOARDING_SOURCE = fs.readFileSync(
  path.join(FRONTEND_DIR, "screens", "onboarding.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "ui.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(FRONTEND_DIR, "styles.css"), "utf8");

// "Under 15 words a sentence" (DESIGN.md section 8).
const MAX_WORDS_PER_SENTENCE = 14;

// Loads onboarding.js the way the copy checks need it: no document, empty app helpers.
function loadBare() {
  const context = { app: { screens: {}, ui: {}, store: {}, router: {} } };
  vm.runInNewContext(ONBOARDING_SOURCE, context, { filename: "onboarding.js" });
  return context.app.screens.onboarding;
}

// Every string in COPY: the lead, the three list items, the privacy line and the button.
function copyStrings(copy) {
  return [copy.lead, ...copy.items, copy.privacy, copy.button];
}

// A sentence ends at ".", "?" or "!" followed by a space or the end, so "1.5" stays one word.
function sentencesOf(text) {
  return text
    .split(/[.?!](?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(sentence) {
  return sentence.split(/\s+/).filter(Boolean).length;
}

// Loads ui.js then onboarding.js against the fake document and mounts the screen into a fake
// <section> holding its h1 and an empty .screen__body, as index.html does. The store and the
// router record every call in `calls`; setFlag answers with `setFlagResult()`.
function mountOnboarding({ setFlagResult = () => Promise.resolve() } = {}) {
  const document = fakeDocument();
  const calls = [];
  const app = {
    screens: {},
    store: {
      setFlag: (key, value) => {
        calls.push("setFlag " + key + " " + value);
        return setFlagResult();
      },
    },
    router: { go: (name) => calls.push("go " + name) },
  };
  const context = { app, document };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(ONBOARDING_SOURCE, context, { filename: "onboarding.js" });
  const section = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Speech Coach";
  const body = new FakeElement("div");
  body.className = "screen__body";
  section.appendChild(heading);
  section.appendChild(body);
  const screen = app.screens.onboarding;
  screen.mount(section);
  return { screen, section, body, calls };
}

// Text of a fake node: its own text plus its children's, in order.
function textOf(node) {
  const own = node.textContent || "";
  return own + (node.children || []).map(textOf).join("");
}

// Lets every queued promise callback run.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// A promise with its resolve handle, to hold an await open.
function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

test("onboarding.js loads with no document and registers mount, show, hide and COPY", () => {
  const screen = loadBare();
  assert.equal(typeof screen.mount, "function");
  assert.equal(typeof screen.show, "function");
  assert.equal(typeof screen.hide, "function");
  assert.equal(typeof screen.COPY.lead, "string");
  assert.equal(screen.COPY.items.length, 3);
  screen.COPY.items.forEach((item) => assert.equal(typeof item, "string"));
  assert.equal(typeof screen.COPY.privacy, "string");
  assert.equal(typeof screen.COPY.button, "string");
});

test("the copy is the brief's wording", () => {
  const { COPY } = loadBare();
  assert.equal(
    COPY.lead,
    "Record a practice speech. Get your pace, pauses and filler words in seconds.",
  );
  assert.deepEqual(
    [...COPY.items],
    [
      "Words per minute against a target range",
      "Pauses over 1.5 seconds and filler words like um",
      "A chart of every session on this phone",
    ],
  );
  assert.equal(
    COPY.privacy,
    "Audio is deleted right after analysis. Transcripts stay on this device.",
  );
  assert.equal(COPY.button, "Start practicing");
});

test("the privacy line says audio is deleted and transcripts stay on the device", () => {
  const { COPY } = loadBare();
  assert.match(COPY.privacy, /deleted/);
  assert.match(COPY.privacy, /device/);
});

test("every sentence in every COPY string is under 15 words", () => {
  const { COPY } = loadBare();
  for (const text of copyStrings(COPY)) {
    const sentences = sentencesOf(text);
    assert.ok(sentences.length > 0, JSON.stringify(text) + " has no sentence");
    for (const sentence of sentences) {
      assert.ok(
        wordCount(sentence) <= MAX_WORDS_PER_SENTENCE,
        JSON.stringify(sentence) + " has " + wordCount(sentence) + " words",
      );
    }
  }
});

test("the sentence check counts 1.5 as one word and splits on full stops", () => {
  assert.deepEqual(sentencesOf("Pauses over 1.5 seconds. Then stop."), [
    "Pauses over 1.5 seconds",
    "Then stop",
  ]);
  assert.equal(wordCount("Pauses over 1.5 seconds"), 4);
});

test("no COPY string contains an exclamation mark", () => {
  const { COPY } = loadBare();
  for (const text of copyStrings(COPY)) {
    assert.ok(!text.includes("!"), JSON.stringify(text));
  }
});

test("mount builds the lead, the list, the privacy line and the button in the body", () => {
  const { screen, section, body } = mountOnboarding();
  const { COPY } = screen;
  assert.equal(section.children.length, 2, "the h1 and the body stay the section's children");
  assert.deepEqual(
    body.children.map((child) => child.tagName + "." + child.className),
    [
      "p.onboarding__lead",
      "ul.onboarding__list",
      "p.onboarding__privacy",
      "button.btn btn--primary btn--block",
    ],
  );
  const [lead, list, privacy, button] = body.children;
  assert.equal(textOf(lead), COPY.lead);
  assert.equal(textOf(privacy), COPY.privacy);
  assert.equal(textOf(button), COPY.button);
  assert.equal(button.getAttribute("type"), "button");

  assert.equal(list.getAttribute("role"), "list", "Safari keeps the list role without bullets");
  assert.equal(list.children.length, 3);
  list.children.forEach((item, index) => {
    assert.equal(item.tagName, "li");
    const [icon, ...rest] = item.children;
    assert.equal(icon.tagName, "svg");
    assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(icon.getAttribute("width"), "24");
    assert.equal(icon.getAttribute("height"), "24");
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.equal(rest.map(textOf).join(""), COPY.items[index]);
  });
});

test("the three list icons are different", () => {
  const { body } = mountOnboarding();
  const list = byClass(body, "onboarding__list");
  const names = list.children.map((item) => item.children[0].getAttribute("data-icon"));
  assert.equal(new Set(names).size, 3, JSON.stringify(names));
  names.forEach((name) => assert.ok(name, "every icon is a named app.ui icon"));
});

test("Start practicing saves the onboarded flag, then goes to Practice", async () => {
  const saving = deferred();
  const { body, calls } = mountOnboarding({ setFlagResult: () => saving.promise });
  const button = byClass(body, "btn--primary");
  button.click();
  await settle();
  assert.deepEqual(calls, ["setFlag onboarded true"], "Practice waits for the flag");
  saving.resolve();
  await settle();
  assert.deepEqual(calls, ["setFlag onboarded true", "go practice"]);
});

test("Start practicing still opens Practice when the flag cannot be saved", async () => {
  const { body, calls } = mountOnboarding({
    setFlagResult: () => Promise.reject(new Error("IndexedDB is blocked")),
  });
  byClass(body, "btn--primary").click();
  await settle();
  assert.deepEqual(calls, ["setFlag onboarded true", "go practice"]);
});

test("show and hide leave the mounted screen as it is", () => {
  const { screen, body } = mountOnboarding();
  const before = body.children.slice();
  screen.show({});
  screen.hide();
  assert.deepEqual(body.children, before);
});

test("index.html loads onboarding.js last and keeps only the h1 and an empty body", () => {
  const sources = [...INDEX_HTML.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(sources[sources.length - 1], "screens/onboarding.js");
  const section = INDEX_HTML.match(
    /<section class="screen" id="screen-onboarding"[^>]*>([\s\S]*?)<\/section>/,
  );
  assert.ok(section, "index.html has #screen-onboarding");
  assert.equal(
    section[1].replace(/\s+/g, ""),
    '<h1>SpeechCoach</h1><divclass="screen__body"></div>',
  );
});

test("styles.css lays out the onboarding list and the button on the spacing scale", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp("(?:^|[}\\s])" + escaped + " \\{([^}]*)\\}"));
    assert.ok(match, "styles.css has a rule for " + selector);
    return match[1];
  };
  const list = rule(".onboarding__list");
  assert.match(list, /list-style: none;/);
  assert.match(list, /padding: 0;/);
  assert.match(list, /margin: var\(--s-6\) 0;/);
  const item = rule(".onboarding__list li");
  assert.match(item, /display: flex;/);
  assert.match(item, /gap: var\(--s-3\);/);
  assert.match(item, /align-items: flex-start;/);
  assert.match(item, /margin-bottom: var\(--s-4\);/);
  assert.match(rule(".onboarding__privacy"), /font-size: var\(--fs-small\);/);
  assert.match(rule(".onboarding__privacy"), /color: var\(--muted\);/);
  assert.match(rule("#screen-onboarding .btn"), /margin-top: var\(--s-6\);/);
});
