// Tests for the How we measure page (frontend/how.html) and the link to it from the Results
// transcript legend. The page is static HTML, so these tests read the file as text.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const HOW_PATH = path.join(FRONTEND_DIR, "how.html");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8")],
);
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};

async function legendOnClip() {
  const session = {
    id: "s1",
    createdAt: "2026-10-10T19:21:00.000Z",
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 33.1,
    metrics: CLIP_METRICS,
    transcript: CLIP_WORDS.map((word) => ({ ...word })),
  };
  const context = {
    app: {
      screens: {},
      passages: [{ id: "gettysburg", targetWpm: [130, 150] }],
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: "s1" });
  return byClass(body, "transcript__legend");
}

function readPage() {
  return fs.readFileSync(HOW_PATH, "utf8");
}

function visibleText(html) {
  return html
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
}

test("the legend ends with one How we count link to how.html", async () => {
  const legend = await legendOnClip();
  const links = legend.children.filter((node) => node.className === "transcript__how");
  assert.equal(links.length, 1);
  assert.equal(links[0].tagName, "a");
  assert.equal(links[0].getAttribute("href"), "how.html");
  assert.equal(links[0].textContent, "How we count");
  assert.equal(
    legend.textContent,
    "Highlighted words are hesitations: um, uh, mhm. Underlined words are verbal habits. " +
      "Purple underlined words are restarts. Most used: “so”, 1 time.",
  );
});

test("how.html is a static page with one h1, the shared styles and no script", () => {
  const html = readPage();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<h1[^>]*>\s*How we measure\s*<\/h1>/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.match(html, /href="\.\/#\/practice"/);
  assert.ok(!/<script/i.test(html), "no script tag");
  assert.ok(!visibleText(html).includes("!"), "no exclamation point in visible text");
});

test("how.html names every rule word and every source", () => {
  const text = visibleText(readPage());
  ["like", "so", "you know", "actually", "basically"].forEach((word) => {
    assert.ok(text.includes("“" + word + "”"), "rule word: " + word);
  });
  [
    "Zoom",
    "tl;dv",
    "Microsoft",
    "Gong",
    "Graveline",
    "Trouvain",
    "Houghton",
    "Bosker",
    "Wisniewski",
  ].forEach((name) => {
    assert.ok(text.includes(name), "source: " + name);
  });
});
