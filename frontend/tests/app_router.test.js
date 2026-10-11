// Tests for the hash router in frontend/app.js: what a route change does to the page's scroll,
// the tab's title and keyboard focus. app.js runs in a vm context with a fake window and
// document that log what the router does; a test boots the app, sets a new hash and fires the
// hashchange handler app.js registered.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// Each screen's h1 in index.html. Onboarding's is the app's own name.
const HEADINGS = {
  onboarding: "Speech Coach",
  practice: "Practice",
  results: "Results",
  history: "History",
  progress: "Progress",
};
const NAV_HREFS = ["#/practice", "#/history", "#/progress"];

// An element that can sit inside another, hold attributes and take focus. focus() makes it the
// document's activeElement and logs its label, noting a request not to scroll.
function fakeElement(page, label, parent) {
  const element = {
    label,
    parent,
    attributes: {},
    textContent: "",
    setAttribute: (name, value) => {
      element.attributes[name] = String(value);
    },
    getAttribute: (name) =>
      Object.hasOwn(element.attributes, name) ? element.attributes[name] : null,
    removeAttribute: (name) => {
      delete element.attributes[name];
    },
    contains: (other) => {
      for (let node = other; node; node = node.parent) {
        if (node === element) {
          return true;
        }
      }
      return false;
    },
    focus: (options) => {
      page.focusLog.push(label + (options && options.preventScroll ? " (no scroll)" : ""));
      page.document.activeElement = element;
    },
  };
  return element;
}

// A <section class="screen"> holding its h1 and one button. It logs when the router makes it
// the active screen.
function fakeSection(page, name) {
  const section = fakeElement(page, name + " section", page.body);
  section.hidden = true;
  section.classList = {
    add: (className) => page.log.push("activate " + name + " (" + className + ")"),
    remove: () => {},
  };
  section.heading = fakeElement(page, HEADINGS[name] + " heading", section);
  section.heading.textContent = HEADINGS[name];
  section.button = fakeElement(page, name + " button", section);
  section.querySelector = (selector) => (selector === "h1" ? section.heading : null);
  return section;
}

// The <nav class="nav"> and its three links.
function fakeNav(page) {
  const nav = fakeElement(page, "nav", page.body);
  nav.links = NAV_HREFS.map((href) => {
    const link = fakeElement(page, "nav link " + href, nav);
    link.attributes.href = href;
    link.classList = { toggle: () => {} };
    return link;
  });
  return nav;
}

// Runs app.js against a fake page whose focus starts on <body>. `withScrollTo: false` leaves
// window.scrollTo out, as some test fakes do. Route steps go to page.log and focus calls to
// page.focusLog; a test may replace a screen's show() through page.app or remove a DOM API
// from page.document, page.nav or page.sections before the route it checks.
function loadApp(startHash, { withScrollTo = true } = {}) {
  const page = { log: [], focusLog: [], sections: {} };
  page.body = fakeElement(page, "body", null);
  page.nav = fakeNav(page);
  Object.keys(HEADINGS).forEach((name) => {
    page.sections[name] = fakeSection(page, name);
  });
  const documentHandlers = {};
  const windowHandlers = {};
  const fakeWindow = {
    location: { hash: startHash },
    addEventListener: (type, handler) => {
      windowHandlers[type] = handler;
    },
  };
  if (withScrollTo) {
    fakeWindow.scrollTo = (x, y) => page.log.push("scrollTo " + x + "," + y);
  }
  page.document = {
    title: "",
    activeElement: page.body,
    addEventListener: (type, handler) => {
      documentHandlers[type] = handler;
    },
    getElementById: (id) => page.sections[id.replace(/^screen-/, "")] || null,
    querySelector: (selector) => (/^(nav)?\.nav$|^nav$/.test(selector) ? page.nav : null),
    querySelectorAll: (selector) => (selector === ".nav__item" ? page.nav.links : []),
  };
  const context = { window: fakeWindow, document: page.document };
  vm.runInNewContext(APP_SOURCE, context, { filename: "app.js" });
  page.app = fakeWindow.app;
  Object.keys(HEADINGS).forEach((name) => {
    page.app.screens[name] = {
      mount: () => {},
      show: (params) => page.log.push("show " + name + (params.id ? " " + params.id : "")),
      hide: () => page.log.push("hide " + name),
    };
  });
  page.boot = () => documentHandlers.DOMContentLoaded();
  // Changes the hash the way a link or app.router.go does, then lets the router run.
  page.goTo = (hash) => {
    fakeWindow.location.hash = hash;
    windowHandlers.hashchange();
  };
  return page;
}

function scrolls(log) {
  return log.filter((entry) => entry.startsWith("scrollTo"));
}

test("a change to another screen scrolls the page to the top once that screen is active", () => {
  const page = loadApp("#/history");
  page.boot();
  page.log.length = 0;
  page.goTo("#/results/take-1");
  assert.deepEqual(page.log, [
    "hide history",
    "activate results (screen--active)",
    "scrollTo 0,0",
    "show results take-1",
  ]);
});

test("every screen change scrolls to the top, whichever screens it joins", () => {
  const page = loadApp("#/practice");
  page.boot();
  for (const hash of ["#/history", "#/progress", "#/practice", "#/results/take-1"]) {
    page.log.length = 0;
    page.goTo(hash);
    assert.deepEqual(scrolls(page.log), ["scrollTo 0,0"], "after going to " + hash);
  }
});

