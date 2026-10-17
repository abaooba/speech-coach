// Tests for "Hear it" (guided coach, final review finding 8): app.ui.speak picks an English voice
// that runs on the device (speechSynthesis.getVoices(), localService true) when the browser has
// one, since a desktop browser may offer network voices that send the text away. Without one it
// leaves the browser's default. The copy says only what the app controls: the device's built-in
// voice says the word, and the app sends nothing.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.join(FRONTEND_DIR, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

function loadUi(voices) {
  const spoken = [];
  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
      this.voice = null;
    }
  }
  const synth = { cancel() {}, speak: (utterance) => spoken.push(utterance) };
  if (voices !== undefined) {
    synth.getVoices = () => voices;
  }
  const context = {
    app: {},
    document: fakeDocument(),
    speechSynthesis: synth,
    SpeechSynthesisUtterance: Utterance,
  };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  return { ui: context.app.ui, spoken };
}

const NETWORK_US = { name: "Google US English", lang: "en-US", localService: false };
const LOCAL_GB = { name: "Daniel", lang: "en-GB", localService: true };
const LOCAL_US = { name: "Samantha", lang: "en-US", localService: true };
const LOCAL_FR = { name: "Thomas", lang: "fr-FR", localService: true };

test("speak prefers a US English voice that runs on the device", () => {
  const { ui, spoken } = loadUi([NETWORK_US, LOCAL_GB, LOCAL_FR, LOCAL_US]);
  assert.equal(ui.speak("thorough"), true);
  assert.equal(spoken[0].voice.name, "Samantha");
  assert.equal(spoken[0].lang, "en-US");
  assert.equal(spoken[0].rate, 0.85);
});

test("without one, any English voice on the device", () => {
  const { ui, spoken } = loadUi([NETWORK_US, LOCAL_FR, LOCAL_GB]);
  ui.speak("thorough");
  assert.equal(spoken[0].voice.name, "Daniel");
});

test("with no English voice on the device, or no voice list, the browser's default speaks", () => {
  for (const voices of [[NETWORK_US, LOCAL_FR], [], undefined, "x"]) {
    const { ui, spoken } = loadUi(voices);
    assert.equal(ui.speak("thorough"), true, String(voices));
    assert.equal(spoken[0].voice, null, "no network voice is chosen by the app");
    assert.equal(spoken[0].lang, "en-US");
  }
});

test("the copy says the device's voice speaks and the app sends nothing", () => {
  const how = read("how.html").replace(/\s+/g, " ");
  assert.ok(how.includes("Your device’s built-in voice says it. The app sends nothing."));
  assert.ok(!how.includes("Nothing is sent."));
  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(readme.includes("device's built-in voice, and the app sends nothing."));
  assert.ok(!/nothing is sent/i.test(readme));
});
