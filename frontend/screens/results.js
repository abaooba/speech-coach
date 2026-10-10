/* screens/results.js: app.screens.results, the four metric cards after a take (DESIGN.md
   sections 1 and 6). summarize(session) turns the backend metrics into the card numbers and the
   pace hint without touching the DOM; show({id}) loads the session from app.store and builds the
   meta line, the metric grid and the Record again / History actions into the screen body. */
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
    const range = passage && Array.isArray(passage.targetWpm) ? passage.targetWpm : DEFAULT_TARGET_WPM;
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

  function renderSession(session) {
    const summary = summarize(session);
    app.ui.clear(body);
    body.appendChild(buildMeta(session));
    body.appendChild(buildMetricGrid(summary));
    body.appendChild(buildActions());
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

  app.screens.results = { mount, show, hide, summarize };
})();
