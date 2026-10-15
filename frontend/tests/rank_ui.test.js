// Tests for the rank card on screen (docs/PLAN.md T37, "ladder and lens"; the tier spec's
// sections 1 to 6, 8 and 10): app.rankCard.build in frontend/rankcard.js, the card's place on
// Progress and Results, the flame icon in ui.js and the card's section of styles.css. ui.js,
// delivery.js, rank.js, rankcard.js and the screens run for real against the shared fake DOM,
// so every take is scored from its words exactly as the app scores it; app.store and
// app.router are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const SOURCES = {
  ui: UI_SOURCE,
  delivery: read("delivery.js"),
  rank: read("rank.js"),
  rankCard: read("rankcard.js"),
  results: read(path.join("screens", "results.js")),
  progress: read(path.join("screens", "progress.js")),
};
const CSS = read("styles.css");

const SVG_NS = "http://www.w3.org/2000/svg";
const FLAME_PATH =
  "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 " +
  "6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z";
const NBSP = "\u00a0";

// One word every 0.4 s is 150 wpm, inside the default 140 to 160 band; with no filler, pause or
// restart, rank.js scores the take 100.
const WORD_SECONDS = 0.4;

// A clean take of `seconds` saved at `createdAt`.
function cleanTake(id, createdAt, seconds) {
  const count = Math.round(seconds / WORD_SECONDS);
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: seconds,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: "word",
      start: index * WORD_SECONDS,
      end: (index + 1) * WORD_SECONDS,
    })),
  };
}

// Three clean 2-minute takes a day apart rate 64.0 after the first, 74.3 (Varsity) after the
// second and 80.0 (Elite) after the third.
const DAY_1 = cleanTake("day-1", "2026-10-11T12:00:00", 120);
const DAY_2 = cleanTake("day-2", "2026-10-12T12:00:00", 120);
const DAY_3 = cleanTake("day-3", "2026-10-13T12:00:00", 120);
const ELITE_TAKES = [DAY_1, DAY_2, DAY_3];
const TODAY = "2026-10-13T18:00:00";

// Nine clean 3-minute takes rate 97.9: a Master, with nine of the gate's ten slots passing. A
// tenth makes 100 with every slot passing: Flawless.
const MASTER_TAKES = Array.from({ length: 9 }, (_, index) =>
  cleanTake("m" + index, "2026-10-0" + (index + 1) + "T12:00:00", 180),
);
const FLAWLESS_TAKES = [...MASTER_TAKES, cleanTake("m9", "2026-10-10T12:00:00", 180)];

// ui.js, delivery.js, rank.js, rankcard.js and results.js in one context, in index.html's order.
function load() {
  const context = { app: { screens: {} }, document: fakeDocument() };
  ["ui", "delivery", "rank", "rankCard", "results"].forEach((name) =>
    vm.runInNewContext(SOURCES[name], context, { filename: name + ".js" }),
  );
  return context.app;
}

function progressCard(takes, today = TODAY) {
  const app = load();
  const model = app.rankCard.model(takes, { screen: "progress", today });
  return app.rankCard.build(model, { screen: "progress" });
}

function resultsCard(takes, takeId) {
  const app = load();
  const model = app.rankCard.model(takes, { screen: "results", takeId });
  return app.rankCard.build(model, { screen: "results" });
}

// The class of an element: an SVG element keeps it in the attribute, since its className is
// read-only in browsers.
function classOf(node) {
  return node.className || (node.getAttribute ? node.getAttribute("class") : null) || "";
}

// Every class in the tree in document order, one entry per element that has one.
function classOrder(node) {
  if (!node.children) {
    return [];
  }
  const own = classOf(node);
  return [...(own ? [own] : []), ...node.children.flatMap(classOrder)];
}

// The first element in the tree whose class list holds `name`.
function find(node, name) {
  if (!node.children) {
    return null;
  }
  if (classOf(node).split(" ").includes(name)) {
    return node;
  }
  for (const child of node.children) {
    const found = find(child, name);
    if (found) {
      return found;
    }
  }
  return null;
}

// What a screen reader hears from a node: its text and its children's, skipping aria-hidden.
function spoken(node) {
  if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
    return "";
  }
  return (node.textContent || "") + (node.children || []).map(spoken).join("");
}

