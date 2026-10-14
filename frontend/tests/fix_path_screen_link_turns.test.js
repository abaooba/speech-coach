// A Path link never runs behind the next node's card (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 9; screens/path.js linkD). A link's
// turn is drawn in a box that spans its row's --s-6 foot, the gap before the next row, and the
// next node's top half. A node's open card starts at the top of its row, beside the node, so a
// turn that is still crossing below the foot runs behind that card. Every turn must finish its
// sideways travel inside the foot and drop straight into the next node.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { mountPath, record, findAll, unitsOf, titleOf } = require("./path-screen-harness");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const PATH_SECTION = CSS.slice(CSS.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");

// The declarations of the one rule in the Path section, outside any @-rule, whose selector is
// exactly `selector`.
function declarations(selector) {
  const found = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < PATH_SECTION.length; index += 1) {
    const char = PATH_SECTION[index];
    if (char === "{") {
      if (depth === 0) {
        const prelude = PATH_SECTION.slice(start, index).replace(/\s+/g, " ").trim();
        const end = PATH_SECTION.indexOf("}", index);
        if (prelude === selector) {
          found.push(PATH_SECTION.slice(index + 1, end));
        }
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      start = index + 1;
    }
  }
  assert.equal(found.length, 1, "one rule for " + selector);
  return Object.fromEntries(
    found[0]
      .split(";")
      .map((part) => [part.slice(0, part.indexOf(":")).trim(), part.slice(part.indexOf(":") + 1)])
      .filter(([property]) => property)
      .map(([property, value]) => [property, value.replace(/\s+/g, " ").trim()]),
  );
}

// Where the foot ends in the turn's 100-high box: the box is the foot (--s-6) plus the next
// node's top half, so the foot's share of its height, read from the stylesheet.
function footEndY() {
  const spacing = Number(/--s-6:\s*(\d+)px;/.exec(CSS)[1]);
  const height = declarations(".path-step__turn").height;
  const match = /^calc\(var\(--s-6\) \+ (\d+)px\)$/.exec(height);
  assert.ok(match, "the turn's box is the foot plus a fixed height: " + height);
  return (100 * spacing) / (spacing + Number(match[1]));
}

// A path's `d` (M, C and L commands, absolute) as its segments: [{command, from, points}].
function segmentsOf(d) {
  const tokens = d.match(/[MCL]|-?\d+(\.\d+)?/g);
  const segments = [];
  let at = null;
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index];
    const count = { M: 1, C: 3, L: 1 }[command];
    assert.ok(count, "an M, C or L command in " + d);
    const points = [];
    for (let point = 0; point < count; point += 1) {
      points.push({ x: Number(tokens[index + 1]), y: Number(tokens[index + 2]) });
      index += 2;
    }
    index += 1;
    segments.push({ command, from: at, points });
    at = points[points.length - 1];
  }
  return segments;
}

// Checks one turn from a node at fromX into the next at toX: it starts under the first node at
// the top of the foot; every curve keeps all its control points, and so all of itself, inside
// the foot; below the foot it only drops straight down the next node's column to its centre.
function assertTurnsInsideFoot(d, fromX, toX, footY) {
  const segments = segmentsOf(d);
  assert.deepEqual(segments[0], { command: "M", from: null, points: [{ x: fromX, y: 0 }] }, d);
  segments.slice(1).forEach((segment) => {
    if (segment.command === "C") {
      segment.points.forEach((point) =>
        assert.ok(point.y <= footY, "a curve point below the foot in " + d),
      );
      return;
    }
    assert.equal(segment.command, "L", d);
    const [to] = segment.points;
    assert.equal(segment.from.x, toX, "below the foot the line runs down the next node's column");
    assert.equal(to.x, toX, d);
    assert.ok(to.y > segment.from.y, "straight down, " + d);
  });
  const last = segments[segments.length - 1].points.slice(-1)[0];
  assert.deepEqual(last, { x: toX, y: 100 }, "it ends at the next node's centre: " + d);
}

test("the foot ends half-way down the turn's box: --s-6 is a level's half height", () => {
  assert.equal(footEndY(), 50);
});

test("linkD crosses to the next node's column inside the foot, then drops into the node", () => {
  const { screen } = mountPath();
  const footY = footEndY();
  const xs = [0, 1, 2, 3, 4, 5].map((index) => screen.nodeX(index, 6));
  xs.slice(0, -1).forEach((fromX, index) =>
    assertTurnsInsideFoot(screen.linkD(fromX, xs[index + 1]), fromX, xs[index + 1], footY),
  );
  assertTurnsInsideFoot(screen.linkD(75, 50), 75, 50, footY);
  assertTurnsInsideFoot(screen.linkD(50, 50), 50, 50, footY);
});

test("every turn drawn, into a left, right or centre node, stays in its foot", async () => {
  // Fillers stops at level 3 (a left node) and Pace at level 4 (a right one), each with its card
  // open from the start, the cases where the old turn ran behind a card.
  const cleared = ["fillers-1", "fillers-2", "pace-1", "pace-2", "pace-3"].map((id) =>
    record(id, "2026-10-12"),
  );
  const { screen, body } = mountPath({ cleared });
  await screen.show({});
  const footY = footEndY();
  const units = unitsOf(body);
  assert.deepEqual(units.map(titleOf).sort(), ["Fillers", "Long pauses", "Pace", "Restarts"]);
  units.forEach((unit) => {
    const steps = findAll(unit, "path-step");
    const xs = steps.map((_, index) => screen.nodeX(index, steps.length));
    const turns = findAll(unit, "path-step__turn");
    assert.equal(turns.length, steps.length - 1);
    turns.forEach((turn, index) =>
      assertTurnsInsideFoot(turn.children[0].getAttribute("d"), xs[index], xs[index + 1], footY),
    );
  });
});
