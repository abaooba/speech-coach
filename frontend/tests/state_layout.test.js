// Text checks on section 5 of frontend/styles.css: a screen that shows nothing but a state block
// (an empty History, Need two sessions, Session not found) centers it between the heading and
// the nav, with an action as wide as the block (DESIGN.md section 6, "State block"). The rules
// reach the block through `.screen__body > .state`, so Practice's block, which sits inside
// .practice__state, never matches. Every screen hands app.ui.renderState its .screen__body, so
// the block is that body's child; the screenshot loop checks how the rules render.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION_START = "/* 5. State blocks and spinner */";
const SECTION_END = "/* 6. ";

const SCREEN = ".screen--active:has(> .screen__body > .state)";
const BODY = SCREEN + " > .screen__body";
const ACTION = ".screen__body > .state > .state__action";

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

// Top-level rules of the section as { selectors, declarations }, every value of a property kept
// in order, so a fallback line followed by its upgrade can both be checked.
function rulesOf(text) {
  const rules = [];
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = {};
    match[2].split(";").forEach((part) => {
      const colon = part.indexOf(":");
      if (colon !== -1) {
        const name = squash(part.slice(0, colon));
        (declarations[name] = declarations[name] || []).push(squash(part.slice(colon + 1)));
      }
    });
    rules.push({ selectors: match[1].split(",").map(squash), declarations });
  }
  return rules;
}

function sectionText() {
  const start = CSS.indexOf(SECTION_START);
  const end = CSS.indexOf(SECTION_END, start);
  assert.ok(start !== -1 && end > start, "styles.css should keep section 5 before section 6");
  return CSS.slice(start, end);
}

const RULES = rulesOf(sectionText());

function declared(selector) {
  const rule = RULES.find((candidate) => candidate.selectors.includes(selector));
  assert.ok(rule, `section 5 should have a rule for ${selector}`);
  return rule.declarations;
}

test("a screen holding only a state block is a column as tall as the window above the nav", () => {
  const screen = declared(SCREEN);
  assert.deepEqual(screen.display, ["flex"]);
  assert.deepEqual(screen["flex-direction"], ["column"]);
  // main's top and bottom padding come off the window height; 100vh is the fallback for
  // browsers without dynamic viewport units.
  assert.deepEqual(screen["min-height"], [
    "calc(100vh - var(--s-4) - var(--nav-h) - var(--s-5) - env(safe-area-inset-bottom))",
    "calc(100dvh - var(--s-4) - var(--nav-h) - var(--s-5) - env(safe-area-inset-bottom))",
  ]);
});

test("its body takes the height under the heading, so the block's auto margins center it", () => {
  const body = declared(BODY);
  assert.deepEqual(body.display, ["flex"]);
  assert.deepEqual(body["flex-direction"], ["column"]);
  assert.deepEqual(body.flex, ["1 0 auto"]);
  assert.deepEqual(declared(".state").margin, ["auto"]);
});

test("the action spans the block, --s-6 under the words", () => {
  const action = declared(ACTION);
  assert.deepEqual(action["align-self"], ["stretch"]);
  // .state already puts --s-3 between its children, so the margin adds the rest.
  assert.deepEqual(action["margin-top"], ["calc(var(--s-6) - var(--s-3))"]);
});

test("only the active screen matches, and only a block that is the body's own child", () => {
  // .screen[hidden] keeps every other screen at display: none; Practice's error block sits
  // inside .practice__state and keeps the record zone's layout.
  assert.ok(SCREEN.startsWith(".screen--active:has(> .screen__body > .state)"));
  RULES.flatMap((rule) => rule.selectors)
    .filter((selector) => selector.includes(":has("))
    .forEach((selector) => assert.ok(selector.startsWith(".screen--active"), selector));
});

test("no screen section keeps a copy of the centering rule", () => {
  const sections = CSS.slice(CSS.indexOf(SECTION_END, CSS.indexOf(SECTION_START)));
  assert.doesNotMatch(sections, /screen--active:has\(\.state\)/);
  assert.doesNotMatch(sections, /#screen-progress \.state__action/);
});
