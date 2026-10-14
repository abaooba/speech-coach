// Tests that frontend/app.js never routes before boot has mounted the screens. index.html loads
// app.js first and the nav is on the page from the first paint, so a nav tap can change the hash
// while the other scripts still load. Routing that tap early showed a screen before its mount()
// (a TypeError in the real screens) or, with the screen's script not run yet, showed nothing
// while recording the hash as routed, so boot's own route was skipped and the page stayed blank.
// app.js runs in a vm context with a fake window and document; the window keeps every listener
// and fires them as a browser does, reporting a listener's error instead of stopping on it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const SCREEN_NAMES = ["onboarding", "practice", "results", "history", "progress", "account"];

// A promise with its resolve handle, to hold an await open.
function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

// Runs app.js against a fake page: a section per screen that logs when it is made active, and a
// window that keeps its listeners. page.registerScreens() adds the screens as their scripts
// would; each logs mount and show, and its show() throws before its mount() has run, as the real
// screens do. `readFlag`, when given, answers app.store.getFlag("onboarded").
function loadPage(startHash, { readFlag } = {}) {
  const page = { log: [], errors: [] };
  const location = { hash: startHash };
  const sections = {};
  SCREEN_NAMES.forEach((name) => {
    sections["screen-" + name] = {
      hidden: true,
      classList: {
        add: () => page.log.push("activate " + name),
        remove: () => {},
      },
      querySelector: () => null,
      contains: () => false,
    };
  });
  const documentHandlers = {};
  const windowListeners = {};
  const fakeWindow = {
    location,
    addEventListener: (type, handler) => {
      (windowListeners[type] = windowListeners[type] || []).push(handler);
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
    querySelectorAll: () => [],
  };
  vm.runInNewContext(APP_SOURCE, { window: fakeWindow, document }, { filename: "app.js" });
  const app = fakeWindow.app;
  page.registerScreens = () => {
    SCREEN_NAMES.forEach((name) => {
      let mounted = false;
      app.screens[name] = {
        mount: () => {
          mounted = true;
          page.log.push("mount " + name);
        },
        show: () => {
          if (!mounted) {
            throw new TypeError(name + ".show() ran before its mount()");
          }
          page.log.push("show " + name);
        },
        hide: () => page.log.push("hide " + name),
      };
    });
  };
  if (readFlag) {
    app.store = { getFlag: () => readFlag() };
  }
  page.location = location;
  // A nav tap: the hash changes and the browser fires hashchange at every listener there is.
  page.tapNav = (hash) => {
    location.hash = hash;
    page.fireHashChange();
  };
  page.fireHashChange = () => {
    (windowListeners.hashchange || []).forEach((listener) => {
      try {
        listener({ type: "hashchange" });
      } catch (error) {
        page.errors.push(error.message);
      }
    });
  };
  page.boot = () => documentHandlers.DOMContentLoaded();
  return page;
}

function shown(log) {
  return log.filter((entry) => entry.startsWith("show "));
}

// True when every mount comes before the first show.
function mountsFirst(log) {
  const firstShow = log.findIndex((entry) => entry.startsWith("show "));
  const lastMount = log.reduce((last, entry, index) => (entry.startsWith("mount ") ? index : last), -1);
  return firstShow === -1 || lastMount < firstShow;
}

test("a nav tap before the screens' scripts ran is shown once boot has mounted them", async () => {
  const page = loadPage("#/practice");
  page.tapNav("#/history");
  page.registerScreens();
  await page.boot();
  assert.deepEqual(page.errors, []);
  assert.deepEqual(shown(page.log), ["show history"], "boot routes the hash the tap left");
  assert.ok(mountsFirst(page.log), page.log.join(", "));
  assert.equal(page.log.filter((entry) => entry.startsWith("activate ")).pop(), "activate history");
});

test("a nav tap after the scripts ran but before boot never shows an unmounted screen", async () => {
  const page = loadPage("#/practice");
  page.registerScreens();
  page.tapNav("#/progress");
  assert.deepEqual(page.errors, [], "no show() before mount()");
  assert.deepEqual(page.log, [], "nothing is routed before boot");
  await page.boot();
  assert.deepEqual(page.errors, []);
  assert.deepEqual(shown(page.log), ["show progress"]);
  assert.ok(mountsFirst(page.log), page.log.join(", "));
});

test("the hashchange a tap queued before boot, arriving after it, shows nothing twice", async () => {
  const page = loadPage("#/practice");
  page.registerScreens();
  page.location.hash = "#/history";
  await page.boot();
  page.log.length = 0;
  page.fireHashChange();
  assert.deepEqual(page.log, []);
  assert.deepEqual(page.errors, []);
});

test("after boot a nav tap routes as usual", async () => {
  const page = loadPage("#/practice");
  page.registerScreens();
  await page.boot();
  page.log.length = 0;
  page.tapNav("#/history");
  assert.deepEqual(page.log, ["hide practice", "activate history", "show history"]);
  assert.deepEqual(page.errors, []);
});

test("a first launch tapped during script load still opens Onboarding, mounted first", async () => {
  const page = loadPage("#/practice", { readFlag: () => Promise.resolve(undefined) });
  page.registerScreens();
  page.tapNav("#/history");
  await page.boot();
  assert.deepEqual(page.errors, []);
  assert.equal(page.location.hash, "#/onboarding");
  assert.deepEqual(shown(page.log), ["show onboarding"]);
  assert.ok(mountsFirst(page.log), page.log.join(", "));
});

test("a nav tap while the onboarded flag is read shows that screen once, after mount", async () => {
  const reading = deferred();
  const page = loadPage("#/practice", { readFlag: () => reading.promise });
  page.registerScreens();
  const booting = page.boot();
  page.tapNav("#/history");
  reading.resolve(true);
  await booting;
  assert.deepEqual(page.errors, []);
  assert.deepEqual(shown(page.log), ["show history"]);
  assert.ok(mountsFirst(page.log), page.log.join(", "));
});
