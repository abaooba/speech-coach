// Tests that frontend/app.js applies the saved theme on boot, before any screen mounts. app.js
// runs in a vm context with a fake window and document; the test registers a fake app.ui and a
// screen, then fires the DOMContentLoaded handler app.js registered.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function fakeSection() {
  return { hidden: true, classList: { add: () => {}, remove: () => {} } };
}

// Runs app.js and returns the app it created, its DOMContentLoaded handler and a record of
// every screen call, in order.
function loadApp() {
  const handlers = {};
  const sections = { "screen-practice": fakeSection() };
  const fakeWindow = { location: { hash: "#/practice" }, addEventListener: () => {} };
  const document = {
    title: "",
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    getElementById: (id) => sections[id] || null,
    querySelectorAll: () => [],
  };
  vm.runInNewContext(APP_SOURCE, { window: fakeWindow, document }, { filename: "app.js" });
  const calls = [];
  const app = fakeWindow.app;
  app.screens.practice = {
    mount: () => calls.push("mount practice"),
    show: () => calls.push("show practice"),
    hide: () => {},
  };
  return { app, boot: handlers.DOMContentLoaded, calls };
}

test("boot applies the saved theme before any screen mounts", () => {
  const { app, boot, calls } = loadApp();
  app.ui = {
    getTheme: () => {
      calls.push("getTheme");
      return "dark";
    },
    applyTheme: (choice) => calls.push("applyTheme " + choice),
  };
  assert.equal(typeof boot, "function", "app.js boots on DOMContentLoaded");
  boot();
  assert.deepEqual(calls, ["getTheme", "applyTheme dark", "mount practice", "show practice"]);
});

test("boot still mounts and routes when app.ui has no theme helpers", () => {
  for (const ui of [undefined, {}, { getTheme: () => "dark" }]) {
    const { app, boot, calls } = loadApp();
    app.ui = ui;
    assert.doesNotThrow(boot);
    assert.deepEqual(calls, ["mount practice", "show practice"]);
  }
});
