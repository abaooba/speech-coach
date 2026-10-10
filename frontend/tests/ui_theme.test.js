// Tests for the theme helpers in frontend/ui.js: app.ui.getTheme, setTheme, applyTheme and
// nextTheme. ui.js runs in a vm context, so localStorage, the document, its <html> element, the
// two theme-color metas and getComputedStyle are all fakes injected per test.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument } = require("./fake-dom");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const STORAGE_KEY = "speech-coach-theme";
const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

// The --bg values in styles.css, light and dark.
const BACKGROUND = { light: "#FFFFFF", dark: "#0F1115" };

function loadUi(globals) {
  const context = { app: {}, ...globals };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  return context.app.ui;
}

// A working localStorage that records every write.
function fakeStorage(initial) {
  const items = { ...initial };
  const writes = [];
  return {
    items,
    writes,
    getItem: (key) => (Object.hasOwn(items, key) ? items[key] : null),
    setItem: (key, value) => {
      writes.push([key, value]);
      items[key] = String(value);
    },
  };
}

// Storage that refuses reads and writes, as private modes and full quotas do.
function throwingStorage() {
  return {
    getItem: () => {
      throw new Error("SecurityError: storage is blocked");
    },
    setItem: () => {
      throw new Error("QuotaExceededError: storage is full");
    },
  };
}

// Storage whose every property access throws, as a blocked origin does.
function blockedStorage() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("SecurityError: access is denied for this document");
      },
    },
  );
}

class FakeMeta {
  constructor(media, content) {
    this.dataset = {};
    this.attributes = { name: "theme-color", media, content };
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

// A document holding <html> and the two theme-color metas from index.html. querySelectorAll is
// present only when `withQuery` is true, because the shared test fakes have none.
function themeDocument({ withQuery }) {
  const documentElement = { dataset: {} };
  const metas = [
    new FakeMeta("(prefers-color-scheme: light)", BACKGROUND.light),
    new FakeMeta("(prefers-color-scheme: dark)", BACKGROUND.dark),
  ];
  const queries = [];
  const document = { documentElement };
  if (withQuery) {
    document.querySelectorAll = (selector) => {
      queries.push(selector);
      return selector === THEME_COLOR_SELECTOR ? metas : [];
    };
  }
  return { document, documentElement, metas, queries };
}

// getComputedStyle that resolves --bg the way the stylesheet does: data-theme wins, otherwise
// the device scheme decides. The value keeps the leading space browsers may report.
function fakeGetComputedStyle(deviceScheme, calls) {
  return (element) => {
    calls.push(element);
    const forced = element.dataset.theme;
    const scheme = forced === "dark" || forced === "light" ? forced : deviceScheme;
    return { getPropertyValue: (name) => (name === "--bg" ? " " + BACKGROUND[scheme] : "") };
  };
}

function metaContents(metas) {
  return metas.map((meta) => meta.getAttribute("content"));
}

test("ui.js adds the four theme helpers and touches no storage or document at load", () => {
  const storage = fakeStorage({ [STORAGE_KEY]: "dark" });
  let storageReads = 0;
  const countingStorage = {
    getItem: (key) => {
      storageReads += 1;
      return storage.getItem(key);
    },
    setItem: storage.setItem,
  };
  const page = themeDocument({ withQuery: true });
  const ui = loadUi({ localStorage: countingStorage, document: page.document });
  for (const name of ["getTheme", "applyTheme", "setTheme", "nextTheme"]) {
    assert.equal(typeof ui[name], "function", `app.ui.${name} should be a function`);
  }
  assert.equal(storageReads, 0);
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(page.documentElement.dataset, {});
  assert.deepEqual(page.queries, []);
});

test("getTheme returns the saved choice", () => {
  for (const choice of ["auto", "dark", "light"]) {
    const ui = loadUi({ localStorage: fakeStorage({ [STORAGE_KEY]: choice }) });
    assert.equal(ui.getTheme(), choice);
  }
});

test("getTheme returns auto when nothing or something unknown is saved", () => {
  assert.equal(loadUi({ localStorage: fakeStorage({}) }).getTheme(), "auto");
  for (const saved of ["blue", "", "DARK", "null"]) {
    const ui = loadUi({ localStorage: fakeStorage({ [STORAGE_KEY]: saved }) });
    assert.equal(ui.getTheme(), "auto", JSON.stringify(saved));
  }
});

test("getTheme returns auto when storage throws, is blocked or does not exist", () => {
  assert.equal(loadUi({ localStorage: throwingStorage() }).getTheme(), "auto");
  assert.equal(loadUi({ localStorage: blockedStorage() }).getTheme(), "auto");
  assert.equal(loadUi({ localStorage: null }).getTheme(), "auto");
  assert.equal(loadUi({}).getTheme(), "auto");
});

test("setTheme saves the choice under speech-coach-theme, then applies it", () => {
  const storage = fakeStorage({});
  const page = themeDocument({ withQuery: false });
  const ui = loadUi({ localStorage: storage, document: page.document });

  assert.equal(ui.setTheme("dark"), "dark");
  assert.deepEqual(storage.writes, [[STORAGE_KEY, "dark"]]);
  assert.equal(page.documentElement.dataset.theme, "dark");
  assert.equal(ui.getTheme(), "dark");

  ui.setTheme("auto");
  assert.equal(storage.items[STORAGE_KEY], "auto");
  assert.equal(page.documentElement.dataset.theme, "auto");
  assert.equal(ui.getTheme(), "auto");
});

test("setTheme still applies the choice when storage throws or is blocked", () => {
  for (const storage of [throwingStorage(), blockedStorage()]) {
    const page = themeDocument({ withQuery: false });
    const ui = loadUi({ localStorage: storage, document: page.document });
    assert.doesNotThrow(() => ui.setTheme("light"));
    assert.equal(page.documentElement.dataset.theme, "light");
  }
});

test("setTheme and applyTheme turn an unknown choice into auto", () => {
  const storage = fakeStorage({});
  const page = themeDocument({ withQuery: false });
  const ui = loadUi({ localStorage: storage, document: page.document });
  assert.equal(ui.setTheme("blue"), "auto");
  assert.equal(storage.items[STORAGE_KEY], "auto");
  assert.equal(page.documentElement.dataset.theme, "auto");
  ui.applyTheme("dark");
  assert.equal(ui.applyTheme(undefined), "auto");
  assert.equal(page.documentElement.dataset.theme, "auto");
});

test("nextTheme cycles auto, dark, light and back to auto", () => {
  const ui = loadUi({});
  assert.equal(ui.nextTheme("auto"), "dark");
  assert.equal(ui.nextTheme("dark"), "light");
  assert.equal(ui.nextTheme("light"), "auto");
  let choice = "auto";
  const seen = [];
  for (let tap = 0; tap < 3; tap += 1) {
    choice = ui.nextTheme(choice);
    seen.push(choice);
  }
  assert.deepEqual(seen, ["dark", "light", "auto"]);
});

test("nextTheme answers auto for anything it does not know", () => {
  const ui = loadUi({});
  for (const choice of ["blue", "", undefined, null, "Dark"]) {
    assert.equal(ui.nextTheme(choice), "auto", String(choice));
  }
});

test("applyTheme sets data-theme on <html> and skips the metas without querySelectorAll", () => {
  const page = themeDocument({ withQuery: false });
  const styleCalls = [];
  const ui = loadUi({
    document: page.document,
    getComputedStyle: fakeGetComputedStyle("light", styleCalls),
  });
  for (const choice of ["dark", "light", "auto"]) {
    assert.equal(ui.applyTheme(choice), choice);
    assert.equal(page.documentElement.dataset.theme, choice);
  }
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.light, BACKGROUND.dark]);
  assert.deepEqual(page.metas[0].dataset, {});
  assert.deepEqual(styleCalls, []);
});

