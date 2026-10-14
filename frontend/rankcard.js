/* rankcard.js: app.rankCard, the rank card "ladder and lens" on Progress and Results
   (docs/PLAN.md T37). model(takes, options) works out everything the card shows from the
   speaker's takes, reading the rank only through app.rank (rank.js, owner-written). It is pure:
   no clock, no DOM, no store. */
(function () {
  "use strict";

  // The two screens the card is drawn on. Progress shows the streak; Results shows what the take
  // on screen did to the rating.
  const PROGRESS = "progress";
  const RESULTS = "results";

  // rank.js rates the newest 10 takes (its RATED_TAKES). Results also rates the speaker as they
  // stood before the take on screen, which needs the take before those 10.
  const RATED_TAKES = 10;

  // The ceiling of the top tier's bar: the top of the rating scale.
  const TOP_RATING = 100;

  // The top tier also asks every one of the last 10 takes to pass this bar, as rank.js
  // everyRecentTakeFlawless does: 2 minutes or more, a score of 97 or more, no long pause.
  const GATE_MIN_SECONDS = 120;
  const GATE_MIN_SCORE = 97;

  // The projection on Results. It first finds the fewest perfect 3-minute takes that reach the
  // next tier, trying 1 to 10; ten of them rate 100, so one count always does. When one take is
  // enough, it finds the lowest whole score one 2-minute take needs, else one 3-minute take.
  // Projected takes come a minute apart after the newest take, so rank.js rates them newest.
  const PERFECT_SCORE = 100;
  const MAX_PROJECTED_TAKES = 10;
  const TWO_MINUTES = 120;
  const THREE_MINUTES = 180;
  const MS_PER_MINUTE = 60 * 1000;

  // The rating shows one decimal; the bar's fill and notch are percentages with two.
  const TENTHS = 10;
  const HUNDREDTHS = 100;

  // Ladder rows, best tier first: every tier below the speaker's is passed, theirs is current
  // and every tier above it is ahead.
  const PASSED = "passed";
  const CURRENT = "current";
  const AHEAD = "ahead";

  // Which way the take on screen moved the rating. A first rated take has nothing to compare
  // with, so its line is words alone.
  const UP = "up";
  const DOWN = "down";
  const SAME = "same";
  const FIRST = "first";

  // The streak's icon on Progress.
  const FLAME_ICON = "flame";

  // Fixed copy (the tier spec, section 9).
  const COPY = Object.freeze({
    to: " to ",
    reached: " reached",
    topTier: "Top tier",
    up: "Up ",
    down: "Down ",
    noChange: "No change",
    firstTake: "First rated take",
    now: ", now ",
    scored: (score) => "This take scored " + score + ".",
    atLeast: (count, tier) =>
      "At least " + count + " more takes to " + tier + ", even perfect ones.",
    twoMinute: (score, tier) =>
      "One 2-minute take scoring " + score + " or more reaches " + tier + ".",
    threeMinute: (score, tier) =>
      "One 3-minute take scoring " + score + " or more reaches " + tier + ".",
    gateRule: "2 minutes or more, 97 or more, no long pause.",
    gateNeeds: (top) => " " + top + " needs all " + RATED_TAKES + ": ",
    gateKept: " Each new take must too: ",
    allPass: "All of your last 10 takes pass.",
    nonePass: "None of your last 10 takes pass.",
    onePasses: "1 of your last 10 takes passes.",
    somePass: (count) => count + " of your last 10 takes pass.",
    streak: (days, longest) => "Current streak " + days + ", longest " + longest,
    noStreak: (longest) => "No current streak, longest " + longest,
    day: " day",
    days: " days",
  });

  // What the card shows, or null when there is no card: rank.js or results.js is not loaded,
  // no take is rated, or on Results the take on screen is a sample or not in `takes`.
  // `takes` are the stored sessions in any order; samples never count, the same rule as Progress.
  // options.screen is "progress" or "results". Progress passes options.today, the moment its
  // streak counts to (a Date or an ISO time; the model never reads the clock). Results passes
  // options.takeId, and its card is computed from the takes up to and including that one, so a
  // reopened old take shows what it did then.
  function model(takes, options) {
    const settings = options || {};
    if (!rankLoaded()) {
      return null;
    }
    const rated = ratedTakes(takes);
    const onResults = settings.screen === RESULTS;
    const counted = onResults ? throughTake(rated, settings.takeId) : rated;
    if (counted.length === 0) {
      return null;
    }
    const kept = onResults ? RATED_TAKES + 1 : RATED_TAKES;
    const history = counted.slice(-kept).map(historyEntry);
    const now = standingOf(history);
    const card = {
      tier: now.name,
      rating: now.shown,
      floor: now.floor,
      ceiling: now.ceiling,
      fill: percentOf(now.rating, now.floor, now.ceiling),
      slices: slicesOf(now),
      ladder: ladderOf(now),
      next: nextOf(now),
      change: null,
      notch: null,
      gate: gateOf(history, now),
      foot: null,
    };
    if (onResults) {
      const before = history.length > 1 ? standingOf(history.slice(0, -1)) : null;
      card.change = changeOf(before, now);
      card.notch = notchOf(before, now, card.change);
      card.foot = { icon: null, text: takeSentence(history, now) };
    } else {
      card.foot = { icon: FLAME_ICON, text: streakText(app.rank.streak(rated, settings.today)) };
    }
    return card;
  }

  // The card reads rank.js and results.js's summarize and isSample; without them there is none.
  function rankLoaded() {
    const rank = app.rank;
    const results = app.screens ? app.screens.results : null;
    return (
      Boolean(rank) &&
      typeof rank.takeScore === "function" &&
      typeof rank.rating === "function" &&
      typeof rank.tier === "function" &&
      typeof rank.streak === "function" &&
      Array.isArray(rank.TIERS) &&
      Boolean(results) &&
      typeof results.summarize === "function" &&
      typeof results.isSample === "function"
    );
  }

  // The speaker's own takes that rank.js can date, oldest first: a sample never counts, and
  // neither does a take whose createdAt is not a date, which rank.js leaves out too.
  function ratedTakes(takes) {
    const isSample = app.screens.results.isSample;
    return (Array.isArray(takes) ? takes : [])
      .filter((take) => Boolean(take) && typeof take === "object" && !isSample(take))
      .map((take) => ({ take, at: new Date(take.createdAt).getTime() }))
      .filter((entry) => Number.isFinite(entry.at))
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.take);
  }

  // The rated takes up to and including the one with `takeId`, or none when that take is not
  // rated: a sample, or a take the list does not hold.
  function throughTake(rated, takeId) {
    const index = rated.findIndex((take) => take.id === takeId);
    return index === -1 ? [] : rated.slice(0, index + 1);
  }

  // One take as rank.js reads it, scored as results.js tierFor scores it: summarize re-scores
  // the take from its words with today's rules, against its own pace band.
  function historyEntry(take) {
    const summary = app.screens.results.summarize(take);
    return {
      createdAt: take.createdAt,
      score: app.rank.takeScore(summary.report, summary.target),
      speakingSeconds: summary.report.speakingSeconds,
      longPauseCount: summary.report.longPauseCount,
    };
  }

  // Where a history leaves the speaker: rank.js's rating and tier, the tier's place in TIERS
  // (lowest first), its floor, its ceiling (the next tier's floor, or 100 for the top tier) and
  // the rating as the card shows it.
  function standingOf(history) {
    const tiers = app.rank.TIERS;
    const rating = app.rank.rating(history);
    const name = app.rank.tier(rating, history);
    const index = Math.max(0, tiers.findIndex((tier) => tier.name === name));
    const top = index === tiers.length - 1;
    const ceiling = top ? TOP_RATING : tiers[index + 1].min;
    return {
      rating,
      name,
      index,
      top,
      floor: tiers[index].min,
      ceiling,
      shown: shownRating(rating, ceiling, top),
    };
  }

  // The rating to one decimal, but never rounded up onto the next tier's floor while the tier is
  // below it: 39.96 shows 39.9 beside Novice, not 40.0, so "0.1 to Contender" adds up. A Master
  // whose rating has passed 99 without the gate shows the rating as it is.
  function shownRating(rating, ceiling, top) {
    const rounded = roundTo(rating, TENTHS);
    if (!top && rating < ceiling && rounded >= ceiling) {
      return roundTo(ceiling - 1 / TENTHS, TENTHS);
    }
    return rounded;
  }

  // Each tier's slice of the 0 to 100 ruler, lowest first, with the speaker's marked current.
  function slicesOf(now) {
    const tiers = app.rank.TIERS;
    return tiers.map((tier, index) => ({
      floor: tier.min,
      ceiling: index === tiers.length - 1 ? TOP_RATING : tiers[index + 1].min,
      current: index === now.index,
    }));
  }

  // The ladder's rows, best tier first; the top tier's row draws a diamond.
  function ladderOf(now) {
    const tiers = app.rank.TIERS;
    const rows = tiers.map((tier, index) => {
      let state = AHEAD;
      if (index < now.index) {
        state = PASSED;
      } else if (index === now.index) {
        state = CURRENT;
      }
      return { name: tier.name, floor: tier.min, state, top: index === tiers.length - 1 };
    });
    return rows.reverse();
  }

  // The caption under the bar: "18.8 to Varsity", the points from the rating as shown to the
  // next tier's floor, so the two numbers always add up. A Master whose rating has reached 99
  // while the gate is not met reads "99 reached", and the top tier reads "Top tier". `points`,
  // `name` and `floor` are null for those two, which have no hidden words to add.
  function nextOf(now) {
    if (now.top || now.rating >= now.ceiling) {
      const text = now.top ? COPY.topTier : now.ceiling + COPY.reached;
      return { text, points: null, name: null, floor: null };
    }
    const next = app.rank.TIERS[now.index + 1];
    const points = (now.ceiling - now.shown).toFixed(1);
    return { text: points + COPY.to + next.name, points, name: next.name, floor: next.min };
  }

  // Results only: the change this take made to the rating as shown, "Up 3.1", "Down 1.2" or
  // "No change" (under 0.1), with ", now Contender" when the tier changed with it.
  function changeOf(before, now) {
    if (before === null) {
      return { direction: FIRST, words: COPY.firstTake, now: null, text: COPY.firstTake };
    }
    const difference = roundTo(now.shown - before.shown, TENTHS);
    let direction = SAME;
    let words = COPY.noChange;
    if (difference > 0) {
      direction = UP;
      words = COPY.up + difference.toFixed(1);
    } else if (difference < 0) {
      direction = DOWN;
      words = COPY.down + (-difference).toFixed(1);
    }
    const tier = now.name === before.name ? null : now.name;
    return { direction, words, now: tier, text: tier === null ? words : words + COPY.now + tier };
  }

  // Results only: where the rating stood before this take, as a place along the bar. It is
  // drawn only when that rating was in the same tier and the change line shows a move.
  function notchOf(before, now, change) {
    if (before === null || before.name !== now.name || change.direction === SAME) {
      return null;
    }
    return percentOf(before.rating, now.floor, now.ceiling);
  }

  // The top tier's gate, shown to a Master and to the top tier: one pill per slot of the last
  // 10 takes, oldest first, true when that take passes. With fewer than 10 takes the oldest
  // slots have no take, and they stay empty.
  function gateOf(history, now) {
    const tiers = app.rank.TIERS;
    if (now.index < tiers.length - 2) {
      return null;
    }
    const recent = history.slice(-RATED_TAKES).map(passesGate);
    const empty = Array.from({ length: RATED_TAKES - recent.length }, () => false);
    const passing = recent.filter(Boolean).length;
    const rule = now.top ? COPY.gateKept : COPY.gateNeeds(tiers[tiers.length - 1].name);
    return {
      pills: empty.concat(recent),
      passing,
      text: passingText(passing) + rule + COPY.gateRule,
    };
  }

  function passesGate(entry) {
    return (
      numberOr0(entry.speakingSeconds) >= GATE_MIN_SECONDS &&
      numberOr0(entry.score) >= GATE_MIN_SCORE &&
      numberOr0(entry.longPauseCount) === 0
    );
  }

  // "4 of your last 10 takes pass.", in words for none, one and all.
  function passingText(passing) {
    if (passing === RATED_TAKES) {
      return COPY.allPass;
    }
    if (passing === 0) {
      return COPY.nonePass;
    }
    return passing === 1 ? COPY.onePasses : COPY.somePass(passing);
  }

  // Results' foot: "This take scored 72." and, below Master, what reaches the next tier.
  function takeSentence(history, now) {
    const scored = COPY.scored(Math.round(history[history.length - 1].score));
    const projection = projectionOf(history, now);
    return projection === null ? scored : scored + " " + projection;
  }

  // What it takes to reach the next tier. Master and Flawless get nothing: the top tier needs
  // the gate as well as the rating, so a number alone would mislead.
  function projectionOf(history, now) {
    const tiers = app.rank.TIERS;
    if (now.index >= tiers.length - 2) {
      return null;
    }
    const next = tiers[now.index + 1];
    const count = fewestPerfectTakes(history, next.min);
    if (count === null) {
      return null;
    }
    if (count > 1) {
      return COPY.atLeast(count, next.name);
    }
    const twoMinute = lowestScore(history, next.min, TWO_MINUTES);
    if (twoMinute !== null) {
      return COPY.twoMinute(twoMinute, next.name);
    }
    const threeMinute = lowestScore(history, next.min, THREE_MINUTES);
    return threeMinute === null ? null : COPY.threeMinute(threeMinute, next.name);
  }

  // The fewest perfect 3-minute takes that lift the rating to `floor`, or null past 10.
  function fewestPerfectTakes(history, floor) {
    for (let count = 1; count <= MAX_PROJECTED_TAKES; count += 1) {
      const projected = withAddedTakes(history, count, PERFECT_SCORE, THREE_MINUTES);
      if (app.rank.rating(projected) >= floor) {
        return count;
      }
    }
    return null;
  }

  // The lowest whole score one take of `seconds` needs to lift the rating to `floor`, or null
  // when even 100 falls short.
  function lowestScore(history, floor, seconds) {
    for (let score = 0; score <= PERFECT_SCORE; score += 1) {
      if (app.rank.rating(withAddedTakes(history, 1, score, seconds)) >= floor) {
        return score;
      }
    }
    return null;
  }

  // The history plus `count` takes after its newest one, a minute apart, each scoring `score`
  // over `seconds` with no long pause.
  function withAddedTakes(history, count, score, seconds) {
    const newest = Math.max(...history.map((entry) => new Date(entry.createdAt).getTime()));
    const added = Array.from({ length: count }, (_, index) => ({
      createdAt: new Date(newest + (index + 1) * MS_PER_MINUTE).toISOString(),
      score,
      speakingSeconds: seconds,
      longPauseCount: 0,
    }));
    return history.concat(added);
  }

  // Progress's foot: "Current streak 3 days, longest 5", or "No current streak, longest 5 days".
  function streakText(streak) {
    if (streak.current > 0) {
      return COPY.streak(dayCount(streak.current), streak.longest);
    }
    return COPY.noStreak(dayCount(streak.longest));
  }

  function dayCount(days) {
    return days + (days === 1 ? COPY.day : COPY.days);
  }

  // Where `value` sits along a bar from `floor` to `ceiling`, as a percentage from 0 to 100.
  function percentOf(value, floor, ceiling) {
    const share = ((value - floor) / (ceiling - floor)) * 100;
    return roundTo(Math.min(100, Math.max(0, share)), HUNDREDTHS);
  }

  // `value` rounded to a whole number of 1 / `steps`: steps 10 keeps one decimal.
  function roundTo(value, steps) {
    return Math.round(value * steps) / steps;
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  app.rankCard = { model };
})();