test("another session on Results scrolls to the top too", () => {
  const page = loadApp("#/results/take-1");
  page.boot();
  page.log.length = 0;
  page.goTo("#/results/take-2");
  assert.deepEqual(scrolls(page.log), ["scrollTo 0,0"]);
  assert.ok(page.log.includes("show results take-2"));
});

test("a hash that lands on the screen already shown keeps the scroll", () => {
  // An unknown or empty hash is Practice, and the same session id is the same page.
  const cases = [
    ["#/practice", "#/nowhere"],
    ["#/practice", ""],
    ["#/results/take-1", "#results/take-1"],
  ];
  for (const [startHash, nextHash] of cases) {
    const page = loadApp(startHash);
    page.boot();
    page.log.length = 0;
    page.goTo(nextHash);
    assert.deepEqual(scrolls(page.log), [], startHash + " then " + JSON.stringify(nextHash));
    assert.ok(page.log.some((entry) => entry.startsWith("show ")), "the screen is shown again");
  }
});

test("a window without scrollTo still routes to the new screen", () => {
  const page = loadApp("#/practice", { withScrollTo: false });
  page.boot();
  page.log.length = 0;
  assert.doesNotThrow(() => page.goTo("#/history"));
  assert.deepEqual(page.log, [
    "hide practice",
    "activate history (screen--active)",
    "show history",
  ]);
});

test("the tab title names the screen by its heading", () => {
  const page = loadApp("#/practice");
  page.boot();
  assert.equal(page.document.title, "Practice · Speech Coach");
  const titles = [
    ["#/results/take-1", "Results · Speech Coach"],
    ["#/history", "History · Speech Coach"],
    ["#/progress", "Progress · Speech Coach"],
    ["#/practice", "Practice · Speech Coach"],
  ];
  for (const [hash, title] of titles) {
    page.goTo(hash);
    assert.equal(page.document.title, title, "on " + hash);
  }
});

test("a heading that is the app's own name, or no heading at all, gives the plain title", () => {
  const onboarding = loadApp("#/onboarding");
  onboarding.boot();
  assert.equal(onboarding.document.title, "Speech Coach");

  const noHeading = loadApp("#/history");
  noHeading.sections.history.querySelector = () => null;
  noHeading.boot();
  assert.equal(noHeading.document.title, "Speech Coach");

  const noQuery = loadApp("#/history");
  delete noQuery.sections.history.querySelector;
  noQuery.boot();
  assert.equal(noQuery.document.title, "Speech Coach");
});

test("the boot route leaves focus where the browser put it", () => {
  const page = loadApp("#/results/take-1");
  page.boot();
  assert.deepEqual(page.focusLog, []);
  assert.equal(page.document.activeElement, page.body);
  assert.equal(page.sections.results.heading.getAttribute("tabindex"), null);
});

test("after an in-app change focus moves to the new screen's heading, without scrolling", () => {
  // A History row's button had focus, and it is hidden with its screen.
  const page = loadApp("#/history");
  page.boot();
  page.document.activeElement = page.sections.history.button;
  let focusDuringShow = null;
  page.app.screens.results.show = () => {
    focusDuringShow = page.document.activeElement;
  };
  page.goTo("#/results/take-1");
  const heading = page.sections.results.heading;
  assert.equal(focusDuringShow, page.sections.history.button, "focus moves after show() runs");
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.deepEqual(page.focusLog, ["Results heading (no scroll)"]);
  assert.equal(page.document.activeElement, heading);
});

test("focus left on the page body moves to the new screen's heading too", () => {
  const page = loadApp("#/practice");
  page.boot();
  page.goTo("#/progress");
  assert.deepEqual(page.focusLog, ["Progress heading (no scroll)"]);
  assert.equal(page.sections.progress.heading.getAttribute("tabindex"), "-1");
});

test("a nav activation keeps focus on the nav link", () => {
  const page = loadApp("#/practice");
  page.boot();
  const historyLink = page.nav.links[1];
  page.document.activeElement = historyLink;
  page.goTo("#/history");
  assert.deepEqual(page.focusLog, []);
  assert.equal(page.document.activeElement, historyLink);
  assert.equal(page.sections.history.heading.getAttribute("tabindex"), null);
});

test("focus that show() puts inside the new screen stays there", () => {
  const page = loadApp("#/history");
  page.boot();
  page.app.screens.practice.show = () => page.sections.practice.button.focus();
  page.goTo("#/practice");
  assert.deepEqual(page.focusLog, ["practice button"]);
  assert.equal(page.document.activeElement, page.sections.practice.button);
});

test("routing survives fakes without focus, contains, querySelector or activeElement", () => {
  const removals = {
    "no focus() on the heading": (page) => delete page.sections.results.heading.focus,
    "no contains() on the section": (page) => delete page.sections.results.contains,
    "no contains() on the nav": (page) => delete page.nav.contains,
    "no document.querySelector": (page) => delete page.document.querySelector,
    "no document.activeElement": (page) => delete page.document.activeElement,
  };
  for (const [what, remove] of Object.entries(removals)) {
    const page = loadApp("#/history");
    page.boot();
    remove(page);
    assert.doesNotThrow(() => page.goTo("#/results/take-1"), what);
    assert.ok(page.log.includes("show results take-1"), what);
    assert.equal(page.document.title, "Results · Speech Coach", what);
    assert.equal(page.sections.results.heading.getAttribute("tabindex"), "-1", what);
  }
});
