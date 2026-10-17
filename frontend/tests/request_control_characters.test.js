// Tests that the two requests carrying transcript text never send a character JSON writes as a
// \uXXXX escape (guided coach, final review finding 5): every C0 control character (U+0000 to
// U+001F, not only NUL, which the server refuses) and any lone half of a surrogate pair are
// dropped from the coach notes' moments and excerpt (tips.js) and from the grammar check's
// transcript (language.js). Escaped, each would cost 6 bytes against the server's body limit.
// The coach notes body also always fits backend/limits.py's 64,000 bytes, even with 40 moments
// full of emoji (4 bytes each in UTF-8): the oldest shown ids give way first.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const BODY_LIMIT_BYTES = 64000;
const CONTROLS = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join("");
const LONE = "\ud83d" + "x" + "\ude00";

function loadTips() {
  const app = {};
  vm.runInNewContext(read("tips.js"), { app }, { filename: "tips.js" });
  return app.tips;
}

function loadLanguage() {
  const app = { screens: {} };
  vm.runInNewContext(read("language.js"), { app }, { filename: "language.js" });
  return app.language;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapes(json) {
  return json.match(/\\u[0-9a-f]{4}|\\[bfnrt]/gi) || [];
}

const REPORT = { speakingSeconds: 61.5, wordsPerMinute: 148.2, fillerCount: 1 };

function moment(id, kind, fields) {
  return { id, kind, at: 3, clock: "0:03", seconds: null, hint: false, ...fields };
}

test("a moment's text, context and expected word drop every C0 control and lone surrogate", () => {
  const tips = loadTips();
  const given = moment("misread-1", "misread", {
    text: "we" + CONTROLS + "win" + LONE,
    before: "a\tb\nc",
    after: "d\u001fe",
    expected: "f\u0001g",
  });
  const session = { id: "t", transcript: [{ text: "Hi", start: 0, end: 1 }] };
  const [sent] = plain(tips.adviceRequest(session, REPORT, null, "Novice", [], [given])).moments;
  assert.equal(sent.text, "wewinx");
  assert.equal(sent.before, "abc");
  assert.equal(sent.after, "de");
  assert.equal(sent.expected, "fg");
  const body = JSON.stringify(tips.adviceRequest(session, REPORT, null, "Novice", [], [given]));
  assert.deepEqual(escapes(body), [], "no character goes out as an escape");
});

test("the excerpt drops them too, before it is cut at 1,500 characters", () => {
  const tips = loadTips();
  const session = {
    id: "t",
    transcript: [{ text: "we\u0000win" + LONE }, { text: CONTROLS.repeat(100) + "a".repeat(2000) }],
  };
  const excerpt = tips.adviceRequest(session, REPORT, null, "Novice", []).summary.transcript_excerpt;
  assert.ok(excerpt.startsWith("wewinx "), excerpt.slice(0, 20));
  assert.equal(excerpt.length, 1500, "the cap counts the characters that are sent");
  assert.deepEqual(escapes(JSON.stringify(excerpt)), []);
});

test("the grammar check's transcript drops every C0 control and lone surrogate", () => {
  const language = loadLanguage();
  const session = {
    id: "t",
    transcript: [{ text: "we" + CONTROLS + "win" + LONE }, { text: "a\tb" }],
  };
  const body = language.requestBody(session);
  assert.equal(body.transcript, "wewinx ab");
  assert.deepEqual(escapes(JSON.stringify(body)), []);
});

test("40 moments full of emoji and 2,000 long shown ids still fit the 64,000-byte limit", () => {
  const tips = loadTips();
  const emoji = (count) => "😀".repeat(count);
  const kinds = ["restart", "filler", "pause", "long-pause", "misread", "skip", "stumble", "unclear"];
  const moments = Array.from({ length: 40 }, (_, index) => {
    const kind = kinds[index % kinds.length];
    return moment(kind + "-" + (900 + index), kind, {
      at: 86399.987654,
      clock: "999:59",
      seconds: 86399.987654,
      text: emoji(300),
      before: emoji(300),
      after: emoji(300),
      expected: emoji(300),
      hint: true,
    });
  });
  const session = {
    id: "8b1f6c2e-4a1d-4c3b-9e8f-0123456789ab",
    transcript: [{ text: "字".repeat(3000), start: 0, end: 60 }],
  };
  const ids = Array.from({ length: 2000 }, (_, index) => String(index).padStart(11, "x"));
  const body = tips.adviceRequest(session, REPORT, [140, 160], "Champion", ids, moments);
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  assert.ok(bytes <= BODY_LIMIT_BYTES, "body is " + bytes + " bytes");
  assert.equal(body.moments.length, 40, "every moment is kept");
  assert.equal(Array.from(body.moments[0].text).length, 120, "at its full cap");
  assert.ok(body.shown_ids.length >= 500, "only a few of the oldest ids give way");
  assert.ok(body.shown_ids.length < 600);
  assert.equal(body.shown_ids[body.shown_ids.length - 1], ids[1999], "the newest ids stay");
});

test("a body that fits keeps its 600 newest shown ids", () => {
  const tips = loadTips();
  const ids = Array.from({ length: 2000 }, (_, index) => String(index).padStart(11, "x"));
  const session = { id: "t", transcript: [{ text: "字".repeat(3000) }] };
  const body = tips.adviceRequest(session, REPORT, [140, 160], "Novice", ids, []);
  assert.equal(body.shown_ids.length, 600);
  assert.equal(body.shown_ids[0], ids[1400]);
});
