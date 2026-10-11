// Tests for the inline script in index.html's <head> that applies a saved Dark or Light theme
// before the first paint. The test reads the script out of index.html and runs it in a vm
// context whose localStorage and <html> element are fakes, one context per case.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const HEAD = INDEX_HTML.slice(0, INDEX_HTML.indexOf("</head>"));
const STYLESHEET_LINK = '<link rel="stylesheet" href="styles.css">';

// Every <script> in <head> without a src, with its position and its text.
const INLINE_SCRIPTS = [...HEAD.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
const HEAD_SCRIPT = INLINE_SCRIPTS.length === 1 ? INLINE_SCRIPTS[0][1] : "";

// The key ui.js keeps the theme under, so the two can never drift apart.
const STORAGE_KEY = UI_SOURCE.match(/const THEME_STORAGE_KEY = "([^"]+)";/)[1];

// A localStorage holding `saved` under the theme key; it logs every key read and every write.
function fakeStorage(saved) {
  const storage = { reads: [], writes: [] };
  storage.getItem = (key) => {
    storage.reads.push(key);
    return key === STORAGE_KEY && saved !== undefined ? saved : null;
  };
  storage.setItem = (key, value) => storage.writes.push([key, value]);
  return storage;
}

// Runs the head script once in a fresh context. `install` puts localStorage on the context, or
// leaves it out, or makes reading it throw. Returns the context and the fake <html>.
function runHeadScript(install) {
  const documentElement = { dataset: {} };
  const context = { document: { documentElement } };
  install(context);
  vm.runInNewContext(HEAD_SCRIPT, context, { filename: "index.html head script" });
  return { context, documentElement };
}

function withStorage(storage) {
  return (context) => {
    context.localStorage = storage;
  };
}

test("index.html has one inline script in <head>, right after the stylesheet", () => {
  assert.equal(INLINE_SCRIPTS.length, 1, "exactly one <script> without src in <head>");
  const linkAt = HEAD.indexOf(STYLESHEET_LINK);
  assert.notEqual(linkAt, -1, "the stylesheet link is in <head>");
  const scriptAt = INLINE_SCRIPTS[0].index;
  assert.ok(scriptAt > linkAt, "the script comes after the stylesheet link");
  const between = HEAD.slice(linkAt + STYLESHEET_LINK.length, scriptAt);
  assert.equal(between.trim(), "", "nothing sits between the link and the script");
});

test("a saved Dark or Light theme sets data-theme on <html>", () => {
  for (const theme of ["dark", "light"]) {
    const storage = fakeStorage(theme);
    const { documentElement } = runHeadScript(withStorage(storage));
    assert.deepEqual(documentElement.dataset, { theme }, "saved " + theme);
    assert.deepEqual(storage.reads, [STORAGE_KEY], "it reads the key ui.js writes");
    assert.deepEqual(storage.writes, [], "it never writes");
  }
});

test("Auto, nothing saved or an unknown value leaves <html> without data-theme", () => {
  for (const saved of ["auto", undefined, "", "purple", "DARK", " dark"]) {
    const { documentElement } = runHeadScript(withStorage(fakeStorage(saved)));
    assert.equal(
      Object.hasOwn(documentElement.dataset, "theme"),
      false,
      "saved " + JSON.stringify(saved),
    );
  }
});

test("blocked or missing storage leaves the device setting in charge and throws nothing", () => {
  const blocked = {
    "getItem throws": withStorage({
      getItem: () => {
        throw new Error("SecurityError: storage is blocked");
      },
    }),
    "reading localStorage throws": (context) => {
      Object.defineProperty(context, "localStorage", {
        get: () => {
          throw new Error("SecurityError: access is denied for this document");
        },
      });
    },
    "no localStorage at all": () => {},
    "localStorage is null": withStorage(null),
  };
  for (const [what, install] of Object.entries(blocked)) {
    let page;
    assert.doesNotThrow(() => {
      page = runHeadScript(install);
    }, what);
    assert.deepEqual(page.documentElement.dataset, {}, what);
  }
});

test("the head script adds no global", () => {
  const context = { document: { documentElement: { dataset: {} } } };
  context.localStorage = fakeStorage("dark");
  const before = Object.keys(context).sort();
  // A second run in the same context would throw if a top-level let or const were declared.
  for (let run = 0; run < 2; run += 1) {
    vm.runInNewContext(HEAD_SCRIPT, context, { filename: "index.html head script" });
  }
  assert.deepEqual(Object.keys(context).sort(), before);
});