test("applyTheme points both theme-color metas at a forced theme's --bg", () => {
  const page = themeDocument({ withQuery: true });
  const styleCalls = [];
  const ui = loadUi({
    document: page.document,
    getComputedStyle: fakeGetComputedStyle("light", styleCalls),
  });

  ui.applyTheme("dark");
  assert.equal(page.documentElement.dataset.theme, "dark");
  assert.deepEqual(page.queries, [THEME_COLOR_SELECTOR]);
  assert.equal(styleCalls[0], page.documentElement, "reads --bg from the <html> element");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.dark, BACKGROUND.dark]);
  assert.equal(page.metas[0].dataset.originalContent, BACKGROUND.light);
  assert.equal(page.metas[1].dataset.originalContent, BACKGROUND.dark);

  ui.applyTheme("light");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.light, BACKGROUND.light]);
  assert.equal(page.metas[1].dataset.originalContent, BACKGROUND.dark, "remembered only once");
});

test("applyTheme with auto restores each meta's own content", () => {
  const page = themeDocument({ withQuery: true });
  const ui = loadUi({
    document: page.document,
    getComputedStyle: fakeGetComputedStyle("dark", []),
  });
  ui.applyTheme("light");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.light, BACKGROUND.light]);
  ui.applyTheme("dark");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.dark, BACKGROUND.dark]);
  ui.applyTheme("auto");
  assert.equal(page.documentElement.dataset.theme, "auto");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.light, BACKGROUND.dark]);
});

test("applyTheme with auto first leaves the metas as the page shipped them", () => {
  const page = themeDocument({ withQuery: true });
  const ui = loadUi({
    document: page.document,
    getComputedStyle: fakeGetComputedStyle("light", []),
  });
  ui.applyTheme("auto");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.light, BACKGROUND.dark]);
});

test("applyTheme leaves the metas alone when getComputedStyle is missing", () => {
  const page = themeDocument({ withQuery: true });
  const ui = loadUi({ document: page.document });
  ui.applyTheme("dark");
  assert.equal(page.documentElement.dataset.theme, "dark");
  assert.deepEqual(metaContents(page.metas), [BACKGROUND.light, BACKGROUND.dark]);
});

test("applyTheme and setTheme survive a context with no document or no <html>", () => {
  const bare = loadUi({ localStorage: fakeStorage({}) });
  assert.equal(bare.applyTheme("dark"), "dark");
  assert.equal(bare.setTheme("light"), "light");

  const shared = loadUi({ document: fakeDocument(), getComputedStyle: () => ({}) });
  assert.doesNotThrow(() => shared.applyTheme("dark"));
  assert.doesNotThrow(() => shared.setTheme("auto"));
});
