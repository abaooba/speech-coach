// Tests for the Read card's New passage button under 360px (frontend/styles.css section 7 and
// frontend/screens/practice.js; the owner's decision on the 320 x 568 review, where a speech's
// title wrapped to four lines beside the button and left no line of the passage clear of the
// fade). Under 360px of viewport width, on the Read tab only, the button shows its icon alone:
// the same place, a 44 x 44 target, the same focus ring, and its words still its name, as its
// aria-label (DESIGN.md section 6: an icon sits beside visible text or carries an aria-label).
// Talk's New topic keeps its words at every width, and from 360px the Read tab's does too. The
// stylesheet is read as text; the screen mounts on practice-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { FakeElement } = require("./fake-dom");
const { parts, setup } = require("./practice-harness");

// A browser element has removeAttribute and the shared fake does not; this file's elements get
// one (each test file runs in its own process), so leaving the Read tab can drop the aria-label.
if (typeof FakeElement.prototype.removeAttribute !== "function") {
  FakeElement.prototype.removeAttribute = function removeAttribute(name) {
    delete this.attributes[name];
  };
}

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const NARROW = "@media (max-width: 359px)";
const READ_BUTTON = '#screen-practice .passage-card__new[data-kind="passage"]';

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
      rules.push({ at, selectors: prelude.split(",").map(squash), declarations: declarationsOf(body) });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(withoutComments(CSS));

// The rules whose selectors name the card's button.
function buttonRules() {
  return RULES.filter((rule) => rule.selectors.some((s) => s.includes("passage-card__new")));
}

function narrowRule(selector) {
  return RULES.find((rule) => rule.at === NARROW && rule.selectors.includes(selector));
}

// A passage of `group` for the Read tab; two in a group, so New passage shows.
function passage(id, group) {
  const title = "Theodore Roosevelt, man in the arena " + id;
  return { id, kind: "passage", title, text: title + ".", targetWpm: [130, 150], group };
}

const GROUPS = [{ id: "speech", label: "Speech" }];
const TALK = {
  id: "day",
  kind: "prompt",
  title: "Your day",
  text: "First topic.",
  topics: ["First topic.", "Second topic."],
  targetWpm: [140, 160],
  timeLimitSeconds: 60,
};
const DATA = [TALK, passage("speech-one", "speech"), passage("speech-two", "speech")];

function mount() {
  return setup({ passages: DATA, groups: GROUPS, random: () => 0 });
}

// --- The stylesheet ---------------------------------------------------------------------------

test("under 360px the Read tab's button is a 44 x 44 target showing its icon alone", () => {
  const rule = narrowRule(READ_BUTTON);
  assert.ok(rule, `${NARROW} { ${READ_BUTTON} } is missing`);
  assert.deepEqual(rule.declarations, {
    width: "44px",
    padding: "0",
    gap: "0",
    "font-size": "0",
  });
  // Its height stays the card's 44px target; the icon is the 16px one it always draws.
  const base = RULES.find((r) => r.at === null && r.selectors.includes(".passage-card__new"));
  assert.equal(base.declarations["min-height"], "44px");
});

test("the narrow rule keeps the button's place and its focus ring", () => {
  for (const rule of buttonRules()) {
    for (const property of Object.keys(rule.declarations)) {
      assert.ok(!property.startsWith("outline"), `${rule.selectors.join(", ")} sets ${property}`);
    }
  }
  const narrow = narrowRule(READ_BUTTON).declarations;
  for (const property of ["margin", "margin-left", "margin-right", "margin-block", "grid-column",
    "grid-row", "align-self", "position", "min-height", "height", "display", "visibility",
    "opacity"]) {
    assert.equal(narrow[property], undefined, `the narrow rule sets ${property}`);
  }
});

test("Talk's New topic and every width from 360px keep the button as it was", () => {
  const kinded = buttonRules().filter((rule) => rule.selectors.some((s) => s.includes("data-kind")));
  assert.deepEqual(
    kinded.map((rule) => [rule.at, rule.selectors]),
    [[NARROW, [READ_BUTTON]]],
    "only the narrow rule reads the button's kind, and only the Read tab's",
  );
  const narrowButtonRules = buttonRules().filter((rule) => rule.at === NARROW);
  assert.deepEqual(
    narrowButtonRules.map((rule) => rule.selectors),
    [[READ_BUTTON]],
    "no narrow rule reaches Talk's button",
  );
});

// --- The button in the DOM --------------------------------------------------------------------

test("on the Read tab New passage keeps its words and carries them as its aria-label", () => {
  const t = mount();
  parts(t).read.click();
  const button = parts(t).newTopic;
  assert.equal(button.hidden, false, "a group of two shows New passage");
  assert.equal(button.textContent, "New passage", "the words stay in the button");
  assert.equal(button.getAttribute("aria-label"), "New passage");
  assert.equal(button.dataset.kind, "passage");
  assert.equal(button.className, "btn btn--ghost passage-card__new");
  assert.equal(button.children.length, 1);
  assert.equal(button.children[0].getAttribute("data-icon"), "refresh");
  assert.equal(button.children[0].getAttribute("aria-hidden"), "true", "the icon adds no name");
});

test("Talk's New topic keeps its words as its only name, before and after the Read tab", () => {
  const t = mount();
  const button = parts(t).newTopic;
  const talkButton = () => {
    assert.equal(button.textContent, "New topic");
    assert.equal(button.getAttribute("aria-label"), null, "no aria-label on Talk");
    assert.equal(button.dataset.kind, "prompt");
    assert.equal(button.className, "btn btn--ghost passage-card__new");
  };
  talkButton();
  parts(t).read.click();
  assert.equal(button.getAttribute("aria-label"), "New passage");
  parts(t).talk.click();
  talkButton();
  parts(t).read.click();
  assert.equal(button.getAttribute("aria-label"), "New passage", "and back on Read");
  assert.equal(button.dataset.kind, "passage");
});
