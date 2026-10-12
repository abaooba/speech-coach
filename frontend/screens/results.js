/* screens/results.js: app.screens.results, the screen after a take (DESIGN.md sections 1, 6, 8).
   show({id}) reads the take and the speaker's take before it from app.store, never writing, and
   draws the meta line, headline, cards, timeline, transcript, tips and actions node by node,
   never from markup. summarize, headlineFor and the other pure helpers touch no DOM or app.ui. */
(function () {
  "use strict";

  // Used when the session's passage is no longer in app.passages.
  const DEFAULT_TARGET_WPM = [140, 160];

  // Practice's "See a sample result" saves the bundled take (sample-session.json) under a title
  // that starts with this. It is saved like any session, so History lists it; isSample reads the
  // prefix to keep it out of every comparison.
  const SAMPLE_TITLE_PREFIX = "Sample: ";

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

  // A pace band ("130 to 160") is drawn with non-breaking spaces around its "to", in the Pace
  // hint and in the headline, so it never splits across lines.
  const UNBROKEN_JOINER = "\u00a0to\u00a0";
  const BAND_SPACES = /(\d+) to (\d+)/;
  const BAND_UNBROKEN = "$1" + UNBROKEN_JOINER + "$2";

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
    shortenFreezes: "Next take, keep every pause under 5 seconds.",
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

  // The speech timeline's strip, in viewBox units: 320 wide and 40 tall, stretched to the
  // column. The track sits inside the box; filler ticks and long-pause blocks run 4 units past
  // it at both ends, so they read as taller than the track. A restart is a 1-unit line the full
  // height of the strip, so it shows past a filler tick at the same moment and never reads as a
  // pause block. Every color is a token string, so both themes apply.
  const TIMELINE_TITLE = "Speech timeline";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const STRIP = Object.freeze({
    width: 320,
    height: 40,
    trackY: 6,
    trackHeight: 28,
    trackRadius: 4,
    tickY: 2,
    tickHeight: 36,
    tickWidth: 2,
    restartWidth: 1,
    edgeHeight: 3,
    minBlockWidth: 2,
  });
  const STRIP_COLORS = Object.freeze({
    track: "var(--surface)",
    trackEdge: "var(--border)",
    clean: "var(--ok-bg)",
    cleanEdge: "var(--ok)",
    pause: "var(--pause)",
    longPause: "var(--pause-long)",
    filler: "var(--filler)",
    restart: "var(--pause)",
  });
  // Coordinates keep two decimals: a hundredth of a unit is far below a pixel.
  const COORD_SCALE = 100;
  // The long-pause and restart keys join the legend only when the strip draws one.
  const LEGEND_KEYS = [
    ["filler", "Filler"],
    ["pause", "Mid-sentence pause"],
    ["long-pause", "Long pause (5 s+)"],
    ["restart", "Restart"],
    ["clean", "Clean stretch"],
  ];
  const LONG_PAUSE_KEY = "long-pause";
  const RESTART_KEY = "restart";
  // The hidden list of moments, read in time order: "Filler “um” at 0:02".
  const MOMENT = Object.freeze({
    filler: (word, at) => "Filler “" + word + "” at " + at,
    pause: (at, seconds) => "Mid-sentence pause at " + at + ", " + seconds + " seconds",
    longPause: (at, seconds) => "Long pause at " + at + ", " + seconds + " seconds",
    clean: (from, to, seconds) => "Clean stretch from " + from + " to " + to + ", " + seconds,
  });

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
  const SKIP_ITEM = "skip";
  const TOKEN_SEPARATOR = " ";
  const FILLER_LABEL_SUFFIX = ", filler word";
  const HABIT_LABEL_SUFFIX = ", verbal habit";
  const RESTART_LABEL_SUFFIX = ", restart";
  // "make, misread, script says makes": the label names the word the script has there.
  const MISREAD_LABEL_SUFFIX = ", misread, script says ";
  // A skipped script word is drawn struck through and read as "skipped: lose".
  const SKIPPED_LABEL_PREFIX = "skipped: ";
  // Up to this many script words skipped in one place are drawn one by one, so a skipped line
  // ("Consider what we lose.") reads as the line it was. A longer run is usually script the take
  // never reached (it stopped early or started partway in); word by word it would bury the
  // transcript, so it is one marker: "50 words skipped:", then its first and last words.
  const MAX_SKIPS_SHOWN_ONE_BY_ONE = 8;
  // Words a skip run shows at each end, either side of SKIP_RUN_GAP.
  const SKIP_RUN_EDGE_WORDS = 3;
  const SKIP_RUN_GAP = "…";
  const SKIP_RUN_COUNT_SUFFIX = " words skipped:";
  const LEGEND_TEXT = "Highlighted words are ums and uhs. Underlined words are verbal habits.";
  // Added only when the transcript marks a restart. Restart words keep plain text with a
  // --pause underline, so they differ from the bold filler-colored habits by more than color.
  const LEGEND_RESTART_TEXT = " Purple underlined words are restarts.";
  // Added only when the transcript of a take read from a script shows a misread or a skip.
  const LEGEND_MISREAD_TEXT = " Wavy underlined words are misreads.";
  const LEGEND_SKIP_TEXT = " Struck-through words were skipped.";
  const HOW_HREF = "how.html";
  const HOW_LINK_TEXT = "How we count";
  const PAUSE_TEXT_SUFFIX = " s pause";
  const PAUSE_LABEL_PREFIX = "pause, ";
  const PAUSE_LABEL_SUFFIX = " seconds";
  const LONG_PAUSE_TEXT_SUFFIX = " s long pause";
  const LONG_PAUSE_LABEL_PREFIX = "long pause, ";
  // A skip's `at` is the end of the word said before it; allow for float error in that match.
  const MILLISECOND = 0.001;

  // The screen's .screen__body; show() rebuilds everything inside it.
  let body = null;

  // Counts show() calls so a slow load from an earlier visit cannot paint over a newer one.
  let showCount = 0;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  // The numbers on the four cards, their hints and the time used, from one stored session,
  // plus the app.delivery report the transcript and tips are drawn from. Pure: reads the session
  // and app.passages, never the DOM or app.ui, and returns a fresh object. A take saved without
  // words falls back to the backend tallies inside app.delivery, so a bad or old record never
  // breaks the screen.
  function summarize(session) {
    const report = app.delivery.analyze(session.transcript, session.metrics);
    const wpm = Math.round(report.wordsPerMinute);
    const target = targetFor(session.passageId);
    return {
      wpm,
      fillersPerMinute: report.fillersPerMinute,
      pauseCount: report.pauseCount,
      longestPause: report.longestPause,
      longPauseCount: report.longPauseCount,
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

  // {seconds, limitSeconds} for a preset with a time limit, else null. Seconds, not clock text,
  // so summarize never needs app.ui; the meta line prints it as "2:41 of 3:00".
  function timeUsedFor(passageId, speakingSeconds) {
    const passages = app.passages || [];
    const passage = passages.find((entry) => entry.id === passageId);
    if (!passage || !Number.isFinite(passage.timeLimitSeconds)) {
      return null;
    }
    return { seconds: speakingSeconds, limitSeconds: passage.timeLimitSeconds };
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
    const band = bandText(summary.target, TARGET_JOINER);
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
    if (summary.longPauseCount > 0) {
      return HEADLINE.shortenFreezes;
    }
    if (summary.pauseCount > 0) {
      return HEADLINE.movePauses;
    }
    if (clean > 0 && clean < CLEAN_STRETCH_GOAL_SECONDS) {
      return HEADLINE.stretchClean(secondsText(clean));
    }
    return HEADLINE.holdDelivery;
  }

  // A drop of at least half a filler a minute since the last take (DESIGN.md section 8), on the
  // same numbers the Fillers card compares: a take saved without words counts its backend
  // tallies there too, so the headline never contradicts the card's "4.2 fewer".
  function fillersDropped(summary, previousSummary) {
    if (!previousSummary) {
      return false;
    }
    const drop = roundTo(previousSummary.fillersPerMinute - summary.fillersPerMinute, 1);
    return drop >= MIN_FILLER_DROP;
  }

  function paceIsInside(summary) {
    const [lo, hi] = summary.target;
    return summary.wpm >= lo && summary.wpm <= hi;
  }

  // "130 to 150" for a [lo, hi] target, with `joiner` (" to ", or its unbroken form) between.
  function bandText(target, joiner) {
    return target[0] + joiner + target[1];
  }

  // True for the bundled sample: History lists it, but it is not one of the speaker's takes, so
  // no comparison on this screen and nothing on Progress ever uses it. Pure.
  function isSample(session) {
    const title = session ? session.passageTitle : undefined;
    return typeof title === "string" && title.startsWith(SAMPLE_TITLE_PREFIX);
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

  // Where the take's moments fall on the speech timeline: positions from 0 (the first word) to
  // 1 (the last), each with its recording-time clock (`time`), for every filler, the pauses the
  // card counts (mid-sentence, or 5 s+ anywhere, flagged `long`), every restart (at its `at`,
  // where the abandoned first copy began) and the clean stretch when there is one. Null for a
  // take without words or without speaking time. Pure.
  function timelineSegments(report) {
    const start = report ? report.speechStart : null;
    const seconds = report ? report.speakingSeconds : 0;
    if (!Number.isFinite(start) || !(seconds > 0)) {
      return null;
    }
    const position = (time) => clamp01((time - start) / seconds);
    const fillers = listOf(report.fillers).map((filler) => ({
      at: position(filler.start),
      time: filler.start,
      text: filler.text,
      kind: filler.kind,
    }));
    const pauses = listOf(report.pauses)
      .filter(app.delivery.isCountedPause)
      .map((pause) => ({
        from: position(pause.at),
        to: position(pause.at + pause.length),
        time: pause.at,
        seconds: pause.length,
        long: pause.long,
      }));
    const restarts = listOf(report.restarts).map((restart) => ({
      at: position(restart.at),
      time: restart.at,
      text: restart.text,
    }));
    const clean = report.cleanStretch;
    const cleanStretch =
      clean && clean.seconds > 0
        ? {
            from: position(clean.start),
            to: position(clean.end),
            time: clean.start,
            endTime: clean.end,
            seconds: clean.seconds,
          }
        : null;
    return { start, seconds, fillers, pauses, restarts, cleanStretch };
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
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
  // for every backend word and {type: "pause", length} for every [at, length] in `pauses`
  // (Results passes only the pauses the card counts: mid-sentence, or 5 s+ anywhere). A pause
  // goes right after the last word whose end is at or before `at`; when no word has ended by
  // then it goes before the first word. A word whose index is in `restartWords` (the second
  // copies of the report's restarts) also gets `restart: true`. `scriptSlips` (optional) holds
  // the report's `misreads` and `skips` for a take read from a script: a word whose index is a
  // misread's `wordIndex` gets `misread`, the script word it stands for (two, space-joined, when
  // both halves of "short-endure" were misread), and each skip becomes {type: "skip", text} after
  // the last word that ended by its `at`, ahead of any pause there; more than
  // MAX_SKIPS_SHOWN_ONE_BY_ONE skips in one place become one {type: "skip", text, count} run. A
  // skip is not a word. Pure: fresh objects, and no input is changed.
  function buildTranscriptPlan(words, pauses, restartWords, scriptSlips) {
    const wordList = Array.isArray(words) ? words : [];
    const pauseList = Array.isArray(pauses) ? pauses : [];
    const restartIndexes = new Set(listOf(restartWords));
    const slips = scriptSlips && typeof scriptSlips === "object" ? scriptSlips : {};
    const misreadWords = misreadsByWord(slips.misreads);
    const kinds = app.delivery.classify(wordList);

    // Slot 0 holds the skips and pauses that go before the first word; slot i + 1 those after
    // word i.
    const skippedBySlot = Array.from({ length: wordList.length + 1 }, () => []);
    listOf(slips.skips).forEach((skip) => {
      const slot = lastWordEndedBy(wordList, numberOr0(skip.at) + MILLISECOND) + 1;
      skippedBySlot[slot].push(String(skip.word));
    });
    const slots = skippedBySlot.map(skipItems);
    pauseList.forEach((pause) => {
      const [at, length] = Array.isArray(pause) ? pause : [];
      const slot = lastWordEndedBy(wordList, numberOr0(at)) + 1;
      slots[slot].push({ type: PAUSE_ITEM, length: numberOr0(length) });
    });

    const plan = [...slots[0]];
    wordList.forEach((word, index) => {
      const item = {
        type: WORD_ITEM,
        text: textOf(word),
        filler: kinds[index] !== null,
        kind: kinds[index],
      };
      if (restartIndexes.has(index)) {
        item.restart = true;
      }
      if (misreadWords.has(index)) {
        item.misread = misreadWords.get(index).join(" ");
      }
      plan.push(item);
      plan.push(...slots[index + 1]);
    });
    return plan;
  }

  // The plan items for the script words skipped in one place, in script order: one per word, or
  // for more than MAX_SKIPS_SHOWN_ONE_BY_ONE a single run, {type: "skip", text, count}, whose
  // text is its first and last SKIP_RUN_EDGE_WORDS words either side of SKIP_RUN_GAP.
  function skipItems(skippedWords) {
    if (skippedWords.length <= MAX_SKIPS_SHOWN_ONE_BY_ONE) {
      return skippedWords.map((text) => ({ type: SKIP_ITEM, text }));
    }
    const text = [
      ...skippedWords.slice(0, SKIP_RUN_EDGE_WORDS),
      SKIP_RUN_GAP,
      ...skippedWords.slice(-SKIP_RUN_EDGE_WORDS),
    ].join(" ");
    return [{ type: SKIP_ITEM, text, count: skippedWords.length }];
  }

  // Transcript index -> the script words misread there, in script order. A misread no
  // transcript word says (wordIndex -1) is left out.
  function misreadsByWord(misreads) {
    const byWord = new Map();
    listOf(misreads).forEach((misread) => {
      const index = misread ? misread.wordIndex : -1;
      if (Number.isInteger(index) && index >= 0) {
        byWord.set(index, [...(byWord.get(index) || []), String(misread.word)]);
      }
    });
    return byWord;
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

  // The speaker's take saved just before this one, or null. app.store.list() is newest first, so
  // that is the first listed session created earlier that is not a sample. A sample has no last
  // take: it is compared with nothing. A store without list(), or one that cannot be read, means
  // the cards show no comparison, never an error.
  async function loadPreviousSession(session) {
    if (isSample(session) || !app.store || typeof app.store.list !== "function") {
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
      (other) => Boolean(other) && !isSample(other) && other.createdAt < session.createdAt,
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
  // there is a last take, and then one note under the grid), the speech timeline and the
  // transcript (both skipped when the session has no words; pause markers alone would mean
  // nothing), the tips (skipped when there are none), the two actions. The last take is
  // summarized for the comparison only: no tips are chosen for it.
  function renderSession(session, previous) {
    const summary = summarize(session);
    const previousSummary = previous ? summarize(previous) : null;
    const deltas = compareWithPrevious(summary, previousSummary);
    const plan = buildTranscriptPlan(
      session.transcript,
      countedPauses(summary.report),
      restartWords(summary.report),
      { misreads: summary.report.misreads, skips: summary.report.skips },
    );
    const hasTranscript = plan.some((item) => item.type === WORD_ITEM);
    const segments = hasTranscript ? timelineSegments(summary.report) : null;
    const tips = selectTips(summary.report, summary.target);

    app.ui.clear(body);
    body.appendChild(buildMeta(session, summary.timeUsed));
    body.appendChild(buildHeadline(headlineFor(summary, previousSummary), summary.target));
    body.appendChild(buildMetricGrid(summary, deltas));
    if (deltas) {
      body.appendChild(app.ui.el("p", { class: "metric-grid__note", text: DELTA_NOTE }));
    }
    if (segments) {
      body.appendChild(buildTimeline(segments));
    }
    if (hasTranscript) {
      body.appendChild(sectionTitle(TRANSCRIPT_TITLE));
      body.appendChild(buildLegend(summary.topHabit, plan));
      body.appendChild(buildTranscript(plan));
    }
    if (tips.length > 0) {
      body.appendChild(sectionTitle(TIPS_TITLE));
      tips.forEach((tip) => body.appendChild(buildTipCard(tip)));
    }
    body.appendChild(buildActions());
  }

  // The pauses the pauses card counts (mid-sentence, or 5 s+ anywhere), as [at, length] pairs
  // for the transcript, so the transcript, the card and the timeline always show the same pauses.
  function countedPauses(report) {
    return listOf(report.pauses)
      .filter(app.delivery.isCountedPause)
      .map((pause) => [pause.at, pause.length]);
  }

  // The indexes of every word that says a restarted phrase again, for the transcript.
  function restartWords(report) {
    return listOf(report.restarts).flatMap((restart) => listOf(restart.secondCopy));
  }

  // tips.js loads before this file in index.html. Without it (a failed load, or a context that
  // stubs app without tips) the screen simply has no Tips section instead of an error.
  function selectTips(report, target) {
    if (!app.tips || typeof app.tips.select !== "function") {
      return [];
    }
    return app.tips.select(report, { targetWpm: target });
  }

  // What the two highlight styles mean, then the restart, misread and skip styles each when the
  // transcript plan shows one, plus the most-used habit when there is one. The link follows the
  // text after a plain space, which disappears when the link wraps to a new line, so a wrapped
  // link starts flush with the text above it.
  function buildLegend(topHabit, plan) {
    const link = app.ui.el("a", { class: "transcript__how", href: HOW_HREF, text: HOW_LINK_TEXT });
    let text = LEGEND_TEXT;
    if (plan.some((item) => item.restart)) {
      text += LEGEND_RESTART_TEXT;
    }
    if (plan.some((item) => item.misread)) {
      text += LEGEND_MISREAD_TEXT;
    }
    if (plan.some((item) => item.type === SKIP_ITEM)) {
      text += LEGEND_SKIP_TEXT;
    }
    if (topHabit) {
      const times = topHabit.count === 1 ? " time." : " times.";
      text += " Most used: “" + topHabit.text + "”, " + topHabit.count + times;
    }
    return app.ui.el("p", { class: "transcript__legend", text }, [TOKEN_SEPARATOR, link]);
  }

  function sectionTitle(text) {
    return app.ui.el("h2", { class: "results__heading", text });
  }

  // Every item is followed by a space text node, so the words keep their breaks when the
  // paragraph is copied or read aloud and the browser can wrap between any two of them.
  function buildTranscript(plan) {
    const nodes = [];
    plan.forEach((item) => {
      nodes.push(planNode(item));
      nodes.push(TOKEN_SEPARATOR);
    });
    return app.ui.el("p", { class: "transcript" }, nodes);
  }

  function planNode(item) {
    if (item.type === PAUSE_ITEM) {
      return pauseMarker(item.length);
    }
    if (item.type === SKIP_ITEM) {
      return item.count ? skipRunMarker(item) : skippedMarker(item.text);
    }
    return wordToken(item);
  }

  // The label uses the bare word, so "Um," reads as "um, filler word" (DESIGN.md section 6).
  // Each mark adds its class and its part of the label, in this order: filler or habit, restart,
  // misread. So the second "so" of "so so" reads "so, verbal habit, restart", and a misread in a
  // restarted phrase "needs, restart, misread, script says need". A plain word has no label.
  function wordToken(item) {
    const classes = ["tok"];
    let label = normalizeWord(item.text);
    if (item.filler) {
      const habit = item.kind === app.delivery.HABIT;
      classes.push(habit ? "tok--habit" : "tok--filler");
      label += habit ? HABIT_LABEL_SUFFIX : FILLER_LABEL_SUFFIX;
    }
    if (item.restart) {
      classes.push("tok--restart");
      label += RESTART_LABEL_SUFFIX;
    }
    if (item.misread) {
      classes.push("tok--misread");
      label += MISREAD_LABEL_SUFFIX + item.misread;
    }
    if (classes.length === 1) {
      return app.ui.el("span", { class: "tok", text: item.text });
    }
    return app.ui.el("span", { class: classes.join(" "), "aria-label": label, text: item.text });
  }

  // A script word the speaker skipped, struck through where it belonged. Not a .tok: it was
  // never said, so nothing that counts words counts it.
  function skippedMarker(text) {
    return app.ui.el("span", {
      class: "tok--skipped",
      "aria-label": SKIPPED_LABEL_PREFIX + text,
      text,
    });
  }

  // A run of skipped script words as one marker: "50 words skipped:" in --muted, then the run's
  // first and last words struck through. The count is visible text, so a screen reader reads
  // the same words as the eye, with no label to depend on.
  function skipRunMarker(item) {
    return app.ui.el("span", { class: "skip-run" }, [
      app.ui.el("span", { class: "skip-run__count", text: item.count + SKIP_RUN_COUNT_SUFFIX }),
      TOKEN_SEPARATOR,
      app.ui.el("span", { class: "tok--skipped", text: item.text }),
    ]);
  }

  // "2.1 s pause", always one decimal, matching the "x.x s pause" the README asks you to see.
  // A pause of 5 s or more reads "6.0 s long pause" and carries its own outlined style.
  function pauseMarker(length) {
    const value = numberOr0(length);
    const seconds = value.toFixed(1);
    if (app.delivery.isLongPause(value)) {
      return app.ui.el("span", {
        class: "tok--pause tok--pause-long num",
        "aria-label": LONG_PAUSE_LABEL_PREFIX + seconds + PAUSE_LABEL_SUFFIX,
        text: seconds + LONG_PAUSE_TEXT_SUFFIX,
      });
    }
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
      const clock = app.ui.formatClock;
      const text = clock(timeUsed.seconds) + TIME_USED_JOINER + clock(timeUsed.limitSeconds);
      const used = app.ui.el("span", { class: "results__time-used", text });
      parts.push(META_SEPARATOR, used);
    }
    return app.ui.el("p", { class: "results__meta num" }, parts);
  }

  // The strength over the focus. Each icon follows its words in the DOM, so each line's text
  // is exactly its sentence, and CSS draws it first (order: -1). Wherever a sentence names the
  // take's own band it keeps that band on one line, as the Pace hint does; any other "4 to 1"
  // wraps as usual.
  function buildHeadline(headline, target) {
    const band = bandText(target, TARGET_JOINER);
    const unbroken = bandText(target, UNBROKEN_JOINER);
    const draw = (sentence) => sentence.split(band).join(unbroken);
    return app.ui.el("section", { class: "headline" }, [
      headlineLine("headline__strength", draw(headline.strength), STRENGTH_ICON),
      headlineLine("headline__focus", draw(headline.focus), FOCUS_ICON),
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
  // text is exactly the words, and CSS draws it first (order: -1). A pace band ("130 to 160")
  // never splits across lines: the spaces around its "to" do not break.
  function hintLine(hint) {
    const text = hint.text.replace(BAND_SPACES, BAND_UNBROKEN);
    return app.ui.el(
      "div",
      { class: "metric-card__hint metric-card__hint--" + hint.tone, text },
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

  // The speech timeline section: heading, strip, axis, legend and the hidden list of moments.
  function buildTimeline(segments) {
    return app.ui.el("section", { class: "timeline" }, [
      sectionTitle(TIMELINE_TITLE),
      timelineStrip(segments),
      timelineAxis(segments),
      timelineLegend(segments),
      timelineMoments(segments),
    ]);
  }

  // Bottom layer first: the track, the clean-stretch band and its base line, the pause blocks
  // (long ones taller than the track), the restart lines, then the filler ticks on top.
  function timelineStrip(segments) {
    const strip = svgEl("svg", {
      class: "timeline__strip",
      viewBox: "0 0 " + STRIP.width + " " + STRIP.height,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": timelineLabel(segments),
    });
    [
      stripTrack(),
      ...stripCleanStretch(segments.cleanStretch),
      ...segments.pauses.map(stripPause),
      ...segments.restarts.map(stripRestart),
      ...segments.fillers.map(stripFiller),
    ].forEach((mark) => strip.appendChild(mark));
    return strip;
  }

  // The track runs from the first word to the last. Its 1px edge is inset half a unit so the
  // strip's own edge never clips it, and it stays 1px however wide the column is.
  function stripTrack() {
    return svgEl("rect", {
      class: "timeline__track",
      x: "0.5",
      y: coord(STRIP.trackY + 0.5),
      width: coord(STRIP.width - 1),
      height: coord(STRIP.trackHeight - 1),
      rx: String(STRIP.trackRadius),
      fill: STRIP_COLORS.track,
      stroke: STRIP_COLORS.trackEdge,
      "stroke-width": "1",
      "vector-effect": "non-scaling-stroke",
    });
  }

  function stripCleanStretch(cleanStretch) {
    if (!cleanStretch) {
      return [];
    }
    const x = cleanStretch.from * STRIP.width;
    const width = (cleanStretch.to - cleanStretch.from) * STRIP.width;
    const band = [x, STRIP.trackY, width, STRIP.trackHeight];
    const edge = [x, STRIP.trackY + STRIP.trackHeight - STRIP.edgeHeight, width, STRIP.edgeHeight];
    return [
      stripRect("timeline__clean", band, STRIP_COLORS.clean),
      stripRect("timeline__clean-edge", edge, STRIP_COLORS.cleanEdge),
    ];
  }

  // A pause block is as wide as the pause, and never thinner than a filler tick. A long pause
  // stands as tall as a filler tick, past the track, in its own color.
  function stripPause(pause) {
    const x = pause.from * STRIP.width;
    const width = Math.max(STRIP.minBlockWidth, (pause.to - pause.from) * STRIP.width);
    if (pause.long) {
      const box = [x, STRIP.tickY, width, STRIP.tickHeight];
      return stripRect("timeline__long-pause", box, STRIP_COLORS.longPause);
    }
    const box = [x, STRIP.trackY, width, STRIP.trackHeight];
    return stripRect("timeline__pause", box, STRIP_COLORS.pause);
  }

  // A tick is centered on its filler's start and kept inside the strip at either end.
  function stripFiller(filler) {
    const box = [tickX(filler.at, STRIP.tickWidth), STRIP.tickY, STRIP.tickWidth, STRIP.tickHeight];
    return stripRect("timeline__filler", box, STRIP_COLORS.filler);
  }

  // A restart line stands at the start of the abandoned first copy, the full strip tall.
  function stripRestart(restart) {
    const box = [tickX(restart.at, STRIP.restartWidth), 0, STRIP.restartWidth, STRIP.height];
    return stripRect("timeline__restart", box, STRIP_COLORS.restart);
  }

  // The left edge of a mark `width` wide centered on `at`, kept inside the strip.
  function tickX(at, width) {
    return Math.min(STRIP.width - width, Math.max(0, at * STRIP.width - width / 2));
  }

  function stripRect(className, [x, y, width, height], fill) {
    return svgEl("rect", {
      class: className,
      x: coord(x),
      y: coord(y),
      width: coord(width),
      height: coord(height),
      fill,
    });
  }

  // "Speech timeline from 0:01 to 0:32: 11 fillers, 3 mid-sentence pauses, a 4.9 second clean
  // stretch", in the recording-time clock the tips use. A take with long pauses adds "1 long
  // pause" after the mid-sentence count, which then leaves the long ones out.
  function timelineLabel(segments) {
    const from = app.ui.formatClock(segments.start);
    const to = app.ui.formatClock(segments.start + segments.seconds);
    const longCount = segments.pauses.filter((pause) => pause.long).length;
    const shortCount = segments.pauses.length - longCount;
    const parts = [
      countText(segments.fillers.length, "filler", "fillers"),
      countText(shortCount, "mid-sentence pause", "mid-sentence pauses"),
    ];
    if (longCount > 0) {
      parts.push(countText(longCount, "long pause", "long pauses"));
    }
    parts.push(cleanStretchText(segments.cleanStretch));
    return TIMELINE_TITLE + " from " + from + " to " + to + ": " + parts.join(", ");
  }

  // "no fillers", "1 filler", "11 fillers".
  function countText(count, one, many) {
    if (count === 0) {
      return "no " + many;
    }
    return count + " " + (count === 1 ? one : many);
  }

  // "a 4.9 second clean stretch", "an 8 second clean stretch" or "no clean stretch".
  function cleanStretchText(cleanStretch) {
    if (!cleanStretch) {
      return "no clean stretch";
    }
    const seconds = String(cleanStretch.seconds);
    return articleFor(seconds) + " " + seconds + " second clean stretch";
  }

  // "an" for a number said with a leading vowel sound: 8, 11 and 18, eighty and eight hundred.
  function articleFor(numberText) {
    return /^(8|1[18](\.|$))/.test(numberText) ? "an" : "a";
  }

  // The first word, the midpoint and the last word in recording time. Hidden from screen
  // readers: the strip's label already names the range.
  function timelineAxis(segments) {
    const { start, seconds } = segments;
    const times = [start, start + seconds / 2, start + seconds];
    return app.ui.el(
      "div",
      { class: "timeline__axis", "aria-hidden": "true" },
      times.map((time) => app.ui.el("span", { text: app.ui.formatClock(time) })),
    );
  }

  function timelineLegend(segments) {
    const shown = {
      [LONG_PAUSE_KEY]: segments.pauses.some((pause) => pause.long),
      [RESTART_KEY]: segments.restarts.length > 0,
    };
    const keys = LEGEND_KEYS.filter(([kind]) => shown[kind] !== false);
    return app.ui.el(
      "p",
      { class: "timeline__legend" },
      keys.map(([kind, text]) =>
        app.ui.el("span", { class: "timeline__key" }, [
          app.ui.el("span", {
            class: "timeline__swatch timeline__swatch--" + kind,
            "aria-hidden": "true",
          }),
          text,
        ]),
      ),
    );
  }

  // Every moment on the strip as a sentence, in time order, for screen readers.
  function timelineMoments(segments) {
    const clock = app.ui.formatClock;
    const moments = [
      ...segments.fillers.map((filler) => ({
        time: filler.time,
        text: MOMENT.filler(filler.text, clock(filler.time)),
      })),
      ...segments.pauses.map((pause) => ({
        time: pause.time,
        text: (pause.long ? MOMENT.longPause : MOMENT.pause)(
          clock(pause.time),
          pause.seconds.toFixed(1),
        ),
      })),
    ];
    const clean = segments.cleanStretch;
    if (clean) {
      const seconds = secondsText(clean.seconds);
      moments.push({
        time: clean.time,
        text: MOMENT.clean(clock(clean.time), clock(clean.endTime), seconds),
      });
    }
    moments.sort((a, b) => a.time - b.time);
    return app.ui.el(
      "ul",
      { class: "sr-only timeline__moments" },
      moments.map((moment) => app.ui.el("li", { text: moment.text })),
    );
  }

  // SVG elements need their own namespace and take every attribute, class included, through
  // setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  function coord(value) {
    return String(Math.round(value * COORD_SCALE) / COORD_SCALE);
  }

  // The bar CSS keeps stuck above the nav, or at the end of the page on a short or zoomed
  // window: a quiet History, then the screen's one primary button, Record again.
  function buildActions() {
    return app.ui.el("div", { class: "results__actions" }, [
      app.ui.el("button", {
        class: "btn btn--ghost",
        type: "button",
        text: HISTORY_LABEL,
        onClick: () => app.router.go("history"),
      }),
      app.ui.el("button", {
        class: "btn btn--primary",
        type: "button",
        text: RECORD_AGAIN_LABEL,
        onClick: () => app.router.go("practice"),
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
    timelineSegments,
    isSample,
  };
})();
