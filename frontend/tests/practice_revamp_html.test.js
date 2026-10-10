// Text checks on the Practice section of frontend/index.html (DESIGN.md section 6, "Header"):
// the h1 sits in header.screen__header beside the wordmark, a 16px mic mark plus "Speech Coach".
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// The markup of <section id="screen-practice">, from its opening tag to its closing tag.
function practiceSection() {
  const start = HTML.indexOf('id="screen-practice"');
  assert.ok(start !== -1, "index.html has a Practice section");
  const open = HTML.lastIndexOf("<section", start);
  const close = HTML.indexOf("</section>", start);
  return HTML.slice(open, close + "</section>".length);
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

// The markup between an opening tag that matches `openPattern` and its matching close tag.
function element(text, openPattern, tagName) {
  const match = text.match(openPattern);
  assert.ok(match, `no element matches ${openPattern}`);
  const close = text.indexOf(`</${tagName}>`, match.index);
  return text.slice(match.index, close + tagName.length + 3);
}

test("the Practice h1 sits in header.screen__header before the one screen body", () => {
  const section = practiceSection();
  const header = element(section, /<header class="screen__header">/, "header");
  assert.equal(count(section, /<h1[\s>]/g), 1, "exactly one h1");
  assert.match(header, /<h1>Practice<\/h1>/);
  assert.equal(count(section, /class="screen__body"/g), 1);
  assert.ok(section.indexOf("screen__body") > section.indexOf("</header>"), "header comes first");
});

test("the wordmark is a 16px decorative mic mark plus the words Speech Coach", () => {
  const header = element(practiceSection(), /<header class="screen__header">/, "header");
  const wordmark = element(header, /<span class="wordmark">/, "span");
  const svg = element(wordmark, /<svg[^>]*>/, "svg");
  const svgTag = svg.match(/<svg[^>]*>/)[0];
  assert.match(svgTag, /aria-hidden="true"/);
  assert.match(svgTag, /width="16"/);
  assert.match(svgTag, /height="16"/);
  assert.match(svgTag, /stroke="currentColor"/);
  assert.equal(squashText(wordmark.replace(svg, "")), "Speech Coach");
  const h1At = header.indexOf("<h1>");
  assert.ok(h1At < header.indexOf('class="wordmark"'), "h1 first, then the mark");
});

// The visible text of a markup fragment: tags dropped, whitespace collapsed.
function squashText(markup) {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

test("the theme toggle is a button after the wordmark, inside the header", () => {
  const header = element(practiceSection(), /<header class="screen__header">/, "header");
  const toggle = element(header, /<button class="icon-btn theme-toggle"[^>]*>/, "button");
  assert.match(toggle, /type="button"/);
  assert.ok(header.indexOf('class="wordmark"') < header.indexOf("theme-toggle"));
  assert.equal(count(practiceSection(), /<button/g), 1, "the only static button");
});
