// Loads the pieces the guided coach reads in one vm context, as index.html does: ui.js,
// delivery.js, screens/results.js (its speech-map helpers) and coach.js. Shared by the
// coach_*.test.js files.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const FILES = ["ui.js", "delivery.js", path.join("screens", "results.js"), "coach.js"];

function loadCoach(extraFiles) {
  const app = { screens: {}, passages: [], router: { go() {} }, store: {} };
  const context = { app, document: fakeDocument() };
  vm.createContext(context);
  FILES.concat(extraFiles || []).forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });
  return app;
}

// Words half a second apart, a third of a second long, from a sentence; `at` shifts the start.
function spoken(sentence, at) {
  const first = at || 0;
  return sentence.split(" ").map((text, index) => ({
    text,
    start: first + index * 0.5,
    end: first + index * 0.5 + 0.33,
  }));
}

// The module runs in another realm: compare through JSON so plain objects match.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadCoach, spoken, plain };
