// The 2026-10-19 design review: a selected chip is a soft accent tint with accent text, so
// Practice no longer stacks solid accent fills; primary buttons and the active nav item stay
// solid. DESIGN.md section 6 says the same.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8");
const DESIGN = fs.readFileSync(path.join(FRONTEND, "DESIGN.md"), "utf8");

function declarationsOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(
    new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"),
  );
  assert.ok(match, "styles.css has a rule for " + selector);
  const declarations = {};
  match[1].split(";").forEach((part) => {
    const colon = part.indexOf(":");
    if (colon !== -1) {
      declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    }
  });
  return declarations;
}

test("a selected chip is a soft accent tint with accent text and an accent edge", () => {
  const selected = declarationsOf(".chip--selected");
  assert.equal(selected.background, "var(--accent-soft)");
  assert.equal(selected.color, "var(--accent)");
  assert.equal(selected["border-color"], "var(--accent)");
});

test("primary buttons and the active nav item keep the solid accent", () => {
  assert.equal(declarationsOf(".btn--primary").background, "var(--accent)");
  assert.equal(declarationsOf(".nav__item--active").color, "var(--accent)");
});

test("DESIGN.md describes the selected chip as the soft tint", () => {
  assert.match(DESIGN, /`\.chip--selected`: `--accent-soft` bg, `--accent` text and border/);
});
