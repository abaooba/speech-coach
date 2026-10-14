// Review fix tests for the Path's crown and checkpoint states (frontend/screens/path.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 9; DESIGN.md section 9, "Color never
// carries meaning alone"). A locked crown and an open one drew the same crown and label, told
// apart only by the icon's colour, and an open checkpoint and a cleared one the same flag and
// label, told apart only by the fill's hue. Each now has a cue that is not colour: a locked crown
// carries a small lock badge, and a cleared checkpoint a small check badge, drawn as the clock
// badge a due check-back adds to a cleared level. The node's accessible name already says the
// state. The screen runs for real through tests/path-screen-harness.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  mountPath,
  record,
  find,
  iconsOf,
  unitTitled,
  levelNodes,
  crownNode,
  checkpointNode,
  stateOf,
} = require("./path-screen-harness");

async function shown(options) {
  const mounted = mountPath(options);
  await mounted.screen.show({});
  return mounted;
}

// Records clearing the unit's levels 1 to `through`, a day apart from 1 October.
function clearedThrough(unitId, through) {
  return Array.from({ length: through }, (_, index) =>
    record(unitId + "-" + (index + 1), "2026-10-0" + (index + 1)),
  );
}

// The icon a node's badge draws, or null for a node without one.
function badgeOf(node) {
  const badge = find(find(node, "path-node__circle"), "path-node__badge");
  if (badge === null) {
    return null;
  }
  const icons = iconsOf(badge);
  assert.equal(icons.length, 1, "a badge draws one icon");
  return icons[0];
}

test("a locked crown carries a lock badge beside its crown; an open one does not", async () => {
  const locked = await shown({ cleared: clearedThrough("fillers", 2) });
  const crown = crownNode(unitTitled(locked.body, "Fillers"));
  assert.equal(stateOf(crown), "locked");
  assert.deepEqual(iconsOf(find(crown, "path-node__circle")), ["crown", "lock"]);
  assert.equal(badgeOf(crown), "lock");

  const open = await shown({ cleared: clearedThrough("fillers", 3) });
  const openCrown = crownNode(unitTitled(open.body, "Fillers"));
  assert.equal(stateOf(openCrown), "open");
  assert.equal(badgeOf(openCrown), null);
  assert.deepEqual(iconsOf(find(openCrown, "path-node__circle")), ["crown"]);
});

test("a crown earned, in part or in full, has no lock: its fill or edge says so", async () => {
  const part = await shown({
    cleared: [...clearedThrough("fillers", 3), record("fillers_crown-1", "2026-10-05")],
  });
  assert.equal(badgeOf(crownNode(unitTitled(part.body, "Fillers"))), null);
  const full = await shown({
    cleared: [...clearedThrough("pace", 3), record("pace_crown-1", "2026-10-05")],
  });
  const ladder = crownNode(unitTitled(full.body, "Pace"));
  assert.equal(stateOf(ladder), "earned");
  assert.equal(badgeOf(ladder), null);
});

test("Pace's locked ladder crown carries the lock too", async () => {
  const { body } = await shown({ cleared: clearedThrough("pace", 2) });
  assert.equal(badgeOf(crownNode(unitTitled(body, "Pace"))), "lock");
});

test("a cleared checkpoint carries a check badge beside its flag; an open one does not",
  async () => {
    const open = await shown({ cleared: clearedThrough("fillers", 5) });
    const openFlag = checkpointNode(unitTitled(open.body, "Fillers"));
    assert.equal(stateOf(openFlag), "open");
    assert.equal(badgeOf(openFlag), null);

    const cleared = [...clearedThrough("fillers", 5), record("fillers_checkpoint", "2026-10-12")];
    const done = await shown({ cleared });
    const flag = checkpointNode(unitTitled(done.body, "Fillers"));
    assert.equal(stateOf(flag), "cleared");
    assert.deepEqual(iconsOf(find(flag, "path-node__circle")), ["flag", "check"]);
    assert.equal(badgeOf(flag), "check");

    cleared.push(record("fillers_checkpoint_room", "2026-10-12"));
    const room = await shown({ cleared });
    assert.equal(badgeOf(checkpointNode(unitTitled(room.body, "Fillers"))), "check");
  });

test("levels keep their own badge: a clock only when a check-back is due", async () => {
  const { body } = await shown({ cleared: [record("fillers-1", "2026-10-12")] });
  const [cleared, current] = levelNodes(unitTitled(body, "Fillers"));
  assert.equal(badgeOf(cleared), "clock", "check-back 1 falls due today, two days on");
  assert.equal(badgeOf(current), null);
});

// --- Its place (styles.css section 13) ---------------------------------------------------------

// Every declaration section 13 gives the exact selector list `selector`, comments left out.
function declarationsFor(selector) {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const section = css.slice(css.indexOf("/* 13. Path screen")).replace(/\/\*[\s\S]*?\*\//g, "");
  const found = {};
  for (const match of section.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].replace(/\s+/g, " ").trim() === selector) {
      for (const part of match[2].split(";")) {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          found[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      }
    }
  }
  return found;
}

test("on the smaller crown and checkpoint circles the badge sits --s-2 out, clear of the icon",
  () => {
    const small = declarationsFor(
      ".path-node--crown .path-node__badge, .path-node--checkpoint .path-node__badge",
    );
    assert.equal(small.top, "calc(-1 * var(--s-2))");
    assert.equal(small.right, "calc(-1 * var(--s-2))");
    const badge = declarationsFor(".path-node__badge");
    assert.equal(badge.top, "calc(-1 * var(--s-1))", "a level's badge stays --s-1 out");
    assert.equal(badge.width, "24px", "every badge is the same size");
  });
