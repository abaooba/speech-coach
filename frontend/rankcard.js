/* rankcard.js: app.rankCard, the rank card "ladder and lens" on Progress and Results
   (docs/PLAN.md T37). model(takes, options) works out everything the card shows from the
   speaker's takes, reading the rank only through app.rank (rank.js, owner-written); it is pure:
   no clock, no DOM, no store. Only Talk takes are rated (owner decision 2026-10-22): a take read
   aloud (app.language.isReadTake) keeps the streak but never moves the rating. build(model,
   {screen}) draws that model node by node with app.ui.el. */
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

  // The icons: a 12px triangle or dash leads the change line, and a 16px flame the streak.
  const CHANGE_ICONS = { [UP]: "triangle-up", [DOWN]: "triangle-down", [SAME]: "dash" };
  const CHANGE_ICON_SIZE = 12;
  const FLAME_ICON = "flame";
  const FOOT_ICON_SIZE = 16;

  // Each card's hidden heading has an id of its own: Progress and Results both keep a card.
  const TITLE_ID_PREFIX = "rank-card-title-";

  // The words screen readers hear that the eye does not need (the tier spec, section 10). The
  // caption keeps its number and "to" together with a no-break space.
  // The rating's visible label, on its own line above the number; its trailing space keeps
  // "Rating 80.0" one phrase for screen readers.
  const RATING_LABEL = "Rating ";
  const HIDDEN = Object.freeze({
    title: "Your rank",
    tier: "Tier: ",
    outOf: " out of 100",
    points: " points",
    startsAt: ", which starts at ",
    from: ", from ",
    yourTier: ", your tier",
    withThisTake: " with this take",
    ladder: (count) => "All " + count + " tiers, top first",
  });
  const CHANGE_LEADS = { [UP]: "Rating ", [DOWN]: "Rating ", [SAME]: "Rating: " };
  const UNBROKEN_TO = "\u00a0to ";

  // What the projection and the gate call a take: a talk take once the speaker has a read one.
  const TAKE = "take";
  const TALK_TAKE = "Talk take";

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
    // `take` is "take", or "Talk take" once the speaker has a take read aloud, which neither
    // reaches a tier nor fills one of the gate's 10 slots.
    atLeast: (count, tier, take) =>
      "At least " + count + " more " + take + "s to " + tier + ", even perfect ones.",
    twoMinute: (score, tier, take) =>
      "One 2-minute " + take + " scoring " + score + " or more reaches " + tier + ".",
    threeMinute: (score, tier, take) =>
      "One 3-minute " + take + " scoring " + score + " or more reaches " + tier + ".",
    gateRule: "2 minutes or more, 97 or more, no long pause.",
    gateNeeds: (top) => " " + top + " needs all 10: ",
    gateKept: (take) => " Each new " + take + " must too: ",
    allPass: (take) => "All of your last 10 " + take + "s pass.",
    nonePass: (take) => "None of your last 10 " + take + "s pass.",
    onePasses: (take) => "1 of your last 10 " + take + "s passes.",
    somePass: (count, take) => count + " of your last 10 " + take + "s pass.",
    streak: (days, longest) => "Current streak " + days + ", longest " + longest,
    noStreak: (longest) => "No current streak, longest " + longest,
    day: " day",
    days: " days",
    // Why read takes leave the rating alone: on Progress once the speaker has one, and on
    // Results under a read take, with the rating as it stood or before there is one.
    talkOnly: "Only Talk takes count for your rating. Read takes count for your streak.",
    noRatingYet:
      "No rating yet: it starts with your first Talk take. Read takes count for your streak.",
    readTake: "Read takes don't change your rating. Only Talk takes count.",
    readBeforeRating: "Read takes don't change your rating. It starts with your first Talk take.",
  });

  // What the card shows, or null when there is no card: rank.js or results.js is not loaded,
  // the speaker has no take of their own, or on Results the take on screen is a sample or not in
  // `takes`. `takes` are the stored sessions in any order; samples never count, the same rule as
  // Progress. options.screen is "progress" or "results". Progress passes options.today, the
  // moment its streak counts to (a Date or an ISO time; the model never reads the clock). Results
  // passes options.takeId, and its card is computed from the takes up to and including that one,
  // so a reopened old take shows what it did then. Only talk takes are rated; until there is one
  // the card has no rating (unrated).
  function model(takes, options) {
    const settings = options || {};
    if (!rankLoaded()) {
      return null;
    }
    const own = ownTakes(takes);
    if (settings.screen === RESULTS) {
      return resultsCard(throughTake(own, settings.takeId));
    }
    return progressCard(own, settings.today);
  }

  // Progress: the newest 10 talk takes rated, the streak counted over every take. Once the
  // speaker has a read take the card says what the rating counts.
  function progressCard(own, today) {
    if (own.length === 0) {
      return null;
    }
    const talk = own.filter((take) => !isReadTake(take));
    const foot = { icon: FLAME_ICON, text: streakText(app.rank.streak(own, today)) };
    if (talk.length === 0) {
      return unrated(COPY.noRatingYet, foot);
    }
    const hasReads = talk.length < own.length;
    const history = talk.slice(-RATED_TAKES).map(historyEntry);
    const card = standingCard(history, standingOf(history), hasReads ? TALK_TAKE : TAKE);
    return { ...card, note: hasReads ? COPY.talkOnly : null, foot };
  }

  // Results, from the takes through the one on screen (its last). A talk take shows what it did
  // to the rating: the rating over the newest 10 talk takes through it, against the rating just
  // before it. A read take did nothing, so its card shows the rating as it stood, with no change
  // line, notch or projection.
  function resultsCard(through) {
    if (through.length === 0) {
      return null;
    }
    const talk = through.filter((take) => !isReadTake(take));
    const take = talk.length < through.length ? TALK_TAKE : TAKE;
    if (isReadTake(through[through.length - 1])) {
      if (talk.length === 0) {
        return unrated(null, { icon: null, text: COPY.readBeforeRating });
      }
      const history = talk.slice(-RATED_TAKES).map(historyEntry);
      const foot = { icon: null, text: COPY.readTake };
      return { ...standingCard(history, standingOf(history), take), note: null, foot };
    }
    const history = talk.slice(-(RATED_TAKES + 1)).map(historyEntry);
    const now = standingOf(history);
    const card = { ...standingCard(history, now, take), note: null };
    const before = history.length > 1 ? standingOf(history.slice(0, -1)) : null;
    card.change = changeOf(before, now);
    card.notch = notchOf(before, now, card.change);
    card.foot = { icon: null, text: takeSentence(history, now, take) };
    return card;
  }

  // The card for the standing `now` that a history of rated takes leaves the speaker in
  // (standingOf); the change, the notch, the note and the foot are each screen's own. `take` is
  // what the gate calls a take (TAKE or TALK_TAKE).
  function standingCard(history, now, take) {
    return {
      tier: now.name,
      rating: now.shown,
      floor: now.floor,
      ceiling: now.ceiling,
      fill: percentOf(now.rating, now.floor, now.ceiling),
      ladder: ladderOf(now),
      next: nextOf(now),
      change: null,
      notch: null,
      gate: gateOf(history, now, take),
      foot: null,
    };
  }

  // The card before any talk take: no rating, so no tier, bar, ladder or gate; build() draws only
  // the note and the foot.
  function unrated(note, foot) {
    return {
      tier: null,
      rating: null,
      floor: null,
      ceiling: null,
      fill: null,
      ladder: null,
      next: null,
      change: null,
      notch: null,
      gate: null,
      note,
      foot,
    };
  }

  // A take read aloud (app.language.isReadTake): a passage, a cold read, the benchmark read or a
  // pasted script it followed. Without language.js every take counts as talk, as before the rule.
  function isReadTake(take) {
    const language = app.language;
    return (
      Boolean(language) && typeof language.isReadTake === "function" && language.isReadTake(take)
    );
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
  function ownTakes(takes) {
    const isSample = app.screens.results.isSample;
    return (Array.isArray(takes) ? takes : [])
      .filter((take) => Boolean(take) && typeof take === "object" && !isSample(take))
      .map((take) => ({ take, at: new Date(take.createdAt).getTime() }))
      .filter((entry) => Number.isFinite(entry.at))
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.take);
  }

  // The speaker's takes up to and including the one with `takeId`, or none when that take is
  // not theirs: a sample, or a take the list does not hold.
  function throughTake(own, takeId) {
    const index = own.findIndex((take) => take.id === takeId);
    return index === -1 ? [] : own.slice(0, index + 1);
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
  function gateOf(history, now, take) {
    const tiers = app.rank.TIERS;
    if (now.index < tiers.length - 2) {
      return null;
    }
    const recent = history.slice(-RATED_TAKES).map(passesGate);
    const empty = Array.from({ length: RATED_TAKES - recent.length }, () => false);
    const passing = recent.filter(Boolean).length;
    const rule = now.top ? COPY.gateKept(take) : COPY.gateNeeds(tiers[tiers.length - 1].name);
    return {
      pills: empty.concat(recent),
      passing,
      text: passingText(passing, take) + rule + COPY.gateRule,
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
  function passingText(passing, take) {
    if (passing === RATED_TAKES) {
      return COPY.allPass(take);
    }
    if (passing === 0) {
      return COPY.nonePass(take);
    }
    return passing === 1 ? COPY.onePasses(take) : COPY.somePass(passing, take);
  }

  // Results' foot: "This take scored 72." and, below Master, what reaches the next tier.
  function takeSentence(history, now, take) {
    const scored = COPY.scored(Math.round(history[history.length - 1].score));
    const projection = projectionOf(history, now, take);
    return projection === null ? scored : scored + " " + projection;
  }

  // What it takes to reach the next tier. Master and Flawless get nothing: the top tier needs
  // the gate as well as the rating, so a number alone would mislead.
  function projectionOf(history, now, take) {
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
      return COPY.atLeast(count, next.name, take);
    }
    const twoMinute = lowestScore(history, next.min, TWO_MINUTES);
    if (twoMinute !== null) {
      return COPY.twoMinute(twoMinute, next.name, take);
    }
    const threeMinute = lowestScore(history, next.min, THREE_MINUTES);
    return threeMinute === null ? null : COPY.threeMinute(threeMinute, next.name, take);
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

  // The card for a model, in reading order: the hidden heading, the stats beside the ladder,
  // the gate for Master and Flawless, the note when there is one, then the foot. A card with no
  // rating yet has only the heading, the note and the foot. `screen` ("progress" or "results")
  // names the screen it sits on and keeps its heading's id unique. Nothing in it takes focus.
  function build(card, options) {
    const screen = options && options.screen === RESULTS ? RESULTS : PROGRESS;
    const titleId = TITLE_ID_PREFIX + screen;
    const heading = app.ui.el("h2", { class: "sr-only", id: titleId, text: HIDDEN.title });
    if (card.tier === null) {
      return app.ui.el(
        "section",
        { class: "rank-card rank-card--unrated", "aria-labelledby": titleId },
        [heading, buildNote(card.note), buildFoot(card.foot)],
      );
    }
    return app.ui.el("section", { class: "rank-card", "aria-labelledby": titleId }, [
      heading,
      app.ui.el("div", { class: "rank-card__body" }, [buildStats(card), buildLadder(card.ladder)]),
      buildGate(card.gate),
      buildNote(card.note),
      buildFoot(card.foot),
    ]);
  }

  // What the rating counts, in a muted line above the foot; a model without one draws none.
  function buildNote(note) {
    return note ? app.ui.el("p", { class: "rank-card__note", text: note }) : null;
  }

  // The stats column, top to bottom: tier, the change on Results, rating, bar,
  // the bar's two ends and the caption.
  function buildStats(card) {
    const el = app.ui.el;
    return el("div", { class: "rank-card__stats" }, [
      el("p", { class: "rank-card__tier" }, [hidden(HIDDEN.tier), card.tier]),
      buildChange(card.change),
      el("p", { class: "rank-card__rating" }, [
        el("span", { class: "rank-card__rating-label", text: RATING_LABEL }),
        card.rating.toFixed(1),
        hidden(HIDDEN.outOf),
      ]),
      buildBar(card),
      el("p", { class: "rank-card__ends", "aria-hidden": "true" }, [
        el("span", { text: String(card.floor) }),
        el("span", { text: String(card.ceiling) }),
      ]),
      buildCaption(card.next),
    ]);
  }

  // "Up 3.1, now Contender" after its triangle, read as "Rating up 3.1 with this take, now
  // Contender". The words share one span, so a long line wraps beside the icon.
  function buildChange(change) {
    if (change === null) {
      return null;
    }
    const className = "rank-card__change rank-card__change--" + change.direction;
    if (change.direction === FIRST) {
      return app.ui.el("p", { class: className }, [app.ui.el("span", { text: change.text })]);
    }
    return app.ui.el("p", { class: className }, [
      app.ui.icon(CHANGE_ICONS[change.direction], CHANGE_ICON_SIZE),
      app.ui.el("span", {}, [
        hidden(CHANGE_LEADS[change.direction]),
        change.words,
        hidden(HIDDEN.withThisTake),
        change.now === null ? null : COPY.now + change.now,
      ]),
    ]);
  }

  // The speaker's tier from floor to ceiling, filled to the rating, with the notch on Results
  // where the rating stood before this take.
  function buildBar(card) {
    const el = app.ui.el;
    const parts = [el("span", { class: "rank-card__fill", style: "width:" + card.fill + "%" })];
    if (card.notch !== null) {
      parts.push(el("span", { class: "rank-card__notch", style: "left:" + card.notch + "%" }));
    }
    return el("div", { class: "rank-card__bar", "aria-hidden": "true" }, parts);
  }

  // "18.8 to Varsity", read as "18.8 points to Varsity, which starts at 60"; "99 reached" and
  // "Top tier" have nothing to add.
  function buildCaption(next) {
    const el = app.ui.el;
    const parts =
      next.points === null
        ? [el("strong", { text: next.text })]
        : [
            el("strong", { text: next.points }),
            hidden(HIDDEN.points),
            UNBROKEN_TO + next.name,
            hidden(HIDDEN.startsAt + next.floor),
          ];
    return el("p", { class: "rank-card__next" }, parts);
  }

  // All seven tiers, best first, each "Flawless, from 99" to a screen reader; the speaker's row
  // adds ", your tier" and carries aria-current.
  function buildLadder(ladder) {
    return app.ui.el(
      "ol",
      { class: "rank-ladder", role: "list", "aria-label": HIDDEN.ladder(ladder.length) },
      ladder.map(buildLadderRow),
    );
  }

  function buildLadderRow(row) {
    const el = app.ui.el;
    const current = row.state === CURRENT;
    const classes = ["rank-ladder__tier", "rank-ladder__tier--" + row.state];
    if (row.top) {
      classes.push("rank-ladder__tier--top");
    }
    const attrs = { class: classes.join(" ") };
    if (current) {
      attrs["aria-current"] = "true";
    }
    return el("li", attrs, [
      el("span", { class: "rank-ladder__mark", "aria-hidden": "true" }),
      el("span", { class: "rank-ladder__name", text: row.name }),
      el("span", { class: "rank-ladder__floor" }, [
        hidden(HIDDEN.from),
        String(row.floor),
        current ? hidden(HIDDEN.yourTier) : null,
      ]),
    ]);
  }

  // Ten pills, oldest take first, filled for each take that passes, then the gate's sentence,
  // which says in words what the pills show.
  function buildGate(gate) {
    if (gate === null) {
      return null;
    }
    const pills = gate.pills.map((passes) =>
      app.ui.el("span", {
        class: passes ? "rank-card__pill rank-card__pill--pass" : "rank-card__pill",
      }),
    );
    return app.ui.el("div", { class: "rank-card__gate" }, [
      app.ui.el("div", { class: "rank-card__pills", "aria-hidden": "true" }, pills),
      app.ui.el("p", { class: "rank-card__gate-text", text: gate.text }),
    ]);
  }

  // The streak after its flame on Progress; this take's sentences on Results.
  function buildFoot(foot) {
    const icon = foot.icon === null ? null : app.ui.icon(foot.icon, FOOT_ICON_SIZE);
    return app.ui.el("p", { class: "rank-card__foot" }, [
      icon,
      app.ui.el("span", { text: foot.text }),
    ]);
  }

  function hidden(text) {
    return app.ui.el("span", { class: "sr-only", text });
  }

  app.rankCard = { model, build };
})();
