/* screens/results.js: app.screens.results, the Results screen after a take (DESIGN.md sections
   1 and 6). Three pure helpers do the thinking without the DOM: summarize(session) turns the
   backend metrics into the card numbers and the pace hint, isFiller(text) names the filler
   words, buildTranscriptPlan(words, pauses) lays the transcript out with its pause markers.
   show({id}) loads the session from app.store and builds the meta line, the metric grid, the
   highlighted transcript, the tips from app.tips and the Record again / History actions. */
(function () {
  "use strict";

  // Used when the session's passage is no longer in app.passages.
  const DEFAULT_TARGET_WPM = [140, 160];
  const SECONDS_PER_MINUTE = 60;

  // Card labels and units (DESIGN.md sections 5 and 6), in display order.
  const WPM_LABEL = "Words per minute";
  const WPM_UNIT = "wpm";
  const FILLERS_LABEL = "Fillers per minute";
  const FILLERS_UNIT = "per min";
  const PAUSES_LABEL = "Pauses over 1.5 s";
  const LONGEST_PAUSE_LABEL = "Longest pause";
  const LONGEST_PAUSE_UNIT = "s";

  // Pace hint copy: always words, never a bare number (DESIGN.md section 9).
  const TARGET_PREFIX = "Target ";
  const TARGET_JOINER = " to ";
  const SLOW_DOWN = "Slow down";
  const SPEED_UP = "Speed up";
  const TONE_OK = "ok";
  const TONE_WARN = "warn";

  // Fixed copy for the bad-id state and the two actions (DESIGN.md sections 1 and 8).
  const NOT_FOUND_TITLE = "Session not found";
  const NOT_FOUND_BODY = "It may have been deleted.";
  const RECORD_AGAIN_LABEL = "Record again";
  const HISTORY_LABEL = "History";
  const META_SEPARATOR = " · ";

  // Section titles between the metric grid and the actions.
  const TRANSCRIPT_TITLE = "Transcript";
  const TIPS_TITLE = "Tips";

  // Fillers (DESIGN.md section 6, "Transcript"): single words matched one at a time, plus the
  // two-word phrase "you know". The lists mirror backend/metrics.py so the highlighted tokens
  // are exactly the ones the fillers card counted.
  const FILLER_WORDS = ["um", "uh", "hmm", "like", "so", "basically", "actually"];
  const FILLER_PHRASE = ["you", "know"];

  // Punctuation at either end of a token, the same rule as backend.metrics.clean: "Um," and
  // "um" compare equal while "so-called" and "day's" stay whole words.
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;

  // Transcript plan item types and the strings the tokens and pause markers are built from.
  const WORD_ITEM = "word";
  const PAUSE_ITEM = "pause";
  const TOKEN_SEPARATOR = " ";
  const FILLER_LABEL_SUFFIX = ", filler word";
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

  // The numbers on the four cards plus the pace hint, from one stored session. Pure: reads the
  // session and app.passages, returns a fresh object. Missing or malformed numbers read as 0 so
  // a bad record never breaks the screen.
  function summarize(session) {
    const metrics = session.metrics || {};
    const fillers = metrics.fillers || {};
    const pauses = Array.isArray(metrics.pauses) ? metrics.pauses : [];

    const wpm = Math.round(numberOr0(metrics.words_per_minute));
    const minutes = numberOr0(metrics.duration) / SECONDS_PER_MINUTE;
    const fillerCount = Object.values(fillers).reduce((sum, count) => sum + numberOr0(count), 0);
    const fillersPerMinute = minutes > 0 ? roundToTenth(fillerCount / minutes) : 0;
    const pauseLengths = pauses.map((pause) => numberOr0(pause[1]));
    const longestPause = pauseLengths.length > 0 ? roundToTenth(Math.max(...pauseLengths)) : 0;
    const target = targetFor(session.passageId);

    return {
      wpm,
      fillersPerMinute,
      pauseCount: pauses.length,
      longestPause,
      target,
      paceHint: paceHintFor(wpm, target),
    };
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  // A copy of the passage's [lo, hi] target, or the default when the passage is unknown.
  function targetFor(passageId) {
    const passages = app.passages || [];
    const passage = passages.find((entry) => entry.id === passageId);
    const known = passage && Array.isArray(passage.targetWpm);
    const range = known ? passage.targetWpm : DEFAULT_TARGET_WPM;
    return [range[0], range[1]];
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

  // True for a filler said on its own: "Um," and "so" yes, "umbrella" no. The phrase "you
  // know" is a pair of tokens, so buildTranscriptPlan handles it instead.
  function isFiller(text) {
    return FILLER_WORDS.includes(normalizeWord(text));
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
    const fillers = fillerFlags(wordList);

    // Slot 0 holds the pauses that go before the first word; slot i + 1 those after word i.
    const slots = Array.from({ length: wordList.length + 1 }, () => []);
    pauseList.forEach((pause) => {
      const [at, length] = Array.isArray(pause) ? pause : [];
      const slot = lastWordEndedBy(wordList, numberOr0(at)) + 1;
      slots[slot].push({ type: PAUSE_ITEM, length: numberOr0(length) });
    });

    const plan = [...slots[0]];
    wordList.forEach((word, index) => {
      plan.push({ type: WORD_ITEM, text: textOf(word), filler: fillers[index] });
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

  // One flag per word: the single fillers by isFiller, then both halves of every "you know".
  function fillerFlags(wordList) {
    const tokens = wordList.map((word) => normalizeWord(textOf(word)));
    const flags = tokens.map((token) => FILLER_WORDS.includes(token));
    tokens.forEach((token, index) => {
      if (token === FILLER_PHRASE[0] && tokens[index + 1] === FILLER_PHRASE[1]) {
        flags[index] = true;
        flags[index + 1] = true;
      }
    });
    return flags;
  }

  function textOf(word) {
    return String((word && word.text) || "");
  }

  async function show(params) {
    const ticket = ++showCount;
    const session = await loadSession(params && params.id);
    if (ticket !== showCount) {
      return;
    }
    if (session === undefined) {
      renderNotFound();
    } else {
      renderSession(session);
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

  // Nothing to release: show() rebuilds the body from the stored session every time.
  function hide() {}

  function renderNotFound() {
    app.ui.renderState(body, {
      kind: "empty",
      title: NOT_FOUND_TITLE,
      body: NOT_FOUND_BODY,
      actionLabel: HISTORY_LABEL,
      onAction: () => app.router.go("history"),
    });
  }

  // Top to bottom: meta line, four cards, the transcript (skipped when the session has no
  // words; pause markers alone would mean nothing), the tips (skipped when there are none),
  // the two actions.
  function renderSession(session) {
    const summary = summarize(session);
    const metrics = session.metrics || {};
    const plan = buildTranscriptPlan(session.transcript, metrics.pauses);
    const hasWords = plan.some((item) => item.type === WORD_ITEM);
    const tips = selectTips(metrics, summary.target);

    app.ui.clear(body);
    body.appendChild(buildMeta(session));
    body.appendChild(buildMetricGrid(summary));
    if (hasWords) {
      body.appendChild(sectionTitle(TRANSCRIPT_TITLE));
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
  function selectTips(metrics, target) {
    if (!app.tips || typeof app.tips.select !== "function") {
      return [];
    }
    return app.tips.select(metrics, { targetWpm: target });
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
    return app.ui.el("span", {
      class: "tok tok--filler",
      "aria-label": normalizeWord(item.text) + FILLER_LABEL_SUFFIX,
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

  function buildMeta(session) {
    const text = session.passageTitle + META_SEPARATOR + app.ui.formatDate(session.createdAt);
    return app.ui.el("p", { class: "results__meta num", text });
  }

  // Exactly four cards, in the order DESIGN.md fixes; only the pace card carries a hint.
  function buildMetricGrid(summary) {
    return app.ui.el("div", { class: "metric-grid" }, [
      metricCard(WPM_LABEL, summary.wpm, WPM_UNIT, summary.paceHint),
      metricCard(FILLERS_LABEL, summary.fillersPerMinute, FILLERS_UNIT),
      metricCard(PAUSES_LABEL, summary.pauseCount),
      metricCard(LONGEST_PAUSE_LABEL, summary.longestPause, LONGEST_PAUSE_UNIT),
    ]);
  }

  // The unit sits inside the value line, after a space, so "162 wpm" reads as one phrase and
  // the small unit shares the big number's baseline.
  function metricCard(label, value, unit, hint) {
    const valueParts = [String(value)];
    if (unit) {
      valueParts.push(" ", app.ui.el("span", { class: "metric-card__unit", text: unit }));
    }
    const parts = [
      app.ui.el("div", { class: "metric-card__label", text: label }),
      app.ui.el("div", { class: "metric-card__value num" }, valueParts),
    ];
    if (hint) {
      parts.push(
        app.ui.el("div", {
          class: "metric-card__hint metric-card__hint--" + hint.tone,
          text: hint.text,
        }),
      );
    }
    return app.ui.el("div", { class: "metric-card" }, parts);
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

  app.screens.results = { mount, show, hide, summarize, isFiller, buildTranscriptPlan };
})();
