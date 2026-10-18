/* coach.js: app.coach, what the coach can say about one take, with no DOM. coachMoments(report,
   words) lists the take's moments in the shape POST /api/advice takes (backend/advice/coach.py
   Moment): the places the coach may quote, each with an id, the second and the speech-map
   clock it happened at, the words around it and whether it is only a hint. coachTakeaway(moments,
   summary) is the one rule-based line shown at once, before Claude's headline arrives:
   {text, momentId}. Both are pure. A moment is found with the same words the speech map uses
   (app.screens.results.restartSpan) and the same clock: seconds counted from the first word,
   rounded to a tenth, shown as m:ss. */
(function () {
  "use strict";

  // The server takes at most this many moments, and these many characters of each text field
  // (coach.py MAX_MOMENTS, MAX_MOMENT_TEXT_CHARACTERS, MAX_MOMENT_CONTEXT_CHARACTERS,
  // MAX_EXPECTED_CHARACTERS).
  const MAX_MOMENTS = 40;
  const MAX_TEXT_CHARACTERS = 120;
  const MAX_CONTEXT_CHARACTERS = 60;
  const MAX_EXPECTED_CHARACTERS = 40;
  // An id's number is 1 to 3 digits (coach.py MOMENT_ID).
  const MAX_ID_NUMBER = 999;

  const RESTART = "restart";
  const FILLER = "filler";
  const PAUSE = "pause";
  const LONG_PAUSE = "long-pause";
  const MISREAD = "misread";
  const SKIP = "skip";
  const STUMBLE = "stumble";
  const UNCLEAR = "unclear";
  // When a take has more moments than fit, the ones that cost the listener most are kept.
  const KEEP_ORDER = [LONG_PAUSE, RESTART, FILLER, PAUSE, MISREAD, SKIP, STUMBLE, UNCLEAR];
  const HINT_KINDS = [STUMBLE, UNCLEAR];

  // The words said around a moment: up to this many each side.
  const CONTEXT_WORDS = 3;
  const MILLISECOND = 0.001;
  // Fillers this close together read as one cluster, as on the speech map.
  const CLUSTER_SECONDS = 5;
  // A quoted phrase in the takeaway line is cut here, with an ellipsis.
  const MAX_QUOTED_CHARACTERS = 40;
  const ELLIPSIS = "…";
  const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five"];
  const MAX_CLOCKS_LISTED = 3;
  const SPACE = " ";

  // The takeaway's advice for each kind of moment, one short technique each.
  const ADVICE = Object.freeze({
    [LONG_PAUSE]: "Finish the thought, then pause.",
    [RESTART]: "Breathe before each sentence instead of starting twice.",
    [FILLER]: "Close your mouth and pause instead.",
    [PAUSE]: "Glance at your next point first.",
    [MISREAD]: "Slow down on that word.",
    [SKIP]: "Look a phrase ahead so no word is skipped.",
  });
  const CLEAN_STRETCH_LINE = (seconds) =>
    "Your longest clean stretch was " + seconds + " s, with no filler, pause or restart. " +
    "Keep that going.";
  const CLEAN_RUN_LINE = "Clean run. No filler, long pause or restart stood out.";

  // --- moments ---

  // The moments of one take, in time order, at most MAX_MOMENTS. `report` is the app.delivery
  // report and `words` the take's transcript. Counted: every filler, every counted pause (long
  // ones as long-pause), every restart and, for a take read from a script, misreads and skips.
  // Hints, never counted anywhere: possible stumbles and unclear words. A take with no words
  // (no speech start) has none. When there are more than MAX_MOMENTS, the kinds that cost the
  // listener most are kept first (KEEP_ORDER). Ids are kind-1, kind-2, ... in time order and
  // keep their numbers whichever moments are dropped. Pure: fresh objects.
  function coachMoments(report, words) {
    const given = report && typeof report === "object" ? report : {};
    const start = given.speechStart;
    if (!Number.isFinite(start)) {
      return [];
    }
    const list = Array.isArray(words) ? words : [];
    const found = [
      ...fillersOf(given, list),
      ...pausesOf(given, list),
      ...restartsOf(given, list),
      ...slipsOf(given, list),
      ...hintsOf(list),
    ];
    const numbered = numberByKind(found.sort((a, b) => a.time - b.time));
    const kept = numbered
      .map((moment, order) => ({ moment, order }))
      .sort((a, b) => rankOf(a.moment.kind) - rankOf(b.moment.kind) || a.order - b.order)
      .slice(0, MAX_MOMENTS)
      .sort((a, b) => a.order - b.order);
    return kept.map((entry) => finish(entry.moment, start));
  }

  function rankOf(kind) {
    return KEEP_ORDER.indexOf(kind);
  }

  // Gives each moment its id: its kind and its place among the moments of that kind. A moment
  // past 999 of its kind has no valid id and is dropped.
  function numberByKind(sorted) {
    const counts = new Map();
    const numbered = [];
    sorted.forEach((moment) => {
      const next = (counts.get(moment.kind) || 0) + 1;
      counts.set(moment.kind, next);
      if (next <= MAX_ID_NUMBER) {
        numbered.push({ ...moment, id: moment.kind + "-" + next });
      }
    });
    return numbered;
  }

  // The wire shape of one moment, with every text field cut to its cap.
  function finish(moment, start) {
    const at = Math.max(0, roundToTenth(moment.time - start));
    return {
      id: moment.id,
      kind: moment.kind,
      at,
      clock: app.ui.formatClock(at),
      seconds: moment.seconds === undefined ? null : moment.seconds,
      text: cut(moment.text, MAX_TEXT_CHARACTERS),
      before: cutFromEnd(moment.before, MAX_CONTEXT_CHARACTERS),
      after: cut(moment.after, MAX_CONTEXT_CHARACTERS),
      expected: moment.expected === undefined ? null : cut(moment.expected, MAX_EXPECTED_CHARACTERS),
      hint: HINT_KINDS.includes(moment.kind),
    };
  }

  function fillersOf(report, list) {
    return listOf(report.fillers).map((filler) => {
      const last = filler.index + (String(filler.text).includes(SPACE) ? 1 : 0);
      return {
        kind: FILLER,
        time: numberOr0(filler.start),
        text: bare(filler.text),
        ...around(list, filler.index, last),
      };
    });
  }

  function pausesOf(report, list) {
    return listOf(report.pauses)
      .filter(app.delivery.isCountedPause)
      .map((pause) => {
        const index = app.delivery.wordBeforePause(list, pause.at, pause.length);
        return {
          kind: pause.long ? LONG_PAUSE : PAUSE,
          time: pause.at,
          seconds: roundToTenth(pause.length),
          text: "",
          ...around(list, index + 1, index),
        };
      });
  }

  function restartsOf(report, list) {
    return listOf(report.restarts).map((restart) => {
      const span = app.screens.results.restartSpan(list, restart);
      return {
        kind: RESTART,
        time: restart.at,
        text: span.phrase,
        ...around(list, span.copyFirst, span.copyLast),
      };
    });
  }

  // Misreads and skips, for a take read from a script.
  function slipsOf(report, list) {
    const misreads = listOf(report.misreads).map((slip) => ({
      kind: MISREAD,
      time: slip.at,
      text: bare(slip.said),
      expected: bare(slip.word),
      ...around(list, slip.wordIndex, slip.wordIndex),
    }));
    const skips = listOf(report.skips).map((slip) => {
      const next = list.findIndex((word) => numberOr0(word && word.start) >= slip.at - MILLISECOND);
      const place = next === -1 ? list.length : next;
      return { kind: SKIP, time: slip.at, text: bare(slip.word), ...around(list, place, place - 1) };
    });
    return [...misreads, ...skips];
  }

  function hintsOf(list) {
    const hint = (kind) => (index) => ({
      kind,
      time: numberOr0(list[index] && list[index].start),
      text: bare(list[index] && list[index].text),
      ...around(list, index, index),
    });
    return [
      ...app.delivery.findStumbles(list).map(hint(STUMBLE)),
      ...app.delivery.findUnclear(list).map(hint(UNCLEAR)),
    ];
  }

  // The words said just before word `first` and just after word `last`, as the transcript
  // spells them (so a full stop still shows where a sentence ended). A word that was not found
  // (index -1) gives no context.
  function around(list, first, last) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0) {
      return { before: "", after: "" };
    }
    const before = list.slice(Math.max(0, first - CONTEXT_WORDS), first);
    const after = list.slice(last + 1, last + 1 + CONTEXT_WORDS);
    return { before: joinWords(before), after: joinWords(after) };
  }

  function joinWords(words) {
    return words.map((word) => String((word && word.text) || "").trim()).filter(Boolean).join(SPACE);
  }

  // --- takeaway ---

  // The rule-based line for a take, {text, momentId}: the first of these that applies, in order
  // of what costs a listener most: the longest long pause, restarts, a cluster of fillers, the
  // longest mid-sentence pause, a misread, a skip; then a strength (momentId null). `summary`
  // is the app.delivery report (only its cleanStretch is read), so a clean take still gets a
  // line. Pure.
  function coachTakeaway(moments, summary) {
    const list = listOf(moments).filter((moment) => moment && typeof moment === "object");
    const ofKind = (kind) => list.filter((moment) => moment.kind === kind);
    const longPause = longestOf(ofKind(LONG_PAUSE));
    if (longPause) {
      return line(longPause, "Your longest pause was " + secondsText(longPause) + ", at " +
        longPause.clock + afterText(longPause) + ".", ADVICE[LONG_PAUSE]);
    }
    const restarts = ofKind(RESTART);
    if (restarts.length > 0) {
      return restartLine(restarts);
    }
    const cluster = biggestCluster(ofKind(FILLER));
    if (cluster) {
      return line(cluster[0], cluster.length + " fillers within a few seconds, from " +
        cluster[0].clock + ".", ADVICE[FILLER]);
    }
    const pause = longestOf(ofKind(PAUSE));
    if (pause) {
      return line(pause, "You paused mid-sentence for " + secondsText(pause) + ", at " +
        pause.clock + afterText(pause) + ".", ADVICE[PAUSE]);
    }
    const misread = ofKind(MISREAD)[0];
    if (misread) {
      const said = "You read " + quote(misread.text) + " where the script says " +
        quote(misread.expected) + ", at " + misread.clock + ".";
      return line(misread, said, ADVICE[MISREAD]);
    }
    const skip = ofKind(SKIP)[0];
    if (skip) {
      return line(skip, "You skipped " + quote(skip.text) + ", at " + skip.clock + ".", ADVICE[SKIP]);
    }
    return { text: strengthLine(summary), momentId: null };
  }

  function line(moment, what, advice) {
    return { text: what + SPACE + advice, momentId: moment.id };
  }

  // "Two restarts, at 0:14 and 0:32. ..." or, for one, the phrase restarted.
  function restartLine(restarts) {
    if (restarts.length === 1) {
      const only = restarts[0];
      return line(only, "You restarted " + quote(only.text) + " at " + only.clock + ".", ADVICE[RESTART]);
    }
    const listed = restarts.slice(0, MAX_CLOCKS_LISTED).map((moment) => moment.clock);
    const more = restarts.length - listed.length;
    const count = COUNT_WORDS[restarts.length] || String(restarts.length);
    const at = more > 0
      ? listed.join(", ") + " and " + more + " more"
      : listed.slice(0, -1).join(", ") + " and " + listed[listed.length - 1];
    return line(restarts[0], count + " restarts, at " + at + ".", ADVICE[RESTART]);
  }

  // The fillers (in time order) of the biggest run where each is within CLUSTER_SECONDS of the
  // one before, the earliest on a tie; null when no two fillers are that close.
  function biggestCluster(fillers) {
    const sorted = fillers.slice().sort((a, b) => a.at - b.at);
    let best = null;
    let run = [];
    sorted.forEach((filler) => {
      const last = run[run.length - 1];
      run = last && filler.at - last.at <= CLUSTER_SECONDS + MILLISECOND ? [...run, filler] : [filler];
      if (run.length > 1 && (best === null || run.length > best.length)) {
        best = run;
      }
    });
    return best;
  }

  function longestOf(moments) {
    return moments.reduce(
      (best, moment) => (best === null || numberOr0(moment.seconds) > numberOr0(best.seconds) ? moment : best),
      null,
    );
  }

  function secondsText(moment) {
    return numberOr0(moment.seconds).toFixed(1) + " s";
  }

  // " after “and”" when a word was said before the pause.
  function afterText(moment) {
    const words = String(moment.before || "").split(SPACE).filter(Boolean);
    const last = words.length > 0 ? bare(words[words.length - 1]) : "";
    return last === "" ? "" : " after " + quote(last);
  }

  function strengthLine(summary) {
    const clean = summary && summary.cleanStretch;
    const seconds = clean && Number.isFinite(clean.seconds) ? clean.seconds : 0;
    return seconds > 0 ? CLEAN_STRETCH_LINE(seconds.toFixed(1)) : CLEAN_RUN_LINE;
  }

  // “text” in curly quotes, long text cut at MAX_QUOTED_CHARACTERS.
  function quote(text) {
    const characters = Array.from(String(text || ""));
    const shown = characters.length > MAX_QUOTED_CHARACTERS
      ? characters.slice(0, MAX_QUOTED_CHARACTERS).join("").trimEnd() + ELLIPSIS
      : characters.join("");
    return "“" + shown + "”";
  }

  // --- small helpers ---

  function bare(text) {
    return app.screens.results.bareText(text);
  }

  // The first `limit` characters (never half of an emoji), or the last `limit` for cutFromEnd.
  function cut(text, limit) {
    return Array.from(String(text || "")).slice(0, limit).join("");
  }

  function cutFromEnd(text, limit) {
    return Array.from(String(text || "")).slice(-limit).join("");
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  app.coach = { coachMoments, coachTakeaway, MAX_MOMENTS };
})();