// What the eye reads: text outside .sr-only.
function visible(node) {
  if (classOf(node).split(" ").includes("sr-only")) {
    return "";
  }
  return (node.textContent || "") + (node.children || []).map(visible).join("");
}

// The tier spec's parts, in order. `current` is the speaker's tier, lowest first from 0.
const TIER_LINE = ["rank-card__tier", "sr-only"];
const RATING_LINE = ["rank-card__rating", "sr-only", "sr-only"];
const NEXT_LINE = ["rank-card__next", "sr-only", "sr-only"];

function ladderParts(current) {
  const rows = [6, 5, 4, 3, 2, 1, 0].flatMap((tier) => {
    let state = "ahead";
    if (tier < current) {
      state = "passed";
    } else if (tier === current) {
      state = "current";
    }
    const top = tier === 6 ? " rank-ladder__tier--top" : "";
    const hidden = tier === current ? ["sr-only", "sr-only"] : ["sr-only"];
    return [
      "rank-ladder__tier rank-ladder__tier--" + state + top,
      "rank-ladder__mark",
      "rank-ladder__name",
      "rank-ladder__floor",
      ...hidden,
    ];
  });
  return ["rank-ladder", ...rows];
}

// The whole card: Results adds its change line under the tier and, in the same tier, the notch.
function cardParts({ current, change = null, notch = false, gate = null }) {
  return [
    "rank-card",
    "sr-only",
    "rank-card__body",
    "rank-card__stats",
    ...TIER_LINE,
    ...(change || []),
    ...RATING_LINE,
    "rank-card__bar",
    "rank-card__fill",
    ...(notch ? ["rank-card__notch"] : []),
    "rank-card__ends",
    ...NEXT_LINE,
    ...ladderParts(current),
    ...(gate || []),
    "rank-card__foot",
  ];
}

const ELITE = 3;
const VARSITY = 2;
const MASTER = 5;
const UP_LINE = ["rank-card__change rank-card__change--up", "sr-only", "sr-only"];

