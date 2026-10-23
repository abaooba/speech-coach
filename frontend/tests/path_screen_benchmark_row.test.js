// The Path's benchmark as one compact row (spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 5, which lets the benchmark
// card turn compact so the Units switch and the shown unit reach the first screen). While a
// benchmark is due, its title and its length sit in the first column and one secondary Start,
// named "Start benchmark", spans both rows of the second; under 320px the Start drops under them
// at the row's full width. The card's old sentence ("Same passage, same prompt, every 14 days.
// See your real progress.") is left to the next move and the Level screen's Goal. The screen runs
// for real through tests/path-screen-harness.js; the stylesheet is read as text, section 13
// alone.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  mountPath,
  sitting,
  classOf,
  find,
  visible,
  everything,
} = require("./path-screen-harness");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION = CSS.slice(CSS.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");
const NARROW = "@media (max-width: 319px)";

async function shown(options) {
  const mounted = mountPath(options);
  await mounted.screen.show({});
  return mounted;
}

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
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

// The section's rules as {at, selector, declarations}, `at` the enclosing @-rule or null.
function parseRules(text, at = null, rules = []) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    const prelude = squash(text.slice(cursor, open));
    const close = closingBrace(text, open);
    const inside = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      parseRules(inside, prelude, rules);
    } else {
      const declarations = {};
      inside.split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
        }
      });
      rules.push({ at, selector: prelude, declarations });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(SECTION);

// The declarations of the one rule with exactly this selector, outside any @-rule unless `at`.
function rule(selector, at = null) {
  const found = RULES.filter((entry) => entry.selector === selector && entry.at === at);
  assert.equal(found.length, 1, "one rule for " + selector + (at ? " in " + at : ""));
  return found[0].declarations;
}

// --- the row ------------------------------------------------------------------------------

test("a due benchmark is one row: its title, its length, then a Start named for it", async () => {
  const { app, body, routes } = await shown();
  const row = find(body, "path-benchmark");
  assert.equal(row.tagName, "section");
  assert.deepEqual(row.children.map(classOf), [
    "path-benchmark__title",
    "path-benchmark__text",
    "btn btn--secondary path-benchmark__start",
  ]);
  const [title, length, start] = row.children;
  assert.equal(title.tagName, "h2");
  assert.equal(visible(title), "Benchmark day");
  assert.equal(length.tagName, "p");
  assert.equal(visible(length), app.path.playById("benchmark").goal.length);
  assert.equal(visible(length), "About 3 minutes");
  assert.equal(start.tagName, "button");
  assert.equal(start.getAttribute("type"), "button");
  assert.equal(visible(start), "Start", "the same word as every other Start on the Path");
  assert.equal(start.getAttribute("aria-label"), "Start benchmark", "its name says which play");
  start.click();
  assert.deepEqual(routes, [{ name: "level", id: "benchmark" }]);
});

test("the Path no longer carries the benchmark's sentence", async () => {
  const due = await shown();
  assert.ok(find(due.body, "path-benchmark"), "the benchmark is due");
  assert.doesNotMatch(everything(due.root), /Same passage|real progress/);
  const dated = await shown({ sessions: sitting("2026-10-13") });
  assert.equal(visible(find(dated.body, "path__next")), "Next benchmark: Tue, Oct 27");
  assert.doesNotMatch(everything(dated.root), /Same passage|real progress/);
});

// --- its stylesheet -------------------------------------------------------------------------

test("the row puts the title and the length in its first column, the Start across both rows", () => {
  const row = rule(".path-benchmark");
  assert.equal(row.display, "grid");
  assert.equal(row["grid-template-columns"], "minmax(0, 1fr) auto");
  assert.equal(row["align-items"], "center");
  assert.equal(row["column-gap"], "var(--s-3)");
  assert.equal(row.padding, "var(--s-3) var(--s-4)");
  assert.equal(row.border, "1px solid var(--border)");
  assert.equal(row["border-radius"], "var(--r-card)");
  assert.equal(row.background, "var(--surface)");
  const title = rule(".path-benchmark__title");
  assert.equal(title["grid-column"], "1");
  assert.equal(title.margin, "0");
  const text = rule(".path-benchmark__text");
  assert.equal(text["grid-column"], "1");
  assert.equal(text.margin, "0", "the length sits right under the title");
  assert.equal(text.color, "var(--muted)");
  assert.equal(text["font-size"], "var(--fs-small)");
  const start = rule(".path-benchmark__start");
  assert.equal(start["grid-column"], "2");
  assert.equal(start["grid-row"], "1 / span 2");
  assert.equal(start["margin-top"], undefined, "centred beside the words, not under them");
});

test("the benchmark row and the benchmark line keep --s-5 under them", () => {
  assert.equal(rule(".path-benchmark, .path__benchmark")["margin-bottom"], "var(--s-5)");
  const line = rule(".path__next, .path__since");
  assert.equal(line.margin, "var(--s-2) 0 0");
  assert.equal(line.color, "var(--muted)");
  assert.ok(
    RULES.every((entry) => !entry.selector.includes(".path-benchmark__text,")),
    "the row's length keeps a rule of its own",
  );
});

test("under 320px the Start drops under the words, at the row's full width", () => {
  assert.equal(rule(".path-benchmark", NARROW)["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(rule(".path-benchmark, .path-unit__card", NARROW).padding, "var(--s-3)");
  const start = rule(".path-benchmark__start", NARROW);
  assert.equal(start["grid-column"], "1");
  assert.equal(start["grid-row"], "auto");
  assert.equal(start.width, "100%");
  assert.equal(start["margin-top"], "var(--s-3)");
  assert.equal(start["overflow-wrap"], "anywhere");
});
