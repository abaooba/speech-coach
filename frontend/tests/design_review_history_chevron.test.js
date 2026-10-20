// The 2026-10-19 design review: a History row ends in a muted chevron, the one cue that a tap
// opens its Results now that the History guide is gone. It is decorative, so the open button's
// accessible name (its title, date, stats and status) does not change.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(FRONTEND, ...parts), "utf8");
const CSS = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const DESIGN = read("DESIGN.md");

function mountHistory(sessions) {
  const app = {
    screens: { results: { summarize: () => ({ wpm: 150, fillersPerMinute: 2, target: [130, 160] }) } },
    store: { list: () => Promise.resolve(sessions) },
    router: { go() {} },
  };
  const context = { app, document: fakeDocument() };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read("screens", "history.js"), context, { filename: "history.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.history.mount(root);
  return { history: app.screens.history, body };
}

const TAKE = { id: "s1", createdAt: "2026-10-11T22:15:00Z", passageTitle: "Your day" };

test("the open button ends in a decorative chevron-right of 20px", async () => {
  const { history, body } = mountHistory([TAKE]);
  await history.show();
  const open = byClass(byClass(body, "session-list").children[0], "session-row__open");
  const last = open.children[open.children.length - 1];
  assert.equal(last.tagName, "span");
  assert.equal(last.className, "session-row__chevron");
  assert.equal(last.getAttribute("aria-hidden"), "true");
  assert.equal(last.children.length, 1);
  const icon = last.children[0];
  assert.equal(icon.tagName, "svg");
  assert.equal(icon.getAttribute("data-icon"), "chevron-right");
  assert.equal(icon.getAttribute("width"), "20");
  assert.ok(!open.getAttribute("aria-label"), "the name stays the row's words");
});

function rule(selector, at) {
  const scope = at ? (CSS.match(new RegExp(at.replace(/[()]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\n\\}")) || [])[1] : CSS;
  assert.ok(scope, "styles.css has " + (at || "rules"));
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = scope.match(new RegExp("(?:^|\\n\\s*)" + escaped + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector + (at ? " under " + at : ""));
  return match[1];
}

test("the chevron is the last grid column, muted and right-aligned, on a phone and from 480px", () => {
  const chevron = rule(".session-row__chevron");
  assert.match(chevron, /grid-area:\s*chevron/);
  assert.match(chevron, /color:\s*var\(--muted\)/);
  assert.match(chevron, /justify-self:\s*end/);
  const phone = rule(".session-row__open");
  assert.match(phone, /grid-template-columns:\s*minmax\(min-content, 1fr\) auto;/);
  assert.match(phone, /grid-template-areas:\s*"text chevron" "stats chevron" "status chevron"/);
  const wide = rule(".session-row__open", "@media (min-width: 480px)");
  assert.match(wide, /grid-template-columns:\s*minmax\(min-content, 1fr\) auto auto;/);
  assert.match(wide, /grid-template-areas:\s*"text stats chevron" "text status chevron"/);
});

test("DESIGN.md's session row names the chevron", () => {
  assert.match(DESIGN, /`\.session-row__chevron`[^\n]*chevron-right[^\n]*--muted/);
});
