// The week pill's flame is not drawn in --warn (frontend/DESIGN.md section 4: --warn is for
// out-of-target hints and status with the warning icon, the time-limit fill past the limit, and
// the Path's gold, a locked-in level's ring and an earned crown; "Warnings are rust orange ...
// and always carry the triangle icon"). "This week: 3 of 4 days" is no warning: its flame is
// --muted, as the rank card's streak flame is, and the due chip's clock too.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const PATH_SECTION = CSS.slice(CSS.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");

// The section's rules, @-rules opened up, as {selectors, declarations}.
function rules() {
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(PATH_SECTION);
  while (match) {
    const prelude = match[1].replace(/\s+/g, " ").trim();
    const selectors = prelude.replace(/^@[^{]*$/, "").split(",").map((part) => part.trim());
    const declarations = Object.fromEntries(
      match[2]
        .split(";")
        .filter((part) => part.includes(":"))
        .map((part) => [
          part.slice(0, part.indexOf(":")).trim(),
          part.slice(part.indexOf(":") + 1).replace(/\s+/g, " ").trim(),
        ]),
    );
    found.push({ selectors, declarations });
    match = pattern.exec(PATH_SECTION);
  }
  return found;
}

test("the week pill's flame and the due chip's clock are --muted", () => {
  for (const icon of [".path__week svg", ".path__due svg"]) {
    const colors = rules()
      .filter(({ selectors, declarations }) => selectors.includes(icon) && declarations.color)
      .map(({ declarations }) => declarations.color);
    assert.deepEqual(colors, ["var(--muted)"], icon + " is colored once, in --muted");
  }
});

test("the Path section uses --warn only for its gold: the check-back rings and the crown", () => {
  const gold = /\.path-node--(half|gold|crown)\b/;
  const warned = rules().filter(({ declarations }) =>
    Object.values(declarations).some((value) => value.includes("var(--warn)")),
  );
  assert.ok(warned.length > 0, "the rings and the crown are gold");
  warned.forEach(({ selectors }) =>
    selectors.forEach((selector) =>
      assert.match(selector, gold, selector + " draws --warn but is not the Path's gold"),
    ),
  );
});
