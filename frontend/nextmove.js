/* nextmove.js: app.nextMove, the one thing to do next, with no DOM. nextMove({history, cleared,
   today, after}) reads the speaker's saved takes (`history`, as app.store.list() resolves them,
   including the take just saved), the cleared records (app.store.listClearedLevels(), read after
   the save), the local day `today` ("YYYY-MM-DD") and optionally what was just done, `after`:
   {type: "level", levelId, passed} after a Path play's result, where `levelId` is the play's
   route id ("fillers-2", "fillers-2_checkback", "fillers_crown", "fillers_checkpoint" or
   "benchmark", read with app.path.playById), or {type: "take"} (or nothing) after a free-talk
   take. It answers {kind, label, href, why}: `label` the button's words, `href` the hash route it
   opens ("#/practice" when the button only goes back to recording) and `why` the line under the
   headline. The first rule that fits wins:
     1. a play just missed that can be played again today -> "Try again" (a level with attempts
        left; a crown or checkpoint, which have no daily limit; never a check-back, which comes
        back days later)
     2. a play just done:
        a level passed       -> the unit's next level, or its checkpoint
        a check-back passed  -> the next due check-back, else the unit's current level
        a crown earned       -> the unit's current level, or its checkpoint
        a checkpoint cleared -> the weakest unit's current level (rule 6, this one counted)
        the benchmark        -> the weakest unit's current level (rule 6)
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
  // Play kinds as app.path names them.
  const LOOP = "loop";
  const CHECKBACK = "checkback";
  const CROWN = "crown";
  const CHECKPOINT = "checkpoint";
  const BENCHMARK = "benchmark";

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
  // Crowns and checkpoints can be played again at once (path.js counts no attempts for them).
  const RETRY_WHY = Object.freeze({
    [CROWN]: "A crown has no daily limit. One clean run earns it.",
    [CHECKPOINT]: "A checkpoint has no daily limit. One clean take clears it.",
  });

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

  // 1. The play just done was missed and can be played again today: a level with an attempt
  // left today, or a crown or checkpoint. A missed check-back comes back days later.
  function retryMove(after, context) {
    const play = playAfter(after);
    if (play === null || after.passed !== false) {
      return null;
    }
    if (play.kind === LOOP) {
      if (app.path.attemptsLeft(play.id, context.history, context.today) === 0) {
        return null;
      }
      return { kind: KIND.retry, label: TRY_AGAIN, href: LEVEL_ROUTE + play.id, why: ONE_CLEAN_TAKE };
    }
    const why = RETRY_WHY[play.kind];
    return why ? { kind: KIND.retry, label: TRY_AGAIN, href: LEVEL_ROUTE + play.id, why } : null;
  }

  // 2. What follows the play just done: a pass of a level, check-back, crown or checkpoint, or
  // the benchmark (which is never passed or missed).
  function passedMove(after, context) {
    const play = playAfter(after);
    if (play === null) {
      return null;
    }
    if (play.kind === BENCHMARK) {
      return weakestMove(context);
    }
    if (after.passed !== true) {
      return null;
    }
    if (play.kind === CHECKBACK) {
      return checkbackPassedMove(play, context);
    }
    if (play.kind === CROWN) {
      return unitMove(unitOf(play.unit), context);
    }
    if (play.kind === CHECKPOINT) {
      // The checkpoint's record may not be saved yet, so count it as cleared here.
      return weakestMove(withCleared(context, play.id));
    }
    return levelPassedMove(app.path.levelById(play.level), context);
  }

  // The next level of the passed level's unit that can be played today, or the unit's
  // checkpoint after level 5.
  function levelPassedMove(level, context) {
    const unit = unitOf(level.unit);
    // The pass may not be in the cleared records yet, so count it as cleared here.
    const passedContext = withCleared(context, level.id);
    const next = unit.levels.find(
      (entry) => entry.number > level.number && !isCleared(entry, passedContext),
    );
    if (next !== undefined) {
      return levelMove(KIND.next, unit, next, passedContext, nextInWhy(unit));
    }
    return checkpointMove(unit, passedContext, "Next: the " + unit.title + " checkpoint.");
  }

  // A passed check-back: the next check-back that is due (never the one just passed, whose
  // record may not be saved yet), else the unit's current level.
  function checkbackPassedMove(play, context) {
    const due = dueCheckbacks(context).find((entry) => entry.levelId !== play.level);
    if (due !== undefined) {
      return checkbackEntryMove(due);
    }
    return unitMove(unitOf(play.unit), context);
  }

  // The unit's current level, or its checkpoint once every level is cleared.
  function unitMove(unit, context) {
    const current = app.path.currentLevel(unit, context.cleared);
    if (current === null) {
      return checkpointMove(unit, context, "Next: the " + unit.title + " checkpoint.");
    }
    return levelMove(KIND.next, unit, current, context, nextInWhy(unit));
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
    const due = dueCheckbacks(context)[0];
    return due === undefined ? null : checkbackEntryMove(due);
  }

  function dueCheckbacks(context) {
    return app.path
      .checkbacks(context.cleared, context.history, context.today)
      .filter((entry) => entry.due);
  }

  // "Start: Fillers 2 check-back" for an entry of app.path.checkbacks.
  function checkbackEntryMove(entry) {
    const level = app.path.levelById(entry.levelId);
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

  function nextInWhy(unit) {
    return "Next in " + unit.title + ".";
  }

  // The Path play `after` names (app.path.playById), or null for a free-talk take or an unknown
  // play.
  function playAfter(after) {
    if (after === null || after.type !== LEVEL_TYPE) {
      return null;
    }
    return app.path.playById(after.levelId);
  }

  // The context with `recordId` counted as cleared, for a pass whose record may not be saved yet.
  function withCleared(context, recordId) {
    return Object.assign({}, context, {
      cleared: context.cleared.concat([{ levelId: recordId }]),
    });
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
