// Review fix test for the gold ring on the Path (frontend/styles.css section 13, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 9). The ring was drawn 8px out from
// inside the circle's 1px border while the label sits --s-1 (4px) under the circle, so on every
// gold node the ring ran into the label and sat on its letters. As the design draws it (a 3px
// ring on the circle itself), it now lies on the circle's edge and ends 3px out, clear of the
// label, without covering the circle's own fill. Node cannot lay a page out, so this checks the
// numbers the layout follows; measured in Chrome at 390 x 844, the ring ends 1px above the
// label on every gold node (it ran 3px into it before).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION = CSS.slice(CSS.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");

// The declarations of the one rule in section 13 whose selector list is exactly `selector`.
function rule(selector) {
  const found = [];
  for (const match of SECTION.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].replace(/\s+/g, " ").trim() === selector) {
      const declarations = {};
      for (const part of match[2].split(";")) {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      }
      found.push(declarations);
    }
  }
  assert.equal(found.length, 1, "one rule for " + selector);
  return found[0];
}

function pixels(value) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  assert.ok(match, value + " is a length in px");
  return Number(match[1]);
}

// A token's value in the light scheme's block: "--s-1: 4px;".
function token(name) {
  const match = new RegExp("--" + name + ":\\s*([^;]+);").exec(CSS);
  assert.ok(match, "the token --" + name);
  return match[1].trim();
}

test("the gold ring lies on the circle's edge and ends clear of the label under it", () => {
  const ring = rule(
    ".path-node--half .path-node__circle::after, .path-node--gold .path-node__circle::after",
  );
  const ringWidth = pixels(ring.border.split(" ")[0]);
  // The ring's box reaches this far past the circle's padding box, which lies inside its border.
  const reach = -pixels(ring.inset);
  const circleBorder = pixels(rule(".path-node__circle").border.split(" ")[0]);
  const outsideCircle = reach - circleBorder;
  assert.equal(rule(".path-node").gap, "var(--s-1)", "the label sits --s-1 under the circle");
  const labelGap = pixels(token("s-1"));

  assert.ok(outsideCircle < labelGap, "the ring ends before the label starts");
  assert.ok(outsideCircle >= ringWidth, "the whole ring lies outside the circle's fill");
  assert.equal(outsideCircle, ringWidth, "it lies on the circle's edge, as the design draws it");
});
