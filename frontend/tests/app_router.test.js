// Tests for the hash router in frontend/app.js: what a route change does to the page's scroll.
// app.js runs in a vm context with a fake window and document that log what the router does;
// a test boots the app, sets a new hash and fires the hashchange handler app.js registered.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const SCREEN_NAMES = ["onboarding", "practice", "results", "history", "progress"];

// A <section class="screen"> that logs when the router makes it the active screen.
function fakeSection(name, log) {
  return {
    hidden: true,
    classList: {
      add: (className) => log.push("activate " + name + " (" + className + ")"),
      remove: () => {},
    },
  };
}

// Runs app.js against a fake page. `withScrollTo: false` leaves window.scrollTo out, as some
// test fakes do. Returns the page's log, its window and helpers to boot and change the hash.
function loadApp(startHash, { withScrollTo = true } = {}) {
  const log = [];
  const documentHandlers = {};
  const windowHandlers = {};
  const sections = {};
  SCREEN_NAMES.forEach((name) => {
    sections["screen-" + name] = fakeSection(name, log);
  });
  const fakeWindow = {
    location: { hash: startHash },
    addEventListener: (type, handler) => {
      windowHandlers[type] = handler;
    },
  };
  if (withScrollTo) {
    fakeWindow.scrollTo = (x, y) => log.push("scrollTo " + x + "," + y);
  }
  const document = {
    title: "",
    addEventListener: (type, handler) => {
      documentHandlers[type] = handler;
    },
    getElementById: (id) => sections[id] || null,
    querySelectorAll: () => [],
  };
  vm.runInNewContext(APP_SOURCE, { window: fakeWindow, document }, { filename: "app.js" });
  const app = fakeWindow.app;
  SCREEN_NAMES.forEach((name) => {
    app.screens[name] = {
      mount: () => {},
      show: (params) => log.push("show " + name + (params.id ? " " + params.id : "")),
      hide: () => log.push("hide " + name),
    };
  });
  return {
    log,
    sections,
    boot: () => documentHandlers.DOMContentLoaded(),
    // Changes the hash the way a link or app.router.go does, then lets the router run.
    goTo: (hash) => {
      fakeWindow.location.hash = hash;
      windowHandlers.hashchange();
    },
  };
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
