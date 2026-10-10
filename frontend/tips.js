/* tips.js: app.tips, the rule-based coaching tips shown under the Results transcript.
   select(metrics, options) reads the backend metrics dict and the passage's target range and
   returns at most two {id, text} tips in priority order. Pure: no DOM, no store, no I/O. */
(function () {
  "use strict";

  /* Rules, evaluated top to bottom; the first two that fire are shown, and "clean" shows only
     when none fire. "wpm" is metrics.words_per_minute; [lo, hi] is options.targetWpm, which
     defaults to [140, 160]. Every number is rounded exactly as the metric cards show it (wpm
     to a whole number, the rates and the pause to one decimal), so a tip never disagrees with
     the card above it.

       id            fires when
       pace-fast     wpm > hi + 15
       pace-slow     wpm < lo - 15
       fillers-high  total fillers / (duration / 60) > 6   (0 per minute when duration is 0)
       pause-long    longest length in metrics.pauses > 3 s
       repeats       metrics.repeats.length >= 3
       clean         nothing above fired

     T12 adds three more rules between "repeats" and "clean"; their thresholds are set there:
       likes         "like" is the filler that dominates the counts
       pause-none    a longer take with no pause at all
       pace-uneven   pace_windows swing far from the overall pace */

  const DEFAULT_TARGET_WPM = [140, 160];
  const MAX_TIPS = 2;
  const SECONDS_PER_MINUTE = 60;

  const PACE_MARGIN_WPM = 15;
  const MAX_FILLERS_PER_MINUTE = 6;
  const MAX_PAUSE_SECONDS = 3;
  const MIN_REPEATS = 3;

  const RULES = [
    {
      id: "pace-fast",
      text: "You are above target pace. Breathe at each period.",
      fires: (facts) => facts.wpm > facts.hi + PACE_MARGIN_WPM,
    },
    {
      id: "pace-slow",
      text: "You are under target pace. Shorten the pauses between ideas.",
      fires: (facts) => facts.wpm < facts.lo - PACE_MARGIN_WPM,
    },
    {
      id: "fillers-high",
      text: "Replace um with a silent beat. Judges hear silence as confidence.",
      fires: (facts) => facts.fillersPerMinute > MAX_FILLERS_PER_MINUTE,
    },
    {
      id: "pause-long",
      text: "One pause ran past 3 seconds. Glance at your next point before you stop talking.",
      fires: (facts) => facts.longestPause > MAX_PAUSE_SECONDS,
    },
    {
      id: "repeats",
      text: "You restarted phrases three times. Finish the sentence, then fix it.",
      fires: (facts) => facts.repeatCount >= MIN_REPEATS,
    },
  ];

  const CLEAN_TIP = { id: "clean", text: "Clean run. Push the pace a little next time." };

  function select(metrics, options) {
    const facts = readFacts(metrics || {}, options || {});
    const fired = RULES.filter((rule) => rule.fires(facts)).slice(0, MAX_TIPS);
    const chosen = fired.length > 0 ? fired : [CLEAN_TIP];
    return chosen.map((tip) => ({ id: tip.id, text: tip.text }));
  }

  // The numbers the rules compare, read once. Missing or malformed values read as 0 so a bad
  // record still yields a tip instead of an exception.
  function readFacts(metrics, options) {
    const [lo, hi] = targetRange(options.targetWpm);
    const fillers = isObject(metrics.fillers) ? metrics.fillers : {};
    const pauses = Array.isArray(metrics.pauses) ? metrics.pauses : [];
    const repeats = Array.isArray(metrics.repeats) ? metrics.repeats : [];

    const minutes = numberOr0(metrics.duration) / SECONDS_PER_MINUTE;
    const fillerCount = Object.values(fillers).reduce((sum, count) => sum + numberOr0(count), 0);
    const pauseLengths = pauses.map((pause) => numberOr0(Array.isArray(pause) ? pause[1] : 0));

    return {
      lo,
      hi,
      wpm: Math.round(numberOr0(metrics.words_per_minute)),
      fillersPerMinute: minutes > 0 ? roundToTenth(fillerCount / minutes) : 0,
      longestPause: pauseLengths.length > 0 ? roundToTenth(Math.max(...pauseLengths)) : 0,
      repeatCount: repeats.length,
    };
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

  function isObject(value) {
    return typeof value === "object" && value !== null;
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
