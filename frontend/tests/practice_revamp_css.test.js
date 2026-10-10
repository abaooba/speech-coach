// Text checks on the Practice rules in frontend/styles.css (DESIGN.md sections 3, 6 and 7).
// Node cannot lay a page out, so these pin the rules that make Practice fit one screen and that
// show or hide its parts per state; the screenshots in the revamp report cover the pixels.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SHORT_SCREENS = "@media (max-height: 600px)";

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
// prelude or null and `selectors` is the comma-separated selector list.
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
      const selectors = prelude.split(",").map(squash);
      rules.push({ at, selectors, declarations: declarationsOf(body) });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(withoutComments(CSS));

// The value the last rule naming this exact selector gives the property, as the cascade would
// for rules of equal specificity; undefined when no rule sets it.
function valueFor(selector, property, at = null) {
  const matching = RULES.filter(
    (rule) =>
      rule.at === at && rule.selectors.includes(selector) && property in rule.declarations,
  );
  return matching.length > 0 ? matching[matching.length - 1].declarations[property] : undefined;
}

function practiceIn(state, part) {
  return `#screen-practice[data-state="${state}"] ${part}`;
}

test("uploading and error hide the record button together with its label (H1)", () => {
  for (const state of ["uploading", "error"]) {
    for (const part of [".btn-record", ".btn-record__label"]) {
      assert.equal(valueFor(practiceIn(state, part), "display"), "none", `${state} ${part}`);
    }
  }
});

test("error also hides the timer and the hint, so its block takes the record zone (H3)", () => {
  assert.equal(valueFor(practiceIn("error", ".practice__timer"), "display"), "none");
  assert.equal(valueFor(practiceIn("error", ".practice__hint"), "display"), "none");
  assert.equal(valueFor(practiceIn("uploading", ".practice__hint"), "display"), "none");
  assert.equal(valueFor(practiceIn("uploading", ".practice__timer"), "display"), undefined);
});

test("the active Practice section is a column as tall as the viewport above the nav (H2)", () => {
  const selector = "#screen-practice.screen--active";
  assert.equal(valueFor(selector, "display"), "flex");
  assert.equal(valueFor(selector, "flex-direction"), "column");
  const minHeight = valueFor(selector, "min-height");
  assert.ok(minHeight.startsWith("calc(100dvh"), `min-height is ${minHeight}`);
  for (const part of ["var(--s-4)", "var(--nav-h)", "var(--s-5)", "env(safe-area-inset-bottom)"]) {
    assert.ok(minHeight.includes(`- ${part}`), `min-height subtracts ${part}`);
  }
});

test("no rule puts a display on the bare Practice id, which would beat .screen[hidden]", () => {
  const offenders = RULES.filter(
    (rule) => rule.selectors.includes("#screen-practice") && "display" in rule.declarations,
  );
  assert.deepEqual(offenders, []);
});

test("the body is a column whose parts keep their size; the card takes the rest (H2)", () => {
  assert.equal(valueFor("#screen-practice .screen__body", "display"), "flex");
  assert.equal(valueFor("#screen-practice .screen__body", "flex-direction"), "column");
  assert.equal(valueFor("#screen-practice .screen__body > *", "flex"), "none");
  assert.equal(valueFor("#screen-practice .passage-card", "flex"), "1 1 0");
  assert.equal(valueFor("#screen-practice .passage-card", "min-height"), "120px");
  assert.equal(valueFor(".passage-card", "max-height"), undefined, "no 40vh cap any more");
});

test("short screens lower the card floor, shrink the record button and hide the hint text", () => {
  assert.equal(valueFor("#screen-practice .passage-card", "min-height", SHORT_SCREENS), "88px");
  assert.equal(valueFor("#screen-practice .btn-record", "width", SHORT_SCREENS), "72px");
  assert.equal(valueFor("#screen-practice .btn-record", "height", SHORT_SCREENS), "72px");
  assert.equal(valueFor("#screen-practice .practice__hint-text", "display", SHORT_SCREENS), "none");
  const hidesSample = RULES.some(
    (rule) =>
      rule.at === SHORT_SCREENS &&
      rule.selectors.some((selector) => /practice__(sample|hint)$/.test(selector)),
  );
  assert.ok(!hidesSample, "the sample button stays on short screens");
});

test("the sample button keeps its room, invisible, while recording", () => {
  const selector = practiceIn("recording", ".practice__sample");
  assert.equal(valueFor(selector, "visibility"), "hidden");
  assert.equal(valueFor(selector, "display"), undefined);
  const hidesWhileRecording = RULES.some(
    (rule) =>
      rule.selectors.some((one) => one.endsWith(".practice__sample") && one.includes(":not(")) &&
      rule.declarations.display === "none",
  );
  assert.ok(!hidesWhileRecording, "no catch-all rule collapses the sample outside idle");
});

test("inside Practice the state block takes the record zone with --s-4 padding", () => {
  assert.equal(valueFor("#screen-practice .practice__state .state", "padding"), "var(--s-4)");
});
