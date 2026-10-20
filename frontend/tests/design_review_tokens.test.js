// The 2026-10-19 design review's token changes: a slightly deeper light accent, and dark-mode
// accent, filler, ok and long-pause colors that no longer glow. Both dark blocks carry the same
// values, and DESIGN.md section 4 lists them with the contrast figures the pairs still meet.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8");
const DESIGN = fs.readFileSync(path.join(FRONTEND, "DESIGN.md"), "utf8");

// Token: [light, dark].
const REVIEWED = {
  "--accent": ["#2E5BE6", "#7C9BFF"],
  "--filler": ["#B45309", "#E6B457"],
  "--ok": ["#15803D", "#5FCF8C"],
  "--pause-long": ["#BE185D", "#E58BC0"],
};

const TOKENS = CSS.slice(0, CSS.indexOf("/* end tokens */"));

function blockOf(selectorStart) {
  const open = TOKENS.indexOf(selectorStart);
  assert.notEqual(open, -1, selectorStart);
  const brace = TOKENS.indexOf("{", open);
  return TOKENS.slice(brace, TOKENS.indexOf("}", brace));
}

function valueIn(block, token) {
  const match = block.match(new RegExp(token.replace(/-/g, "\\-") + ":\\s*([^;]+);"));
  assert.ok(match, token);
  return match[1].trim();
}

const LIGHT = blockOf("\n:root {");
const DARK_BY_DEVICE = blockOf(':root:not([data-theme="light"])');
const DARK_FORCED = blockOf(':root[data-theme="dark"]');

for (const [token, [light, dark]] of Object.entries(REVIEWED)) {
  test(token + " has the reviewed light value and the same dark value in both dark blocks", () => {
    assert.equal(valueIn(LIGHT, token), light);
    assert.equal(valueIn(DARK_BY_DEVICE, token), dark);
    assert.equal(valueIn(DARK_FORCED, token), dark);
  });

  test("DESIGN.md section 4 lists " + token + "'s values", () => {
    const row = DESIGN.match(new RegExp("^\\| `" + token + "` \\| `([^`]+)` \\| `([^`]+)` \\|", "m"));
    assert.ok(row, "a table row for " + token);
    assert.equal(row[1], light);
    assert.equal(row[2], dark);
  });
}

test("DESIGN.md's contrast line carries the recomputed dark figures", () => {
  assert.match(DESIGN, /`--accent` on `--grid` 4\.48 \/ 5\.05/);
  assert.match(DESIGN, /`--ok` on `--ok-bg` 4\.57 \/ 6\.39/);
  assert.match(DESIGN, /`--pause-long` on `--surface` 5\.5 \/ 7\.1/);
});
