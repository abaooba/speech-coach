/* tips.js: app.tips, the coaching tips shown under the Results transcript. select(report,
   options) reads one take's app.delivery report and the passage's target range and returns at
   most two {id, text} tips in priority order. A tip names the moments it is about and one thing
   to try on the next take. Pure: no DOM, no store, no I/O. */
(function () {
  "use strict";

  /* Rules, top to bottom; the first two that fire are shown, and "clean" shows only when none
     fire. [lo, hi] is options.targetWpm, default [140, 160]. Every number is rounded as the
     Results cards show it, so a tip never disagrees with the card above it.

       id          fires when                  why it matters for a debater
       pace-fast   wpm > hi + 15               a judge who cannot keep up stops flowing
       pace-slow   wpm < lo - 15               a slow speech runs out of time for its last point
       fillers     fillers per minute > 3      Zoom and tl;dv put 0.6 to 3 a minute in range
       habit       top habit 3 times or more   the Ah-Counter names each speaker's crutch word
       break-long  mid-sentence pause > 3 s    a pause at a period lands; mid-sentence it stalls
       freeze      5 s+ pause after a period   a freeze reads as a lost place, even at a period
       repeats     3 restarts or more          each restart costs the judge's trust in the line
       clean       nothing above fired */

  const DEFAULT_TARGET_WPM = [140, 160];
  const MAX_TIPS = 2;
  const PACE_MARGIN_WPM = 15;
  const MAX_FILLERS_PER_MINUTE = 3;
  const MIN_HABIT_COUNT = 3;
  const MAX_BREAK_SECONDS = 3;
  const MIN_REPEATS = 3;
  // The fillers tip lists this many moments, then "and N more".
  const MAX_TIMES_LISTED = 3;
  const SECONDS_PER_MINUTE = 60;

  const RULES = [
    {
      id: "pace-fast",
      fires: (facts) => facts.wpm > facts.hi + PACE_MARGIN_WPM,
      text: () => "You are above target pace. Breathe at each period.",
    },
    {
      id: "pace-slow",
      fires: (facts) => facts.wpm < facts.lo - PACE_MARGIN_WPM,
      text: () => "You are under target pace. Shorten the pauses between ideas.",
    },
    {
      id: "fillers",
      fires: (facts) => facts.fillersPerMinute > MAX_FILLERS_PER_MINUTE,
      text: fillersText,
    },
    {
      id: "habit",
      fires: (facts) => facts.topHabit !== null && facts.topHabit.count >= MIN_HABIT_COUNT,
      text: (facts) =>
        "You said “" + facts.topHabit.text + "” " + facts.topHabit.count + " times. " +
        "Drop it and let the sentence land.",
    },
    {
      id: "break-long",
      fires: (facts) => facts.longestBreak > MAX_BREAK_SECONDS,
      text: () =>
        "A pause in the middle of a sentence ran past 3 seconds. " +
        "Glance at your next point first.",
    },
    {
      id: "freeze",
      fires: (facts) => facts.longestFreeze !== null,
      text: (facts) =>
        "You froze for " + facts.longestFreeze.length.toFixed(1) + " seconds at " +
        clockText(facts.longestFreeze.at) + ". Know how your next point opens.",
    },
    {
      id: "repeats",
      fires: (facts) => facts.repeatCount >= MIN_REPEATS,
      text: () => "You restarted phrases three times. Finish the sentence, then fix it.",
    },
  ];

  // The clean tip names what went right and gives no direction: the headline's focus above it
  // already says what to work on next, so the screen gives one piece of advice.
  const CLEAN_TIP = { id: "clean", text: "Clean run. No filler, habit or long pause stood out." };

  function select(report, options) {
    const facts = readFacts(report || {}, options || {});
    const fired = RULES.filter((rule) => rule.fires(facts)).slice(0, MAX_TIPS);
    if (fired.length === 0) {
      return [{ id: CLEAN_TIP.id, text: CLEAN_TIP.text }];
    }
    return fired.map((rule) => ({ id: rule.id, text: rule.text(facts) }));
  }

  // "Fillers at 0:02, 0:05 and 0:10." or "... 0:10 and 8 more.", then the technique. A take
  // saved without words has no moments to name, so it gets the advice alone.
  function fillersText(facts) {
    const technique = "Next take, close your mouth and pause instead.";
    if (facts.fillerTimes.length === 0) {
      return "Replace um with a silent beat. " + technique;
    }
    const listed = facts.fillerTimes.slice(0, MAX_TIMES_LISTED).map(clockText);
    const more = facts.fillerTimes.length - listed.length;
    return "Fillers at " + joinMoments(listed, more) + ". " + technique;
  }

  // "0:02", "0:02 and 0:05", "0:02, 0:05 and 0:10", or "0:02, 0:05, 0:10 and 8 more".
  function joinMoments(listed, more) {
    if (more > 0) {
      return listed.join(", ") + " and " + more + " more";
    }
    if (listed.length === 1) {
      return listed[0];
    }
    return listed.slice(0, -1).join(", ") + " and " + listed[listed.length - 1];
  }

  // The numbers the rules compare, read once. Missing or malformed values read as 0 (or no
  // habit) so a bad record still yields a tip instead of an exception.
  function readFacts(report, options) {
    const [lo, hi] = targetRange(options.targetWpm);
    const fillers = Array.isArray(report.fillers) ? report.fillers : [];
    const habit = report.topHabit;
    const validHabit =
      habit && typeof habit.text === "string" && Number.isFinite(Number(habit.count));
    return {
      lo,
      hi,
      wpm: Math.round(numberOr0(report.wordsPerMinute)),
      fillersPerMinute: roundToTenth(numberOr0(report.fillersPerMinute)),
      fillerTimes: fillers.map((event) => numberOr0(event && event.start)),
      topHabit: validHabit ? { text: habit.text, count: Number(habit.count) } : null,
      longestBreak: roundToTenth(numberOr0(report.longestMidSentencePause)),
      longestFreeze: longestFreeze(report.pauses),
      repeatCount: numberOr0(report.repeatCount),
    };
  }

  // The longest long pause (5 s+, the report's `long` flag) that falls between sentences, as
  // {at, length}, or null. A long mid-sentence pause is left to break-long, so one freeze never
  // gets two tips.
  function longestFreeze(pauses) {
    let longest = null;
    (Array.isArray(pauses) ? pauses : []).forEach((pause) => {
      const freeze = pause && pause.long === true && pause.midSentence === false;
      if (freeze && (longest === null || numberOr0(pause.length) > longest.length)) {
        longest = { at: numberOr0(pause.at), length: numberOr0(pause.length) };
      }
    });
    return longest;
  }

  // The same m:ss text as app.ui.formatClock, kept here so tips.js loads on its own.
  function clockText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    const rest = whole % SECONDS_PER_MINUTE;
    return minutes + ":" + String(rest).padStart(2, "0");
  }

  // A copy of [lo, hi] when the option is a pair of finite numbers, else the default range.
  function targetRange(targetWpm) {
    const valid =
      Array.isArray(targetWpm) &&
      targetWpm.length === 2 &&
      targetWpm.every((bound) => Number.isFinite(Number(bound)));
    const range = valid ? targetWpm : DEFAULT_TARGET_WPM;
    return [Number(range[0]), Number(range[1])];
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  app.tips = { select };
})();
