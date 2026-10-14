/* loop.js: app.loop, the Level screen's pure helpers for one play (spec
   docs/superpowers/specs/2026-10-14-loop-path.md section 8): its steps, the feedback after take 1
   with its change line, the moments to review and the words around them, tap matching, each
   moment's clip and the review's choices. Pure: no DOM, store, clock or Math.random. */
(function () {
  "use strict";

  // What happened at a moment, as the Review asks it: one choice per moment.
  const WHAT_HAPPENED = Object.freeze([
    "Lost my point",
    "Searching for a word",
    "Nerves",
    "Planned breath",
  ]);

  // How long before a filler (seconds) and after it a tap still catches it: Spot it, tapped as
  // take 1 plays back, and the live tap, tapped while recording, which needs a moment longer.
  const SPOT_IT_WINDOW = Object.freeze({ before: 0.5, after: 2 });
  const LIVE_TAP_WINDOW = Object.freeze({ before: 0.5, after: 2.5 });

  // The Review looks at this many moments at most, each played from 1 s before it for 3 s.
  const MOMENTS_TO_REVIEW = 3;
  const CLIP_LEAD_SECONDS = 1;
  const CLIP_SECONDS = 3;

  // The words shown around a moment: 2 before and 2 after a filler, the 2 after a restart's
  // first copy, and 3 before and 2 after a pause, as in "we need to [5.2 s] the plan".
  const WORDS_BEFORE_FILLER = 2;
  const WORDS_AFTER = 2;
  const WORDS_BEFORE_PAUSE = 3;
  // A pace review splits the take's speech into this many equal parts.
  const PACE_PARTS = 3;

  const SECONDS_PER_MINUTE = 60;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // Word times are in seconds to the millisecond; two closer than this are the same moment.
  const MILLISECOND = 0.001;
  // A word's punctuation at either end, kept off the slip it marks: "um," marks "um".
  const EDGES = /^([^\p{L}\p{N}_]*)([\s\S]*?)([^\p{L}\p{N}_]*)$/u;
  const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  // An earlier day this close to today is named by its weekday; one further back by its date.
  const WEEKDAY_WITHIN_DAYS = 6;

  // --- Steps ----------------------------------------------------------------------------------

  // The steps the Level screen's stepper shows for a play (or its id), in order, each {step,
  // label, takeIndex}: `step` "goal", "take", "review", "result", "intro" or "done", and
  // `takeIndex` the take a "take" step records (null for the others). A loop: Goal, its first
  // take, Review, its other takes, Result ("Goal · Read 1 · Review · Read 2 · Read 3 ·
  // Result"). A check-back, crown or checkpoint: Goal · Take · Result. The benchmark: Intro ·
  // Read · Talk · Done.
  function stepsFor(play) {
    const known = playOf(play);
    if (known.kind === "benchmark") {
      return [step("intro", "Intro")]
        .concat(known.takes.map((take, index) => step("take", take.label, index)))
        .concat([step("done", "Done")]);
    }
    const steps = [step("goal", "Goal")];
    known.takes.forEach((take, index) => {
      steps.push(step("take", take.label, index));
      if (index === 0 && known.kind === "loop") {
        steps.push(step("review", "Review"));
      }
    });
    steps.push(step("result", "Result"));
    return steps;
  }

  function step(kind, label, takeIndex) {
    return { step: kind, label, takeIndex: takeIndex === undefined ? null : takeIndex };
  }

  // The play `play` names (a play or its id), as app.path.playById gives it.
  function playOf(play) {
    const id = play && typeof play === "object" ? play.id : play;
    const known = app.path.playById(id);
    if (known === null) {
      throw new Error("Unknown path play: " + id);
    }
    return known;
  }

  // --- Feedback -------------------------------------------------------------------------------

  // The Feedback card after a take (take 1 unless `context.takeIndex` says otherwise): {value,
  // valueText, unitLabel, targetText, change, caught}. The number, its words and the target
  // come from app.path.evaluate against `context.baseline`. `change` is the change line,
  // {text, direction, trend} or null: against the latest earlier own take in `context.history`
  // that has this number (for a read, the latest that followed a script), leaving out the take
  // itself (`context.takeId`) and any take after `context.at`; `direction` is "better", "worse"
  // or "same" for the skill, `trend` "down", "up" or "flat" for the number, and the text says
  // when, from the local day `context.today` ("1.4 fewer than Tuesday", "Same as yesterday").
  // `caught`, on a play with the live tap given `context.liveTaps` (the seconds tapped), is
  // {caught, total, text}: "You caught 3 of 5 live."
  function feedbackFor(play, report, context) {
    const known = playOf(play);
    const given = context && typeof context === "object" ? context : {};
    const takeIndex = Number.isInteger(given.takeIndex) ? given.takeIndex : 0;
    const result = app.path.evaluate(known.id, takeIndex, report, {
      baseline: given.baseline,
      cleared: given.cleared,
      earlier: given.earlier,
    });
    const tapped = known.liveTap && Array.isArray(given.liveTaps);
    return {
      value: result.value,
      valueText: result.valueText,
      unitLabel: result.unitLabel,
      targetText: result.targetText,
      change: changeOf(known, takeIndex, result.value, given),
      caught: tapped ? caughtLive(report, given.liveTaps) : null,
    };
  }

  // The change line for a level's number, or null without a level, a number, a day or an
  // earlier take that has it.
  function changeOf(known, takeIndex, value, given) {
    const level = known.level ? app.path.levelById(known.level) : null;
    const today = app.path.localDay(given.today);
    if (level === null || value === null || today === null) {
      return null;
    }
    const key = level.conditions[0].measure;
    const take = app.path.takeAt(known.id, takeIndex) || {};
    const earlier = latestEarlier(key, take.read === true || key === "readSlips", given);
    if (earlier === null) {
      return null;
    }
    const when = whenText(app.path.localDay(earlier.take.createdAt), today);
    return changeLine(key, value, earlier.value, when, take.band);
  }

  // The latest own take before this one with a number for `key`, as {take, value}, or null. A
  // read (`read`, its slips or its pace alike) compares only with a take that followed a script,
  // since a talk's slips and pace are not a read's.
  function latestEarlier(key, read, given) {
    const before = typeof given.at === "string" ? given.at : null;
    const takes = app.path
      .ownTakes(given.history)
      .filter((take) => take.id !== given.takeId)
      .filter((take) => before === null || String(take.createdAt || "") < before)
      .sort((a, b) => compareText(String(b.createdAt || ""), String(a.createdAt || "")));
    for (const take of takes) {
      const measured = app.path.measure(app.delivery.analyze(take.transcript, take.metrics), 0);
      const hasIt = measured.spoke && (!read || measured.followedScript);
      if (hasIt) {
        return { take, value: measured[key] };
      }
    }
    return null;
  }

  // How a number moved since `before`, compared as it is shown (a rate or seconds to a tenth,
  // a count or wpm whole). Fewer fillers, restarts and slips are better, a longer clean stretch
  // is better, and a pace is better nearer its band.
  function changeLine(key, now, before, when, band) {
    const whole = key === "readSlips" || key === "wpm";
    const scale = whole ? 1 : 10;
    const steps = Math.round(now * scale) - Math.round(before * scale);
    if (steps === 0) {
      return { text: "Same as " + when, direction: "same", trend: "flat" };
    }
    const trend = steps < 0 ? "down" : "up";
    const amount = Math.abs(steps) / scale;
    if (key === "wpm") {
      const nearer = outsideBand(now, band) - outsideBand(before, band);
      const direction = nearer < 0 ? "better" : nearer > 0 ? "worse" : "same";
      const text = amount + " wpm " + (steps < 0 ? "slower" : "faster") + " than " + when;
      return { text, direction, trend };
    }
    if (key === "cleanStretchSeconds") {
      const text = amount + " s " + (steps > 0 ? "longer" : "shorter") + " than " + when;
      return { text, direction: steps > 0 ? "better" : "worse", trend };
    }
    const shown = whole ? String(amount) : amount.toFixed(1);
    const text = shown + " " + (steps < 0 ? "fewer" : "more") + " than " + when;
    return { text, direction: steps < 0 ? "better" : "worse", trend };
  }

  // How far a pace is outside its band, 0 inside it.
  function outsideBand(wpm, band) {
    if (!Array.isArray(band)) {
      return 0;
    }
    if (wpm < band[0]) {
      return band[0] - wpm;
    }
    return wpm > band[1] ? wpm - band[1] : 0;
  }

  function caughtLive(report, taps) {
    const match = matchTaps(taps, fillerTimes(report), LIVE_TAP_WINDOW);
    return {
      caught: match.caught,
      total: match.total,
      text: "You caught " + match.caught + " of " + match.total + " live.",
    };
  }

  // --- Moments --------------------------------------------------------------------------------

  // The moments the Review looks at in a take, at most MOMENTS_TO_REVIEW, earliest first, each
  // {kind, at, time, text, parts, flagged}: `at` the second it starts (what clipFor plays),
  // `time` that as m:ss, `parts` the words around it as [{text, marked}] with the slip marked,
  // and `text` them joined ("so the, um, the plan"). `transcript` is the take's words, which a
  // report does not keep. By unit:
  // - Fillers: each filler ("filler"), with 2 words before and 2 after.
  // - Restarts: each restart ("restart"), the words gone back over and the next 2, and each
  //   misread ("misread"): the word said for the script's word.
  // - Long pauses: the long pauses ("long-pause") first, then the longest short mid-sentence
  //   ones ("pause"), written "we need to [5.2 s] the plan".
  // - Pace: the take's thirds ("pace"), each "0:00 to 0:30, 172 wpm" with `time` "0:00 to 0:30",
  //   `flagged` when outside the band of the take at `takeIndex` (0 for take 1).
  function momentsFor(play, report, transcript, takeIndex) {
    const known = playOf(play);
    const given = report && typeof report === "object" ? report : {};
    const words = wordsOf(transcript);
    if (known.unit === "fillers") {
      return earliest(fillerMoments(given, words));
    }
    if (known.unit === "restarts") {
      return earliest(restartMoments(given, words));
    }
    if (known.unit === "long-pauses") {
      return pauseMoments(given, words);
    }
    if (known.unit === "pace") {
      const take = app.path.takeAt(known.id, Number.isInteger(takeIndex) ? takeIndex : 0);
      return paceMoments(words, take ? take.band : undefined);
    }
    return [];
  }

  function earliest(moments) {
    return moments.sort((a, b) => a.at - b.at).slice(0, MOMENTS_TO_REVIEW);
  }

  // A moment with its words: those before it, the marked slip, and those after.
  function moment(kind, at, before, marked, after) {
    const parts = [];
    if (before) {
      parts.push({ text: before, marked: false });
    }
    parts.push({ text: marked, marked: true });
    if (after) {
      parts.push({ text: after, marked: false });
    }
    return {
      kind,
      at,
      time: clockText(at),
      text: parts.map((part) => part.text).join(""),
      parts,
      flagged: false,
    };
  }

  function fillerMoments(report, words) {
    return listOf(report.fillers)
      .filter((filler) => filler && isFiniteNumber(filler.start) && Number.isInteger(filler.index))
      .map((filler) => {
        const first = filler.index;
        const last = first + String(filler.text || "").split(" ").length - 1;
        const said = textOf(words.slice(first, last + 1)) || String(filler.text || "");
        const { lead, core, trail } = edgesOf(said);
        const before = textOf(words.slice(Math.max(0, first - WORDS_BEFORE_FILLER), first));
        const after = textOf(words.slice(last + 1, last + 1 + WORDS_AFTER));
        return moment(
          "filler",
          filler.start,
          (before ? before + " " : "") + lead,
          core,
          trail + (after ? " " + after : ""),
        );
      });
  }

  function restartMoments(report, words) {
    const restarts = listOf(report.restarts)
      .filter((restart) => restart && isFiniteNumber(restart.at))
      .map((restart) => {
        const first = words.findIndex((word) => Math.abs(word.start - restart.at) < MILLISECOND);
        if (first === -1) {
          return moment("restart", restart.at, "", String(restart.text || ""), "");
        }
        const last = firstCopyEnd(words, first, String(restart.text || ""));
        const goneBackOver = textOf(words.slice(first, last + 1));
        const after = textOf(words.slice(last + 1, last + 1 + WORDS_AFTER));
        return moment("restart", restart.at, "", goneBackOver, after && " " + after);
      });
    const misreads = listOf(report.misreads)
      .filter((misread) => misread && isFiniteNumber(misread.at))
      .map((misread) =>
        moment("misread", misread.at, "", String(misread.said), " for “" + misread.word + "”"),
      );
    return restarts.concat(misreads);
  }

  // The index of the last word of a restart's first copy, which starts at `first` and says as
  // many words as the restart's text, hesitations not counted, as the backend reads a repeat.
  function firstCopyEnd(words, first, text) {
    const length = Math.max(1, text.split(" ").filter(Boolean).length);
    let counted = 0;
    let index = first;
    while (index < words.length) {
      if (!app.delivery.isHesitation(words[index].text)) {
        counted += 1;
      }
      if (counted === length) {
        return index;
      }
      index += 1;
    }
    return words.length - 1;
  }

  // The long pauses first, the longest first, then the longest short mid-sentence pauses: the
  // first MOMENTS_TO_REVIEW of them, earliest first.
  function pauseMoments(report, words) {
    const counted = listOf(report.pauses).filter(
      (pause) =>
        pause && isFiniteNumber(pause.at) && isFiniteNumber(pause.length) &&
        (pause.long === true || pause.midSentence === true),
    );
    const longestFirst = (a, b) => b.length - a.length;
    const chosen = counted
      .filter((pause) => pause.long === true)
      .sort(longestFirst)
      .concat(counted.filter((pause) => pause.long !== true).sort(longestFirst))
      .slice(0, MOMENTS_TO_REVIEW);
    return chosen
      .map((pause) => {
        const index = app.delivery.wordBeforePause(words, pause.at, pause.length);
        const firstBefore = Math.max(0, index - WORDS_BEFORE_PAUSE + 1);
        const before = index === -1 ? "" : textOf(words.slice(firstBefore, index + 1));
        const after = textOf(words.slice(index + 1, index + 1 + WORDS_AFTER));
        const kind = pause.long === true ? "long-pause" : "pause";
        const marked = "[" + roundToTenth(pause.length) + " s]";
        return moment(kind, pause.at, before && before + " ", marked, after && " " + after);
      })
      .sort((a, b) => a.at - b.at);
  }

  // The take's speech, first word to last, in PACE_PARTS equal parts, each with its pace: the
  // words (not hesitations) that start in it, over its minutes.
  function paceMoments(words, band) {
    if (words.length === 0) {
      return [];
    }
    const start = words[0].start;
    const span = words[words.length - 1].end - start;
    if (!(span > 0)) {
      return [];
    }
    const part = span / PACE_PARTS;
    const counts = Array.from({ length: PACE_PARTS }, () => 0);
    words.forEach((word) => {
      if (!app.delivery.isHesitation(word.text)) {
        counts[Math.min(PACE_PARTS - 1, Math.max(0, Math.floor((word.start - start) / part)))] += 1;
      }
    });
    return counts.map((count, index) => {
      const from = start + part * index;
      const to = from + part;
      const wpm = Math.round(count / (part / SECONDS_PER_MINUTE));
      const flagged = Array.isArray(band) && (wpm < band[0] || wpm > band[1]);
      const time = clockText(from) + " to " + clockText(to);
      return {
        kind: "pace",
        at: from,
        time,
        text: time + ", " + wpm + " wpm",
        parts: [{ text: wpm + " wpm", marked: flagged }],
        flagged,
      };
    });
  }

  // --- Taps and clips -------------------------------------------------------------------------

  // Matches taps to events, each tap to at most one event not yet matched and each event to at
  // most one tap: a tap at `t` catches an event at `e` when e - tapWindow.before <= t <= e +
  // tapWindow.after (SPOT_IT_WINDOW or LIVE_TAP_WINDOW). Taps are taken in time order, each
  // catching the earliest event still free in its window, which catches as many as can be
  // caught. {caught, total, pairs: [[tap, event]], text: "You caught 4 of 6."}; anything that is
  // not a time is skipped.
  function matchTaps(taps, eventTimes, tapWindow) {
    const given = tapWindow && typeof tapWindow === "object" ? tapWindow : {};
    const before = isFiniteNumber(given.before) ? given.before : 0;
    const after = isFiniteNumber(given.after) ? given.after : 0;
    const times = (list) => listOf(list).filter(isFiniteNumber).sort((a, b) => a - b);
    const events = times(eventTimes);
    const free = events.map(() => true);
    const pairs = [];
    times(taps).forEach((tap) => {
      const earliest = tap - after - MILLISECOND;
      const latest = tap + before + MILLISECOND;
      const index = events.findIndex(
        (event, at) => free[at] && event >= earliest && event <= latest,
      );
      if (index !== -1) {
        free[index] = false;
        pairs.push([tap, events[index]]);
      }
    });
    return {
      caught: pairs.length,
      total: events.length,
      pairs,
      text: "You caught " + pairs.length + " of " + events.length + ".",
    };
  }

  // When each filler in a take's report starts, the events Spot it and the live tap catch.
  function fillerTimes(report) {
    const given = report && typeof report === "object" ? report : {};
    return listOf(given.fillers)
      .filter((filler) => filler && isFiniteNumber(filler.start))
      .map((filler) => filler.start);
  }

  // The part of take 1 a moment's "Play 3 s" plays: {offset, duration}, from 1 s before the
  // moment (a moment or its second) for 3 s, never before the start.
  function clipFor(momentOrSeconds) {
    const at = isFiniteNumber(momentOrSeconds)
      ? momentOrSeconds
      : momentOrSeconds && isFiniteNumber(momentOrSeconds.at)
        ? momentOrSeconds.at
        : 0;
    const offset = Math.max(0, Math.round((at - CLIP_LEAD_SECONDS) * 1000) / 1000);
    return { offset, duration: CLIP_SECONDS };
  }

  // --- Days in words --------------------------------------------------------------------------

  // A local day ("2026-10-16") in words: "Friday, Oct 16" for `form` "long", "Fri, Oct 16" for
  // "short", else "Oct 16"; "" for anything that is not a day.
  function dateText(day, form) {
    const number = dayNumberOf(day);
    if (number === null) {
      return "";
    }
    const date = new Date(number * MS_PER_DAY);
    const monthDay = MONTHS[date.getUTCMonth()] + " " + date.getUTCDate();
    const weekday = WEEKDAYS[date.getUTCDay()];
    if (form === "long") {
      return weekday + ", " + monthDay;
    }
    return form === "short" ? weekday.slice(0, 3) + ", " + monthDay : monthDay;
  }

  // When an earlier local day was, from `today`: "earlier today", "yesterday", the weekday
  // within WEEKDAY_WITHIN_DAYS, else the date ("Oct 3"); "" without two days.
  function whenText(day, today) {
    const then = dayNumberOf(day);
    const now = dayNumberOf(today);
    if (then === null || now === null) {
      return "";
    }
    const daysAgo = now - then;
    if (daysAgo === 0) {
      return "earlier today";
    }
    if (daysAgo === 1) {
      return "yesterday";
    }
    if (daysAgo > 1 && daysAgo <= WEEKDAY_WITHIN_DAYS) {
      return WEEKDAYS[new Date(then * MS_PER_DAY).getUTCDay()];
    }
    return dateText(day);
  }

  // A real local day as a count of days since 1970-01-01, or null.
  function dayNumberOf(day) {
    if (typeof day !== "string" || !DAY_PATTERN.test(day) || app.path.localDay(day) !== day) {
      return null;
    }
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date) / MS_PER_DAY;
  }

  // --- Small helpers --------------------------------------------------------------------------

  // A transcript's words, each with text and numeric times, so one malformed word never throws.
  function wordsOf(transcript) {
    return listOf(transcript).map((word) => ({
      text: String((word && word.text) || ""),
      start: Number(word && word.start) || 0,
      end: Number(word && word.end) || 0,
    }));
  }

  function textOf(words) {
    return words.map((word) => word.text).join(" ");
  }

  // A slip's text split into its punctuation and its core: "um," is "", "um", ",".
  function edgesOf(text) {
    const [, lead, core, trail] = EDGES.exec(text);
    return core === "" ? { lead: "", core: text, trail: "" } : { lead, core, trail };
  }

  // m:ss, as app.ui.formatClock writes it; kept here so loop.js loads without ui.js.
  function clockText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    return minutes + ":" + String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  }

  function compareText(a, b) {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  app.loop = {
    WHAT_HAPPENED,
    SPOT_IT_WINDOW,
    LIVE_TAP_WINDOW,
    stepsFor,
    feedbackFor,
    momentsFor,
    matchTaps,
    fillerTimes,
    clipFor,
    dateText,
    whenText,
  };
})();
