// Tests for the Results transcript section (DESIGN.md section 6). The transcript marks only the
// pauses the card counts: a pause after a sentence ends, or before the first word or after the
// last, gets no marker, so the transcript, the Mid-sentence pauses card and the speech timeline
// show the same pauses, and how.html says so. The legend's "How we count" link follows its text
// after a plain space.
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

// Words 0.3 s long with 0.1 s between them.
function timed(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: Math.round(index * 400) / 1000,
    end: Math.round(index * 400 + 300) / 1000,
  }));
}

const WORDS = timed("We win. The plan works today.");

function sessionWith(pauses) {
  return {
    id: "s1",
    createdAt: "2026-10-09T22:21:00.000Z",
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 12,
    metrics: { pauses, repeats: [], fillers: {}, pace_windows: [] },
    transcript: WORDS.map((word) => ({ ...word })),
  };
}

async function showSession(session) {
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
  await context.app.screens.results.show({ id: session.id });
  return body;
}

// The transcript's spans in order: words as their text, markers as "[2.1 s pause]".
function transcriptTokens(body) {
  return byClass(body, "transcript")
    .children.filter((node) => node.tagName === "span")
    .map((span) =>
      span.classList.contains("tok--pause") ? "[" + span.textContent + "]" : span.textContent,
    );
}

function pauseCard(body) {
  const card = byClass(body, "metric-grid").children[2];
  return byClass(card, "metric-card__value").children[0].textContent;
}

function timelinePauses(body) {
  const strip = byClass(body, "timeline").children[1];
  return strip.children.filter((mark) => mark.getAttribute("class") === "timeline__pause").length;
}

test("a pause after a period gets no marker; a mid-sentence one does", async () => {
  const afterPeriod = [WORDS[1].end, 2.1];
  const midSentence = [WORDS[3].end, 1.8];
  const body = await showSession(sessionWith([afterPeriod, midSentence]));
  assert.deepEqual(transcriptTokens(body), [
    "We",
    "win.",
    "The",
    "plan",
    "[1.8 s pause]",
    "works",
    "today.",
  ]);
  assert.equal(pauseCard(body), "1", "the card counts the same single pause");
  assert.equal(timelinePauses(body), 1, "and so does the timeline");
});

test("pauses before the first word or after the last get no marker either", async () => {
  const beforeFirst = [0, 1.6];
  const afterLast = [WORDS[5].end, 2];
  const body = await showSession(sessionWith([beforeFirst, afterLast]));
  assert.deepEqual(transcriptTokens(body), ["We", "win.", "The", "plan", "works", "today."]);
  assert.equal(pauseCard(body), "0");
  assert.equal(timelinePauses(body), 0);
});

test("a malformed pause never becomes a marker", async () => {
  const body = await showSession(sessionWith([null, [WORDS[3].end], "x", [WORDS[3].end, 1.8]]));
  assert.deepEqual(
    transcriptTokens(body).filter((token) => token.startsWith("[")),
    ["[1.8 s pause]"],
  );
});

test("how.html says the transcript marks only the pauses the card counts", () => {
  const html = read("how.html");
  assert.ok(
    html.includes("Your transcript marks only mid-sentence pauses, the ones the card counts."),
  );
  assert.ok(!html.includes("marks every pause"));
});

test("the How we count link follows the legend after a space, not a margin", async () => {
  const body = await showSession(sessionWith([]));
  const legend = byClass(body, "transcript__legend");
  const [space, link] = legend.children;
  assert.equal(space.nodeType, 3);
  assert.equal(space.textContent, " ", "a space collapses when the link wraps to a new line");
  assert.equal(link.className, "transcript__how");
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/\.transcript__how\s*\{([^}]*)\}/)[1];
  assert.match(rule, /margin:\s*calc\(-1 \* var\(--s-3\)\) 0;/, "no left margin to indent a wrap");
  assert.match(rule, /min-height:\s*44px/, "still a 44px tap target");
});
