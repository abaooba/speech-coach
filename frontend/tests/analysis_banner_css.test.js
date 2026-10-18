// Tests for the banner's rules in frontend/styles.css (DESIGN.md section 6, "Banner"): the strip
// sticks to the top of the window in the content column, each kind colors it from the tokens,
// it hides with the nav while Practice records or uploads in place, and the Say it better card
// no longer styles a "Hear it" button. The rules are read as text; no browser is involved.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const WITHOUT_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

// Every top-level rule as {selectors, declarations}, media blocks included (their inner rules
// are read as rules of their own).
function rulesOf(text) {
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of text.matchAll(pattern)) {
    const prelude = match[1].trim();
    if (prelude.startsWith("@")) {
      continue;
    }
    const selectors = prelude.split(",").map((selector) => selector.replace(/\s+/g, " ").trim());
    const declarations = {};
    match[2]
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const colon = part.indexOf(":");
        declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
      });
    rules.push({ selectors, declarations });
  }
  return rules;
}

const RULES = rulesOf(WITHOUT_COMMENTS);

// The declarations of every rule whose selector list holds `selector`, merged in order.
function declarationsFor(selector) {
  return RULES.filter((rule) => rule.selectors.includes(selector)).reduce(
    (merged, rule) => Object.assign(merged, rule.declarations),
    {},
  );
}

test("the banner sticks to the top of the window, over the page, under the sheet", () => {
  const banner = declarationsFor(".banner");
  assert.equal(banner.position, "sticky");
  assert.equal(banner.top, "0");
  assert.equal(banner["z-index"], "20");
  const sheet = RULES.filter((rule) => rule.declarations["z-index"] !== undefined)
    .filter((rule) => rule.selectors.some((selector) => selector.startsWith(".sheet")))
    .map((rule) => Number(rule.declarations["z-index"]));
  assert.ok(sheet.length > 0, "the sheet has a z-index");
  assert.ok(sheet.every((value) => value > 20), "the sheet draws over the banner");
});

test("the banner is a wrapping row whose side padding keeps its parts in the content column", () => {
  const banner = declarationsFor(".banner");
  assert.equal(banner.display, "flex");
  assert.equal(banner["flex-wrap"], "wrap");
  assert.equal(banner["align-items"], "center");
  assert.match(banner.padding, /max\(var\(--s-4\), calc\(\(100% - var\(--col-max\)\) \/ 2 \+ var\(--s-4\)\)\)/);
  assert.match(banner["padding-top"], /env\(safe-area-inset-top\)/);
  assert.equal(declarationsFor(".banner[hidden]").display, "none");
  assert.equal(declarationsFor(".banner__text").flex, "1 1 160px");
  assert.equal(declarationsFor(".banner__actions")["flex-wrap"], "wrap");
});

test("each kind colors the strip, its edge and its icon from the tokens; the words stay --text", () => {
  const working = declarationsFor(".banner");
  assert.equal(working.background, "var(--accent-soft)");
  assert.equal(working["box-shadow"], "inset 4px 0 0 var(--accent)");
  assert.equal(working.color, "var(--text)");
  assert.equal(declarationsFor(".banner__icon").color, "var(--accent)");

  const ready = declarationsFor(".banner--ready");
  assert.equal(ready.background, "var(--ok-bg)");
  assert.equal(ready["box-shadow"], "inset 4px 0 0 var(--ok)");
  assert.equal(declarationsFor(".banner--ready .banner__icon").color, "var(--ok)");

  const failed = declarationsFor(".banner--failed");
  assert.equal(failed.background, "var(--record-bg)");
  assert.equal(failed["box-shadow"], "inset 4px 0 0 var(--record)");
  assert.equal(declarationsFor(".banner--failed .banner__icon").color, "var(--record)");
  assert.equal(declarationsFor(".banner--failed .banner__title").color, "var(--record-text)");
  assert.equal(declarationsFor(".banner__body").color, "var(--muted)");
});

test("the banner's buttons keep the 44px tap height, and its spinner is the small one", () => {
  assert.equal(declarationsFor(".banner__action")["min-height"], "44px");
  const spinner = declarationsFor(".banner__icon .spinner");
  assert.equal(spinner.width, "20px");
  assert.equal(spinner.height, "20px");
});

test("the banner hides with the nav while the active Practice records or uploads in place", () => {
  const hiding = RULES.filter((rule) => rule.declarations.display === "none")
    .flatMap((rule) => rule.selectors)
    .filter((selector) => selector.endsWith(" .banner"));
  assert.deepEqual(hiding, [
    'body:has(#screen-practice.screen--active[data-state="recording"]) .banner',
    'body:has(#screen-practice.screen--active[data-state="uploading"]) .banner',
  ]);
});

test("Say it better has no Hear it button or row to style any more", () => {
  const selectors = RULES.flatMap((rule) => rule.selectors);
  assert.equal(selectors.includes(".lang-say__hear"), false);
  assert.equal(selectors.includes(".lang-say__row"), false);
  const better = declarationsFor(".lang-say__better");
  assert.equal(better.margin, "var(--s-2) 0 0");
});
