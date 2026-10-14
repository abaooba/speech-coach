// Tests that the coach notes (docs/PLAN.md T41) are explained where a reader looks: how.html
// says who writes them, what the model is told and what is sent to Anthropic, and that the tips
// show first, in short sentences; styles.css styles every class results.js draws them with,
// from tokens only; frontend/README.md names them.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

const MAX_SENTENCE_WORDS = 15;

// how.html as a reader sees it: no tags, no comments, one space between words.
function howText() {
  return read("how.html")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

// The text of how.html's "Coach notes" section, between its heading and the next one.
function coachNotesSection() {
  const text = howText();
  const start = text.indexOf("7. Coach notes");
  const end = text.indexOf("8. ", start);
  assert.ok(start !== -1 && end !== -1, "how.html has a section 7 'Coach notes' before section 8");
  return text.slice(start + "7. Coach notes".length, end).trim();
}

// The declarations of one rule in styles.css, by its exact selector.
function ruleFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}").exec(css);
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

// The paragraphs of how.html's "The tips" section, as a reader sees them; its table is left out.
function tipsSectionParagraphs() {
  const html = read("how.html");
  const start = html.indexOf("<h2>6. The tips</h2>");
  const end = html.indexOf("<h2>7. ", start);
  assert.ok(start !== -1 && end !== -1, "how.html has a section 6 'The tips' before section 7");
  return [...html.slice(start, end).matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) =>
    match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

function assertShortSentences(text) {
  assert.ok(!text.includes("!"));
  text
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => sentence.trim() !== "")
    .forEach((sentence) => {
      const words = sentence.trim().split(" ").length;
      assert.ok(words < MAX_SENTENCE_WORDS, words + " words: " + sentence);
    });
}

test("how.html's Coach notes section says who writes the notes and what is sent", () => {
  const text = coachNotesSection();
  [
    "Claude, an AI model from Anthropic, writes the notes.",
    "It is told to use only the entries and your numbers.",
    "Your take’s numbers, and the first 1,500 characters of your transcript.",
    "It never sends audio.",
    "It never sends your email.",
    "The app, not the model, attaches each source.",
    "A peer-reviewed source carries a “Peer reviewed” badge.",
    "When the AI is off, the library’s own words stand in, still cited.",
    "Tap a source to read it. The link opens in a new tab.",
  ].forEach((sentence) => assert.ok(text.includes(sentence), sentence));
  assert.ok(text.includes("482"), "names the size of the library");
  assert.ok(
    !text.includes("It adds no facts of its own."),
    "the model is told what to use; nothing checks that it added nothing",
  );
});

test("every sentence of the Coach notes section is under 15 words, with no exclamation", () => {
  assertShortSentences(coachNotesSection());
});

test("how.html's tips section says the tips show first and the notes take their place", () => {
  const prose = tipsSectionParagraphs().join(" ");
  assert.ok(prose.includes("The tips show first."));
  assert.ok(prose.includes("Coach notes take their place when they arrive."));
  assertShortSentences(prose);
});

test("how.html keeps one numbered section per rule, 1 to 8, in order", () => {
  const headings = [...read("how.html").matchAll(/<h2>(\d+)\. /g)].map((match) => Number(match[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("styles.css draws the notes as one card, split by dividers, from tokens only", () => {
  const css = read("styles.css");
  const lead = ruleFor(css, ".coach-notes__lead");
  assert.match(lead, /font-size: var\(--fs-small\)/);
  assert.match(lead, /color: var\(--muted\)/);

  // One surface card, as the headline is: the list it is loses its bullets and indent.
  const card = ruleFor(css, ".coach-notes");
  assert.match(card, /background: var\(--surface\)/);
  assert.match(card, /border: 1px solid var\(--border\)/);
  assert.match(card, /border-radius: var\(--r-card\)/);
  assert.match(card, /list-style: none/);
  assert.match(card, /padding: 0/);
  assert.match(card, /overflow-wrap: anywhere/, "a long title stays inside 320px");
  assert.match(ruleFor(css, ".coach-notes__note"), /padding: var\(--s-4\)/);
  assert.match(
    ruleFor(css, ".coach-notes__note + .coach-notes__note"),
    /border-top: 1px solid var\(--border\)/,
    "a 1px divider between two notes, none along the card's edge",
  );

  assert.match(ruleFor(css, ".coach-notes__text"), /margin: 0/);
  assert.match(ruleFor(css, ".coach-notes__drill"), /font-size: var\(--fs-small\)/);
  assert.match(ruleFor(css, ".coach-notes__drill-label"), /font-weight: 600/);

  // "Source:" and the link run on as text: no flex row that drops the link below the label.
  const source = ruleFor(css, ".coach-notes__source");
  assert.match(source, /font-size: var\(--fs-micro\)/);
  assert.match(source, /color: var\(--muted\)/);
  assert.doesNotMatch(source, /display:/);

  // An inline link whose padding makes a 44px tap target: 12px of text and 16px above and below.
  // The source line sits as far under the line above, so that target never covers the drill.
  const link = ruleFor(css, ".coach-notes__link");
  assert.doesNotMatch(link, /display:/, "inline, so it wraps like the words around it");
  assert.match(link, /padding: var\(--s-4\) 0/);
  assert.match(link, /color: var\(--accent\)/);
  assert.match(source, /margin: var\(--s-4\) 0 0/);

  const badge = ruleFor(css, ".coach-notes__badge");
  assert.match(badge, /background: var\(--ok-bg\)/);
  assert.match(badge, /color: var\(--ok\)/);
  assert.match(badge, /border-radius: var\(--r-chip\)/);
  assert.match(badge, /font-size: var\(--fs-micro\)/);
  assert.match(badge, /white-space: nowrap/);

  [lead, card, source, link, badge].forEach((rule) => {
    assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b/i, "no raw hex color");
  });
  assert.ok(!/\.tip-card__/.test(css), "the notes no longer borrow the tip card's parts");
});

test("focus moved to the Coach notes heading scrolls clear of the action bar and the nav", () => {
  const css = read("styles.css");
  assert.match(
    ruleFor(css, ".coach-notes__heading"),
    /scroll-margin-bottom: calc\(var\(--nav-h\) \+ var\(--s-7\) \+ var\(--s-6\) \+ env\(safe-area-inset-bottom\)\)/,
    "the room every link and button above the stuck bar asks for",
  );
  const short = css.slice(css.indexOf("@media (max-height: 480px), (max-width: 319px)"));
  const where = /\n {2}\.coach-notes__heading \{([^}]*)\}/.exec(short);
  assert.ok(where, "the short or zoomed window, where the bar sits at the end of the page");
  assert.match(
    where[1],
    /scroll-margin-bottom: calc\(var\(--nav-h\) \+ var\(--s-2\) \+ env\(safe-area-inset-bottom\)\)/,
    "there it clears only the nav, as every link and button does",
  );
});

test("frontend/README.md names the coach notes and their source links", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.ok(readme.includes("Coach notes"));
  assert.ok(readme.includes("coachNotes"));
  assert.ok(readme.includes("Peer reviewed"));
});
