// Tests for the Results action bar (DESIGN.md sections 1, 3, 6 and 9; audit L6): the last child
// of the screen, stuck above the nav, one row with the screen's only primary button, "Record
// again", whose width caps at 320px on wide screens (History is the nav's tab, never a second
// button). At 200% zoom on a phone the row wraps rather than overflow, and a focused link or
// button above the bar scrolls clear of the bar, the nav and its own focus ring. On a short or zoomed
// window (review a11y-4) the bar sits at the end of the page instead of covering it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);
const CSS = read("styles.css");

const SESSION = {
  id: "s1",
  createdAt: "2026-10-09T22:21:00.000Z",
  passageId: "gettysburg",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 3,
  metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
  transcript: "We win today.".split(" ").map((text, index) => ({
    text,
    start: index * 0.4,
    end: index * 0.4 + 0.3,
  })),
};

async function showResults(id) {
  const routes = [];
  const context = {
    app: {
      screens: {},
      passages: [{ id: "gettysburg", targetWpm: [130, 150] }],
      store: { get: (wanted) => Promise.resolve(wanted === SESSION.id ? SESSION : undefined) },
      router: { go: (name) => routes.push(name) },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id });
  return { body, routes };
}

// Every element under `node`, depth first.
function descendants(node) {
  return (node.children || []).flatMap((child) => [child, ...descendants(child)]);
}

test("the action bar is the last child: Record again alone; History is the nav's tab", async () => {
  const { body } = await showResults("s1");
  const actions = body.children[body.children.length - 1];
  assert.equal(actions.tagName, "div");
  assert.equal(actions.className, "results__actions");
  assert.deepEqual(
    actions.children.map((button) => [button.tagName, button.className, button.textContent]),
    [["button", "btn btn--primary", "Record again"]],
  );
  actions.children.forEach((button) => assert.equal(button.getAttribute("type"), "button"));
  assert.equal(descendants(body).some((node) => node.textContent === "History"), false);
});

test("Record again is the only primary button on the screen", async () => {
  const { body } = await showResults("s1");
  const primaries = descendants(body).filter(
    (node) => node.classList && node.classList.contains("btn--primary"),
  );
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].textContent, "Record again");
});

test("found by class, Record again goes to Practice", async () => {
  const { body, routes } = await showResults("s1");
  const actions = byClass(body, "results__actions");
  byClass(actions, "btn--primary").click();
  assert.equal(byClass(actions, "btn--ghost"), undefined);
  assert.deepEqual(routes, ["practice"]);
});

test("a missing session shows no action bar, only the state's History action", async () => {
  const { body } = await showResults("nope");
  assert.equal(body.children.length, 1);
  assert.equal(byClass(body, "results__actions"), undefined);
});

// Every declaration styles.css gives this exact selector outside @-rules, later rules winning.
function rule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = {};
  let found = false;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((part) => part.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) {
      found = true;
      match[2].split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      });
    }
  }
  assert.ok(found, `styles.css needs a rule for ${selector}`);
  return declarations;
}

test("the bar sticks above the nav on the page background with a top border", () => {
  const bar = rule(".results__actions");
  assert.equal(bar.position, "sticky");
  assert.equal(bar.bottom, "calc(var(--nav-h) + env(safe-area-inset-bottom))");
  assert.equal(bar.background, "var(--bg)");
  assert.equal(bar["border-top"], "1px solid var(--border)");
  assert.equal(bar.display, "flex");
  assert.equal(bar.padding, "var(--s-3) 0");
  assert.notEqual(bar["flex-direction"], "column", "one row");
});

test("Record again fills the row, caps at 320px and parks at the column's end", () => {
  const primary = rule(".results__actions .btn--primary");
  assert.equal(primary.flex, "1 1 auto");
  assert.equal(primary["max-width"], "320px");
  assert.equal(primary["margin-left"], "auto", "a margin, never end alignment");
});

test("the bar wraps rather than overflows, and never aligns to the end", () => {
  const bar = rule(".results__actions");
  assert.equal(bar["flex-wrap"], "wrap");
  assert.doesNotMatch(
    bar["justify-content"] || "",
    /^(flex-)?end$|^right$/,
    "end alignment sends an overflowing row off the left edge, where nothing can scroll to it",
  );
  const ghost = ALL_RULES.find((entry) => entry.selector === ".results__actions .btn--ghost");
  assert.equal(ghost, undefined, "no ghost button rule: the bar holds Record again alone");
});

// Every rule in styles.css as {at, selector, declarations}: `at` is the enclosing @-rule or
// null, and whitespace is squashed so a value split across lines reads as one line.
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
      const declarations = {};
      body.split(";").forEach((part) => {
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

const ALL_RULES = parseRules(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));
const ABOVE_THE_BAR = "#screen-results :is(a, button):not(.results__actions *)";

function declarationsAt(selector, at) {
  const found = ALL_RULES.find((entry) => entry.selector === selector && entry.at === at);
  assert.ok(found, `styles.css needs ${at ? at + " { " : ""}${selector} { … }`);
  return found.declarations;
}

test("a focused link or button above the bar scrolls clear of the bar, nav and ring", () => {
  assert.equal(
    declarationsAt(ABOVE_THE_BAR, null)["scroll-margin-bottom"],
    "calc(var(--nav-h) + var(--s-7) + var(--s-6) + env(safe-area-inset-bottom))",
    "the nav, one 48px button row, then the bar's padding and border and the 5px ring",
  );
});

// Landscape phones (568 x 320) and 200% zoom on a phone (160 to 187px wide) leave too little
// height for a bar stuck over the page: with the nav it covered up to two thirds of it.
const SHORT_OR_ZOOMED = "@media (max-height: 480px), (max-width: 319px)";
const STATIC_BAR_ROOM = ABOVE_THE_BAR + ", #screen-results .results__actions button";

test("on a short or zoomed window the bar sits at the end of the page instead", () => {
  const bar = declarationsAt("#screen-results .results__actions", SHORT_OR_ZOOMED);
  assert.equal(bar.position, "static", "it scrolls away with the page, so it covers nothing");
  assert.equal(bar["margin-bottom"], "0", "it no longer reaches into main's padding to the nav");
  assert.equal(rule(".results__actions").position, "sticky", "everywhere else it stays stuck");
});

test("there every focused link or button, the bar's own too, scrolls clear of the nav", () => {
  assert.equal(
    declarationsAt(STATIC_BAR_ROOM, SHORT_OR_ZOOMED)["scroll-margin-bottom"],
    "calc(var(--nav-h) + var(--s-2) + env(safe-area-inset-bottom))",
    "with no bar over the page, focus clears only the nav, ring and all, as on History",
  );
  const last = ALL_RULES.filter((entry) => entry.selector.startsWith(ABOVE_THE_BAR)).pop();
  assert.equal(last.at, SHORT_OR_ZOOMED, "it follows the stuck bar's room, so it wins there");
});

test("the stuck bar's buttons ask for no scroll room, so tabbing into it never scrolls", () => {
  for (const { at, selector, declarations } of ALL_RULES) {
    if (!/screen-results|results__/.test(selector)) {
      continue;
    }
    const names = Object.keys(declarations);
    assert.ok(
      !names.some((name) => name.startsWith("scroll-padding")),
      `${selector}: padding the page's scroll area would also cover the bar's own buttons`,
    );
    const inPage = at === SHORT_OR_ZOOMED && selector === STATIC_BAR_ROOM;
    if (selector !== ABOVE_THE_BAR && !inPage) {
      assert.ok(!names.some((name) => name.startsWith("scroll-margin")), selector);
    }
  }
});
