// Tests for the Read card on short phones (frontend/styles.css section 7 and
// frontend/screens/practice.js). At 360 x 640 a Read title wraps to two or three lines beside
// New passage, and with the hint's words and "See a sample result" under the record button, 23 of
// the 24 Read cards kept no line of the passage clear of the fade. So on the Read tab, 650px tall
// or less and narrower than 480px, the hint's words and the sample button hide; Talk keeps both,
// and taller phones and landscape keep them on Read too. practice.js marks the screen with its
// tab's kind for that rule, as it marks the chips and New topic. A long title also wraps inside
// its column (DESIGN.md section 9: the layout survives 200% zoom), in balanced lines. The
// stylesheet is read as text; the screen mounts on practice-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parts, setup } = require("./practice-harness");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SHORT_PHONES = "@media (max-height: 650px) and (max-width: 479px)";
const READ_SCREEN = '#screen-practice[data-kind="passage"]';
const READ_HINT_PARTS = [READ_SCREEN + " .practice__hint-text", READ_SCREEN + " .practice__sample"];

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function closingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("styles.css has an unbalanced brace");
}

function declarationsOf(body) {
  const declarations = {};
  body.split(";").forEach((part) => {
    const colon = part.indexOf(":");
    if (colon !== -1) {
      declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
    }
  });
  return declarations;
}

// Splits CSS into rules: { at, selectors, declarations }, where `at` is the enclosing @-rule
// prelude or null and `selectors` the comma-separated list.
function parseRules(text, at = null, rules = []) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    const prelude = squash(text.slice(cursor, open));
    const close = closingBrace(text, open);
    const body = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      parseRules(body, prelude, rules);
    } else {
      rules.push({
        at,
        selectors: prelude.split(",").map(squash),
        declarations: declarationsOf(body),
      });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(withoutComments(CSS));

// Two Read groups of two, so New passage shows, and a Talk prompt.
const GROUPS = [
  { id: "explainer", label: "Explainer" },
  { id: "speech", label: "Speech" },
];

function passage(id, group) {
  return { id, kind: "passage", title: id, text: id + ".", targetWpm: [130, 150], group };
}

const DATA = [
  {
    id: "day",
    kind: "prompt",
    title: "Your day",
    text: "First topic.",
    topics: ["First topic.", "Second topic."],
    targetWpm: [140, 160],
    timeLimitSeconds: 60,
  },
  passage("explainer-one", "explainer"),
  passage("explainer-two", "explainer"),
  passage("speech-one", "speech"),
  passage("speech-two", "speech"),
];

// --- The screen carries its tab's kind ------------------------------------------------------

test("the screen carries its tab's kind: prompt on Talk, passage on Read", () => {
  const t = setup({ passages: DATA, groups: GROUPS, random: () => 0 });
  assert.equal(t.root.dataset.kind, "prompt", "Practice opens on Talk");
  parts(t).read.click();
  assert.equal(t.root.dataset.kind, "passage");
  parts(t).chips.find((chip) => chip.dataset.group === "speech").click();
  assert.equal(t.root.dataset.kind, "passage", "a group chip keeps the Read tab");
  parts(t).newTopic.click();
  assert.equal(t.root.dataset.kind, "passage", "and so does New passage");
  parts(t).talk.click();
  assert.equal(t.root.dataset.kind, "prompt");
  assert.equal(t.root.dataset.state, "idle", "the state stays where it was");
});

// --- The stylesheet -------------------------------------------------------------------------

test("on a short phone the Read tab hides the hint's words and the sample button", () => {
  const rule = RULES.find(
    (candidate) =>
      candidate.at === SHORT_PHONES &&
      READ_HINT_PARTS.every((selector) => candidate.selectors.includes(selector)),
  );
  assert.ok(rule, `${SHORT_PHONES} { ${READ_HINT_PARTS.join(", ")} } is missing`);
  assert.deepEqual(rule.selectors, READ_HINT_PARTS);
  assert.deepEqual(rule.declarations, { display: "none" });
});

test("only that rule reads the screen's kind, so Talk and taller phones keep the hint", () => {
  const kinded = RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.includes("#screen-practice[data-kind")),
  );
  assert.deepEqual(
    kinded.map((rule) => [rule.at, rule.selectors]),
    [[SHORT_PHONES, READ_HINT_PARTS]],
  );
  // The record button, its label and the card keep their own rules at that size.
  const atShortPhones = RULES.filter((rule) => rule.at === SHORT_PHONES);
  assert.deepEqual(
    atShortPhones.map((rule) => rule.selectors),
    [READ_HINT_PARTS],
    "nothing else changes on a short phone",
  );
});

test("a long title wraps inside its column, in balanced lines", () => {
  const title = RULES.find(
    (rule) => rule.at === null && rule.selectors.includes(".passage-card__title"),
  );
  assert.ok(title, ".passage-card__title has a rule");
  assert.equal(title.declarations["overflow-wrap"], "anywhere", "a long word breaks, not spills");
  assert.equal(title.declarations["text-wrap"], "balance", "no word alone on the last line");
  assert.equal(title.declarations["grid-column"], "1", "the title keeps its column");
});
