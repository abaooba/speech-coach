/* screens/results.js: app.screens.results, the Results screen after a take (DESIGN.md sections
   1, 6 and 8). Pure helpers do the thinking without the DOM: summarize, headlineFor,
   compareWithPrevious and buildTranscriptPlan. show({id}) loads the take and the one before it
   from app.store and draws the meta line, headline, cards, transcript, tips and actions. */
(function () {
  "use strict";

  // Used when the session's passage is no longer in app.passages.
  const DEFAULT_TARGET_WPM = [140, 160];

  // Card labels and units (DESIGN.md sections 5 and 6), in display order. Labels stay short so
  // two cards fit side by side at 320px; the units are small text after the number.
  const WPM_LABEL = "Pace";
  const WPM_UNIT = "wpm";
  const FILLERS_LABEL = "Fillers";
  const FILLERS_UNIT = "/min";
  const PAUSES_LABEL = "Mid-sentence pauses";
  const CLEAN_STRETCH_LABEL = "Clean stretch";
  const CLEAN_STRETCH_UNIT = "s";

  // Pace hint copy: always words, never a bare number (DESIGN.md section 9).
  const TARGET_PREFIX = "Target ";
  const TARGET_JOINER = " to ";
  const SLOW_DOWN = "Slow down";
  const SPEED_UP = "Speed up";
  const TONE_OK = "ok";
  const TONE_WARN = "warn";

  // Filler hint (Zoom and tl;dv put 0.6 to 3 fillers a minute in range) and the time line.
  const MAX_FILLERS_PER_MINUTE = 3;
  const FILLERS_OK = "Target under 3";
  const FILLERS_HIGH = "Aim for under 3";
  const TIME_USED_JOINER = " of ";

  // A hint never relies on color alone: green hints carry a check, rust ones the alert
  // triangle (DESIGN.md sections 4 and 9).
  const HINT_ICONS = { [TONE_OK]: "check", [TONE_WARN]: "alert" };
  const HINT_ICON_SIZE = 16;

  // The headline's thresholds beyond the cards' own: a fillers drop counts from half a filler a
  // minute, and a clean stretch under 15 seconds has room to grow (DebateDrills gives beginners
  // 15 clean seconds; see how.html).
  const MIN_FILLER_DROP = 0.5;
  const CLEAN_STRETCH_GOAL_SECONDS = 15;

  // Headline copy (DESIGN.md section 8): one strength and one focus, each under 15 words.
  const HEADLINE = Object.freeze({
    fillersDown: (from, to) => "Fillers are down from " + from + " to " + to + " a minute.",
    paceInside: (band) => "Your pace is inside the " + band + " target.",
    fillersUnder: "Your fillers are under 3 a minute.",
    noBreaks: "No pause breaks a sentence.",
    cleanStretch: (seconds) => "Your longest clean stretch is " + seconds + ".",
    onChart: "This take is on your progress chart.",
    cutFillers: "Next take, cut fillers under 3 a minute.",
    slowDown: (band) => "Next take, slow toward " + band + " wpm.",
    speedUp: (band) => "Next take, lift your pace toward " + band + " wpm.",
    movePauses: "Next take, save pauses for the ends of sentences.",
    stretchClean: (seconds) => "Next take, stretch your clean run past " + seconds + ".",
    holdDelivery: "Next take, hold this delivery on a longer topic.",
  });
  const STRENGTH_ICON = "check";
  const FOCUS_ICON = "arrow-right";
  const HEADLINE_ICON_SIZE = 16;

  // "vs last take" lines, one per card in card order: the summary key, the card's precision
  // (decimal places) and the words for a rise or a fall. The clean stretch compares only
  // between two takes with words; without words a take has no clean stretch to measure.
  const DELTAS = [
    { key: "wpm", digits: 0, unit: "", up: "faster", down: "slower" },
    { key: "fillersPerMinute", digits: 1, unit: "", up: "more", down: "fewer" },
    { key: "pauseCount", digits: 0, unit: "", up: "more", down: "fewer" },
    {
      key: "cleanStretchSeconds",
      digits: 1,
      unit: " s",
      up: "longer",
      down: "shorter",
      needsWords: true,
    },
  ];
  const UP = "up";
  const DOWN = "down";
  const SAME = "same";
  const NO_CHANGE = "No change";
  // Hidden endings that finish each line as a sentence for screen readers.
  const THAN_LAST_TAKE = " than your last take";
  const FROM_LAST_TAKE = " from your last take";
  const DELTA_ICONS = { [UP]: "triangle-up", [DOWN]: "triangle-down", [SAME]: "dash" };
  const DELTA_ICON_SIZE = 12;
  const DELTA_NOTE = "Arrows compare with your last take.";

  // Fixed copy for the bad-id state and the two actions (DESIGN.md sections 1 and 8).
  const NOT_FOUND_TITLE = "Session not found";
  const NOT_FOUND_BODY = "It may have been deleted.";
  const NOT_FOUND_ICON = "search";
  const RECORD_AGAIN_LABEL = "Record again";
  const HISTORY_LABEL = "History";
  const META_SEPARATOR = " · ";

  // Section titles between the metric grid and the actions.
  const TRANSCRIPT_TITLE = "Transcript";
  const TIPS_TITLE = "Tips";

  // Punctuation at either end of a token, the same rule as backend.metrics.clean: "Um," and
  // "um" compare equal while "so-called" and "day's" stay whole words.
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;

  // Transcript plan item types and the strings the tokens and pause markers are built from.
  const WORD_ITEM = "word";
  const PAUSE_ITEM = "pause";
  const TOKEN_SEPARATOR = " ";
  const FILLER_LABEL_SUFFIX = ", filler word";
  const HABIT_LABEL_SUFFIX = ", verbal habit";
  const LEGEND_TEXT = "Highlighted words are ums and uhs. Underlined words are verbal habits.";
  const HOW_HREF = "how.html";
  const HOW_LINK_TEXT = "How we count";
  const PAUSE_TEXT_SUFFIX = " s pause";
  const PAUSE_LABEL_PREFIX = "pause, ";
  const PAUSE_LABEL_SUFFIX = " seconds";

  // The screen's .screen__body; show() rebuilds everything inside it.
  let body = null;

  // Counts show() calls so a slow load from an earlier visit cannot paint over a newer one.
  let showCount = 0;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  // The numbers on the four cards, their hints and the time line, from one stored session,
  // plus the app.delivery report the transcript and tips are drawn from. Pure: reads the session
  // and app.passages, returns a fresh object. A take saved without words falls back to the
  // backend tallies inside app.delivery, so a bad or old record never breaks the screen.
  function summarize(session) {
    const report = app.delivery.analyze(session.transcript, session.metrics);
    const wpm = Math.round(report.wordsPerMinute);
    const target = targetFor(session.passageId);
    return {
      wpm,
      fillersPerMinute: report.fillersPerMinute,
      pauseCount: report.midSentencePauseCount,
      longestPause: report.longestMidSentencePause,
      cleanStretchSeconds: report.cleanStretch ? report.cleanStretch.seconds : 0,
      topHabit: report.topHabit,
      target,
      paceHint: paceHintFor(wpm, target),
      fillersHint: fillersHintFor(report.fillersPerMinute),
      timeUsed: timeUsedFor(session.passageId, report.speakingSeconds),
      report,
    };
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  // A copy of the passage's [lo, hi] target, or the default when the passage is unknown.
  function targetFor(passageId) {
    const passages = app.passages || [];
    const passage = passages.find((entry) => entry.id === passageId);
    const known = passage && Array.isArray(passage.targetWpm);
    const range = known ? passage.targetWpm : DEFAULT_TARGET_WPM;
    return [range[0], range[1]];
  }

  function fillersHintFor(fillersPerMinute) {
    return fillersPerMinute > MAX_FILLERS_PER_MINUTE
      ? { text: FILLERS_HIGH, tone: TONE_WARN }
      : { text: FILLERS_OK, tone: TONE_OK };
  }

  // "2:41 of 3:00" for a preset with a time limit, else null.
  function timeUsedFor(passageId, speakingSeconds) {
    const passages = app.passages || [];
    const passage = passages.find((entry) => entry.id === passageId);
    if (!passage || !Number.isFinite(passage.timeLimitSeconds)) {
      return null;
    }
    const used = app.ui.formatClock(speakingSeconds);
    return used + TIME_USED_JOINER + app.ui.formatClock(passage.timeLimitSeconds);
  }

  function paceHintFor(wpm, target) {
    const [lo, hi] = target;
    if (wpm > hi) {
      return { text: SLOW_DOWN, tone: TONE_WARN };
    }
    if (wpm < lo) {
      return { text: SPEED_UP, tone: TONE_WARN };
    }
    return { text: TARGET_PREFIX + lo + TARGET_JOINER + hi, tone: TONE_OK };
  }

  // The two headline sentences for a take, from its summary and, when there is one, the
  // summary of the take before it (or null). Pure. Each list below is checked top to bottom
  // and the first match wins; the thresholds are the cards', so the headline never contradicts
  // a card: the band ends count as inside and fillers over 3 a minute are high.
  function headlineFor(summary, previousSummary) {
    const band = summary.target[0] + TARGET_JOINER + summary.target[1];
    return {
      strength: strengthFor(summary, previousSummary, band),
      focus: focusFor(summary, band),
    };
  }

  function strengthFor(summary, previousSummary, band) {
    if (fillersDropped(summary, previousSummary)) {
      return HEADLINE.fillersDown(previousSummary.fillersPerMinute, summary.fillersPerMinute);
    }
    if (paceIsInside(summary)) {
      return HEADLINE.paceInside(band);
    }
    if (summary.fillersPerMinute <= MAX_FILLERS_PER_MINUTE) {
      return HEADLINE.fillersUnder;
    }
    if (summary.pauseCount === 0) {
      return HEADLINE.noBreaks;
    }
    if (summary.cleanStretchSeconds > 0) {
      return HEADLINE.cleanStretch(secondsText(summary.cleanStretchSeconds));
    }
    return HEADLINE.onChart;
  }

  function focusFor(summary, band) {
    const [lo, hi] = summary.target;
    const clean = summary.cleanStretchSeconds;
    if (summary.fillersPerMinute > MAX_FILLERS_PER_MINUTE) {
      return HEADLINE.cutFillers;
    }
    if (summary.wpm > hi) {
      return HEADLINE.slowDown(band);
    }
    if (summary.wpm < lo) {
      return HEADLINE.speedUp(band);
    }
    if (summary.pauseCount > 0) {
      return HEADLINE.movePauses;
    }
    if (clean > 0 && clean < CLEAN_STRETCH_GOAL_SECONDS) {
      return HEADLINE.stretchClean(secondsText(clean));
    }
    return HEADLINE.holdDelivery;
  }

  // A drop of at least half a filler a minute since the last take. Both takes must have words:
  // a take saved without them was counted by the backend's rules, not these.
  function fillersDropped(summary, previousSummary) {
    if (!previousSummary || !hasWords(summary) || !hasWords(previousSummary)) {
      return false;
    }
    const drop = roundTo(previousSummary.fillersPerMinute - summary.fillersPerMinute, 1);
    return drop >= MIN_FILLER_DROP;
  }

  function paceIsInside(summary) {
    const [lo, hi] = summary.target;
    return summary.wpm >= lo && summary.wpm <= hi;
  }

  // True when the take was scored from its words: the report labels one kind per word.
  function hasWords(summary) {
    const kinds = summary && summary.report ? summary.report.kinds : null;
    return Array.isArray(kinds) && kinds.length > 0;
  }

  // How each card moved since the last take: null without a last take, otherwise one entry
  // per card in card order, {direction: "up" | "down" | "same", text} or null for a card the
  // two takes cannot share. Each difference is rounded to its card's precision before the
  // direction is chosen, so 3.1 against 1.9 reads "1.2 more" and a change the card cannot show
  // reads "No change". Pure.
  function compareWithPrevious(summary, previousSummary) {
    if (!previousSummary) {
      return null;
    }
    const bothHaveWords = hasWords(summary) && hasWords(previousSummary);
    return DELTAS.map((delta) => {
      if (delta.needsWords && !bothHaveWords) {
        return null;
      }
      return deltaFor(summary[delta.key] - previousSummary[delta.key], delta);
    });
  }

  function deltaFor(difference, delta) {
    if (!Number.isFinite(difference)) {
      return null;
    }
    const rounded = roundTo(difference, delta.digits);
    if (rounded === 0) {
      return { direction: SAME, text: NO_CHANGE };
    }
    const direction = rounded > 0 ? UP : DOWN;
    return { direction, text: Math.abs(rounded) + delta.unit + " " + delta[direction] };
  }

  // Rounds half away from zero, so a rise and a fall of the same size read the same.
  function roundTo(value, digits) {
    const factor = 10 ** digits;
    return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  }

  // "4.9 seconds", or "1 second".
  function secondsText(seconds) {
    return seconds === 1 ? "1 second" : seconds + " seconds";
  }

  function normalizeWord(text) {
    return String(text || "").toLowerCase().replace(EDGE_PUNCTUATION, "");
  }

  // The transcript as a list of items to draw, in reading order: {type: "word", text, filler}
  // for every backend word and {type: "pause", length} for every [at, length] in
  // metrics.pauses. A pause goes right after the last word whose end is at or before `at`;
  // when no word has ended by then it goes before the first word. Pure: fresh objects, and
  // neither input is changed.
  function buildTranscriptPlan(words, pauses) {
    const wordList = Array.isArray(words) ? words : [];
    const pauseList = Array.isArray(pauses) ? pauses : [];
    const kinds = app.delivery.classify(wordList);

    // Slot 0 holds the pauses that go before the first word; slot i + 1 those after word i.
    const slots = Array.from({ length: wordList.length + 1 }, () => []);
    pauseList.forEach((pause) => {
      const [at, length] = Array.isArray(pause) ? pause : [];
      const slot = lastWordEndedBy(wordList, numberOr0(at)) + 1;
      slots[slot].push({ type: PAUSE_ITEM, length: numberOr0(length) });
    });

    const plan = [...slots[0]];
    wordList.forEach((word, index) => {
      plan.push({
        type: WORD_ITEM,
        text: textOf(word),
        filler: kinds[index] !== null,
        kind: kinds[index],
      });
      plan.push(...slots[index + 1]);
    });
    return plan;
  }

  // Index of the last word whose end is at or before `at`, or -1 when none has ended yet.
  function lastWordEndedBy(wordList, at) {
    for (let index = wordList.length - 1; index >= 0; index -= 1) {
      if (numberOr0(wordList[index] && wordList[index].end) <= at) {
        return index;
      }
    }
    return -1;
  }

  function textOf(word) {
    return String((word && word.text) || "");
  }

  // Both reads finish before the one ticket check, so a slow earlier visit can never paint over
  // a newer one, whichever read is the slow one.
  async function show(params) {
    const ticket = ++showCount;
    const session = await loadSession(params && params.id);
    const previous = session === undefined ? null : await loadPreviousSession(session);
    if (ticket !== showCount) {
      return;
    }
    if (session === undefined) {
      renderNotFound();
    } else {
      renderSession(session, previous);
    }
  }

  // undefined for a missing id, an id the store does not know, or a store that cannot be read;
  // all three end in the same "Session not found" block rather than a console error.
  async function loadSession(id) {
    if (!id) {
      return undefined;
    }
    try {
      return await app.store.get(id);
    } catch {
      return undefined;
    }
  }

  // The take saved just before this one, or null. app.store.list() is newest first, so that is
  // the first listed session created earlier. A store without list(), or one that cannot be
  // read, means the cards show no comparison, never an error.
  async function loadPreviousSession(session) {
    if (!app.store || typeof app.store.list !== "function") {
      return null;
    }
    try {
      const sessions = await app.store.list();
      return earlierSession(sessions, session);
    } catch {
      return null;
    }
  }

  function earlierSession(sessions, session) {
    if (!Array.isArray(sessions)) {
      return null;
    }
    const earlier = sessions.find(
      (other) => Boolean(other) && other.createdAt < session.createdAt,
    );
    return earlier || null;
  }

  // Nothing to release: show() rebuilds the body from the stored session every time.
  function hide() {}

  function renderNotFound() {
    app.ui.renderState(body, {
      kind: "empty",
      icon: NOT_FOUND_ICON,
      title: NOT_FOUND_TITLE,
      body: NOT_FOUND_BODY,
      actionLabel: HISTORY_LABEL,
      onAction: () => app.router.go("history"),
    });
  }

  // Top to bottom: meta line, headline, the four cards (each with its "vs last take" line when
  // there is a last take, and then one note under the grid), the transcript (skipped when the
  // session has no words; pause markers alone would mean nothing), the tips (skipped when there
  // are none), the two actions. The last take is summarized for the comparison only: no tips
  // are chosen for it.
  function renderSession(session, previous) {
    const summary = summarize(session);
    const previousSummary = previous ? summarize(previous) : null;
    const deltas = compareWithPrevious(summary, previousSummary);
    const metrics = session.metrics || {};
    const plan = buildTranscriptPlan(session.transcript, metrics.pauses);
    const hasTranscript = plan.some((item) => item.type === WORD_ITEM);
    const tips = selectTips(summary.report, summary.target);

    app.ui.clear(body);
    body.appendChild(buildMeta(session, summary.timeUsed));
    body.appendChild(buildHeadline(headlineFor(summary, previousSummary)));
    body.appendChild(buildMetricGrid(summary, deltas));
    if (deltas) {
      body.appendChild(app.ui.el("p", { class: "metric-grid__note", text: DELTA_NOTE }));
    }
    if (hasTranscript) {
      body.appendChild(sectionTitle(TRANSCRIPT_TITLE));
      body.appendChild(buildLegend(summary.topHabit));
      body.appendChild(buildTranscript(plan));
    }
    if (tips.length > 0) {
      body.appendChild(sectionTitle(TIPS_TITLE));
      tips.forEach((tip) => body.appendChild(buildTipCard(tip)));
    }
    body.appendChild(buildActions());
  }

  // tips.js loads before this file in index.html. Without it (a failed load, or a context that
  // stubs app without tips) the screen simply has no Tips section instead of an error.
  function selectTips(report, target) {
    if (!app.tips || typeof app.tips.select !== "function") {
      return [];
    }
    return app.tips.select(report, { targetWpm: target });
  }

  // What the two highlight styles mean, plus the most-used habit when there is one.
  function buildLegend(topHabit) {
    const link = app.ui.el("a", { class: "transcript__how", href: HOW_HREF, text: HOW_LINK_TEXT });
    if (!topHabit) {
      return app.ui.el("p", { class: "transcript__legend", text: LEGEND_TEXT }, [link]);
    }
    const times = topHabit.count === 1 ? " time." : " times.";
    const habitLine = " Most used: “" + topHabit.text + "”, " + topHabit.count + times;
    return app.ui.el("p", { class: "transcript__legend", text: LEGEND_TEXT + habitLine }, [link]);
  }

  function sectionTitle(text) {
    return app.ui.el("h2", { class: "results__heading", text });
  }

  // Every item is followed by a space text node, so the words keep their breaks when the
  // paragraph is copied or read aloud and the browser can wrap between any two of them.
  function buildTranscript(plan) {
    const nodes = [];
    plan.forEach((item) => {
      nodes.push(item.type === PAUSE_ITEM ? pauseMarker(item.length) : wordToken(item));
      nodes.push(TOKEN_SEPARATOR);
    });
    return app.ui.el("p", { class: "transcript" }, nodes);
  }

  // The label uses the bare word, so "Um," reads as "um, filler word" (DESIGN.md section 6).
  function wordToken(item) {
    if (!item.filler) {
      return app.ui.el("span", { class: "tok", text: item.text });
    }
    const habit = item.kind === app.delivery.HABIT;
    return app.ui.el("span", {
      class: habit ? "tok tok--habit" : "tok tok--filler",
      "aria-label": normalizeWord(item.text) + (habit ? HABIT_LABEL_SUFFIX : FILLER_LABEL_SUFFIX),
      text: item.text,
    });
  }

  // "2.1 s pause", always one decimal, matching the "x.x s pause" the README asks you to see.
  function pauseMarker(length) {
    const seconds = numberOr0(length).toFixed(1);
    return app.ui.el("span", {
      class: "tok--pause num",
      "aria-label": PAUSE_LABEL_PREFIX + seconds + PAUSE_LABEL_SUFFIX,
      text: seconds + PAUSE_TEXT_SUFFIX,
    });
  }

  function buildTipCard(tip) {
    return app.ui.el("div", { class: "tip-card", text: tip.text });
  }

  // "Gettysburg Address, opening · Oct 10, 10:30 AM", plus " · 2:41 of 3:00" for a timed
  // preset. The date and the time used sit in no-wrap spans, so a narrow screen breaks the line
  // between the parts, never inside "Oct 10, 10:30 AM".
  function buildMeta(session, timeUsed) {
    const title = session.passageTitle ? String(session.passageTitle) + META_SEPARATOR : null;
    const date = app.ui.formatDate(session.createdAt);
    const parts = [title, app.ui.el("span", { class: "results__date", text: date })];
    if (timeUsed) {
      const used = app.ui.el("span", { class: "results__time-used", text: timeUsed });
      parts.push(META_SEPARATOR, used);
    }
    return app.ui.el("p", { class: "results__meta num" }, parts);
  }

  // The strength over the focus. Each icon follows its words in the DOM, so each line's text
  // is exactly its sentence, and CSS draws it first (order: -1).
  function buildHeadline(headline) {
    return app.ui.el("section", { class: "headline" }, [
      headlineLine("headline__strength", headline.strength, STRENGTH_ICON),
      headlineLine("headline__focus", headline.focus, FOCUS_ICON),
    ]);
  }

  function headlineLine(className, sentence, iconName) {
    return app.ui.el("p", { class: className, text: sentence }, [
      app.ui.icon(iconName, HEADLINE_ICON_SIZE),
    ]);
  }

  // Exactly four cards, in the order DESIGN.md fixes; the pace and fillers cards carry hints,
  // and with a last take each card that can be compared carries its delta line.
  function buildMetricGrid(summary, deltas) {
    const cards = [
      { label: WPM_LABEL, value: summary.wpm, unit: WPM_UNIT, hint: summary.paceHint },
      {
        label: FILLERS_LABEL,
        value: summary.fillersPerMinute,
        unit: FILLERS_UNIT,
        hint: summary.fillersHint,
      },
      { label: PAUSES_LABEL, value: summary.pauseCount },
      { label: CLEAN_STRETCH_LABEL, value: summary.cleanStretchSeconds, unit: CLEAN_STRETCH_UNIT },
    ];
    return app.ui.el(
      "div",
      { class: "metric-grid" },
      cards.map((card, index) => metricCard(card, deltas ? deltas[index] : null)),
    );
  }

  // The unit sits inside the value line, after a space, so "162 wpm" reads as one phrase and
  // the small unit shares the big number's baseline. The line never wraps (styles.css), so the
  // unit cannot drop below its number.
  function metricCard(card, delta) {
    const valueParts = [String(card.value)];
    if (card.unit) {
      valueParts.push(" ", app.ui.el("span", { class: "metric-card__unit", text: card.unit }));
    }
    const parts = [
      app.ui.el("div", { class: "metric-card__label", text: card.label }),
      app.ui.el("div", { class: "metric-card__value num" }, valueParts),
    ];
    if (card.hint) {
      parts.push(hintLine(card.hint));
    }
    if (delta) {
      parts.push(deltaLine(delta));
    }
    return app.ui.el("div", { class: "metric-card" }, parts);
  }

  // The hint's words, then its icon. The icon comes after the words in the DOM, so the line's
  // text is exactly the words, and CSS draws it first (order: -1).
  function hintLine(hint) {
    return app.ui.el(
      "div",
      { class: "metric-card__hint metric-card__hint--" + hint.tone, text: hint.text },
      [app.ui.icon(HINT_ICONS[hint.tone], HINT_ICON_SIZE)],
    );
  }

  // "12 slower", then a hidden " than your last take" so the line reads as a sentence, then
  // the triangle or dash, which CSS draws first. Its own class, never the hint's.
  function deltaLine(delta) {
    const ending = delta.direction === SAME ? FROM_LAST_TAKE : THAN_LAST_TAKE;
    return app.ui.el(
      "div",
      { class: "metric-card__delta metric-card__delta--" + delta.direction, text: delta.text },
      [
        app.ui.el("span", { class: "sr-only", text: ending }),
        app.ui.icon(DELTA_ICONS[delta.direction], DELTA_ICON_SIZE),
      ],
    );
  }

  function buildActions() {
    return app.ui.el("div", { class: "results__actions" }, [
      app.ui.el("button", {
        class: "btn btn--primary btn--block",
        type: "button",
        text: RECORD_AGAIN_LABEL,
        onClick: () => app.router.go("practice"),
      }),
      app.ui.el("button", {
        class: "btn btn--secondary btn--block",
        type: "button",
        text: HISTORY_LABEL,
        onClick: () => app.router.go("history"),
      }),
    ]);
  }

  app.screens.results = {
    mount,
    show,
    hide,
    summarize,
    buildTranscriptPlan,
    headlineFor,
    compareWithPrevious,
  };
})();
