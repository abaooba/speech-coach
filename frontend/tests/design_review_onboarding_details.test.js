// The 2026-10-19 design review: Onboarding's seven-sentence privacy paragraph keeps its words
// but folds into a details element, closed by default, under the summary "How your audio is
// handled", with a link to how.html's "Your audio" section after it. The promise card and the
// three measured items stay in view above the button.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(FRONTEND, ...parts), "utf8");
const HOW = read("how.html");
const CSS = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const DESIGN = read("DESIGN.md");

function mountOnboarding() {
  const app = { screens: {}, store: { setFlag: () => Promise.resolve() }, router: { go() {} } };
  const context = { app, document: fakeDocument() };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read("screens", "onboarding.js"), context, { filename: "onboarding.js" });
  const section = new FakeElement("section");
  section.appendChild(new FakeElement("h1"));
  const body = new FakeElement("div");
  body.className = "screen__body";
  section.appendChild(body);
  app.screens.onboarding.mount(section);
  return { body, COPY: app.screens.onboarding.COPY };
}

function textOf(node) {
  return (node.textContent || "") + (node.children || []).map(textOf).join("");
}

test("the privacy paragraph sits in a closed details under its summary, then the link", () => {
  const { body, COPY } = mountOnboarding();
  const details = body.children[3];
  assert.equal(details.tagName, "details");
  assert.equal(details.className, "onboarding__privacy-details");
  assert.ok(!details.getAttribute("open"), "closed by default");
  const [summary, privacy, link] = details.children;
  assert.equal(details.children.length, 3);
  assert.equal(summary.tagName, "summary");
  assert.equal(textOf(summary), "How your audio is handled");
  assert.equal(privacy.tagName, "p");
  assert.equal(privacy.className, "onboarding__privacy");
  assert.equal(textOf(privacy), COPY.privacy, "the paragraph's words are unchanged");
  assert.equal(link.tagName, "a");
  assert.equal(link.getAttribute("href"), "how.html#your-audio");
  assert.ok(textOf(link).length > 0);
});

test("the promise card and the three measured items stay visible above the button", () => {
  const { body } = mountOnboarding();
  const names = body.children.map((child) => child.tagName + "." + child.className);
  assert.deepEqual(names, [
    "p.onboarding__lead",
    "div.onboarding__promise",
    "ul.onboarding__list",
    "details.onboarding__privacy-details",
    "button.btn btn--primary btn--block",
  ]);
  assert.equal(byClass(body, "onboarding__list").children.length, 3);
});

test("how.html's Your audio section carries the id the link points at", () => {
  assert.match(HOW, /<section class="how__section" id="your-audio">\s*<h2>Your audio<\/h2>/);
});

test("the summary is a 44px small accent row and the paragraph keeps its muted small type", () => {
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = CSS.match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"));
    assert.ok(match, "styles.css has a rule for " + selector);
    return match[1];
  };
  const summary = rule(".onboarding__privacy-summary");
  assert.match(summary, /min-height:\s*44px/);
  assert.match(summary, /font-size:\s*var\(--fs-small\)/);
  assert.match(summary, /color:\s*var\(--accent\)/);
  assert.match(rule(".onboarding__privacy"), /color:\s*var\(--muted\)/);
  assert.match(rule(".onboarding__privacy-link"), /color:\s*var\(--accent\)/);
});

test("DESIGN.md describes the folded privacy paragraph", () => {
  assert.match(DESIGN, /How your audio is handled/);
  assert.match(DESIGN, /details\.onboarding__privacy-details/);
});
