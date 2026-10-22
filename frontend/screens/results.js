/* screens/results.js: app.screens.results, the screen after a take (DESIGN.md sections 1, 6, 8).
   show({id}) reads the take and the speaker's take before it from app.store, never writing, and
   draws the meta line, the Coach card (app.screens.coachCard), speech map, stat strip, rank card
   (app.rankCard), transcript and actions node by node, never from markup; the
   cited coach notes (app.tips.coachNotes) upgrade the card when they arrive. summarize and
   the other pure helpers touch no DOM or app.ui. */
(function () {
  "use strict";

  // Used when the session's passage is neither in app.passages nor one of its retired ids.
  const DEFAULT_TARGET_WPM = [140, 160];

  // Practice's "See a sample result" saves the bundled take (sample-session.json) under a title
  // that starts with this. It is saved like any session, so History lists it; isSample reads the
  // prefix to keep it out of every comparison.
  const SAMPLE_TITLE_PREFIX = "Sample: ";

  // Stat labels and units (DESIGN.md sections 5 and 6), in display order. Labels stay short so
  // two stats fit side by side at 320px; the units are small text after the number.
  const WPM_LABEL = "Pace";
  const WPM_UNIT = "wpm";
  const FILLERS_LABEL = "Fillers";
  const FILLERS_UNIT = "/min";
  const PAUSES_LABEL = "Pauses";
  const PAUSE_UNIT = "pause";
  const PAUSES_UNIT = "pauses";
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
  const SECONDS_PER_MINUTE = 60;
  const FILLERS_OK = "Target under 3";
  const FILLERS_HIGH = "Aim for under 3";
  const TIME_USED_JOINER = " of ";
  // Pauses hint: how many of the counted pauses ran 5 s or more ("0 over 5 s" is the good news).
  const LONG_PAUSES_SUFFIX = " over 5 s";
  // Clean stretch hint, against the 15 s practice target.
  const CLEAN_OK = "Target 15 s";
  const CLEAN_SHORT = "Aim past 15 s";

  // A hint never relies on color alone: green hints carry a check, rust ones the alert
  // triangle (DESIGN.md sections 4 and 9).
  const HINT_ICONS = { [TONE_OK]: "check", [TONE_WARN]: "alert" };
  const HINT_ICON_SIZE = 16;

  // A pace band ("130 to 160") is drawn with non-breaking spaces around its "to" in the Pace
  // hint, so it never splits across lines.
  const UNBROKEN_JOINER = "\u00a0to\u00a0";
  const BAND_SPACES = /(\d+) to (\d+)/;
  const BAND_UNBROKEN = "$1" + UNBROKEN_JOINER + "$2";

  // A clean stretch under 15 seconds has room to grow (15 clean seconds is the beginners'
  // practice target how.html names): the Clean stretch card's hint.
  const CLEAN_STRETCH_GOAL_SECONDS = 15;

  // "vs last take" lines, one per stat in strip order: the summary key, the stat's precision
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
  // A stat the two takes cannot share keeps its delta row, so the four cells stay level.
  const NONE = "none";
  const NO_CHANGE = "No change";
  const NOT_COMPARED = "Not compared";
  // Hidden endings that finish each line as a sentence for screen readers.
  const THAN_LAST_TAKE = " than your last take";
  const FROM_LAST_TAKE = " from your last take";
  const WITH_LAST_TAKE = " with your last take";
  const DELTA_ICONS = {
    [UP]: "triangle-up",
    [DOWN]: "triangle-down",
    [SAME]: "dash",
    [NONE]: "dash",
  };
  const DELTA_ICON_SIZE = 12;
  const DELTA_NOTE = "Arrows compare with your last take.";

  // The speech map (DESIGN.md section 6): the take's moments as two-line cards stacked in reading
  // order beside a rail that is linear in time. Every card is cardHeight tall with cardGap
  // between two, so the rail is exactly as tall as the stack (no empty rail, however long the
  // take); a moment's dot, diamond or block sits on the rail at its true second and a curve joins
  // it to its card. Fillers within clusterSeconds of the one before, with no other moment
  // between, share one card ("3 fillers"). A card's words start at the moment itself after at most
  // leadWords, so the mark is in view on a 320px phone, and run contextWords past it. A take
  // with more than shownCards moments shows that many until "Show all" is tapped,
  // so a long take never becomes a column of cards. Clocks count from the first word, as the
  // meta line's time used does.
  const MAP_TITLE = "Speech map";
  const MAP = Object.freeze({
    cardHeight: 56,
    cardGap: 8,
    railWidth: 56,
    railX: 24,
    laneX: 40,
    dotRadius: 5,
    blockWidth: 10,
    minBlockHeight: 10,
    clusterSeconds: 5,
    leadWords: 1,
    contextWords: 2,
    restartLeadWords: 0,
    restartContextWords: 1,
    shownCards: 8,
  });
  const MAP_START_TEXT = "First word";
  const MAP_END_TEXT = "Last word";
  const CAP_SEPARATOR = " · ";
  const SHOW_IN_TRANSCRIPT = "Show in transcript";
  const SHOW_ALL = (count) => "Show all " + count + " moments";
  const CHEVRON_ICON = "chevron-right";
  const CHEVRON_SIZE = 16;
  const CLUSTER_JOINER = " · ";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const RAIL_COLORS = Object.freeze({
    line: "var(--border)",
    filler: "var(--filler)",
    pause: "var(--pause)",
    "long-pause": "var(--pause-long)",
    restart: "var(--pause)",
    clean: "var(--ok)",
    cleanFill: "var(--ok-bg)",
  });
  // Row kinds, each a .moment--<kind> modifier and a card label.
  const FILLER_MOMENT = "filler";
  const PAUSE_MOMENT = "pause";
  const LONG_PAUSE_MOMENT = "long-pause";
  const RESTART_MOMENT = "restart";
  const CLEAN_MOMENT = "clean";
  const KIND_SEPARATOR = " · ";
  const MOMENT_LABEL = Object.freeze({
    [FILLER_MOMENT]: (row) => (row.count === 1 ? "Filler" : row.count + " fillers"),
    [PAUSE_MOMENT]: (row) => "Mid-sentence pause" + KIND_SEPARATOR + row.seconds.toFixed(1) + " s",
    [LONG_PAUSE_MOMENT]: (row) => "Long pause" + KIND_SEPARATOR + row.seconds.toFixed(1) + " s",
    [RESTART_MOMENT]: () => "Restart",
    [CLEAN_MOMENT]: (row) => "Clean stretch" + KIND_SEPARATOR + row.seconds.toFixed(1) + " s",
  });
  // The clean stretch has no words to show: its line says what it is.
  const CLEAN_CONTEXT = "No filler, pause or restart.";
  const CONTEXT_ELLIPSIS = "…";
  // The transcript ids the Show in transcript button scrolls to: every word carries one, and
  // every pause marker, numbered in time order.
  const WORD_ID_PREFIX = "word-";
  const PAUSE_ID_PREFIX = "pause-";
  // The mark's flash: its class, how long it stays, and the words said in the live region.
  const SHOWN_CLASS = "tok--shown";
  const SHOWN_MS = 1500;
  const SHOWN_ANNOUNCEMENT = "Shown in transcript.";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

  // Fixed copy for the bad-id state and the two actions (DESIGN.md sections 1 and 8).
  const NOT_FOUND_TITLE = "Session not found";
  const NOT_FOUND_BODY = "It may have been deleted.";
  const NOT_FOUND_ICON = "search";
  const RECORD_AGAIN_LABEL = "Record again";
  const HISTORY_LABEL = "History";
  const META_SEPARATOR = " · ";

  const TRANSCRIPT_TITLE = "Transcript";

  // Said in the live region when the coach notes replace the Coach card's rule content, a swap
  // nothing else would say.
  const NOTES_READY_ANNOUNCEMENT = "Coach notes ready.";
  // The sheet after a take (spec Phase 5 item 6; the design's sheet copy table).
  const SHEET_LABEL = "Coach";
  const SHEET_READING = "Reading your take…";
  const SEE_FULL_RESULTS = "See full results";
  const CHECK_LANGUAGE_LABEL = "Check grammar & vocabulary";
  const AFTER_A_TAKE = Object.freeze({ type: "take" });
  // app.rank rates the newest 10 takes (rank.js RATED_TAKES); the list is newest first.
  const RATED_TAKES = 10;
  // The rank card (docs/PLAN.md T37) is built for this screen: it says what this take did.
  const RANK_SCREEN = "results";

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
  const STUMBLE_LABEL_SUFFIX = ", possible stumble";
  const UNCLEAR_LABEL_SUFFIX = ", may have been unclear";
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
  // The hesitations named are examples: er, ah, hm, uh-huh and mm-hmm are highlighted too.
  const LEGEND_TEXT =
    "Highlighted words are hesitations: um, uh, mhm. Underlined words are verbal habits.";
  // Added only when the transcript marks a restart. Restart words keep plain text with a
  // --pause underline, so they differ from the bold filler-colored habits by more than color.
  const LEGEND_RESTART_TEXT = " Purple underlined words are restarts.";
  // Added only when the transcript marks a pause of 5 s or more.
  const LEGEND_LONG_PAUSE_TEXT = " Pink outlined pills are long pauses of 5 s or more.";
  // Added only when the transcript of a take read from a script shows a misread or a skip.
  const LEGEND_MISREAD_TEXT = " Wavy underlined words are misreads.";
  const LEGEND_SKIP_TEXT = " Struck-through words were skipped.";
  // Added only when the transcript marks a possible stumble (app.delivery.findStumbles).
  const LEGEND_STUMBLE_TEXT =
    " Gray dashed words ran long, maybe a small stumble. A hint only: they are not counted.";
  // Added only when the transcript boxes a word the transcriber was unsure of
  // (app.delivery.findUnclear).
  const LEGEND_UNCLEAR_TEXT = " Dotted boxes: may have been unclear — a hint, not counted.";

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

  // The view of the take on show (viewOf), for startLanguageCheck.
  let currentView = null;

  // The id of the take Practice has just saved and is opening (markFresh), until the next
  // show() uses it up: that take, and only that one, gets the sheet after a take.
  let freshTakeId = null;

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
      slipsPerMinute: slipsPerMinuteOf(report),
      pauseCount: report.pauseCount,
      longestPause: report.longestPause,
      longPauseCount: report.longPauseCount,
      cleanStretchSeconds: report.cleanStretch ? report.cleanStretch.seconds : 0,
      topHabit: report.topHabit,
      target,
      paceHint: paceHintFor(wpm, target),
      fillersHint: fillersHintFor(report.fillersPerMinute),
      pausesHint: pausesHintFor(report.longPauseCount),
      cleanHint: cleanHintFor(report.cleanStretch ? report.cleanStretch.seconds : 0),
      timeUsed: timeUsedFor(session.passageId, report.speakingSeconds),
      report,
    };
  }

  // Read slips a minute, to a tenth, the number Progress charts for takes read aloud in place of
  // fillers: restarts and misread words, as path.js counts a read's slips. A skipped word is not
  // a slip, since a transcript can drop a short word the speaker did say. 0 with no speech.
  function slipsPerMinuteOf(report) {
    const minutes = numberOr0(report.speakingSeconds) / SECONDS_PER_MINUTE;
    if (minutes <= 0) {
      return 0;
    }
    const slips = numberOr0(report.repeatCount) + listOf(report.misreads).length;
    return roundToTenth(slips / minutes);
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  // The entry a take was recorded on: a Practice entry, or a retired id an old take still
  // carries (app.passages.retired(): its band and time limit only), so an old take keeps the
  // band and limit it was recorded under. Null for an id that is neither.
  function passageFor(passageId) {
    const passages = app.passages || [];
    const retired = typeof passages.retired === "function" ? passages.retired() : [];
    const known = Array.from(passages).concat(Array.from(retired));
    return known.find((entry) => entry.id === passageId) || null;
  }

  // A copy of the passage's [lo, hi] target, or the default when the passage is unknown.
  function targetFor(passageId) {
    const passage = passageFor(passageId);
    const known = passage && Array.isArray(passage.targetWpm);
    const range = known ? passage.targetWpm : DEFAULT_TARGET_WPM;
    return [range[0], range[1]];
  }

  function fillersHintFor(fillersPerMinute) {
    return fillersPerMinute > MAX_FILLERS_PER_MINUTE
      ? { text: FILLERS_HIGH, tone: TONE_WARN }
      : { text: FILLERS_OK, tone: TONE_OK };
  }

  // "0 over 5 s" in green, "1 over 5 s" in rust: the freezes among the counted pauses.
  function pausesHintFor(longPauseCount) {
    const count = numberOr0(longPauseCount);
    return { text: count + LONG_PAUSES_SUFFIX, tone: count > 0 ? TONE_WARN : TONE_OK };
  }

  // "Target 15 s" once the clean stretch reaches the practice target, "Aim past 15 s" before.
  function cleanHintFor(cleanStretchSeconds) {
    return cleanStretchSeconds >= CLEAN_STRETCH_GOAL_SECONDS
      ? { text: CLEAN_OK, tone: TONE_OK }
      : { text: CLEAN_SHORT, tone: TONE_WARN };
  }

  // {seconds, limitSeconds} for a preset with a time limit, else null. Seconds, not clock text,
  // so summarize never needs app.ui; the meta line prints it as "2:41 of 3:00".
  function timeUsedFor(passageId, speakingSeconds) {
    const passage = passageFor(passageId);
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

  // True for the bundled sample: History lists it, but it is not one of the speaker's takes, so
  // no comparison on this screen and nothing on Progress ever uses it. Pure.
  function isSample(session) {
    const title = session ? session.passageTitle : undefined;
    return typeof title === "string" && title.startsWith(SAMPLE_TITLE_PREFIX);
  }

  // True for a take read aloud (app.language.isReadTake), which never sets the rank's tier.
  // Without language.js every take counts as talk, as before the rule.
  function isReadTake(session) {
    const language = app.language;
    return (
      Boolean(language) && typeof language.isReadTake === "function" && language.isReadTake(session)
    );
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

  // The speech map's rows for a report and the take's words: every moment in time order with its
  // card and rail geometry, or null when the take has no timeline. `limit` (default every row)
  // is how many cards are shown: the rest stay on the rail as marks without a card. Returns
  // {height, shown, rows}: `shown` the cards shown, `height` their stack's, and the rail's, in
  // pixels (cardHeight a card, cardGap between two); a row is {kind, time, at, seconds, index,
  // cardTop, cardMid, railY, railEnd, context, target}: `kind` one of filler, pause, long-pause,
  // restart or clean; `time` its recording-time start and `at` the same counted from the first
  // word, the clock the cards show; `seconds` how long it holds the rail (0 for a filler or a
  // restart); `index` its place in the stack; `cardTop` and `cardMid` its card's top and middle
  // in the stack (null past `limit`); `railY` its second on the rail (linear in time, 0 the first
  // word and `height` the last) and `railEnd` where a pause or the clean stretch ends there (at
  // least minBlockHeight below railY, never past the rail); `context` the words around it,
  // {before, after, tokens: [{text, mark}]} with `mark` null or the moment's kind, cut to
  // leadWords before and contextWords after (restartLeadWords and restartContextWords for a
  // restart) with `before` and `after` true where words were cut, or for a cluster its fillers
  // alone, every one marked, with `cluster`
  // true; `target` the transcript id the card scrolls to. A filler row adds `words` (every
  // filler in its cluster, in order), `count` and `lastTime`; a pause row `afterWord`, the word
  // the pause followed (null before the first word), and `pauseIndex`, its place among the
  // counted pauses; a restart row `phrase`, the words from the abandoned first copy through its
  // second copy ("I kinda ner— I'm kinda nervous"), or the repeat's own text when the copy was
  // not found; the clean row `endTime` (and `endAt`) and no context. Pure.
  function speechMapRows(report, words, limit = Infinity) {
    const segments = timelineSegments(report);
    if (!segments) {
      return null;
    }
    const wordList = Array.isArray(words) ? words : [];
    const counted = listOf(report.pauses).filter(app.delivery.isCountedPause);
    const moments = [
      ...listOf(report.fillers).map((filler) => ({
        kind: FILLER_MOMENT,
        time: filler.start,
        seconds: 0,
        words: [filler.text],
        count: 1,
        lastTime: filler.start,
        wordIndexes: fillerWordIndexes(wordList, filler),
      })),
      ...counted.map((pause, pauseIndex) => ({
        kind: pause.long ? LONG_PAUSE_MOMENT : PAUSE_MOMENT,
        time: pause.at,
        seconds: pause.length,
        afterWord: wordBefore(wordList, pause.at, pause.length),
        afterIndex: app.delivery.wordBeforePause(wordList, pause.at, pause.length),
        pauseIndex,
      })),
      ...listOf(report.restarts).map((restart) => ({
        kind: RESTART_MOMENT,
        time: restart.at,
        seconds: 0,
        ...restartSpan(wordList, restart),
      })),
    ];
    if (segments.cleanStretch) {
      const clean = report.cleanStretch;
      moments.push({
        kind: CLEAN_MOMENT,
        time: clean.start,
        seconds: clean.seconds,
        endTime: clean.end,
        firstIndex: wordAt(wordList, clean.start),
      });
    }
    moments.sort((a, b) => a.time - b.time);
    const clustered = [];
    moments.forEach((moment) => {
      const last = clustered[clustered.length - 1];
      if (last && joinsCluster(last, moment)) {
        last.words.push(moment.words[0]);
        last.count += 1;
        last.lastTime = moment.time;
        last.wordIndexes = last.wordIndexes.concat(moment.wordIndexes);
        return;
      }
      clustered.push(moment);
    });
    const shown = Math.min(clustered.length, Math.max(0, limit));
    const height = stackHeight(shown);
    const railY = (time) =>
      coordinate(clamp01((time - segments.start) / segments.seconds) * height);
    const rows = clustered.map((moment, index) => {
      const top = index < shown ? index * (MAP.cardHeight + MAP.cardGap) : null;
      const y = railY(moment.time);
      const row = {
        ...moment,
        at: roundToTenth(moment.time - segments.start),
        endAt:
          moment.endTime === undefined ? undefined : roundToTenth(moment.endTime - segments.start),
        index,
        cardTop: top,
        cardMid: top === null ? null : top + MAP.cardHeight / 2,
        railY: y,
        railEnd: moment.seconds > 0 ? railEndFor(y, railY(spanEnd(moment)), height) : y,
        context: contextFor(wordList, moment),
        target: transcriptTargetFor(moment),
      };
      delete row.wordIndexes;
      delete row.afterIndex;
      delete row.firstIndex;
      delete row.copyFirst;
      delete row.copyLast;
      delete row.markIndex;
      if (row.endAt === undefined) {
        delete row.endAt;
      }
      return row;
    });
    return { height, shown, rows };
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  // When a span moment ends: the clean stretch's own end time (its seconds are rounded), or the
  // pause's start plus its length.
  function spanEnd(moment) {
    return moment.endTime === undefined ? moment.time + moment.seconds : moment.endTime;
  }

  // The stack of `count` cards with a gap between two; a take with no moment has no stack.
  function stackHeight(count) {
    return count === 0 ? 0 : count * MAP.cardHeight + (count - 1) * MAP.cardGap;
  }

  // A block's end: at least minBlockHeight below its start, never past the rail's end.
  function railEndFor(start, end, height) {
    return coordinate(Math.min(height, Math.max(end, start + MAP.minBlockHeight)));
  }

  // Rail positions keep one decimal: a tenth of a pixel is below what the eye can see.
  function coordinate(value) {
    return Math.round(value * 10) / 10;
  }

  // A filler joins the filler row before it when it starts within clusterSeconds of that row's
  // last filler. Rows are built in time order, so any other moment between them is the row
  // before instead.
  function joinsCluster(row, moment) {
    if (row.kind !== FILLER_MOMENT || moment.kind !== FILLER_MOMENT) {
      return false;
    }
    return moment.time - row.lastTime <= MAP.clusterSeconds + MILLISECOND;
  }

  // The transcript indexes a filler event covers: its word, and the next for "you know".
  function fillerWordIndexes(wordList, filler) {
    const indexes = [filler.index];
    if (String(filler.text).includes(TOKEN_SEPARATOR) && filler.index + 1 < wordList.length) {
      indexes.push(filler.index + 1);
    }
    return indexes.filter((index) => Number.isInteger(index) && index >= 0);
  }

  // The word a pause followed (app.delivery's own placing), bare of its punctuation ("sad." is
  // “sad”), or null before the first word.
  function wordBefore(wordList, at, length) {
    const index = app.delivery.wordBeforePause(wordList, at, length);
    return index >= 0 && index < wordList.length ? bareText(textOf(wordList[index])) : null;
  }

  // Text without punctuation at either end, its case kept: "I," reads “I”.
  function bareText(text) {
    return String(text || "").replace(EDGE_PUNCTUATION, "");
  }

  // The index of the first word starting at `time` or after, or -1.
  function wordAt(wordList, time) {
    return wordList.findIndex((word) => numberOr0(word && word.start) >= time - MILLISECOND);
  }

  // A restart's words: {phrase, copyFirst, copyLast, markIndex}, the phrase "I kinda ner— I'm
  // kinda nervous" running from the first word at the repeat's `at` (copyFirst) through the last
  // word of the second copy (copyLast; the report's `secondCopy` indexes, whose first is
  // markIndex, the word the transcript marks first), bare of the punctuation at its ends ("and
  // I, uh, and I" loses its last comma). Without a second copy, the repeat's text as the backend
  // gave it and the word at `at` alone.
  function restartSpan(wordList, restart) {
    const copy = listOf(restart.secondCopy);
    const first = wordAt(wordList, restart.at);
    const last = copy.length > 0 ? Math.max(...copy) : -1;
    if (first === -1 || last < first || last >= wordList.length) {
      const phrase = String(restart.text || "");
      return { phrase, copyFirst: first, copyLast: first, markIndex: first };
    }
    return {
      phrase: bareText(wordList.slice(first, last + 1).map(textOf).join(TOKEN_SEPARATOR)),
      copyFirst: first,
      copyLast: last,
      markIndex: Math.min(...copy),
    };
  }

  // The words around a moment, marked where they are the moment: a filler's word, the pause
  // itself as "5.2 s" after the word it followed, or the restarted phrase; leadWords plain words
  // before and contextWords after (restartLeadWords, none, and restartContextWords for a restart,
  // whose phrase is long already), so the mark starts the line on a narrow phone. A cluster of
  // fillers shows its fillers alone ("um · um · mhm"), and a restart with no word at its `at`
  // its phrase alone, unmarked. Null for the clean stretch.
  function contextFor(wordList, moment) {
    if (moment.kind === CLEAN_MOMENT) {
      return null;
    }
    const plain = (from, to) =>
      wordList.slice(Math.max(0, from), Math.max(0, to)).map((word) => ({
        text: textOf(word),
        mark: null,
      }));
    if (moment.kind === FILLER_MOMENT && moment.count > 1) {
      return {
        before: false,
        after: false,
        cluster: true,
        tokens: moment.words.map((text) => ({ text, mark: FILLER_MOMENT })),
      };
    }
    if (moment.kind === FILLER_MOMENT) {
      const marked = new Set(moment.wordIndexes);
      const first = Math.min(...marked);
      const last = Math.max(...marked);
      const inside = wordList.slice(first, last + 1).map((word, offset) => ({
        text: textOf(word),
        mark: marked.has(first + offset) ? FILLER_MOMENT : null,
      }));
      return contextAround(wordList, plain, first, last, inside, MAP.leadWords, MAP.contextWords);
    }
    if (moment.kind === RESTART_MOMENT && moment.copyFirst === -1) {
      return { before: false, after: false, tokens: [{ text: moment.phrase, mark: null }] };
    }
    if (moment.kind === RESTART_MOMENT) {
      const inside = wordList
        .slice(moment.copyFirst, moment.copyLast + 1)
        .map((word) => ({ text: textOf(word), mark: RESTART_MOMENT }));
      return contextAround(
        wordList,
        plain,
        moment.copyFirst,
        moment.copyLast,
        inside,
        MAP.restartLeadWords,
        MAP.restartContextWords,
      );
    }
    const pauseToken = { text: moment.seconds.toFixed(1) + " s", mark: moment.kind };
    const index = moment.afterIndex;
    const pause = [pauseToken];
    return contextAround(wordList, plain, index + 1, index, pause, MAP.leadWords, MAP.contextWords);
  }

  // `inside` (the moment's own tokens, at word indexes first..last) with `lead` plain words
  // before and `count` after; `before` and `after` say whether the take went on past the cut.
  function contextAround(wordList, plain, first, last, inside, lead, count) {
    const from = first - lead;
    const to = last + 1 + count;
    return {
      before: from > 0,
      after: to < wordList.length,
      tokens: [...plain(from, first), ...inside, ...plain(last + 1, to)],
    };
  }

  // Where the card's button scrolls: the moment's first word, the pause marker, the first word
  // of the restart's second copy (the one the transcript marks), or the clean stretch's first.
  function transcriptTargetFor(moment) {
    if (moment.kind === PAUSE_MOMENT || moment.kind === LONG_PAUSE_MOMENT) {
      return PAUSE_ID_PREFIX + moment.pauseIndex;
    }
    if (moment.kind === FILLER_MOMENT) {
      return WORD_ID_PREFIX + Math.min(...moment.wordIndexes);
    }
    if (moment.kind === RESTART_MOMENT) {
      return moment.markIndex >= 0 ? WORD_ID_PREFIX + moment.markIndex : null;
    }
    return moment.firstIndex >= 0 ? WORD_ID_PREFIX + moment.firstIndex : null;
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

  function normalizeWord(text) {
    return bareText(text).toLowerCase();
  }

  // The transcript as a list of items to draw, in reading order: {type: "word", text, filler}
  // for every backend word and {type: "pause", length} for every [at, length] in `pauses`
  // (Results passes only the pauses the card counts: mid-sentence, or 5 s+ anywhere). A pause
  // goes right after the word app.delivery judged it by (wordBeforePause): the last word that
  // has ended by `at` or is still going then; when there is none it goes before the first
  // word. A word whose index is in `restartWords` (the second copies of the report's
  // restarts) also gets `restart: true`; any other word app.delivery.findStumbles finds gets
  // `stumble: true`, a hint that counts nowhere. `scriptSlips` (optional) holds
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
    const stumbles = new Set(app.delivery.findStumbles(wordList));
    const unclear = new Set(unclearIndexes(wordList));

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
      const slot = app.delivery.wordBeforePause(wordList, numberOr0(at), numberOr0(length)) + 1;
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
      } else if (stumbles.has(index)) {
        item.stumble = true;
      }
      if (misreadWords.has(index)) {
        item.misread = misreadWords.get(index).join(" ");
      }
      if (unclear.has(index) && !item.filler) {
        item.unclear = true;
      }
      plan.push(item);
      plan.push(...slots[index + 1]);
    });
    return plan;
  }

  // The words app.delivery.findUnclear hints at (a delivery.js without it hints none).
  function unclearIndexes(wordList) {
    return typeof app.delivery.findUnclear === "function" ? app.delivery.findUnclear(wordList) : [];
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

  // Index of the last word whose end is at or before `at`, or -1 when none has ended yet. Skips
  // go by it: a skip's `at` is the end of the word said before it, so a next word that starts
  // early never pulls the skip past it.
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

  // The take is drawn as soon as app.store.get() has it, with no comparison: the Coach card
  // shows the rule takeaway and rule tips at once, with "Writing notes on this take…". Its last
  // take, which only the "vs last take" lines need, comes from app.store.list(), and the list can
  // take a moment; once that take is found, the screen is drawn again with the comparison. The
  // same list rates the takes up to this one for the rank card, which joins that second draw (a
  // first take, with no comparison, is drawn again for its card alone), and gives the speaker's
  // tier for the coach notes, which are asked for last and, when they come, upgrade the Coach card
  // in a third draw; when none come, the card's status goes and its rule content stays. A take
  // Practice just saved (markFresh) also gets the sheet after a take, once the list is in, with
  // the rule line at once and Claude's headline from the same notes. A ticket check before each
  // draw means a slow earlier visit can never paint over a newer one, whichever read is the slow
  // one, and a take the speaker has left (hide) asks for no notes and draws none.
  async function show(params) {
    const ticket = ++showCount;
    const fresh = takeFresh(params && params.id);
    const session = await loadSession(params && params.id);
    if (ticket !== showCount) {
      return;
    }
    if (session === undefined) {
      renderNotFound();
      return;
    }
    const view = viewOf(session);
    view.isCurrent = () => ticket === showCount;
    currentView = view;
    renderSession(session, view, null);
    const sessions = await loadSessions();
    if (ticket !== showCount) {
      return;
    }
    const previous = previousOf(session, sessions);
    view.rankCard = rankCardFor(session, sessions);
    if (previous !== null || view.rankCard !== null) {
      renderSession(session, view, previous);
    }
    // A take that carries its notes (the bundled sample) has nothing to ask for.
    const asked =
      view.notes !== null ? Promise.resolve(null) : loadCoachNotes(session, view.summary, sessions);
    const sheet =
      fresh && !isSample(session) ? await openTakeSheetSafely(session, view, sessions) : null;
    const notes = await asked;
    if (ticket !== showCount) {
      return;
    }
    view.notesPending = false;
    if (notes !== null) {
      view.notes = notes;
      drawNotes(session, view, previous);
    } else if (view.coachCard) {
      view.coachCard.clearStatus();
    }
    if (sheet) {
      try {
        upgradeSheet(sheet, view);
      } catch {
        // The card already holds the notes; a sheet that cannot take them keeps its rule line.
      }
    }
  }

  // Practice calls this with the id of the take it just saved, right before it opens Results
  // for it, so that take gets the sheet after a take. Samples and takes opened again (from
  // History, a reload) never come through here.
  function markFresh(id) {
    freshTakeId = id === undefined || id === null ? null : String(id);
  }

  // True when `id` is the take just marked fresh. Any show() uses the mark up.
  function takeFresh(id) {
    const fresh = freshTakeId !== null && freshTakeId === String(id);
    freshTakeId = null;
    return fresh;
  }

  // The sheet after a take (app.sheet): the coach's rule line about this take at once, with
  // "Reading your take…", the one next move app.nextMove picks from the saved takes (this one
  // included) and the cleared levels, "See full results", and for a take the grammar check fits,
  // "Check grammar & vocabulary". Null, and no sheet, while sheet.js, nextmove.js or coach.js is
  // not loaded, or once the speaker has left.
  async function openTakeSheet(session, view, sessions) {
    const loaded =
      app.sheet &&
      typeof app.sheet.open === "function" &&
      typeof app.nextMove === "function" &&
      view.takeaway;
    if (!loaded) {
      return null;
    }
    const cleared = await loadCleared();
    if (!view.isCurrent()) {
      return null;
    }
    let move = null;
    try {
      move = app.nextMove({ history: sessions, cleared, today: today(), after: AFTER_A_TAKE });
    } catch {
      return null;
    }
    const options = {
      label: SHEET_LABEL,
      line: sheetLine(view.takeaway, view.moments),
      why: move.why,
      status: { kind: "loading", text: SHEET_READING },
      primary: {
        label: move.label,
        icon: "arrow-right",
        onSelect: () => app.nextMove.go(move.href),
      },
      secondary: { label: SEE_FULL_RESULTS },
    };
    const language = app.language;
    if (language && typeof language.canCheck === "function" && language.canCheck(session)) {
      options.extra = {
        label: CHECK_LANGUAGE_LABEL,
        icon: "text-check",
        onSelect: startLanguageCheck,
      };
    }
    return app.sheet.open(options);
  }

  // The sheet is extra to the take's results: one that throws while it opens is left out, so the
  // Coach card still gets its notes and its "Writing notes on this take…" status still goes.
  async function openTakeSheetSafely(session, view, sessions) {
    try {
      return await openTakeSheet(session, view, sessions);
    } catch {
      return null;
    }
  }

  // Claude's headline in the sheet's line once the notes are in; without one, the rule line
  // stays and only the "Reading your take…" status goes.
  function upgradeSheet(sheet, view) {
    const headline = view.notes ? view.notes.headline : null;
    if (headline) {
      sheet.update(sheetLine(headline, view.moments));
    } else {
      sheet.clearStatus();
    }
  }

  // The coach's line as the sheet's parts: its quoted words in the mark of the moment it names.
  function sheetLine(headline, moments) {
    return app.sheet.lineParts(headline, moments);
  }

  // The cleared Path records (app.store.listClearedLevels), or [] from a store without them.
  async function loadCleared() {
    if (!app.store || typeof app.store.listClearedLevels !== "function") {
      return [];
    }
    try {
      const cleared = await app.store.listClearedLevels();
      return Array.isArray(cleared) ? cleared : [];
    } catch {
      return [];
    }
  }

  // The local day ("YYYY-MM-DD") app.nextMove counts check-backs and attempts from.
  function today() {
    return app.path && typeof app.path.localDay === "function"
      ? app.path.localDay(new Date())
      : null;
  }

  // Runs the grammar check of the take on show from outside its Coach card (the sheet's "Check
  // grammar & vocabulary" link): the card scrolls into view, and focus goes to the result.
  function startLanguageCheck() {
    const card = currentView && currentView.coachCard;
    if (!card) {
      return;
    }
    if (typeof card.node.scrollIntoView === "function") {
      const behavior = prefersReducedMotion() ? "auto" : "smooth";
      card.node.scrollIntoView({ block: "start", behavior });
    }
    card.startCheck(true);
  }

  // Show all: the map is drawn again with every card, and focus moves to the first card the tap
  // revealed, so a keyboard carries on from there instead of falling to the page; when that
  // card is a still one (nothing to press), focus goes to the map's heading instead.
  function expandMap(session, view, previous) {
    view.mapExpanded = true;
    revealedCard = null;
    mapHeading = null;
    renderSession(session, view, previous);
    if (revealedCard && revealedIsButton) {
      focusIfPossible(revealedCard);
    } else if (mapHeading) {
      mapHeading.setAttribute("tabindex", "-1");
      focusIfPossible(mapHeading);
    }
  }

  // The first card past the collapsed count (and whether it is a button, decided where it is
  // built: a tag name's case differs between browsers and test fakes) and the map's heading,
  // set while the expanded map is built.
  let revealedCard = null;
  let revealedIsButton = false;
  let mapHeading = null;

  // The third draw, with the coach notes in the Coach card. Like every draw it rebuilds the
  // body, so a link or button the speaker was on inside it is gone: focus then moves to the
  // Coach heading, where the next Tab carries on, instead of falling to the page. Focus
  // anywhere else (the h1, the nav, an open sheet) stays put. Either way the live region says the
  // notes are ready, since the card changes under the speaker without a sound.
  function drawNotes(session, view, previous) {
    const focusWasInBody = holdsFocus(body);
    const heading = renderSession(session, view, previous);
    if (focusWasInBody) {
      focusIfPossible(heading);
    }
    app.ui.announce(NOTES_READY_ANNOUNCEMENT);
  }

  // True when keyboard focus sits on `node` or inside it. Some test fakes have no activeElement,
  // and some have no contains().
  function holdsFocus(node) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || !node || typeof node.contains !== "function") {
      return false;
    }
    return node.contains(active);
  }

  // Moves keyboard focus when the node can take it; the test fakes may have no focus().
  function focusIfPossible(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
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

  // Every take app.store.list() knows, newest first, or [] from a store without list() or one
  // that cannot be read: then the cards show no comparison and the notes are asked for as a
  // Novice's, never an error.
  async function loadSessions() {
    if (!app.store || typeof app.store.list !== "function") {
      return [];
    }
    try {
      const sessions = await app.store.list();
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  // The speaker's take saved just before this one, or null: the first listed session created
  // earlier that is not a sample. A sample has no last take: it is compared with nothing.
  function previousOf(session, sessions) {
    if (isSample(session)) {
      return null;
    }
    const earlier = sessions.find(
      (other) => Boolean(other) && !isSample(other) && other.createdAt < session.createdAt,
    );
    return earlier || null;
  }

  // The notes a take carries under `coachNotes` (the bundled sample, sample-session.json), read
  // as tips.js reads a reply, or null: a recorded take has none, and a field that does not
  // parse is treated as none.
  function bundledNotes(session) {
    const tips = app.tips;
    if (!session || !session.coachNotes || !tips || typeof tips.parseCoachNotes !== "function") {
      return null;
    }
    try {
      return tips.parseCoachNotes(session.coachNotes);
    } catch {
      return null;
    }
  }

  // The coach notes for the take (tips.js coachNotes), or null: tips.js loads before this file,
  // but a context without it, or without its notes, simply keeps the tips.
  async function loadCoachNotes(session, summary, sessions) {
    if (!app.tips || typeof app.tips.coachNotes !== "function") {
      return null;
    }
    try {
      const notes = await app.tips.coachNotes(
        session,
        summary.report,
        summary.target,
        tierFor(sessions),
      );
      return notes || null;
    } catch {
      return null;
    }
  }

  // The speaker's rank tier for the notes request, from app.rank over their newest talk takes
  // (samples and takes read aloud left out, as the rank card leaves them out; each scored as
  // rank.js scores one), or app.tips.DEFAULT_TIER, the server's own default, while rank.js is not
  // loaded or a take cannot be scored. Only loadCoachNotes asks, once app.tips is known to be
  // loaded.
  function tierFor(sessions) {
    const rank = app.rank;
    const loaded =
      rank &&
      typeof rank.takeScore === "function" &&
      typeof rank.rating === "function" &&
      typeof rank.tier === "function";
    if (!loaded) {
      return app.tips.DEFAULT_TIER;
    }
    try {
      const history = sessions
        .filter((take) => Boolean(take) && !isSample(take) && !isReadTake(take))
        .slice(0, RATED_TAKES)
        .map((take) => {
          const summary = summarize(take);
          return {
            createdAt: take.createdAt,
            score: rank.takeScore(summary.report, summary.target),
            speakingSeconds: summary.report.speakingSeconds,
            longPauseCount: summary.report.longPauseCount,
          };
        });
      return rank.tier(rank.rating(history), history);
    } catch {
      return app.tips.DEFAULT_TIER;
    }
  }

  // The rank card's model for this take, computed from the takes up to and including it, or
  // null: for a sample (the card counts none), or while rank.js or rankcard.js is not loaded,
  // when Results draws as it did before the card. The card is extra to the take's numbers, so
  // one that cannot be worked out never stops the screen.
  function rankCardFor(session, sessions) {
    const rankCard = app.rankCard;
    if (!rankCard || typeof rankCard.model !== "function" || typeof rankCard.build !== "function") {
      return null;
    }
    try {
      return rankCard.model(sessions, { screen: RANK_SCREEN, takeId: session.id });
    } catch {
      return null;
    }
  }

  // Leaving the screen ends the visit: a draw still on its way (the comparison, the coach notes)
  // is dropped, so a hidden screen is never redrawn and never announces over another one.
  // Nothing else to release: show() rebuilds the body from the stored session every time.
  function hide() {
    showCount += 1;
    currentView = null;
  }

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

  // What the screen draws for one take, worked out once per show() however often the take is
  // drawn: its summary, transcript plan, speech map (null without words), rule tips and the
  // coach's moments and rule takeaway (app.coach; none while coach.js is not loaded).
  function viewOf(session) {
    const summary = summarize(session);
    const plan = buildTranscriptPlan(
      session.transcript,
      countedPauses(summary.report),
      restartWords(summary.report),
      { misreads: summary.report.misreads, skips: summary.report.skips },
    );
    const hasTranscript = plan.some((item) => item.type === WORD_ITEM);
    const moments = momentsOf(summary.report, session.transcript);
    const takeaway = takeawayOf(moments, summary.report);
    const bundled = bundledNotes(session);
    return {
      summary,
      plan,
      hasTranscript,
      map: hasTranscript ? speechMapRows(summary.report, session.transcript) : null,
      // Set once Show all is tapped: the map then shows every card, not its first shownCards.
      mapExpanded: false,
      tips: selectTips(summary.report, summary.target, headlineKindOf(takeaway, moments)),
      moments,
      takeaway,
      // The coach notes: the take's own (the bundled sample ships them), else set by show()
      // once they arrive, and whether they may still come.
      notes: bundled,
      notesPending:
        bundled === null && Boolean(app.tips) && typeof app.tips.coachNotes === "function",
      // The Coach card's state across draws (its open tip and grammar check), and the card
      // drawn last.
      coachState: {},
      coachCard: null,
      // The rank card's model, set by show() once the store's list has rated the take.
      rankCard: null,
    };
  }

  // Top to bottom: meta line, the Coach card (when coachcard.js is loaded), the speech map
  // (skipped when the session has no words; pause markers alone would mean nothing), the stat
  // strip (each stat with its "vs last take" line when there is a last take, and then one note
  // under the strip), the rank card once the store's list has rated the take, words to check and
  // the transcript (both skipped without words too), the action bar. `previous` is the last
  // take, or null while there is none to compare with; it is summarized for the comparison only.
  // Returns the Coach heading, or null without a card.
  function renderSession(session, view, previous) {
    const { summary, plan, hasTranscript, map, rankCard } = view;
    const previousSummary = previous ? summarize(previous) : null;
    const deltas = compareWithPrevious(summary, previousSummary);

    app.ui.clear(body);
    body.appendChild(buildMeta(session, summary.timeUsed));
    view.coachCard = buildCoachCard(session, view);
    if (view.coachCard) {
      body.appendChild(view.coachCard.node);
    }
    if (map) {
      const shownMap = view.mapExpanded
        ? map
        : speechMapRows(summary.report, session.transcript, MAP.shownCards);
      const expand = () => expandMap(session, view, previous);
      body.appendChild(buildSpeechMap(shownMap, timelineSegments(summary.report), expand));
    }
    body.appendChild(buildStatStrip(summary, deltas));
    if (deltas) {
      body.appendChild(app.ui.el("p", { class: "stat-strip__note", text: DELTA_NOTE }));
    }
    if (rankCard) {
      body.appendChild(app.rankCard.build(rankCard, { screen: RANK_SCREEN }));
    }
    if (hasTranscript) {
      body.appendChild(
        app.ui.el("h2", { class: "results__heading transcript__heading", text: TRANSCRIPT_TITLE }),
      );
      body.appendChild(buildLegend(summary.topHabit, plan));
      body.appendChild(buildTranscript(plan));
    }
    body.appendChild(buildActions());
    return view.coachCard ? view.coachCard.heading : null;
  }

  // The Coach card for this draw (app.screens.coachCard), or null while coachcard.js is not
  // loaded or the coach has nothing to say: Results then draws without it. A card that cannot
  // be built never stops the screen.
  function buildCoachCard(session, view) {
    const coachCard = app.screens.coachCard;
    if (!coachCard || typeof coachCard.build !== "function") {
      return null;
    }
    const { summary } = view;
    const targets = momentTargets(summary.report, session.transcript, view.moments);
    try {
      return coachCard.build({
        session,
        moments: view.moments,
        takeaway: view.takeaway,
        ruleTips: view.tips,
        topHabit: summary.topHabit,
        notes: view.notes,
        seconds: summary.report.speakingSeconds,
        pending: view.notesPending,
        targetOf: (id) => targets.get(id) || null,
        onShowMoment: showInTranscript,
        isCurrent: view.isCurrent,
        state: view.coachState,
      });
    } catch {
      return null;
    }
  }

  // The take's moments for the coach (app.coach.coachMoments), or [] while coach.js is not
  // loaded or cannot read the take.
  function momentsOf(report, words) {
    try {
      return app.coach && typeof app.coach.coachMoments === "function"
        ? app.coach.coachMoments(report, words)
        : [];
    } catch {
      return [];
    }
  }

  // The coach's rule line for the take ({text, momentId}), or null without app.coach.
  function takeawayOf(moments, report) {
    try {
      return app.coach && typeof app.coach.coachTakeaway === "function"
        ? app.coach.coachTakeaway(moments, report)
        : null;
    } catch {
      return null;
    }
  }

  // Moment id -> the transcript id its chip scrolls to ("word-12", "pause-0"), for `moments` as
  // app.coach lists them: kind-n is the n-th of its kind in time order, so the same list in the
  // same order is read here (a skip has no mark, so none). Pure.
  function momentTargets(report, words, moments) {
    const wordList = Array.isArray(words) ? words : [];
    const byTime = (list, timeOf) =>
      list
        .map((item, order) => ({ item, order }))
        .sort((a, b) => timeOf(a.item) - timeOf(b.item) || a.order - b.order)
        .map((entry) => entry.item);
    const wordTarget = (index) =>
      Number.isInteger(index) && index >= 0 ? WORD_ID_PREFIX + index : null;
    const counted = listOf(report && report.pauses)
      .filter(app.delivery.isCountedPause)
      .map((pause, pauseIndex) => ({ pause, pauseIndex }));
    const lists = {
      filler: byTime(listOf(report && report.fillers), (filler) => numberOr0(filler.start)).map(
        (filler) => wordTarget(filler.index),
      ),
      pause: byTime(
        counted.filter((entry) => !entry.pause.long),
        (entry) => entry.pause.at,
      ).map((entry) => PAUSE_ID_PREFIX + entry.pauseIndex),
      "long-pause": byTime(
        counted.filter((entry) => entry.pause.long),
        (entry) => entry.pause.at,
      ).map((entry) => PAUSE_ID_PREFIX + entry.pauseIndex),
      restart: byTime(listOf(report && report.restarts), (restart) => restart.at).map((restart) =>
        wordTarget(restartSpan(wordList, restart).markIndex),
      ),
      misread: byTime(listOf(report && report.misreads), (misread) => misread.at).map((misread) =>
        wordTarget(misread.wordIndex),
      ),
      stumble: byIndexTime(wordList, app.delivery.findStumbles(wordList)).map(wordTarget),
      unclear: byIndexTime(wordList, unclearIndexes(wordList)).map(wordTarget),
    };
    const targets = new Map();
    listOf(moments).forEach((moment) => {
      const number = Number(String(moment && moment.id).split("-").pop());
      const list = lists[moment && moment.kind];
      const target = list && Number.isInteger(number) ? list[number - 1] : null;
      if (target) {
        targets.set(moment.id, target);
      }
    });
    return targets;
  }

  // Word indexes in the order of their words' start times.
  function byIndexTime(wordList, indexes) {
    return listOf(indexes)
      .slice()
      .sort((a, b) => startOf(wordList[a]) - startOf(wordList[b]) || a - b);
  }

  function startOf(word) {
    return numberOr0(word && word.start);
  }

  // The pauses the Pauses stat counts (mid-sentence, or 5 s+ anywhere), as [at, length] pairs
  // for the transcript, so the transcript, the stat and the map always show the same pauses.
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
  // `headlineKind` is the kind of the moment the Coach headline is about ("filler" lets the
  // fillers tip drop the technique the headline already gives), or null.
  function selectTips(report, target, headlineKind) {
    if (!app.tips || typeof app.tips.select !== "function") {
      return [];
    }
    return app.tips.select(report, { targetWpm: target, headlineKind });
  }

  // The kind of the moment the rule headline points at, or null when it names none.
  function headlineKindOf(takeaway, moments) {
    const id = takeaway && takeaway.momentId;
    const moment = id ? listOf(moments).find((each) => each && each.id === id) : null;
    return moment && typeof moment.kind === "string" ? moment.kind : null;
  }

  // What the two highlight styles mean, then the restart, misread, skip and stumble styles each
  // when the transcript plan shows one, plus the most-used habit when there is one. The link
  // follows the text after a plain space, which disappears when the link wraps to a new line, so
  // a wrapped link starts flush with the text above it.
  function buildLegend(topHabit, plan) {
    const link = app.ui.el("a", { class: "transcript__how", href: HOW_HREF, text: HOW_LINK_TEXT });
    let text = LEGEND_TEXT;
    if (plan.some((item) => item.restart)) {
      text += LEGEND_RESTART_TEXT;
    }
    if (plan.some((item) => item.type === PAUSE_ITEM && app.delivery.isLongPause(item.length))) {
      text += LEGEND_LONG_PAUSE_TEXT;
    }
    if (plan.some((item) => item.misread)) {
      text += LEGEND_MISREAD_TEXT;
    }
    if (plan.some((item) => item.type === SKIP_ITEM)) {
      text += LEGEND_SKIP_TEXT;
    }
    if (plan.some((item) => item.stumble)) {
      text += LEGEND_STUMBLE_TEXT;
    }
    if (plan.some((item) => item.unclear)) {
      text += LEGEND_UNCLEAR_TEXT;
    }
    if (topHabit) {
      const times = topHabit.count === 1 ? " time." : " times.";
      text += " Most used: “" + topHabit.text + "”, " + topHabit.count + times;
    }
    return app.ui.el("p", { class: "transcript__legend", text }, [TOKEN_SEPARATOR, link]);
  }

  // Every item is followed by a space text node, so the words keep their breaks when the
  // paragraph is copied or read aloud and the browser can wrap between any two of them. Each
  // word carries the id of its index ("word-75") and each pause marker its place among the
  // counted pauses ("pause-0"), so a speech-map card can scroll to its moment.
  function buildTranscript(plan) {
    const nodes = [];
    let wordIndex = 0;
    let pauseIndex = 0;
    plan.forEach((item) => {
      if (item.type === PAUSE_ITEM) {
        nodes.push(pauseMarker(item.length, PAUSE_ID_PREFIX + pauseIndex));
        pauseIndex += 1;
      } else if (item.type === SKIP_ITEM) {
        nodes.push(item.count ? skipRunMarker(item) : skippedMarker(item.text));
      } else {
        nodes.push(wordToken(item, WORD_ID_PREFIX + wordIndex));
        wordIndex += 1;
      }
      nodes.push(TOKEN_SEPARATOR);
    });
    return app.ui.el("p", { class: "transcript" }, nodes);
  }

  // The label uses the bare word, so "Um," reads as "um, filler word" (DESIGN.md section 6).
  // Each mark adds its class and its part of the label, in this order: filler or habit, restart,
  // misread, possible stumble. So the second "so" of "so so" reads "so, verbal habit, restart",
  // a misread in a restarted phrase "needs, restart, misread, script says need", and a word that
  // ran long "check, possible stumble". A plain word has no label.
  function wordToken(item, id) {
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
    if (item.stumble) {
      classes.push("tok--stumble");
      label += STUMBLE_LABEL_SUFFIX;
    }
    if (item.unclear) {
      classes.push("tok--unclear");
      label += UNCLEAR_LABEL_SUFFIX;
    }
    if (classes.length === 1) {
      return app.ui.el("span", { class: "tok", id, text: item.text });
    }
    return app.ui.el("span", {
      class: classes.join(" "),
      id,
      "aria-label": label,
      text: item.text,
    });
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
  function pauseMarker(length, id) {
    const value = numberOr0(length);
    const seconds = value.toFixed(1);
    if (app.delivery.isLongPause(value)) {
      return app.ui.el("span", {
        class: "tok--pause tok--pause-long num",
        id,
        "aria-label": LONG_PAUSE_LABEL_PREFIX + seconds + PAUSE_LABEL_SUFFIX,
        text: seconds + LONG_PAUSE_TEXT_SUFFIX,
      });
    }
    return app.ui.el("span", {
      class: "tok--pause num",
      id,
      "aria-label": PAUSE_LABEL_PREFIX + seconds + PAUSE_LABEL_SUFFIX,
      text: seconds + PAUSE_TEXT_SUFFIX,
    });
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

  // Exactly four stats on one strip, in the order DESIGN.md fixes, each with its hint, and with
  // a last take each with its delta line, so the four cells always share the same rows.
  function buildStatStrip(summary, deltas) {
    const stats = [
      { label: WPM_LABEL, value: summary.wpm, unit: WPM_UNIT, hint: summary.paceHint },
      {
        label: FILLERS_LABEL,
        value: summary.fillersPerMinute,
        unit: FILLERS_UNIT,
        hint: summary.fillersHint,
      },
      {
        label: PAUSES_LABEL,
        value: summary.pauseCount,
        unit: summary.pauseCount === 1 ? PAUSE_UNIT : PAUSES_UNIT,
        hint: summary.pausesHint,
      },
      {
        label: CLEAN_STRETCH_LABEL,
        value: summary.cleanStretchSeconds,
        unit: CLEAN_STRETCH_UNIT,
        hint: summary.cleanHint,
      },
    ];
    return app.ui.el(
      "div",
      { class: "stat-strip" },
      stats.map((stat, index) => statCell(stat, deltas ? deltas[index] : undefined)),
    );
  }

  // The unit sits inside the value line, after a space, so "162 wpm" reads as one phrase and
  // the small unit shares the number's baseline. The line never wraps (styles.css), so the
  // unit cannot drop below its number.
  function statCell(stat, delta) {
    const valueParts = [String(stat.value)];
    if (stat.unit) {
      valueParts.push(" ", app.ui.el("span", { class: "stat__unit", text: stat.unit }));
    }
    const parts = [
      app.ui.el("div", { class: "stat__label", text: stat.label }),
      app.ui.el("div", { class: "stat__value num" }, valueParts),
      hintLine(stat.hint),
    ];
    if (delta !== undefined) {
      parts.push(deltaLine(delta || { direction: NONE, text: NOT_COMPARED }));
    }
    return app.ui.el("div", { class: "stat" }, parts);
  }

  // The hint's words, then its icon. The icon comes after the words in the DOM, so the line's
  // text is exactly the words, and CSS draws it first (order: -1). A pace band ("130 to 160")
  // never splits across lines: the spaces around its "to" do not break.
  function hintLine(hint) {
    const text = hint.text.replace(BAND_SPACES, BAND_UNBROKEN);
    return app.ui.el(
      "div",
      { class: "stat__hint stat__hint--" + hint.tone, text },
      [app.ui.icon(HINT_ICONS[hint.tone], HINT_ICON_SIZE)],
    );
  }

  // "12 slower", then a hidden " than your last take" so the line reads as a sentence, then
  // the triangle or dash, which CSS draws first. Its own class, never the hint's. A stat the two
  // takes cannot share reads "Not compared with your last take" after a dash.
  function deltaLine(delta) {
    const endings = { [SAME]: FROM_LAST_TAKE, [NONE]: WITH_LAST_TAKE };
    const ending = endings[delta.direction] || THAN_LAST_TAKE;
    return app.ui.el(
      "div",
      { class: "stat__delta stat__delta--" + delta.direction, text: delta.text },
      [
        app.ui.el("span", { class: "sr-only", text: ending }),
        app.ui.icon(DELTA_ICONS[delta.direction], DELTA_ICON_SIZE),
      ],
    );
  }

  // The speech map section: the heading, then the stage: the first word's cap, the body (the
  // rail SVG beside the list of moment cards) and the last word's cap, then, while the map shows
  // only its first cards, the Show all button. The list's label sums the take up for screen
  // readers; each card's own words say the rest, so the rail is decoration. Clocks count from
  // the first word, so the end cap reads as the meta line's time used does.
  function buildSpeechMap(map, segments, onExpand) {
    const clock = app.ui.formatClock;
    mapHeading = app.ui.el("h2", {
      class: "results__heading speech-map__heading",
      text: MAP_TITLE,
    });
    const parts = [
      mapHeading,
      app.ui.el("div", { class: "speech-map__stage" }, [
        mapCap("speech-map__cap speech-map__cap--start", clock(0), MAP_START_TEXT),
        app.ui.el("div", { class: "speech-map__body" }, [
          buildRail(map),
          app.ui.el(
            "ol",
            { class: "speech-map__moments", role: "list", "aria-label": mapLabel(segments) },
            map.rows.slice(0, map.shown).map((row) => momentRow(row, clock)),
          ),
        ]),
        mapCap("speech-map__cap speech-map__cap--end", clock(segments.seconds), MAP_END_TEXT),
      ]),
    ];
    if (map.shown < map.rows.length) {
      parts.push(
        app.ui.el("button", {
          class: "speech-map__more",
          type: "button",
          text: SHOW_ALL(map.rows.length),
          onClick: onExpand,
        }),
      );
    }
    return app.ui.el("section", { class: "speech-map" }, parts);
  }

  // "0:00 · First word" or "1:01 · Last word": a hollow ring on the rail's end and its words.
  function mapCap(className, time, text) {
    return app.ui.el("p", { class: className }, [
      app.ui.el("span", { class: "speech-map__ring", "aria-hidden": "true" }),
      app.ui.el("span", { class: "speech-map__cap-text" }, [
        app.ui.el("span", { class: "num", text: time }),
        CAP_SEPARATOR + text,
      ]),
    ]);
  }

  // The rail: an SVG as tall as the stack, hidden from screen readers (the cards say it all).
  // The line runs the stack's height at railX; then, bottom layer first, every row's elbow (from
  // its second on the rail to its card's middle, then across to the card) and its mark: a dot for
  // a filler, a diamond for a restart, a block from its start to its end for a pause or the
  // clean stretch. Every colour is a token string, so both themes apply.
  function buildRail(map) {
    const rail = svgEl("svg", {
      class: "speech-map__rail",
      width: String(MAP.railWidth),
      height: String(map.height),
      viewBox: "0 0 " + MAP.railWidth + " " + map.height,
      "aria-hidden": "true",
    });
    rail.appendChild(
      svgEl("line", {
        class: "speech-map__line",
        x1: String(MAP.railX),
        y1: "0",
        x2: String(MAP.railX),
        y2: String(map.height),
        stroke: RAIL_COLORS.line,
        "stroke-width": "2",
      }),
    );
    map.rows.slice(0, map.shown).forEach((row) => rail.appendChild(railElbow(row)));
    map.rows.forEach((row) => rail.appendChild(railMark(row)));
    return rail;
  }

  // One curve from the mark's second (its start, for a block) to the card's edge at its middle:
  // a cubic whose handles sit at the lane's x, so it leaves the rail sideways and arrives level,
  // and never runs alongside a block on the rail.
  function railElbow(row) {
    const d = [
      "M" + MAP.railX + " " + row.railY,
      "C" + MAP.laneX + " " + row.railY,
      MAP.laneX + " " + row.cardMid,
      MAP.railWidth + " " + row.cardMid,
    ].join(" ");
    return svgEl("path", {
      class: "speech-map__elbow speech-map__elbow--" + row.kind,
      d,
      fill: "none",
      stroke: RAIL_COLORS[row.kind],
      "stroke-width": "2",
      "stroke-linejoin": "round",
    });
  }

  function railMark(row) {
    const className = "speech-map__mark speech-map__mark--" + row.kind;
    if (row.kind === FILLER_MOMENT) {
      return svgEl("circle", {
        class: className,
        cx: String(MAP.railX),
        cy: String(row.railY),
        r: String(MAP.dotRadius),
        fill: RAIL_COLORS.filler,
      });
    }
    if (row.kind === RESTART_MOMENT) {
      return svgEl("rect", {
        class: className,
        x: String(MAP.railX - MAP.dotRadius),
        y: String(coordinate(row.railY - MAP.dotRadius)),
        width: String(MAP.dotRadius * 2),
        height: String(MAP.dotRadius * 2),
        rx: "1",
        transform: "rotate(45 " + MAP.railX + " " + row.railY + ")",
        fill: RAIL_COLORS.restart,
      });
    }
    const attrs = {
      class: className,
      x: String(MAP.railX - MAP.blockWidth / 2),
      y: String(row.railY),
      width: String(MAP.blockWidth),
      height: String(coordinate(row.railEnd - row.railY)),
      rx: String(MAP.blockWidth / 2),
      fill: RAIL_COLORS[row.kind],
    };
    if (row.kind === CLEAN_MOMENT) {
      attrs.fill = RAIL_COLORS.cleanFill;
      attrs.stroke = RAIL_COLORS.clean;
      attrs["stroke-width"] = "2";
    }
    return svgEl("rect", attrs);
  }

  // One card, the whole of it the control: the head (its clock, or the clean stretch's two
  // clocks, then its kind) over the words around the moment, the moment marked as the transcript
  // marks it, a hidden "Show in transcript" that names what a tap does, and a chevron at the
  // edge. A restart whose words were not found has nothing to scroll to, so its card is plain.
  function momentRow(row, clock) {
    const parts = [
      app.ui.el("p", { class: "moment__head" }, [
        app.ui.el("span", { class: "moment__time num", text: momentTime(row, clock) }),
        app.ui.el("span", { class: "moment__kind", text: MOMENT_LABEL[row.kind](row) }),
      ]),
      momentContext(row),
    ];
    let card;
    if (row.target) {
      parts.push(
        app.ui.el("span", { class: "sr-only", text: SHOW_IN_TRANSCRIPT }),
        app.ui.el("span", { class: "moment__chevron", "aria-hidden": "true" }, [
          app.ui.icon(CHEVRON_ICON, CHEVRON_SIZE),
        ]),
      );
      card = app.ui.el(
        "button",
        {
          class: "moment__card",
          type: "button",
          "data-target": row.target,
          onClick: () => showInTranscript(row.target),
        },
        parts,
      );
    } else {
      card = app.ui.el("div", { class: "moment__card moment__card--still" }, parts);
    }
    if (row.index === MAP.shownCards) {
      revealedCard = card;
      revealedIsButton = Boolean(row.target);
    }
    return app.ui.el("li", { class: "moment moment--" + row.kind }, [card]);
  }

  // "0:30", or "0:00 to 0:26" for the clean stretch, counted from the first word.
  function momentTime(row, clock) {
    if (row.kind === CLEAN_MOMENT) {
      return clock(row.at) + TARGET_JOINER + clock(row.endAt);
    }
    return clock(row.at);
  }

  // "…judging because, [um] I put…": the plain words as text, each marked token a span in the
  // transcript's own classes (.tok--filler, .tok--restart, .tok--pause), an ellipsis at an end
  // where the take went on; a cluster's fillers alone, " · " between two. The clean stretch's
  // line says what it is instead.
  function momentContext(row) {
    if (!row.context) {
      return app.ui.el("p", { class: "moment__context", text: CLEAN_CONTEXT });
    }
    const joiner = row.context.cluster ? CLUSTER_JOINER : TOKEN_SEPARATOR;
    const parts = [];
    if (row.context.before) {
      parts.push(CONTEXT_ELLIPSIS);
    }
    row.context.tokens.forEach((token, index) => {
      if (index > 0) {
        parts.push(joiner);
      }
      parts.push(token.mark ? contextMark(token) : token.text);
    });
    if (row.context.after) {
      parts.push(CONTEXT_ELLIPSIS);
    }
    return app.ui.el("p", { class: "moment__context" }, parts);
  }

  const CONTEXT_MARK_CLASS = Object.freeze({
    [FILLER_MOMENT]: "tok tok--filler",
    [RESTART_MOMENT]: "tok tok--restart",
    [PAUSE_MOMENT]: "tok--pause num",
    [LONG_PAUSE_MOMENT]: "tok--pause tok--pause-long num",
  });

  function contextMark(token) {
    return app.ui.el("span", { class: CONTEXT_MARK_CLASS[token.mark], text: token.text });
  }

  // Scrolls the transcript's mark into the middle of the window (smoothly, unless the speaker
  // asked for less motion), flashes it for a moment and moves keyboard focus onto it, so the
  // next Tab carries on from the transcript. The live region says what happened. A mark the
  // document cannot find (a test fake, a take redrawn meanwhile) means nothing happens; a
  // context without timers (a test fake) keeps the flash on until the next tap. Only one mark
  // flashes at a time: a tap within the 1.5 s takes the flash off the mark before it.
  let shownTimer = null;
  let shownMark = null;
  function showInTranscript(target) {
    const mark = typeof document === "undefined" ? null : document.getElementById(target);
    if (!mark) {
      return;
    }
    if (shownMark && shownMark !== mark) {
      shownMark.classList.remove(SHOWN_CLASS);
    }
    shownMark = mark;
    if (typeof mark.scrollIntoView === "function") {
      const behavior = prefersReducedMotion() ? "auto" : "smooth";
      mark.scrollIntoView({ block: "center", behavior });
    }
    mark.setAttribute("tabindex", "-1");
    if (typeof mark.focus === "function") {
      mark.focus({ preventScroll: true });
    }
    mark.classList.add(SHOWN_CLASS);
    if (typeof setTimeout === "function") {
      clearTimeout(shownTimer);
      shownTimer = setTimeout(() => mark.classList.remove(SHOWN_CLASS), SHOWN_MS);
    }
    app.ui.announce(SHOWN_ANNOUNCEMENT);
  }

  function prefersReducedMotion() {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches
    );
  }

  // SVG elements need their own namespace and take every attribute, class included, through
  // setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  // "Speech map from 0:00 to 0:30: 11 fillers, 3 mid-sentence pauses, a 4.9 second clean
  // stretch", counted from the first word. A take with long pauses adds "1 long
  // pause" after the mid-sentence count, which then leaves the long ones out, and a take with
  // restarts adds "1 restart" after the pauses, the order the cards use.
  function mapLabel(segments) {
    const from = app.ui.formatClock(0);
    const to = app.ui.formatClock(segments.seconds);
    const longCount = segments.pauses.filter((pause) => pause.long).length;
    const shortCount = segments.pauses.length - longCount;
    const parts = [
      countText(segments.fillers.length, "filler", "fillers"),
      countText(shortCount, "mid-sentence pause", "mid-sentence pauses"),
    ];
    if (longCount > 0) {
      parts.push(countText(longCount, "long pause", "long pauses"));
    }
    if (segments.restarts.length > 0) {
      parts.push(countText(segments.restarts.length, "restart", "restarts"));
    }
    parts.push(cleanStretchText(segments.cleanStretch));
    return MAP_TITLE + " from " + from + " to " + to + ": " + parts.join(", ");
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

  // The bar CSS keeps stuck above the nav, or at the end of the page on a short or zoomed
  // window: the screen's one primary button, Record again. History is the nav's tab under it.
  function buildActions() {
    return app.ui.el("div", { class: "results__actions" }, [
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
    compareWithPrevious,
    timelineSegments,
    speechMapRows,
    restartSpan,
    bareText,
    isSample,
    momentTargets,
    startLanguageCheck,
    markFresh,
  };
})();