test("ui.js draws a flame in the icons' 24-unit, 2-unit stroke style", () => {
  const app = load();
  const flame = app.ui.icon("flame", 16);
  assert.equal(flame.namespaceURI, SVG_NS);
  assert.equal(flame.getAttribute("data-icon"), "flame");
  assert.equal(flame.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(flame.getAttribute("width"), "16");
  assert.equal(flame.getAttribute("fill"), "none");
  assert.equal(flame.getAttribute("stroke"), "currentColor");
  assert.equal(flame.getAttribute("stroke-width"), "2");
  assert.equal(flame.getAttribute("aria-hidden"), "true");
  assert.deepEqual(
    flame.children.map((child) => [child.tagName, child.attributes]),
    [["path", { d: FLAME_PATH }]],
  );
});

test("the flame sits right after contrast in ui.js's icon list", () => {
  const names = [...UI_SOURCE.matchAll(/^ {4}"?([a-z-]+)"?: \[/gm)].map((match) => match[1]);
  const contrast = names.indexOf("contrast");
  assert.deepEqual(names.slice(contrast, contrast + 3), ["contrast", "flame", "moon"]);
});

test("the Progress card draws the tier spec's parts in order, with the streak foot", () => {
  const card = progressCard(ELITE_TAKES);
  assert.equal(card.tagName, "section");
  assert.deepEqual(classOrder(card), cardParts({ current: ELITE }));
  const foot = find(card, "rank-card__foot");
  const [icon, words] = foot.children;
  assert.equal(icon.getAttribute("data-icon"), "flame");
  assert.equal(icon.getAttribute("width"), "16");
  assert.equal(words.tagName, "span");
  assert.equal(visible(foot), "Current streak 3 days, longest 3");
});

test("the Results card adds the change line under the tier and the take's sentences", () => {
  const card = resultsCard(ELITE_TAKES, "day-3");
  assert.deepEqual(classOrder(card), cardParts({ current: ELITE, change: UP_LINE }));
  const change = find(card, "rank-card__change");
  assert.equal(change.children[0].getAttribute("data-icon"), "triangle-up");
  assert.equal(change.children[0].getAttribute("width"), "12");
  assert.equal(visible(change), "Up 5.7, now Elite");
  const foot = find(card, "rank-card__foot");
  assert.equal(foot.children.length, 1, "no icon on Results");
  assert.equal(
    visible(foot),
    "This take scored 100. At least 2 more takes to Champion, even perfect ones.",
  );
});

test("in the same tier the Results card adds the notch where the rating stood before", () => {
  // The second take moved Varsity's 64.0 to 74.3: the notch sits (64 - 60) / 15 along the bar.
  const card = resultsCard(ELITE_TAKES, "day-2");
  assert.deepEqual(
    classOrder(card),
    cardParts({ current: VARSITY, change: UP_LINE, notch: true }),
  );
  assert.equal(find(card, "rank-card__notch").getAttribute("style"), "left:26.67%");
  assert.equal(visible(find(card, "rank-card__change")), "Up 10.3");
});

test("a first rated take's change line is its words alone", () => {
  const card = resultsCard([DAY_1], "day-1");
  const change = find(card, "rank-card__change");
  assert.equal(classOf(change), "rank-card__change rank-card__change--first");
  assert.equal(change.children.length, 1, "no icon");
  assert.equal(spoken(change), "First rated take");
});

test("the ladder lists all 7 tiers best first, with exactly one aria-current", () => {
  for (const card of [progressCard(ELITE_TAKES), resultsCard(ELITE_TAKES, "day-2")]) {
    const ladder = find(card, "rank-ladder");
    assert.equal(ladder.tagName, "ol");
    assert.equal(ladder.getAttribute("role"), "list", "Safari drops a list's role with its style");
    assert.equal(ladder.getAttribute("aria-label"), "All 7 tiers, top first");
    assert.equal(ladder.children.length, 7);
    ladder.children.forEach((row) => assert.equal(row.tagName, "li"));
    const current = ladder.children.filter((row) => row.getAttribute("aria-current") !== null);
    assert.equal(current.length, 1);
    assert.equal(current[0].getAttribute("aria-current"), "true");
    assert.ok(classOf(current[0]).includes("rank-ladder__tier--current"));
  }
  const rows = find(progressCard(ELITE_TAKES), "rank-ladder").children;
  assert.deepEqual(rows.map(spoken), [
    "Flawless, from 99",
    "Master, from 96",
    "Champion, from 88",
    "Elite, from 75, your tier",
    "Varsity, from 60",
    "Contender, from 40",
    "Novice, from 0",
  ]);
  assert.deepEqual(rows.map(visible), [
    "Flawless99",
    "Master96",
    "Champion88",
    "Elite75",
    "Varsity60",
    "Contender40",
    "Novice0",
  ]);
  rows.forEach((row) => assert.equal(row.children[0].getAttribute("aria-hidden"), "true"));
});

test("screen readers hear the card in the tier spec's order; the drawings are hidden", () => {
  const card = resultsCard(ELITE_TAKES, "day-3");
  const [heading, body, foot] = card.children;
  assert.equal(heading.tagName, "h2");
  assert.equal(classOf(heading), "sr-only");
  assert.equal(heading.textContent, "Your rank");
  assert.equal(card.getAttribute("aria-labelledby"), heading.getAttribute("id"));
  const lines = body.children[0].children.map(spoken).filter(Boolean);
  assert.deepEqual(
    lines.map((line) => line.replace(NBSP, " ")),
    [
      "Tier: Elite",
      "Rating Up 5.7 with this take, now Elite",
      "Rating 80.0 out of 100",
      "8.0 points to Champion, which starts at 88",
    ],
  );
  assert.equal(spoken(foot), visible(foot));
  for (const hidden of ["rank-card__bar", "rank-card__ends"]) {
    assert.equal(find(card, hidden).getAttribute("aria-hidden"), "true", hidden);
  }
});

test("the caption keeps its number and 'to' together, and the next floor is hidden text", () => {
  const next = find(progressCard(ELITE_TAKES), "rank-card__next");
  assert.equal(next.children[0].tagName, "strong");
  assert.equal(next.children[0].textContent, "8.0");
  assert.equal(visible(next), "8.0" + NBSP + "to Champion");
  const top = find(progressCard(FLAWLESS_TAKES), "rank-card__next");
  assert.equal(top.children.length, 1);
  assert.equal(top.children[0].tagName, "strong");
  assert.equal(spoken(top), "Top tier");
});

test("the bar sits at its true place, with no ruler or wedge above it", () => {
  const card = progressCard(ELITE_TAKES);
  // 80.0 is (80 - 75) / 13 of Elite's 75 to 88.
  assert.equal(find(card, "rank-card__fill").getAttribute("style"), "width:38.46%");
  for (const removed of ["rank-card__scale", "rank-card__ruler", "rank-card__zoom"]) {
    assert.equal(find(card, removed), null, removed + " was removed: one bar, no wedge");
  }
  assert.deepEqual(
    find(card, "rank-card__ends").children.map((end) => end.textContent),
    ["75", "88"],
  );
});

test("a Master's card adds the gate's ten pills and its sentence above the streak", () => {
  const card = progressCard(MASTER_TAKES, "2026-10-09T18:00:00");
  const gate = [
    "rank-card__gate",
    "rank-card__pills",
    "rank-card__pill",
    ...Array(9).fill("rank-card__pill rank-card__pill--pass"),
    "rank-card__gate-text",
  ];
  assert.deepEqual(classOrder(card), cardParts({ current: MASTER, gate }));
  assert.equal(find(card, "rank-card__pills").getAttribute("aria-hidden"), "true");
  assert.equal(
    find(card, "rank-card__gate-text").textContent,
    "9 of your last 10 takes pass. Flawless needs all 10: 2 minutes or more, 97 or more, " +
      "no long pause.",
  );
  assert.equal(visible(find(card, "rank-card__foot")), "Current streak 9 days, longest 9");
});

test("Progress and Results each label their card with a heading id of their own", () => {
  const progress = progressCard(ELITE_TAKES);
  const results = resultsCard(ELITE_TAKES, "day-3");
  const progressId = progress.children[0].getAttribute("id");
  const resultsId = results.children[0].getAttribute("id");
  assert.ok(progressId && resultsId);
  assert.notEqual(progressId, resultsId);
  assert.equal(progress.getAttribute("aria-labelledby"), progressId);
  assert.equal(results.getAttribute("aria-labelledby"), resultsId);
});

test("nothing in the card takes focus or a click", () => {
  const card = resultsCard(ELITE_TAKES, "day-2");
  const all = (node) => (node.children ? [node, ...node.children.flatMap(all)] : []);
  for (const node of all(card)) {
    assert.ok(!["button", "a", "input"].includes(node.tagName), node.tagName);
    assert.equal(node.getAttribute("tabindex"), null);
    assert.deepEqual(Object.keys(node.listeners || {}), []);
  }
});

// styles.css section "10b. Rank card", right before section 11.
const SECTION_START = "/* 10b. Rank card";
const SECTION_END = "/* 11. Reduced motion";

function sectionText() {
  const start = CSS.indexOf(SECTION_START);
  const end = CSS.indexOf(SECTION_END);
  assert.ok(start !== -1, "styles.css has section 10b");
  assert.ok(end > start, "section 10b comes before section 11");
  return CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
}

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

// The section's rules as { at, selectors, declarations }, `at` the enclosing @media or null.
function rulesOf(text, at = null, rules = []) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    let depth = 0;
    let close = open;
    for (; close < text.length; close += 1) {
      depth += text[close] === "{" ? 1 : text[close] === "}" ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }
    const prelude = squash(text.slice(cursor, open));
    const body = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      rulesOf(body, prelude, rules);
    } else {
      const declarations = {};
      body.split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
        }
      });
      rules.push({ at, selectors: prelude.split(",").map(squash), declarations });
    }
    cursor = close + 1;
  }
  return rules;
}

