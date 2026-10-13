/* path.js: app.path, the skill path (docs/PLAN.md T42): four units of five levels, each level a
   challenge mode scored after the take from its app.delivery report. order() puts the weakest
   unit first, evaluate() passes or fails a take and says why, and the unlock and cold-read
   helpers read cleared levels and take history. Pure: no DOM, store, clock or Math.random. */
(function () {
  "use strict";

  // The challenge modes, by id, and the name a screen shows for each.
  const SUDDEN_DEATH = "suddenDeath";
  const SPEED_LADDER = "speedLadder";
  const COLD_READ = "coldRead";
  const CLEAN_STRETCH = "cleanStretch";
  const MODE_TITLES = Object.freeze({
    [SUDDEN_DEATH]: "Sudden death",
    [SPEED_LADDER]: "Speed ladder",
    [COLD_READ]: "Cold read",
    [CLEAN_STRETCH]: "Clean stretch",
  });

  // A level on the path is cleared, current (open to play, not cleared yet) or locked.
  const CLEARED = "cleared";
  const CURRENT = "current";
  const LOCKED = "locked";

  const SECONDS_PER_MINUTE = 60;
  // Word times are in milliseconds; two times closer than this are the same moment.
  const MILLISECOND = 0.001;

  // Restarts unit: cold reads, a passage the speaker has never read (pickColdRead), with fewer
  // restarts and misreads allowed, in all, at each level.
  const COLD_READ_MAX_SLIPS = [4, 3, 2, 1, 0];
  // A minute and a half: the longest cold read (192 words) takes 82 s at 140 wpm, the slow edge
  // of the cold reads' band.
  const COLD_READ_SECONDS = 90;

  // Fillers unit: sudden death. The run is the time from the first word to the first filler or
  // restart; each level asks for a longer one (PLAN T42).
  const RUN_TARGETS_SECONDS = [30, 45, 60, 90, 120];
  // The take runs this long past the target, so a slow first word, or stopping as Practice's
  // time bar fills, never costs a run that reached the target.
  const RUN_HEADROOM_SECONDS = 15;
  // Sudden death is talked on Practice's "Your day" prompt: an easy topic leaves the fillers as
  // the thing to beat.
  const SUDDEN_DEATH_PROMPT_ID = "free-talk";

  // Long pauses unit: clean stretch. Free talk with one stretch held clean: no filler, restart,
  // mid-sentence pause or long pause (delivery.js longestCleanStretch). DebateDrills gives
  // beginners 15 clean seconds (how.html); the last level asks for a minute.
  const STRETCH_TARGETS_SECONDS = [15, 20, 30, 45, 60];
  // A clean-stretch take lasts a minute or twice the stretch, whichever is longer, so a stumble
  // early still leaves room to hold one.
  const MIN_TALK_SECONDS = 60;
  const STRETCH_ROOM_FACTOR = 2;
  // Clean stretches are talked on Practice's Impromptu prompt: arguing a side is where a
  // speaker stalls to think.
  const CLEAN_STRETCH_PROMPT_ID = "impromptu";

  // Pace unit: a speed ladder, the same passage read at a set pace within SPEED_TOLERANCE_WPM.
  // The three rungs of PLAN T42 (140, 160, 180 wpm), then the top rung with fewer restarts.
  const LADDER_PASSAGE_ID = "rebuttal-uniforms";
  const LADDER_RUNGS = [
    { wpm: 140, maxRestarts: 2 },
    { wpm: 160, maxRestarts: 2 },
    { wpm: 180, maxRestarts: 2 },
    { wpm: 180, maxRestarts: 1 },
    { wpm: 180, maxRestarts: 0 },
  ];
  const SPEED_TOLERANCE_WPM = 10;

  // A reading take that leaves out more script words than this in one place did not read the
  // passage through: it stopped early or started partway in. Results draws a longer run of
  // skipped words as one marker for the same reason (screens/results.js).
  const MAX_SKIPPED_IN_ONE_PLACE = 8;

  // The weakness ranking mirrors backend/advice/select.py weakest_skills and
  // distances_from_target, with the same targets, so the path leads with the skill the coach's
  // advice is about. Change the two together.
  const RESTARTS_PER_MINUTE_TARGET = 1;
  const FILLERS_PER_MINUTE_TARGET = 3;
  const LONG_PAUSES_TARGET = 0;
  const DEFAULT_TARGET_WPM = [140, 160];
  const NONE_AT_ALL = -1;
  const TIE_DECIMALS = 9;
  // The units follow the speaker's latest takes, averaged over this many, so one odd take
  // cannot reorder the path and a habit the speaker has since fixed stops leading it.
  const RECENT_TAKES = 5;

  const NO_SPEECH = "No speech was found in this take. Try the level again.";
  // How a detail ends when it says what clears the level.
  const TO_CLEAR_THIS_LEVEL = " to clear this level.";
  // A reading take the backend found does not follow its passage (talk, another text, or a few
  // lines read and then ad-libbed) reports no script slips, just as a flawless read does.
  const NOT_FOLLOWED =
    "This take did not follow the passage. Read it as written" + TO_CLEAR_THIS_LEVEL;

  // The units in the order select.py's MEASURED_SKILLS lists their library tags, which is the
  // order ties keep. Each unit trains its skill with one mode, a little harder at each level.
  const UNITS = deepFreeze([
    unit("restarts", "Restarts", ["restart"], COLD_READ_MAX_SLIPS.map(coldReadLevel)),
    unit("fillers", "Fillers", ["filler"], RUN_TARGETS_SECONDS.map(suddenDeathLevel)),
    unit(
      "long-pauses",
      "Long pauses",
      ["long_pause"],
      STRETCH_TARGETS_SECONDS.map(cleanStretchLevel),
    ),
    unit("pace", "Pace", ["pace_fast", "pace_slow"], LADDER_RUNGS.map(speedLadderLevel)),
  ]);

  const LEVELS_BY_ID = new Map(
    UNITS.flatMap((entry) => entry.levels.map((level) => [level.id, level])),
  );

  const JUDGES = {
    [SUDDEN_DEATH]: judgeSuddenDeath,
    [SPEED_LADDER]: judgeSpeedLadder,
    [COLD_READ]: judgeColdRead,
    [CLEAN_STRETCH]: judgeCleanStretch,
  };

  // A unit: {id, title, tags, levels}. `tags` are the research library's tags for its skill;
  // each level is {id, unit, number, mode, prompt, durationSeconds, pass, passageId}, its id
  // "<unit>-<number>" (the id app.store keeps once it is cleared).
  function unit(id, title, tags, levelSpecs) {
    const levels = levelSpecs.map((spec, index) => ({
      id: id + "-" + (index + 1),
      unit: id,
      number: index + 1,
      mode: spec.mode,
      prompt: spec.prompt,
      durationSeconds: spec.durationSeconds,
      pass: spec.pass,
      passageId: spec.passageId,
    }));
    return { id, title, tags, levels };
  }

  // A cold read's passage is picked per take (pickColdRead), so the level names none.
  function coldReadLevel(maxSlips) {
    return {
      mode: COLD_READ,
      prompt: "Read a passage you have never seen " + slipAllowance(maxSlips) + ".",
      durationSeconds: COLD_READ_SECONDS,
      pass: { maxSlips },
      passageId: null,
    };
  }

  function suddenDeathLevel(runSeconds) {
    return {
      mode: SUDDEN_DEATH,
      prompt:
        "Keep talking for " + clockText(runSeconds) + " without a filler or restart. " +
        "The first one ends your run.",
      durationSeconds: runSeconds + RUN_HEADROOM_SECONDS,
      pass: { runSeconds },
      passageId: SUDDEN_DEATH_PROMPT_ID,
    };
  }

  function cleanStretchLevel(stretchSeconds) {
    return {
      mode: CLEAN_STRETCH,
      prompt:
        "Talk on the topic and hold one clean stretch of " + secondsText(stretchSeconds) +
        ": no filler, restart, mid-sentence pause or pause of " +
        secondsText(app.delivery.LONG_PAUSE_SECONDS) + " or more.",
      durationSeconds: Math.max(MIN_TALK_SECONDS, STRETCH_ROOM_FACTOR * stretchSeconds),
      pass: { stretchSeconds },
      passageId: CLEAN_STRETCH_PROMPT_ID,
    };
  }

  // A rung lasts as long as the passage takes at its pace, so Practice's time bar fills just as
  // a speaker on pace reads the last word.
  function speedLadderLevel(rung) {
    return {
      mode: SPEED_LADDER,
      prompt:
        "Read the passage at " + rung.wpm + " wpm, give or take " + SPEED_TOLERANCE_WPM + ", " +
        restartAllowance(rung.maxRestarts) + ".",
      durationSeconds: Math.round((ladderWords() * SECONDS_PER_MINUTE) / rung.wpm),
      pass: { wpm: rung.wpm, toleranceWpm: SPEED_TOLERANCE_WPM, maxRestarts: rung.maxRestarts },
      passageId: LADDER_PASSAGE_ID,
    };
  }

  // The ladder passage's word count, read from passages.js, which index.html loads first.
  function ladderWords() {
    const passages = Array.isArray(app.passages) ? app.passages : [];
    const passage = passages.find((entry) => entry.id === LADDER_PASSAGE_ID);
    if (!passage) {
      throw new Error("path.js needs the passage '" + LADDER_PASSAGE_ID + "' from passages.js");
    }
    return passage.text.trim().split(/\s+/).length;
  }

  // "without a restart or misread", "with at most 1 restart or misread", "with at most 4
  // restarts and misreads in all".
  function slipAllowance(maxSlips) {
    if (maxSlips === 0) {
      return "without a restart or misread";
    }
    if (maxSlips === 1) {
      return "with at most 1 restart or misread";
    }
    return "with at most " + maxSlips + " restarts and misreads in all";
  }

  // "without a restart", "with at most 1 restart", "with at most 2 restarts".
  function restartAllowance(maxRestarts) {
    return maxRestarts === 0
      ? "without a restart"
      : "with at most " + countText(maxRestarts, "restart");
  }

  // The level with this id ("fillers-2"), or null.
  function levelById(id) {
    return LEVELS_BY_ID.get(id) || null;
  }

  // --- Scoring a take --------------------------------------------------------------------------

  // Whether a take clears `level`, as {passed, detail}. `detail` tells the speaker what the take
  // did and, short of the target, what clears the level. `report` is the take's app.delivery
  // report; a take with no words clears nothing. A reading level is scored on the report's
  // script slips, so its take must be sent with the passage as its script. A take the backend
  // finds does not follow the passage comes back as free talk with no slips at all
  // (backend/script_align.py MIN_SCRIPT_FOLLOWED_SHARE), so a reading level clears only when
  // report.followedScript says the take followed it.
  function evaluate(level, report) {
    const mode = level ? level.mode : undefined;
    if (!Object.prototype.hasOwnProperty.call(JUDGES, mode)) {
      throw new Error("Unknown path mode: " + mode);
    }
    const facts = factsOf(report);
    if (!facts.spoke) {
      return { passed: false, detail: NO_SPEECH };
    }
    return JUDGES[mode](level.pass, facts);
  }

  // suddenDeath: the run is the time from the first word to the first filler or restart, or to
  // the last word when there is neither. The level is cleared once the run reaches
  // pass.runSeconds.
  function judgeSuddenDeath(pass, facts) {
    const slip = facts.slips.length > 0 ? facts.slips[0] : null;
    const end = slip ? slip.at : facts.speechStart + facts.speakingSeconds;
    const run = roundToTenth(Math.max(0, end - facts.speechStart));
    const passed = run >= pass.runSeconds;
    const target = clockText(pass.runSeconds);
    let said = "No filler or restart, but you spoke for only " + clockText(run) + ".";
    if (slip) {
      said = "Your run lasted " + clockText(run) + " before " + slip.name + ".";
    } else if (passed) {
      said = "No filler or restart in " + clockText(run) + " of speech.";
    }
    let next = "Keep going to " + target + TO_CLEAR_THIS_LEVEL;
    if (passed) {
      next = "Level cleared: the target was " + target + ".";
    } else if (slip) {
      next = "Reach " + target + TO_CLEAR_THIS_LEVEL;
    }
    return { passed, detail: said + " " + next };
  }

  // speedLadder: cleared when the take followed the passage, the pace the Pace card shows (wpm,
  // rounded) is within pass.toleranceWpm of pass.wpm and it has at most pass.maxRestarts
  // restarts.
  function judgeSpeedLadder(pass, facts) {
    if (!facts.followedScript) {
      return { passed: false, detail: NOT_FOLLOWED };
    }
    const unread = longestSkipRun(facts.skips);
    if (unread > MAX_SKIPPED_IN_ONE_PLACE) {
      return notReadThrough(unread);
    }
    const lo = pass.wpm - pass.toleranceWpm;
    const hi = pass.wpm + pass.toleranceWpm;
    const band = lo + " to " + hi + " wpm";
    const fixes = [];
    if (facts.wpm > hi) {
      fixes.push("slow down to " + band);
    } else if (facts.wpm < lo) {
      fixes.push("speed up to " + band);
    }
    if (facts.restartCount > pass.maxRestarts) {
      fixes.push(
        pass.maxRestarts === 0
          ? "read it without a restart"
          : "keep restarts to " + pass.maxRestarts + " or fewer",
      );
    }
    const said =
      "You read at " + facts.wpm + " wpm with " + countText(facts.restartCount, "restart") + ".";
    if (fixes.length === 0) {
      return { passed: true, detail: said + " Level cleared: the target was " + band + "." };
    }
    const fix = capitalize(fixes.join(" and "));
    return { passed: false, detail: said + " " + fix + TO_CLEAR_THIS_LEVEL };
  }

  // coldRead: cleared when the take followed the passage with at most pass.maxSlips restarts
  // and misreads in all (PLAN T42). A skipped word is not a slip: a transcript can drop a short
  // word the speaker said.
  function judgeColdRead(pass, facts) {
    if (!facts.followedScript) {
      return { passed: false, detail: NOT_FOLLOWED };
    }
    const unread = longestSkipRun(facts.skips);
    if (unread > MAX_SKIPPED_IN_ONE_PLACE) {
      return notReadThrough(unread);
    }
    const said = "You read it with " + slipsText(facts.restartCount, facts.misreadCount) + ".";
    if (facts.restartCount + facts.misreadCount <= pass.maxSlips) {
      const limit = pass.maxSlips === 0 ? "" : ": the limit was " + pass.maxSlips + " in all";
      return { passed: true, detail: said + " Level cleared" + limit + "." };
    }
    const fix =
      pass.maxSlips === 0
        ? "Read a new passage without a restart or misread"
        : "Keep restarts and misreads to " + pass.maxSlips + " or fewer in all";
    return { passed: false, detail: said + " " + fix + TO_CLEAR_THIS_LEVEL };
  }

  // cleanStretch: cleared when the longest clean stretch, as the Results card shows it, reaches
  // pass.stretchSeconds.
  function judgeCleanStretch(pass, facts) {
    const seconds = roundToTenth(facts.cleanStretchSeconds);
    const said = "Your longest clean stretch was " + secondsText(seconds) + ".";
    const target = secondsText(pass.stretchSeconds);
    if (seconds >= pass.stretchSeconds) {
      return { passed: true, detail: said + " Level cleared: the target was " + target + "." };
    }
    return { passed: false, detail: said + " Hold one for " + target + TO_CLEAR_THIS_LEVEL };
  }

  function notReadThrough(unread) {
    return {
      passed: false,
      detail:
        "You left out " + unread + " words of the passage in one place. " +
        "Read all of it" + TO_CLEAR_THIS_LEVEL,
    };
  }

  // The numbers the judges read from a report, each checked, so a malformed report fails a
  // level instead of throwing.
  function factsOf(report) {
    const given = report && typeof report === "object" ? report : {};
    const speechStart = isFiniteNumber(given.speechStart) ? given.speechStart : null;
    const speakingSeconds = numberOr0(given.speakingSeconds);
    const clean = given.cleanStretch;
    return {
      spoke: speechStart !== null && speakingSeconds > 0,
      speechStart,
      speakingSeconds,
      wpm: Math.round(numberOr0(given.wordsPerMinute)),
      slips: slipsOf(given),
      restartCount: numberOr0(given.repeatCount),
      followedScript: given.followedScript === true,
      misreadCount: listOf(given.misreads).length,
      skips: listOf(given.skips),
      cleanStretchSeconds: clean && typeof clean === "object" ? numberOr0(clean.seconds) : 0,
    };
  }

  // Every filler and restart as {at, name}, earliest first. `name` is how the detail names it:
  // “um”, or you restarted “the few decisions”. A restart is at the start of the phrase the
  // speaker went back over, where delivery.js ends a clean stretch and Results marks it.
  function slipsOf(report) {
    const fillers = listOf(report.fillers)
      .filter((filler) => filler && isFiniteNumber(filler.start))
      .map((filler) => ({
        at: filler.start,
        name: filler.text ? quoted(filler.text) : "a filler",
      }));
    const restarts = listOf(report.restarts)
      .filter((restart) => restart && isFiniteNumber(restart.at))
      .map((restart) => ({
        at: restart.at,
        name: restart.text ? "you restarted " + quoted(restart.text) : "a restart",
      }));
    return fillers.concat(restarts).sort((a, b) => a.at - b.at);
  }

  // The most script words skipped in one place. Skips come in script order, and the words
  // skipped in one place share their `at`, the end of the word said before them.
  function longestSkipRun(skips) {
    let longest = 0;
    let run = 0;
    let at = null;
    skips.forEach((skip) => {
      const here = skip && isFiniteNumber(skip.at) ? skip.at : null;
      const samePlace = here !== null && at !== null && Math.abs(here - at) < MILLISECOND;
      run = samePlace ? run + 1 : 1;
      at = here;
      longest = Math.max(longest, run);
    });
    return longest;
  }

  // "no restarts or misreads", "2 restarts and no misreads", "1 restart and 2 misreads".
  function slipsText(restarts, misreads) {
    if (restarts === 0 && misreads === 0) {
      return "no restarts or misreads";
    }
    return countText(restarts, "restart") + " and " + countText(misreads, "misread");
  }

  // --- Weakest unit first ----------------------------------------------------------------------

  // The units, the weakest first: each unit's distance from its target (distancesFromTarget),
  // averaged over the speaker's RECENT_TAKES latest takes with speech, ranked as
  // backend/advice/select.py weakest_skills ranks one take. `history` is the takes as
  // app.store.list() resolves them, in any order; the sample a visitor opens from Practice is
  // left out, as Progress leaves it out. Ties, and a speaker with no takes, keep UNITS' order.
  function order(history) {
    const recent = recentDistances(history);
    if (recent.length === 0) {
      return UNITS.slice();
    }
    const average = {};
    UNITS.forEach((entry) => {
      const total = recent.reduce((sum, distances) => sum + distances[entry.id], 0);
      average[entry.id] = roundTo(total / recent.length, TIE_DECIMALS);
    });
    return UNITS.slice().sort((a, b) => average[b.id] - average[a.id]);
  }

  // Each unit's distance for the RECENT_TAKES latest takes that hold speech, newest first.
  function recentDistances(history) {
    const takes = listOf(history)
      .filter((take) => take && typeof take === "object" && isOwnTake(take))
      .sort(newestFirst);
    const recent = [];
    for (const take of takes) {
      if (recent.length === RECENT_TAKES) {
        break;
      }
      const distances = unitDistancesOf(take);
      if (distances !== null) {
        recent.push(distances);
      }
    }
    return recent;
  }

  // One take's distance from target for each unit, by unit id, or null for a take with no
  // speaking time, which says nothing about any skill. Pace has a tag for each edge of its band
  // and reads the edge the take is nearer, the one weakest_skills ranks (the far one goes last).
  function unitDistancesOf(take) {
    const report = app.delivery.analyze(take.transcript, take.metrics);
    if (!(report.speakingSeconds > 0)) {
      return null;
    }
    const byTag = distancesFromTarget(report, paceBandOf(take.passageId));
    const byUnit = {};
    UNITS.forEach((entry) => {
      byUnit[entry.id] = Math.max(...entry.tags.map((tag) => byTag[tag]));
    });
    return byUnit;
  }

  // select.py distances_from_target for the tags the path has a unit for (none trains
  // mid_pause), read from a delivery report as select.py's ReportSummary is. Every skill reads
  // on one scale, above 0 past its target: a rate is its share of its target less one, each
  // long pause is a full step past a target of none (a take without one reads NONE_AT_ALL),
  // and pace counts band widths past an edge of the band.
  function distancesFromTarget(report, band) {
    const minutes = report.speakingSeconds / SECONDS_PER_MINUTE;
    const [lo, hi] = band;
    const wpm = report.wordsPerMinute;
    const longPauses = report.longPauseCount;
    return {
      restart: report.repeatCount / minutes / RESTARTS_PER_MINUTE_TARGET - 1,
      filler: report.fillerCount / minutes / FILLERS_PER_MINUTE_TARGET - 1,
      long_pause: longPauses > LONG_PAUSES_TARGET ? longPauses : NONE_AT_ALL,
      pace_fast: (wpm - hi) / (hi - lo),
      pace_slow: (lo - wpm) / (hi - lo),
    };
  }

  // The pace band of the take's passage, the one Results judges it against, or
  // DEFAULT_TARGET_WPM for a passage that is gone or a band that is not two numbers, low first.
  function paceBandOf(passageId) {
    const passages = Array.isArray(app.passages) ? app.passages : [];
    const passage = passages.concat(coldReadPassages()).find((entry) => entry.id === passageId);
    const band = passage ? passage.targetWpm : null;
    const valid =
      Array.isArray(band) && band.length === 2 && band.every(isFiniteNumber) && band[0] < band[1];
    return valid ? band : DEFAULT_TARGET_WPM;
  }

  // False for the bundled sample (app.screens.results.isSample), as Progress reads it; without
  // the Results module every take is the speaker's own.
  function isOwnTake(take) {
    const results = app.screens ? app.screens.results : undefined;
    return !(results && typeof results.isSample === "function" && results.isSample(take));
  }

  // ISO 8601 times order correctly as plain text; a take without one sorts last.
  function newestFirst(a, b) {
    const first = String(a.createdAt || "");
    const second = String(b.createdAt || "");
    if (first === second) {
      return 0;
    }
    return first < second ? 1 : -1;
  }

  // --- Unlocking ------------------------------------------------------------------------------

  // `cleared` is the speaker's cleared levels as app.store.listClearedLevels() resolves them,
  // [{levelId, clearedAt}]; a record without a text levelId is skipped.
  function clearedIds(cleared) {
    return new Set(
      listOf(cleared)
        .filter((record) => record && typeof record.levelId === "string")
        .map((record) => record.levelId),
    );
  }

  // Whether `level` can be played: a unit's first level always, any other once the level right
  // before it in its unit is cleared (PLAN T42). Each unit climbs on its own, so reordering the
  // units by weakness never locks a level the speaker has opened.
  function isUnlocked(level, cleared) {
    const before = levelBefore(level);
    return before === null || clearedIds(cleared).has(before.id);
  }

  // "cleared", "current" (unlocked, not cleared yet) or "locked".
  function statusOf(level, cleared) {
    if (clearedIds(cleared).has(level.id)) {
      return CLEARED;
    }
    return isUnlocked(level, cleared) ? CURRENT : LOCKED;
  }

  // The unit's first level not cleared yet, which is always unlocked, or null once all are.
  function currentLevel(pathUnit, cleared) {
    const ids = clearedIds(cleared);
    return pathUnit.levels.find((level) => !ids.has(level.id)) || null;
  }

  // The level before `level` in its unit, or null for a unit's first level.
  function levelBefore(level) {
    const known = levelById(level ? level.id : undefined);
    if (known === null) {
      throw new Error("Unknown path level: " + (level ? level.id : level));
    }
    return known.number === 1 ? null : levelById(known.unit + "-" + (known.number - 1));
  }

  // --- Cold reads -----------------------------------------------------------------------------

  // A cold read for the next take: a passage from app.passages.coldReads() the speaker has
  // never read (no take in `history` has its id), drawn with `random`, a function returning a
  // number in [0, 1) such as Math.random, so a test can fix the draw. Once every cold read has
  // been read, the one read longest ago comes back, as backend advice does once every entry has
  // been shown. Null when there are no cold reads.
  function pickColdRead(history, random) {
    if (typeof random !== "function") {
      throw new TypeError("pickColdRead needs a random source, such as Math.random");
    }
    const coldReads = coldReadPassages();
    const takes = listOf(history).filter((take) => take && typeof take === "object");
    const read = new Set(takes.map((take) => take.passageId));
    const unread = coldReads.filter((passage) => !read.has(passage.id));
    if (unread.length > 0) {
      return unread[indexFor(random(), unread.length)];
    }
    return leastRecentlyRead(coldReads, takes);
  }

  // The draw as an index into a list of `length`, kept inside it whatever the source returns.
  function indexFor(draw, length) {
    const index = Math.floor(Number(draw) * length);
    return Number.isFinite(index) ? Math.min(length - 1, Math.max(0, index)) : 0;
  }

  // The passage whose latest take is the oldest; a tie goes to the one listed first.
  function leastRecentlyRead(passages, takes) {
    let oldest = null;
    let oldestReadAt = null;
    passages.forEach((passage) => {
      const readAt = takes
        .filter((take) => take.passageId === passage.id)
        .map((take) => String(take.createdAt || ""))
        .reduce((latest, at) => (at > latest ? at : latest), "");
      if (oldest === null || readAt < oldestReadAt) {
        oldest = passage;
        oldestReadAt = readAt;
      }
    });
    return oldest;
  }

  function coldReadPassages() {
    const passages = app.passages;
    return passages && typeof passages.coldReads === "function" ? passages.coldReads() : [];
  }

  // --- Small helpers --------------------------------------------------------------------------

  // m:ss, as app.ui.formatClock writes it; kept here so path.js loads without ui.js.
  function clockText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    return minutes + ":" + String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  }

  // "17.5 seconds" or "1 second", as the Results headline writes a clean stretch.
  function secondsText(seconds) {
    return seconds === 1 ? "1 second" : seconds + " seconds";
  }

  // "no restarts", "1 restart", "3 restarts".
  function countText(count, noun) {
    if (count === 0) {
      return "no " + noun + "s";
    }
    return count === 1 ? "1 " + noun : count + " " + noun + "s";
  }

  function quoted(text) {
    return "“" + text + "”";
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function roundTo(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  // Freezes the path data all the way down, so no caller can change a level another reads.
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  app.path = {
    UNITS,
    MODE_TITLES,
    levelById,
    order,
    evaluate,
    isUnlocked,
    statusOf,
    currentLevel,
    pickColdRead,
  };
})();
