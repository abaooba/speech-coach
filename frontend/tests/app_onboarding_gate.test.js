// Tests for the first-launch gate in frontend/app.js's boot: when app.store says the speaker has
// not onboarded, the router opens Onboarding before the first route. app.js runs in a vm context
// with a fake window and document; a fake app.store answers getFlag("onboarded").
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const SCREEN_NAMES = ["onboarding", "practice", "results", "history", "progress"];

// A promise with its resolve handle, to hold an await open.
function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

// Runs app.js against a fake page: five sections that log when they are made active, screens
// that log mount, show and hide, and a store whose getFlag answers with `readFlag()`. When
// `withStore` is false app.store is left out. page.queuedHashChanges counts the hashchange
// events the browser would fire, one per change to location.hash; page.fireHashChange() runs
// the handler app.js registered, as the browser does once the boot has finished.
function bootApp(startHash, { readFlag = () => Promise.resolve(undefined), withStore = true } = {}) {
  const page = { log: [], focusLog: [], queuedHashChanges: 0 };
  let hash = startHash;
  const location = {
    get hash() {
      return hash;
    },
    set hash(value) {
      const next = value.startsWith("#") ? value : "#" + value;
      if (next !== hash) {
        page.queuedHashChanges += 1;
      }
      hash = next;
    },
  };
  const sections = {};
  SCREEN_NAMES.forEach((name) => {
    const heading = {
      textContent: name === "onboarding" ? "Speech Coach" : name,
      setAttribute: () => {},
      focus: () => page.focusLog.push(name + " heading"),
    };
    sections["screen-" + name] = {
      hidden: true,
      classList: {
        add: () => page.log.push("activate " + name),
        remove: () => {},
      },
      querySelector: (selector) => (selector === "h1" ? heading : null),
      contains: () => false,
    };
  });
  const documentHandlers = {};
  const windowHandlers = {};
  const fakeWindow = {
    location,
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
    querySelectorAll: () => [],
  };
  vm.runInNewContext(APP_SOURCE, { window: fakeWindow, document }, { filename: "app.js" });
  const app = fakeWindow.app;
  SCREEN_NAMES.forEach((name) => {
    app.screens[name] = {
      mount: () => page.log.push("mount " + name),
      show: () => page.log.push("show " + name),
      hide: () => page.log.push("hide " + name),
    };
  });
  if (withStore) {
    app.store = {
      getFlag: (key) => {
        page.log.push("getFlag " + key);
        return readFlag();
      },
    };
  }
  page.location = location;
  page.fireHashChange = () => windowHandlers.hashchange();
  page.boot = () => documentHandlers.DOMContentLoaded();
  return page;
}

function shown(log) {
  return log.filter((entry) => entry.startsWith("show "));
}

test("a first launch on any other hash goes to Onboarding before the first route", async () => {
  for (const startHash of ["", "#/practice", "#/history", "#/results/take-1"]) {
    const page = bootApp(startHash);
    await page.boot();
    assert.equal(page.location.hash, "#/onboarding", "from " + JSON.stringify(startHash));
    assert.deepEqual(shown(page.log), ["show onboarding"], "from " + JSON.stringify(startHash));
  }
});

test("the flag is read after every screen has mounted, and the route waits for it", async () => {
  const reading = deferred();
  const page = bootApp("#/practice", { readFlag: () => reading.promise });
  const booting = page.boot();
  assert.deepEqual(page.log, [
    "mount onboarding",
    "mount practice",
    "mount results",
    "mount history",
    "mount progress",
    "getFlag onboarded",
  ]);
  reading.resolve(true);
  await booting;
  assert.deepEqual(shown(page.log), ["show practice"]);
});

test("a speaker who has onboarded opens the hash they asked for", async () => {
  for (const [startHash, screen] of [
    ["", "practice"],
    ["#/history", "history"],
    ["#/onboarding", "onboarding"],
  ]) {
    const page = bootApp(startHash, { readFlag: () => Promise.resolve(true) });
    await page.boot();
    assert.equal(page.location.hash, startHash);
    assert.equal(page.queuedHashChanges, 0);
    assert.deepEqual(shown(page.log), ["show " + screen]);
  }
});

test("a first launch already on #/onboarding stays there without a hash change", async () => {
  const page = bootApp("#/onboarding", { readFlag: () => Promise.resolve(false) });
  await page.boot();
  assert.equal(page.queuedHashChanges, 0);
  assert.deepEqual(shown(page.log), ["show onboarding"]);
});

test("the hashchange the gate queues does not show Onboarding again or move focus", async () => {
  const page = bootApp("");
  await page.boot();
  assert.equal(page.queuedHashChanges, 1);
  page.log.length = 0;
  page.fireHashChange();
  assert.deepEqual(page.log, []);
  assert.deepEqual(page.focusLog, []);
});

test("after the gate, Start practicing's hash change routes to Practice as usual", async () => {
  const page = bootApp("");
  await page.boot();
  page.fireHashChange();
  page.log.length = 0;
  page.location.hash = "#/practice";
  page.fireHashChange();
  assert.deepEqual(page.log, ["hide onboarding", "activate practice", "show practice"]);
  assert.deepEqual(page.focusLog, ["practice heading"]);
});

test("a store that cannot answer opens the app ungated instead of a blank page", async () => {
  const failures = {
    "getFlag rejects": () => Promise.reject(new Error("IndexedDB is blocked")),
    "getFlag throws": () => {
      throw new Error("indexedDB is not defined");
    },
  };
  for (const [what, readFlag] of Object.entries(failures)) {
    const page = bootApp("#/history", { readFlag });
    await assert.doesNotReject(async () => page.boot(), what);
    assert.equal(page.location.hash, "#/history", what);
    assert.deepEqual(shown(page.log), ["show history"], what);
  }
});

test("without app.store the boot routes at once, with no gate", () => {
  const page = bootApp("", { withStore: false });
  page.boot();
  assert.equal(page.location.hash, "");
  assert.deepEqual(shown(page.log), ["show practice"]);
});