// Parsed on first use, so a missing section fails each test that reads it, not the whole file.
let parsedRules = null;
function sectionRules() {
  if (parsedRules === null) {
    parsedRules = rulesOf(sectionText());
  }
  return parsedRules;
}

function declared(selector, at = null) {
  return sectionRules()
    .filter((rule) => rule.at === at && rule.selectors.includes(selector))
    .reduce((all, rule) => Object.assign(all, rule.declarations), {});
}

test("styles.css gives the card its own section right before section 11", () => {
  const start = CSS.indexOf(SECTION_START);
  assert.ok(CSS.indexOf("/* Onboarding screen") < start, "after the screens' own rules");
  const between = CSS.slice(start + SECTION_START.length, CSS.indexOf(SECTION_END));
  assert.doesNotMatch(between, /\/\* \d+[a-z]?\. /, "no other numbered section in between");
  assert.equal(CSS.split(SECTION_START).length, 2, "one section 10b");
});

test("the card's colours are the tier spec's tokens only: no hex and no opacity", () => {
  const allowed = [
    "--surface",
    "--border",
    "--text",
    "--muted",
    "--grid",
    "--accent",
    "--accent-soft",
    "--ok",
  ];
  const colours = /^(color|background|background-color|border|border-color|fill)$/;
  sectionRules().forEach((rule) => {
    Object.entries(rule.declarations).forEach(([name, value]) => {
      assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b/i, `${rule.selectors} ${name}`);
      assert.notEqual(name, "opacity", `${rule.selectors} uses opacity`);
      if (colours.test(name)) {
        const tokens = [...value.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]);
        tokens.forEach((token) => assert.ok(allowed.includes(token), `${name}: ${value}`));
      }
    });
  });
});

