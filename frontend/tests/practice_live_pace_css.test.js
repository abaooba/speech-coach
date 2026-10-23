// Text checks on the live pace row's rules in frontend/styles.css (spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7; the judged brief's 2d):
// one centred line in the timer's third row, --s-2 under the bar (--s-1 on short screens), the
// number --muted at 500 and the cue at 600 in --ok or --warn with its icon drawn first; the two
// parts never break inside, so at 200% zoom the row wraps between them. Tokens only, nothing
// animates, and [hidden] beats the flex display.
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

// Rules as { at, selectors, declarations, body }, `at` the enclosing @-rule's prelude or null,
// in the order the file gives them.
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
      const declarations = {};
      body.split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
        }
      });
      rules.push({ at, selectors: prelude.split(",").map(squash), declarations });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(withoutComments(CSS));

// The declarations of the one rule with exactly this selector list under `at`.
function ruleFor(selectors, at = null) {
  const wanted = selectors.map(squash).join(", ");
  const matching = RULES.filter((rule) => rule.at === at && rule.selectors.join(", ") === wanted);
  assert.equal(matching.length, 1, "one rule for " + wanted + (at ? " in " + at : ""));
  return matching[0].declarations;
}

// Every rule whose selectors name the row or one of its parts.
function paceRules() {
  return RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.includes("practice__pace")),
  );
}

test("the row spans the timer's third row: one centred, wrapping flex line under the bar", () => {
  assert.deepEqual(ruleFor([".practice__pace"]), {
    "grid-column": "1 / -1",
    "grid-row": "3",
    display: "flex",
    "flex-wrap": "wrap",
    "justify-content": "center",
    "align-items": "center",
    gap: "0 var(--s-2)",
    "min-width": "0",
    margin: "var(--s-2) 0 0",
    "font-size": "var(--fs-small)",
    "line-height": "1.4",
    "font-weight": "500",
    "text-align": "center",
    color: "var(--muted)",
  });
});

test("the hidden attribute beats the row's flex display", () => {
  assert.deepEqual(ruleFor([".practice__pace[hidden]"]), { display: "none" });
});

test("the number and the cue never break inside; nothing else in the row is held to one line", () => {
  assert.deepEqual(ruleFor([".practice__pace-number", ".practice__pace-cue"]), {
    "white-space": "nowrap",
  });
  const nowrap = paceRules()
    .filter((rule) => rule.declarations["white-space"] === "nowrap")
    .map((rule) => rule.selectors.join(", "));
  assert.deepEqual(nowrap, [".practice__pace-number, .practice__pace-cue"]);
});

test("the cue is bold words in its tone with a 16px icon drawn first, --s-1 before them", () => {
  assert.deepEqual(ruleFor([".practice__pace-cue"]), {
    display: "inline-flex",
    "align-items": "center",
    gap: "var(--s-1)",
    "font-weight": "600",
  });
  assert.deepEqual(ruleFor([".practice__pace-cue svg"]), { flex: "none", order: "-1" });
  assert.deepEqual(ruleFor([".practice__pace-cue--ok"]), { color: "var(--ok)" });
  assert.deepEqual(ruleFor([".practice__pace-cue--warn"]), { color: "var(--warn)" });
});

test("short screens pull the row --s-1 under the bar", () => {
  assert.deepEqual(ruleFor(["#screen-practice .practice__pace"], SHORT_SCREENS), {
    "margin-top": "var(--s-1)",
  });
});

test("the rules sit in section 7 right after the limit's hidden rule, the short one in its block", () => {
  const section = CSS.indexOf("/* 7. Practice screen");
  const results = CSS.indexOf("/* 8. Results screen");
  const limitHidden = CSS.indexOf(".practice__limit[hidden],\n.practice__limit-bar[hidden] {");
  const row = CSS.indexOf("\n.practice__pace {");
  assert.ok(section !== -1 && limitHidden > section, "the limit's hidden rule is in section 7");
  const between = withoutComments(CSS.slice(CSS.indexOf("}", limitHidden) + 1, row)).trim();
  assert.equal(between, "", "nothing but a comment comes between the two");
  const shortBlock = CSS.indexOf(SHORT_SCREENS + " {", section);
  const shortRule = CSS.indexOf("#screen-practice .practice__pace {", section);
  assert.ok(shortBlock !== -1 && shortRule > shortBlock, "inside the first short-screen block");
  assert.ok(shortRule < CSS.indexOf("\n}\n", shortBlock), "before that block closes");
  assert.ok(shortRule < results);
});

test("tokens only, and nothing in the row moves", () => {
  const rules = paceRules();
  assert.ok(rules.length >= 8, rules.length + " rules");
  for (const rule of rules) {
    const name = rule.selectors.join(", ");
    for (const property of ["animation", "transition", "box-shadow", "border", "background"]) {
      assert.ok(!(property in rule.declarations), name + " sets " + property);
    }
    for (const value of Object.values(rule.declarations)) {
      assert.ok(!/#[0-9a-f]{3,8}\b|rgb|hsl/i.test(value), name + ": " + value);
    }
    const color = rule.declarations.color;
    if (color !== undefined) {
      assert.match(color, /^var\(--[a-z-]+\)$/, name);
    }
  }
});
