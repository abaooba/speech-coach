// Record again sits centered in the Results action bar (owner's report of 2026-10-18: on a
// 375px phone the 320px cap left the button parked 23px off the left gutter, which looked
// wrong). Both side margins are auto, so the spare room splits evenly at every width.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function declarationsOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("(?:^|\\})\\s*" + escaped + "\\s*\\{([^}]*)\\}").exec(
    CSS.replace(/\/\*[\s\S]*?\*\//g, ""),
  );
  assert.ok(match, "styles.css has a rule for " + selector);
  const declarations = {};
  match[1]
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const colon = part.indexOf(":");
      declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    });
  return declarations;
}

test("Record again is centered in the bar by auto margins on both sides", () => {
  const primary = declarationsOf(".results__actions .btn--primary");
  assert.equal(primary["margin-left"], "auto");
  assert.equal(primary["margin-right"], "auto");
  assert.equal(primary["max-width"], "320px", "the cap that leaves room to center in");
  assert.equal(primary.flex, "1 1 auto", "on a narrow row it still fills the row");
});

test("the bar itself keeps centering to its margins, not to end alignment", () => {
  const bar = declarationsOf(".results__actions");
  assert.equal(bar.display, "flex");
  assert.notEqual(bar["justify-content"], "flex-end");
});
