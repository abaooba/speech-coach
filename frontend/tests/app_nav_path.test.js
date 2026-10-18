// Tests for the nav's active item in frontend/app.js now that the nav holds Practice, Path,
// Progress and History: a level has no nav item of its own, so on #/level/<playId> the Path's
// item is the one marked, and leaving the level for another screen moves the mark with it.
// app.js runs in a vm context with a fake window and document; each nav link records the class
// and aria-current the router gives it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const SCREENS = ["practice", "results", "history", "progress", "path", "level"];
const NAV_HREFS = [...INDEX_HTML.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)[1].matchAll(
  /<a class="nav__item" href="([^"]+)">/g,
)].map((match) => match[1]);

function fakeLink(href) {
  const link = { href, classes: new Set(), attributes: {} };
  link.getAttribute = (name) => (name === "href" ? href : (link.attributes[name] ?? null));
  link.setAttribute = (name, value) => {
    link.attributes[name] = String(value);
  };
  link.removeAttribute = (name) => {
    delete link.attributes[name];
  };
  link.classList = {
    toggle: (className, on) => (on ? link.classes.add(className) : link.classes.delete(className)),
  };
  return link;
}

function fakeSection() {
  return {
    hidden: true,
    classList: { add: () => {}, remove: () => {} },
    querySelector: () => null,
    contains: () => false,
  };
}

// Boots app.js on `startHash` with every screen a stub; returns the links and a goTo(hash).
async function bootAt(startHash) {
  const links = NAV_HREFS.map(fakeLink);
  const sections = Object.fromEntries(SCREENS.map((name) => ["screen-" + name, fakeSection()]));
  const windowHandlers = {};
  const documentHandlers = {};
  const fakeWindow = {
    location: { hash: startHash },
    addEventListener: (type, handler) => {
      windowHandlers[type] = handler;
    },
  };
  const document = {
    title: "",
    activeElement: null,
    addEventListener: (type, handler) => {
      documentHandlers[type] = handler;
    },
    getElementById: (id) => sections[id] || null,
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === ".nav__item" ? links : []),
  };
  vm.runInNewContext(APP_SOURCE, { window: fakeWindow, document }, { filename: "app.js" });
  SCREENS.forEach((name) => {
    fakeWindow.app.screens[name] = { mount: () => {}, show: () => {}, hide: () => {} };
  });
  await documentHandlers.DOMContentLoaded();
  return {
    links,
    goTo: (hash) => {
      fakeWindow.location.hash = hash;
      windowHandlers.hashchange();
    },
  };
}

// The hrefs of the links marked active, and of those carrying aria-current="page".
function marked(links) {
  return {
    active: links.filter((link) => link.classes.has("nav__item--active")).map((l) => l.href),
    current: links.filter((link) => link.attributes["aria-current"] === "page").map((l) => l.href),
  };
}

test("the nav holds Practice, Path, Progress and History, in that order", () => {
  assert.deepEqual(NAV_HREFS, ["#/practice", "#/path", "#/progress", "#/history"]);
});

test("on #/path the Path item is active and the page's current item", async () => {
  const page = await bootAt("#/path");
  assert.deepEqual(marked(page.links), { active: ["#/path"], current: ["#/path"] });
});

test("on a level the Path item is active: a level has no nav item of its own", async () => {
  const page = await bootAt("#/level/fillers-3");
  assert.deepEqual(marked(page.links), { active: ["#/path"], current: ["#/path"] });
  page.goTo("#/level/fillers-3_checkback");
  assert.deepEqual(marked(page.links), { active: ["#/path"], current: ["#/path"] });
});

test("leaving a level for Practice or Progress moves the mark off the Path", async () => {
  const page = await bootAt("#/level/pace-1");
  page.goTo("#/practice");
  assert.deepEqual(marked(page.links), { active: ["#/practice"], current: ["#/practice"] });
  page.goTo("#/level/pace-1");
  page.goTo("#/progress");
  assert.deepEqual(marked(page.links), { active: ["#/progress"], current: ["#/progress"] });
});

test("Results still marks no nav item", async () => {
  const page = await bootAt("#/results/abc");
  assert.deepEqual(marked(page.links), { active: [], current: [] });
});