test("the section spaces only with the --s scale", () => {
  const spacing = /^(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/;
  const step = /^(0|auto|var\(--s-[1-7]\))$/;
  sectionRules().forEach((rule) => {
    Object.entries(rule.declarations)
      .filter(([name]) => spacing.test(name))
      .forEach(([name, value]) => {
        value.split(" ").forEach((part) => {
          assert.match(part, step, `${rule.selectors.join(", ")} ${name}: ${value}`);
        });
      });
  });
});

test("the card is a bordered surface box with stats beside a ladder of 20px rows", () => {
  const card = declared(".rank-card");
  assert.equal(card.background, "var(--surface)");
  assert.equal(card.border, "1px solid var(--border)");
  assert.equal(card["border-radius"], "var(--r-card)");
  assert.equal(card.padding, "var(--s-4)");
  assert.equal(card["font-variant-numeric"], "tabular-nums");
  assert.equal(card["box-shadow"], undefined);
  const body = declared(".rank-card__body");
  assert.equal(body.display, "grid");
  assert.equal(body["grid-template-columns"], "minmax(0, 1fr) auto");
  assert.equal(body["column-gap"], "var(--s-4)");
  const row = declared(".rank-ladder__tier");
  assert.equal(row["grid-template-columns"], "8px 1fr auto");
  assert.equal(row.height, "20px");
  assert.equal(row["border-radius"], "var(--r-chip)");
  assert.equal(row["white-space"], "nowrap");
  const ladder = declared(".rank-ladder");
  assert.equal(ladder["list-style"], "none");
});

test("the speaker's tier is accent on accent-soft, and an Up line is --ok", () => {
  const current = declared(".rank-ladder__tier--current");
  assert.equal(current.background, "var(--accent-soft)");
  assert.equal(current.color, "var(--accent)");
  assert.equal(current["font-weight"], "600");
  const mark = (state) => declared(".rank-ladder__tier--" + state + " .rank-ladder__mark");
  assert.equal(mark("current").background, "var(--accent)");
  assert.equal(mark("passed").background, "var(--muted)");
  assert.equal(mark("ahead").background, undefined, "an ahead tier's mark is hollow");
  assert.equal(declared(".rank-ladder__mark").border, "1.5px solid var(--muted)");
  assert.equal(declared(".rank-card__fill").background, "var(--accent)");
  assert.equal(declared(".rank-card__bar").background, "var(--grid)");
  for (const removed of [".rank-card__ruler", ".rank-card__slice", ".rank-card__zoom polygon"]) {
    assert.deepEqual(declared(removed), {}, removed + ": no ruler or wedge styles left");
  }
  assert.equal(declared(".rank-card__notch").background, "var(--text)");
  assert.equal(declared(".rank-card__change").color, "var(--muted)");
  assert.equal(declared(".rank-card__change--up").color, "var(--ok)");
  assert.equal(declared(".rank-card__pill--pass").background, "var(--ok)");
  assert.equal(declared(".rank-card__next strong").color, "var(--text)");
});

test("the card sits 24px under the Results stat strip and 32px above Progress's switch", () => {
  assert.equal(declared("#screen-results .rank-card")["margin-top"], "var(--s-5)");
  assert.equal(declared("#screen-progress .rank-card")["margin-bottom"], "var(--s-6)");
});

test("narrow screens shrink the rating, then stack the ladder, then drop the marks", () => {
  assert.equal(
    declared(".rank-card__rating", "@media (max-width: 359px)")["font-size"],
    "var(--fs-metric-narrow)",
  );
  assert.equal(declared(".rank-card__rating")["font-size"], "var(--fs-metric)");
  const stacked = declared(".rank-card__body", "@media (max-width: 319px)");
  assert.equal(stacked["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(stacked["row-gap"], "var(--s-3)");
  assert.equal(declared(".rank-ladder__mark", "@media (max-width: 199px)").display, "none");
});

// The screens. index.html loads rank.js and rankcard.js before the screens; `rank` and `card`
// leave either out, as index.html does until it is wired. The store serves `sessions` newest
// first. `calls.draws` counts Results draws: every draw empties the body and starts again with
// the meta line. `tips` stands in for tips.js when a test needs the coach notes.
function mountScreen(name, sessions, options) {
  const { rank = true, card = true, tips = null } = options || {};
  const app = { screens: {}, store: {}, router: { go() {} } };
  const context = { app, document: fakeDocument() };
  const files = ["ui", "delivery", rank ? "rank" : null, card ? "rankCard" : null, "results"];
  files
    .concat(name === "progress" ? ["progress"] : [])
    .filter(Boolean)
    .forEach((file) => vm.runInNewContext(SOURCES[file], context, { filename: file + ".js" }));
  if (tips) {
    app.tips = tips;
  }
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  app.store.get = (id) => Promise.resolve(byId[id]);
  app.store.list = () => Promise.resolve([...newestFirst]);

  const calls = { draws: 0 };
  const root = new FakeElement("section");
  root.appendChild(new FakeElement("h1"));
  const body = new FakeElement("div");
  body.className = "screen__body";
  const append = body.appendChild.bind(body);
  body.appendChild = (child) => {
    if (child.classList && child.classList.contains("results__meta")) {
      calls.draws += 1;
    }
    return append(child);
  };
  root.appendChild(body);
  const screen = app.screens[name];
  screen.mount(root);
  return { screen, body, calls };
}

async function showProgress(sessions, options) {
  const page = mountScreen("progress", sessions, options);
  await page.screen.show();
  return page;
}

async function showResults(sessions, id, options) {
  const page = mountScreen("results", sessions, options);
  await page.screen.show({ id });
  return page;
}

// The body's direct children by their first class: "rank-card", "segmented", "state", ...
function partsOf(body) {
  return body.children.map((child) => classOf(child).split(" ")[0]);
}

// The tree as plain data, for comparing two draws: tags, classes, attributes and text.
function snapshot(node) {
  if (!node.children) {
    return { text: node.textContent };
  }
  return {
    tag: node.tagName,
    className: classOf(node),
    attributes: { ...node.attributes },
    text: node.textContent,
    children: node.children.map(snapshot),
  };
}

// Local noon `daysAgo` days before today. Progress counts its streak to the real clock, so its
// takes are dated from it: the day before yesterday, yesterday and today make a 3-day streak.
function localNoon(daysAgo) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

const RECENT_TAKES = [2, 1, 0].map((daysAgo) => cleanTake("r" + daysAgo, localNoon(daysAgo), 120));

function sampleTake(id, createdAt) {
  return { ...cleanTake(id, createdAt, 120), passageTitle: "Sample: Congress" };
}

test("Progress puts the card first under the h1, a section gap above the switch", async () => {
  const { body } = await showProgress(RECENT_TAKES);
  assert.deepEqual(partsOf(body).slice(0, 3), ["rank-card", "segmented", "progress__title"]);
  const card = body.children[0];
  assert.equal(visible(find(card, "rank-card__tier")), "Elite");
  assert.equal(visible(find(card, "rank-card__rating")), "80.0");
  assert.equal(find(card, "rank-card__change"), null, "no change line on Progress");
  assert.equal(visible(find(card, "rank-card__foot")), "Current streak 3 days, longest 3");
});

test("with one rated take Progress puts the card above Need two sessions", async () => {
  const { body } = await showProgress([RECENT_TAKES[2]]);
  assert.deepEqual(partsOf(body), ["rank-card", "state"]);
  const [card, block] = body.children;
  assert.equal(visible(find(card, "rank-card__tier")), "Varsity");
  assert.equal(visible(find(card, "rank-card__rating")), "64.0");
  assert.equal(find(block, "state__title").textContent, "Need two sessions");
  assert.equal(find(block, "state__body").textContent, "Record one more to see a trend.");
});

test("Progress draws no card with no rated take: no takes, or a sample alone", async () => {
  for (const sessions of [[], [sampleTake("sample", localNoon(0))]]) {
    const { body } = await showProgress(sessions);
    assert.deepEqual(partsOf(body), ["state"]);
    assert.equal(find(body, "state__body").textContent, "Record two sessions to see a trend.");
  }
});

test("a sample never counts toward Progress's card", async () => {
  const sample = sampleTake("sample", localNoon(0));
  const withSample = await showProgress([...RECENT_TAKES, sample]);
  const without = await showProgress(RECENT_TAKES);
  assert.deepEqual(snapshot(withSample.body.children[0]), snapshot(without.body.children[0]));
});

test("Results puts the card under the stat strip and above the transcript", async () => {
  const { body } = await showResults(ELITE_TAKES, "day-3");
  assert.deepEqual(partsOf(body).slice(0, 7), [
    "results__meta",
    "headline",
    "speech-map",
    "stat-strip",
    "stat-strip__note",
    "rank-card",
    "results__heading",
  ]);
  const card = find(body, "rank-card");
  assert.equal(visible(find(card, "rank-card__change")), "Up 5.7, now Elite");
  assert.equal(
    visible(find(card, "rank-card__foot")),
    "This take scored 100. At least 2 more takes to Champion, even perfect ones.",
  );
});

test("a reopened take's card shows the rank as it stood after that take", async () => {
  const { body } = await showResults(ELITE_TAKES, "day-2");
  const card = find(body, "rank-card");
  assert.equal(visible(find(card, "rank-card__tier")), "Varsity");
  assert.equal(visible(find(card, "rank-card__rating")), "74.3");
  assert.equal(visible(find(card, "rank-card__change")), "Up 10.3");
  assert.ok(find(card, "rank-card__notch"), "same tier, so the notch marks 64.0");
});

test("Results draws no card for a sample", async () => {
  const sample = sampleTake("sample", "2026-10-14T12:00:00");
  const { body } = await showResults([...ELITE_TAKES, sample], "sample");
  assert.equal(find(body, "rank-card"), null);
  assert.equal(find(body, "stat-strip__note"), null, "a sample compares with nothing");
});

test("a first take's card comes with the store's list, in one more draw", async () => {
  const withCard = await showResults([DAY_1], "day-1");
  assert.equal(withCard.calls.draws, 2, "at once, then with the card");
  assert.equal(visible(find(withCard.body, "rank-card__change")), "First rated take");
  const without = await showResults([DAY_1], "day-1", { rank: false, card: false });
  assert.equal(without.calls.draws, 1, "no last take and no card: one draw, as before the card");
  assert.equal(find(without.body, "rank-card"), null);
});

test("the card stays in place when the coach notes redraw Results", async () => {
  const notes = {
    tips: [
      {
        entry_id: "filler-001",
        text: "Stay silent where the um would go.",
        drill: "",
        citation: { label: "A Coach, Ums (2017)", url: "https://example.org/um", type: "coach" },
      },
    ],
    source: "ai",
  };
  const tips = { select: () => [], coachNotes: () => Promise.resolve(notes) };
  const { body, calls } = await showResults(ELITE_TAKES, "day-3", { tips });
  assert.equal(calls.draws, 3, "the take, the comparison and card, then the notes");
  assert.deepEqual(partsOf(body).slice(1, 6), [
    "headline",
    "speech-map",
    "stat-strip",
    "stat-strip__note",
    "rank-card",
  ]);
  assert.ok(find(body, "coach-notes"), "the notes arrived");
});

test("without rank.js or rankcard.js both screens draw exactly as before the card", async () => {
  const before = { rank: false, card: false };
  for (const missing of [{ rank: false }, { card: false }]) {
    for (const sessions of [[], [RECENT_TAKES[2]], RECENT_TAKES]) {
      const now = await showProgress(sessions, missing);
      const then = await showProgress(sessions, before);
      assert.deepEqual(snapshot(now.body), snapshot(then.body), JSON.stringify(missing));
    }
    for (const [sessions, id] of [
      [ELITE_TAKES, "day-3"],
      [[DAY_1], "day-1"],
    ]) {
      const now = await showResults(sessions, id, missing);
      const then = await showResults(sessions, id, before);
      assert.deepEqual(snapshot(now.body), snapshot(then.body), JSON.stringify(missing));
      assert.equal(now.calls.draws, then.calls.draws);
    }
  }
});
