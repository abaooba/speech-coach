/* rank.js: app.rank, the skill rank. takeScore(report, targetWpm) turns one take's
   app.delivery report into a 0-100 score; rating(history) averages the newest takes into one
   number; tier(rating, history) names it; streak(history, today) counts days practiced in a row.
   A history is a list of takes in any order, each {createdAt, score, speakingSeconds,
   longPauseCount}. Pure: no DOM, no store, no I/O. */
(function () {
  "use strict";

  // The target pace band every screen falls back to when a passage has none of its own.
  const DEFAULT_TARGET_WPM = [140, 160];

  // Error weights: how much each slip costs, in fillers.
  const FILLER_WEIGHT = 1;
  // A restart repeats words the judge already heard, so it costs more than an um.
  const RESTART_WEIGHT = 1.5;
  // Each pause is charged once. A mid-sentence pause under 5 s stalls the line like an um.
  const MID_SENTENCE_PAUSE_WEIGHT = 1;
  // A 5 s+ freeze reads as a lost place: the costliest slip, the same mid-sentence or after a
  // period, and never added to the mid-sentence weight.
  const LONG_PAUSE_WEIGHT = 3;
  // A misread word is an error; a skipped word is half one, since the listener rarely notices.
  const MISREAD_WEIGHT = 1;
  const SKIP_WEIGHT = 0.5;
  // More script words than this skipped in one place is script the take never reached (it
  // stopped early or started partway in), not a slip, so that run costs nothing. The same line
  // as path.js MAX_SKIPPED_IN_ONE_PLACE, kept here so rank.js loads on its own.
  const MAX_SKIPPED_IN_ONE_PLACE = 8;
  // A skip's `at` is a word time in seconds; two closer than this are the same place.
  const MILLISECOND = 0.001;

  // score = 100 * exp(-DECAY * errors per minute): 1 a minute gives 86, 0.1 a minute 98.5.
  const DECAY_PER_ERROR_PER_MINUTE = 0.15;
  // One point off for every 5 wpm outside the target band.
  const WPM_PER_PACE_POINT = 5;
  const MAX_SCORE = 100;

  // The rating averages the newest takes, each weighted by its minutes.
  const RATED_TAKES = 10;
  // A long take counts no more than 3 minutes, so one marathon cannot carry the rating.
  const MAX_TAKE_WEIGHT_MINUTES = 3;
  // A take under 30 s counts a quarter, so quick tries barely move the rating.
  const SHORT_TAKE_SECONDS = 30;
  const SHORT_TAKE_DISCOUNT = 0.25;
  // A new speaker starts at 40: up to 3 imaginary 40-point, 1-minute takes fill the empty slots
  // of the 10, so one lucky take cannot jump tiers, and they fade out as real takes arrive. They
  // also make up whatever minutes the rated takes fall short of 3, whichever is more, so ten
  // quick tries cannot push them out.
  const PRIOR_SCORE = 40;
  const PRIOR_TAKES = 3;
  const PRIOR_TAKE_MINUTES = 1;

  // Tiers, lowest first. Flawless also needs every one of the last 10 takes to pass the bar
  // below, so a rating of 99 alone is Master.
  const TIERS = [
    { name: "Novice", min: 0 },
    { name: "Contender", min: 40 },
    { name: "Varsity", min: 60 },
    { name: "Elite", min: 75 },
    { name: "Champion", min: 88 },
    { name: "Master", min: 96 },
    { name: "Flawless", min: 99 },
  ];
  const FLAWLESS_MIN_SECONDS = 120;
  const FLAWLESS_MIN_SCORE = 97;

  const SECONDS_PER_MINUTE = 60;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function takeScore(report, targetWpm) {
    const given = report && typeof report === "object" ? report : {};
    const minutes = numberOr0(given.speakingSeconds) / SECONDS_PER_MINUTE;
    if (minutes <= 0) {
      return 0;
    }
    const weighted =
      numberOr0(given.fillerCount) * FILLER_WEIGHT +
      numberOr0(given.repeatCount) * RESTART_WEIGHT +
      shortMidSentencePauseCount(given) * MID_SENTENCE_PAUSE_WEIGHT +
      numberOr0(given.longPauseCount) * LONG_PAUSE_WEIGHT +
      countOf(given.misreads) * MISREAD_WEIGHT +
      chargedSkipCount(given.skips) * SKIP_WEIGHT;
    const errorScore = MAX_SCORE * Math.exp((-DECAY_PER_ERROR_PER_MINUTE * weighted) / minutes);
    const pacePenalty = wpmOutsideBand(numberOr0(given.wordsPerMinute), targetWpm);
    return clamp(errorScore - pacePenalty / WPM_PER_PACE_POINT, 0, MAX_SCORE);
  }

  function rating(history) {
    const rated = newestTakes(history);
    const ratedWeights = rated.map((entry) => weightOf(entry.speakingSeconds));
    const ratedMinutes = ratedWeights.reduce((sum, takeWeight) => sum + takeWeight, 0);
    const priorWeight = priorMinutes(rated.length, ratedMinutes);
    let total = PRIOR_SCORE * priorWeight;
    rated.forEach((entry, i) => {
      total += clamp(numberOr0(entry.score), 0, MAX_SCORE) * ratedWeights[i];
    });
    const weight = priorWeight + ratedMinutes;
    return weight > 0 ? total / weight : PRIOR_SCORE;
  }

  // The minutes the imaginary takes weigh: one per empty slot of the 10, up to 3, or the minutes
  // the rated takes fall short of 3, whichever is more.
  function priorMinutes(ratedCount, ratedMinutes) {
    const emptySlots = Math.min(PRIOR_TAKES, RATED_TAKES - ratedCount);
    const missingMinutes = PRIOR_TAKES * PRIOR_TAKE_MINUTES - ratedMinutes;
    return Math.max(PRIOR_TAKE_MINUTES * emptySlots, missingMinutes);
  }

  function tier(value, history) {
    const flawless = TIERS[TIERS.length - 1];
    if (value >= flawless.min && everyRecentTakeFlawless(history)) {
      return flawless.name;
    }
    let name = TIERS[0].name;
    TIERS.slice(0, -1).forEach((each) => {
      if (value >= each.min) {
        name = each.name;
      }
    });
    return name;
  }

  // {current, longest} runs of consecutive local days with a take. The current run is still
  // alive when the last take was yesterday: today is not over yet.
  function streak(history, today) {
    const days = Array.from(new Set(datedTakes(history).map((entry) => dayNumber(entry.at))));
    days.sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    days.forEach((day, i) => {
      run = i > 0 && day - days[i - 1] === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    });
    const last = days.length > 0 ? days[days.length - 1] : null;
    const alive = last !== null && dayNumber(new Date(today)) - last <= 1;
    return { current: alive ? run : 0, longest };
  }

  // The last 10 takes must each be 2 min+, score 97+ and have no long pause.
  function everyRecentTakeFlawless(history) {
    const rated = newestTakes(history);
    return (
      rated.length === RATED_TAKES &&
      rated.every(
        (entry) =>
          numberOr0(entry.speakingSeconds) >= FLAWLESS_MIN_SECONDS &&
          numberOr0(entry.score) >= FLAWLESS_MIN_SCORE &&
          numberOr0(entry.longPauseCount) === 0,
      )
    );
  }

  // A take's minutes, capped at 3, and a quarter of that under 30 s.
  function weightOf(speakingSeconds) {
    const seconds = numberOr0(speakingSeconds);
    const minutes = Math.min(seconds / SECONDS_PER_MINUTE, MAX_TAKE_WEIGHT_MINUTES);
    return seconds < SHORT_TAKE_SECONDS ? minutes * SHORT_TAKE_DISCOUNT : minutes;
  }

  // The newest 10 takes with a readable createdAt, oldest first.
  function newestTakes(history) {
    return datedTakes(history)
      .sort((a, b) => a.at - b.at)
      .slice(-RATED_TAKES);
  }

  // Each take with a valid date, as {at: Date, ...take}; junk entries are dropped.
  function datedTakes(history) {
    const list = Array.isArray(history) ? history : [];
    return list
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({ ...entry, at: new Date(entry.createdAt) }))
      .filter((entry) => !Number.isNaN(entry.at.getTime()));
  }

  // Days since the epoch on the local calendar, so 23:50 and 00:10 are different days.
  function dayNumber(date) {
    const localMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round(localMidnight / MS_PER_DAY);
  }

  // How far wpm is outside [lo, hi], or 0 inside it.
  function wpmOutsideBand(wpm, targetWpm) {
    const [lo, hi] = targetRange(targetWpm);
    if (wpm < lo) {
      return lo - wpm;
    }
    return wpm > hi ? wpm - hi : 0;
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

  // The mid-sentence pauses that are not long, so a long one is charged once, as long. The
  // report's `pauses` lists each as {at, length, midSentence, long}; a report without that list
  // falls back to midSentencePauseCount.
  function shortMidSentencePauseCount(report) {
    if (!Array.isArray(report.pauses)) {
      return numberOr0(report.midSentencePauseCount);
    }
    return report.pauses.filter(
      (pause) => Boolean(pause) && pause.midSentence === true && pause.long !== true,
    ).length;
  }

  // The skips a take is charged for: every skip outside a run of more than
  // MAX_SKIPPED_IN_ONE_PLACE. Skips come in script order, and the words skipped in one place
  // share their `at`, the end of the word said before them (path.js longestSkipRun); a skip
  // without a numeric `at` is a place of its own.
  function chargedSkipCount(skips) {
    const runs = [];
    let at = null;
    (Array.isArray(skips) ? skips : []).forEach((skip) => {
      const here = skip && Number.isFinite(skip.at) ? skip.at : null;
      const samePlace = here !== null && at !== null && Math.abs(here - at) < MILLISECOND;
      if (samePlace) {
        runs[runs.length - 1] += 1;
      } else {
        runs.push(1);
      }
      at = here;
    });
    return runs
      .filter((run) => run <= MAX_SKIPPED_IN_ONE_PLACE)
      .reduce((sum, run) => sum + run, 0);
  }

  function countOf(list) {
    return Array.isArray(list) ? list.length : 0;
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  app.rank = {
    DEFAULT_TARGET_WPM: DEFAULT_TARGET_WPM.slice(),
    TIERS: TIERS.map((each) => ({ ...each })),
    takeScore,
    rating,
    tier,
    streak,
  };
})();
