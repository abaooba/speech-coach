/* nextmove.js: app.nextMove, the one thing to do next, with no DOM. nextMove({history, cleared,
   today, after}) reads the speaker's saved takes (`history`, as app.store.list() resolves them,
   including the take just saved), the cleared records (app.store.listClearedLevels(), read after
   the save), the local day `today` ("YYYY-MM-DD") and optionally what was just done, `after`:
   {type: "level", levelId, passed} after a Path level's final take, or {type: "take"} (or
   nothing) after a free-talk take. It answers {kind, label, href, why}: `label` the button's
   words, `href` the hash route it opens (null when the button only goes back to recording) and
   `why` the line under the headline. The first rule that fits wins:
     1. a level just missed with attempts left today  -> "Try again"
     2. a level just passed                           -> the unit's next level, or its checkpoint
     3. at most one take of your own so far           -> level 1 of the weakest unit
     4. a check-back is due                           -> "Start: Fillers 2 check-back"
     5. the benchmark is due and 3+ takes exist       -> "Start benchmark"
     6. otherwise                                     -> the weakest unit's current level
     7. nothing fits                                  -> "Record another take"
   Pure: reads app.path only. */
(function () {
  "use strict";

  // The benchmark is only suggested once the speaker has this many takes of their own, so it
  // has a trend to be compared with.
  const BENCHMARK_AFTER_TAKES = 3;
  const LEVEL_ROUTE = "#/level/";
  const PRACTICE_ROUTE = "#/practice";
  const BENCHMARK_ID = "benchmark";
  const CHECKBACK_SUFFIX = "_checkback";
  const RESTING = "resting";
  const LEVEL_TYPE = "level";

  const KIND = Object.freeze({
    retry: "retry",
    next: "next-level",
    checkpoint: "checkpoint",
    first: "first-level",
    checkback: "checkback",
    benchmark: "benchmark",
    weakest: "weakest-unit",
    record: "record",
  });

  const TRY_AGAIN = "Try again";
  const ONE_CLEAN_TAKE = "One clean take 2 clears the level.";
  const BENCHMARK_LABEL = "Start benchmark";
  const BENCHMARK_WHY = "Same passage, same prompt, every 14 days. See your real progress.";
  const RECORD_LABEL = "Record another take";
  const RECORD_WHY = "Every take adds a point to your trend.";
  const CHECKBACK_WHY = "A check-back keeps a cleared level locked in.";

  function nextMove(options) {
    const given = options && typeof options === "object" ? options : {};
    const history = listOf(given.history);
    const cleared = listOf(given.cleared);
    const today = given.today;
    const after = given.after && typeof given.after === "object" ? given.after : null;
    const context = { history, cleared, today };
    const rules = [
      () => retryMove(after, context),
      () => passedMove(after, context),
      () => firstTakesMove(context),
      () => checkbackMove(context),
      () => benchmarkMove(context),
      () => weakestMove(context),
    ];
    for (const rule of rules) {
      const move = rule();
      if (move !== null) {
        return move;
      }
    }
    return { kind: KIND.record, label: RECORD_LABEL, href: PRACTICE_ROUTE, why: RECORD_WHY };
  }

  // 1. The level just played was missed and today still has an attempt left.
  function retryMove(after, context) {
    const level = levelAfter(after);
    if (level === null || after.passed !== false) {
      return null;
    }
    if (app.path.attemptsLeft(level.id, context.history, context.today) === 0) {
      return null;
    }
    return { kind: KIND.retry, label: TRY_AGAIN, href: LEVEL_ROUTE + level.id, why: ONE_CLEAN_TAKE };
  }

  // 2. The level just played was passed: the next level of its unit that can be played today, or
  // the unit's checkpoint after level 5.
  function passedMove(after, context) {
    const level = levelAfter(after);
    if (level === null || after.passed !== true) {
      return null;
    }
    const unit = unitOf(level.unit);
    const next = unit.levels.find((entry) => entry.number > level.number && !isCleared(entry, context));
    if (next !== undefined) {
      return levelMove(KIND.next, unit, next, context, "Next in " + unit.title + ".");
    }
    return checkpointMove(unit, context, "Next: the " + unit.title + " checkpoint.");
  }

  // 3. A speaker with at most one take of their own starts the weakest unit from level 1.
  function firstTakesMove(context) {
    if (app.path.ownTakes(context.history).length > 1) {
      return null;
    }
    const unit = app.path.order(context.history)[0];
    const first = app.path.currentLevel(unit, context.cleared);
    if (first === null) {
      return null;
    }
    const why = hasTakes(context)
      ? weakestWhy(unit)
      : unit.title + " is the first unit on the Path.";
    return levelMove(KIND.first, unit, first, context, why);
  }

  // 4. The first check-back that has come due.
  function checkbackMove(context) {
    const due = app.path.checkbacks(context.cleared, context.history, context.today).find((entry) => entry.due);
    if (due === undefined) {
      return null;
    }
    const level = app.path.levelById(due.levelId);
    const unit = unitOf(level.unit);
    return {
      kind: KIND.checkback,
      label: "Start: " + unit.title + " " + level.number + " check-back",
      href: LEVEL_ROUTE + level.id + CHECKBACK_SUFFIX,
      why: CHECKBACK_WHY,
    };
  }

  // 5. The benchmark is due and the speaker has enough takes of their own.
  function benchmarkMove(context) {
    const enough = app.path.ownTakes(context.history).length >= BENCHMARK_AFTER_TAKES;
    if (!enough || !app.path.benchmarkState(context.history, context.today).due) {
      return null;
    }
    return { kind: KIND.benchmark, label: BENCHMARK_LABEL, href: LEVEL_ROUTE + BENCHMARK_ID, why: BENCHMARK_WHY };
  }

  // 6. The first unit, weakest first, that has a level to play today (or its checkpoint).
  function weakestMove(context) {
    for (const unit of app.path.order(context.history)) {
      const current = app.path.currentLevel(unit, context.cleared);
      const why = weakestWhy(unit);
      const move =
        current === null
          ? checkpointMove(unit, context, why)
          : levelMove(KIND.weakest, unit, current, context, why);
      if (move !== null) {
        return move;
      }
    }
    return null;
  }

  // "Start: Restarts level 2", unless the level is resting today (out of attempts).
  function levelMove(kind, unit, level, context, why) {
    if (app.path.statusOf(level, context.cleared, context.history, context.today) === RESTING) {
      return null;
    }
    return {
      kind,
      label: "Start: " + unit.title + " level " + level.number,
      href: LEVEL_ROUTE + level.id,
      why,
    };
  }

  // "Start: Restarts checkpoint" once level 5 is cleared and the checkpoint is not.
  function checkpointMove(unit, context, why) {
    const state = app.path.checkpointState(unit.id, context.cleared);
    if (state === null || !state.open || state.cleared) {
      return null;
    }
    return {
      kind: KIND.checkpoint,
      label: "Start: " + unit.title + " checkpoint",
      href: LEVEL_ROUTE + state.id,
      why,
    };
  }

  function weakestWhy(unit) {
    return unit.title + " is your weakest unit right now.";
  }

  // The Path level `after` names, or null for a free-talk take or an unknown level.
  function levelAfter(after) {
    if (after === null || after.type !== LEVEL_TYPE) {
      return null;
    }
    return app.path.levelById(after.levelId);
  }

  function unitOf(unitId) {
    return app.path.UNITS.find((entry) => entry.id === unitId);
  }

  // Cleared in the records, or the level just passed whose record may not be saved yet.
  function isCleared(level, context) {
    return app.path.statusOf(level, context.cleared) === "cleared";
  }

  function hasTakes(context) {
    return app.path.ownTakes(context.history).length > 0;
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  app.nextMove = nextMove;
  app.nextMove.BENCHMARK_AFTER_TAKES = BENCHMARK_AFTER_TAKES;
})();
