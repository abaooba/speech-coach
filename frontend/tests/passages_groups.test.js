// Tests for the Read tab's groups in frontend/passages.js
// (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 2.3): every Read passage
// carries a `group`, "explainer", "story", "speech" or "drill", and app.passages.groups() lists
// the four as {id, label} in the Read tab's order, a new array on every call. Practice shows one
// chip per group and draws a passage of the group on every tap. The module loads into a vm.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PASSAGES_SOURCE = fs.readFileSync(path.join(__dirname, "..", "passages.js"), "utf8");

const GROUPS = [
  { id: "explainer", label: "Explainer" },
  { id: "story", label: "Story" },
  { id: "speech", label: "Speech" },
  { id: "drill", label: "Drill" },
];

// The group each of the Read tab's first six passages belongs to.
const GROUP_OF = {
  "explainer-rainbows": "explainer",
  "story-wrong-train": "story",
  "gettysburg-opening": "speech",
  "liberty-or-death": "speech",
  "drill-st-clusters": "drill",
  "drill-pl-bl-clusters": "drill",
};

function loadPassages() {
  const context = { app: {} };
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  return context.app.passages;
}

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function readPassages() {
  return Array.from(loadPassages()).filter((entry) => entry.kind === "passage");
}

test("groups() lists the Read tab's four groups in order: Explainer, Story, Speech, Drill", () => {
  const passages = loadPassages();
  assert.equal(typeof passages.groups, "function");
  assert.deepEqual(plain(passages.groups()), GROUPS);
});

test("groups() returns a new array of new objects on every call", () => {
  const passages = loadPassages();
  const first = passages.groups();
  assert.ok(Array.isArray(first));
  first[0].label = "Changed";
  first.reverse();
  first.pop();
  const second = passages.groups();
  assert.notEqual(second, first);
  assert.deepEqual(plain(second), GROUPS);
});

test("the six Read passages carry their groups", () => {
  const passages = Array.from(loadPassages());
  for (const [id, group] of Object.entries(GROUP_OF)) {
    const entry = passages.find((candidate) => candidate.id === id);
    assert.ok(entry, `missing entry '${id}'`);
    assert.equal(entry.group, group, id);
  }
});

test("every Read passage carries a listed group, and every group holds a passage", () => {
  const ids = GROUPS.map((group) => group.id);
  const reads = readPassages();
  for (const entry of reads) {
    assert.ok(ids.includes(entry.group), `${entry.id} has the group ${entry.group}`);
  }
  for (const id of ids) {
    assert.ok(
      reads.some((entry) => entry.group === id),
      `the ${id} group holds no passage`,
    );
  }
});

test("prompts, cold reads, the benchmark and retired ids carry no group", () => {
  const passages = loadPassages();
  const others = [
    ...Array.from(passages).filter((entry) => entry.kind === "prompt"),
    ...Array.from(passages.coldReads()),
    passages.benchmark().read,
    passages.benchmark().talk,
    ...Array.from(passages.retired()),
  ];
  for (const entry of others) {
    assert.ok(!Object.hasOwn(entry, "group"), `${entry.id} has no group`);
  }
});
