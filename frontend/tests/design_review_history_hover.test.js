// The 2026-10-19 design review: with a mouse, a hovered History row takes a surface background,
// so the row reads as something a tap opens. Touch screens get no hover rule.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const DESIGN = fs.readFileSync(path.join(FRONTEND, "DESIGN.md"), "utf8");

function hoverBlock() {
  const match = CSS.match(/@media \(hover: hover\)\s*\{([\s\S]*?)\n\}/g);
  assert.ok(match, "styles.css has a hover media block");
  return match.join("\n");
}

test("a hovered open button takes the surface background, under (hover: hover) only", () => {
  const inside = hoverBlock().match(/\.session-row__open:hover\s*\{([^}]*)\}/);
  assert.ok(inside, "the hover rule sits inside @media (hover: hover)");
  assert.match(inside[1], /background:\s*var\(--surface\)/);
  const outside = CSS.replace(/@media \(hover: hover\)\s*\{[\s\S]*?\n\}/g, "");
  assert.doesNotMatch(outside, /\.session-row__open:hover/);
});

test("DESIGN.md's session row mentions the hover background", () => {
  assert.match(DESIGN, /\.session-row__open:hover[^\n]*--surface/);
});
