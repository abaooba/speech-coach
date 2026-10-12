/* delivery.js: app.delivery, the rules the coach applies to the words of a stored take.
   classify(words) labels each word a hesitation sound, a verbal habit or neither (isHesitation
   tests one word); analyze(words, metrics) re-scores any saved take into the report Results, tips
   and Progress read, so they never mix two definitions. Pure: no DOM, no store, no I/O. */
(function () {
  "use strict";

  const HESITATION = "hesitation";
  const HABIT = "habit";

  // um, umm, uhm, uh, uhh, er, erm, ah, ahh, hm, hmm and longer stretches of the same letters,
  // plus the agreement sounds a speaker fills a gap with: mhm, mhmm, mm-hmm, mm-hm, uh-huh.
  // A lone "huh" never matches.
  const HESITATION_PATTERN = /^(?:u+h*m+|u+h+|e+r+m*|a+h+|h+m+|m+-?h+m+|u+h+-h+u+h+)$/;

  // The verbal habits the app counts, in the order a tie for "most used" is broken.
  const HABIT_WORDS = ["like", "so", "you know", "actually", "basically"];

  // Words that make the next "like" a verb or a comparison: "I like", "looks like", "just like".
  const LIKE_VERB_OR_COMPARISON_AFTER = [
    "i", "you", "we", "they", "people", "would", "i'd", "you'd", "we'd", "they'd", "to",
    "do", "does", "did", "don't", "doesn't", "didn't", "not", "really", "also", "just",
    "look", "looks", "looked", "sound", "sounds", "sounded", "feel", "feels", "felt",
    "seem", "seems", "seemed", "something", "nothing", "anything", "things", "stuff",
    "more", "much",
  ];

  // Habits that only count where a sentence or clause begins ("Basically, the plan fails").
  const CLAUSE_OPENERS = ["actually", "basically"];

  // Words that make the next "you know" a real question or verb: "do you know", "let you know".
  const YOU_KNOW_VERB_AFTER = [
    "do", "does", "did", "don't", "doesn't", "didn't", "if", "would", "let", "as",
  ];

  // A pause this long right before "like" marks a filler (Zufferey and Popescu-Belis, 2004).
  const SET_OFF_PAUSE_SECONDS = 0.25;
  // Debaters pause briefly after a connective "so"; only a longer hang counts as a stall.
  const SO_HANG_SECONDS = 0.5;
  // A silence this long is a freeze, not a breath: it counts wherever it falls, even after a
  // full stop, where a shorter pause lets the point land.
  const LONG_PAUSE_SECONDS = 5;

  const CLAUSE_END = /[,;:.?!]["')\]]*$/;
  const SENTENCE_END = /[.?!]["')\]]*$/;
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;
  const SECONDS_PER_MINUTE = 60;
  // Word ends and pause starts are millisecond values; allow for float error when comparing.
  const MILLISECOND = 0.001;

  // How the backend reads a repeat (backend/metrics.py find_repeats, backend/script_align.py),
  // so Results can find the words that say a phrase again. These sounds and bare punctuation
  // ("—" said on its own) are never part of a phrase.
  const REPEAT_SKIP_WORDS = ["um", "uh", "hmm"];
  // After the first copy the second starts within this many words: a free-talk restart leaves
  // at most 2 abandoned words, a cut-off restart starts again within 4 (CUTOFF_LOOKAHEAD_WORDS).
  const SECOND_COPY_SEARCH_WORDS = 4;
  // A dash ending a word marks where the speaker cut themselves off ("ner—", "day—").
  const CUTOFF_MARK = /[—–-]$/;
  // A fragment shorter than this ("a—") is not matched to a word it begins ("and").
  const CUTOFF_MIN_FRAGMENT_LETTERS = 2;
  // Two words joined by a dash with no space ("bullying—the"): the script alignment reads two.
  const JOINING_DASH = /(?<=[\p{L}\p{N}_])(?:--|[-—–])(?=[\p{L}\p{N}_])/u;
  // The backend's stem rule: "I'm" says "I" again, "decision" says "decisions".
  const CONTRACTION = /(?:n['’]t|['’](?:m|s|re|ve|ll|d))$/;

  function normalizeWord(text) {
    return String(text || "").toLowerCase().replace(EDGE_PUNCTUATION, "");
  }

  function isHesitation(text) {
    return HESITATION_PATTERN.test(normalizeWord(text));
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  // One label per word, left to right: "hesitation", "habit" or null.
  function classify(words) {
    const list = toWords(words);
    const tokens = list.map((word) => normalizeWord(word.text));
    const kinds = tokens.map((token) => (HESITATION_PATTERN.test(token) ? HESITATION : null));
    const context = {
      text: (i) => (list[i] ? list[i].text : ""),
      token: (i) => tokens[i] || "",
      hesitation: (i) => kinds[i] === HESITATION,
      gapBefore: (i) => (i > 0 ? list[i].start - list[i - 1].end : 0),
      gapAfter: (i) => (i < list.length - 1 ? list[i + 1].start - list[i].end : Infinity),
      // The nearest earlier word that is not a hesitation, or -1: an um never hides the word
      // that decides whether "like" is a verb ("I, um, like this plan").
      wordBefore: (i) => {
        let index = i - 1;
        while (index >= 0 && kinds[index] === HESITATION) {
          index -= 1;
        }
        return index;
      },
    };

    for (let i = 0; i < list.length; i += 1) {
      if (kinds[i] !== null) {
        continue;
      }
      const token = tokens[i];
      if (token === "you" && tokens[i + 1] === "know") {
        if (youKnowIsHabit(context, i)) {
          kinds[i] = HABIT;
          kinds[i + 1] = HABIT;
        }
        i += 1;
      } else if (token === "like" && likeIsHabit(context, i)) {
        kinds[i] = HABIT;
      } else if (token === "so" && soIsHabit(context, i)) {
        kinds[i] = HABIT;
      } else if (CLAUSE_OPENERS.includes(token) && startsClause(context, kinds, i)) {
        kinds[i] = HABIT;
      }
    }
    return kinds;
  }

  // True when the word that decides a phrase's meaning (the nearest non-hesitation word
  // before position i) is in `words` and sits in the same sentence.
  function followsWordIn(context, i, words) {
    const before = context.wordBefore(i);
    return (
      before !== -1 &&
      !SENTENCE_END.test(context.text(before)) &&
      words.includes(context.token(before))
    );
  }

  // True when position i opens the take or a sentence, looking past any hesitations.
  function opensSentence(context, i) {
    const before = context.wordBefore(i);
    return before === -1 || SENTENCE_END.test(context.text(before));
  }

  // "like" right after I, would, looks, just and the rest is a verb or a comparison and never
  // counts. Otherwise it counts when something sets it off: at the start of a sentence, a comma
  // or um right after it ("Like, the plan fails"); mid-sentence, a comma or um on either side
  // or a 0.25 s pause before it ("it was, like, a disaster").
  function likeIsHabit(context, i) {
    if (followsWordIn(context, i, LIKE_VERB_OR_COMPARISON_AFTER)) {
      return false;
    }
    const setOffAfter = CLAUSE_END.test(context.text(i)) || context.hesitation(i + 1);
    if (opensSentence(context, i)) {
      return setOffAfter;
    }
    return (
      setOffAfter ||
      CLAUSE_END.test(context.text(i - 1)) ||
      context.hesitation(i - 1) ||
      context.gapBefore(i) >= SET_OFF_PAUSE_SECONDS
    );
  }

  // "you know" right after do, if, let and the rest is a real verb and never counts. Otherwise
  // it counts when something sets it off after "know": a comma or stop, an um, or a 0.25 s
  // pause. "You know the drill" and "I'll let you know." never count.
  function youKnowIsHabit(context, i) {
    if (followsWordIn(context, i, YOU_KNOW_VERB_AFTER)) {
      return false;
    }
    const know = i + 1;
    return (
      CLAUSE_END.test(context.text(know)) ||
      context.hesitation(know + 1) ||
      context.gapAfter(know) >= SET_OFF_PAUSE_SECONDS
    );
  }

  // "so" counts only when the speaker hangs on it: an um right after it, or half a second of
  // silence mid-sentence. "So the impact is" and "so far" never count.
  function soIsHabit(context, i) {
    if (SENTENCE_END.test(context.text(i))) {
      return false;
    }
    return context.hesitation(i + 1) || context.gapAfter(i) >= SO_HANG_SECONDS;
  }

  // "actually" and "basically" count only where a sentence or clause begins: the first word,
  // after a comma or stop, or right after another filler.
  function startsClause(context, kinds, i) {
    return i === 0 || CLAUSE_END.test(context.text(i - 1)) || kinds[i - 1] !== null;
  }

  // Everything the Results cards, tips and Progress chart need from one take. Words come from
  // the stored transcript; pauses (transcript gaps merged with pauses.js silences) and repeats
  // come from the backend metrics. A take saved without words falls back to the backend's own
  // tallies, so old or hand-made sessions still render.
  function analyze(words, metrics) {
    const list = toWords(words);
    const given = metrics && typeof metrics === "object" ? metrics : {};
    const pauses = pausePairs(given.pauses);
    const repeats = validRepeats(given.repeats);
    if (list.length === 0) {
      return reportWithoutWords(given, pauses, repeats);
    }
    const kinds = classify(list);
    const fillers = fillerEvents(list, kinds);
    const hesitationCount = fillers.filter((event) => event.kind === HESITATION).length;
    const habitCounts = countHabits(fillers);
    const speakingSeconds = roundToMillisecond(list[list.length - 1].end - list[0].start);
    const classified = pauses.map(([at, length]) => ({
      at,
      length,
      midSentence: isMidSentence(list, at),
      long: isLongPause(length) && isInsideSpeech(list, at),
    }));
    const breaks = classified.filter(isCountedPause);
    return {
      kinds,
      fillers,
      fillerCount: fillers.length,
      hesitationCount,
      habitCounts,
      topHabit: topHabit(habitCounts),
      speechStart: list[0].start,
      speakingSeconds,
      wordsPerMinute: perMinute(list.length - hesitationCount, speakingSeconds),
      fillersPerMinute: perMinute(fillers.length, speakingSeconds),
      pauses: classified,
      ...pauseTallies(classified),
      cleanStretch: longestCleanStretch(list, fillers, breaks, repeats),
      repeatCount: repeats.length,
      restarts: repeats.map((repeat) => restartOf(list, repeat)),
    };
  }

  // The same report shape from the backend tallies alone, for a session saved without words.
  // Without words no pause can be placed in a sentence, so every pause counts as mid-sentence;
  // the long ones are still flagged.
  function reportWithoutWords(metrics, pauses, repeats) {
    const tallies = metrics.fillers && typeof metrics.fillers === "object" ? metrics.fillers : {};
    const fillerCount = Object.values(tallies).reduce((sum, count) => sum + numberOr0(count), 0);
    const habitCounts = {};
    HABIT_WORDS.forEach((habit) => {
      habitCounts[habit] = numberOr0(tallies[habit]);
    });
    const speakingSeconds = numberOr0(metrics.duration);
    const classified = pauses.map(([at, length]) => ({
      at,
      length,
      midSentence: true,
      long: isLongPause(length),
    }));
    return {
      kinds: [],
      fillers: [],
      fillerCount,
      hesitationCount: ["um", "uh", "hmm", "mhm"].reduce((sum, key) => sum + numberOr0(tallies[key]), 0),
      habitCounts,
      topHabit: topHabit(habitCounts),
      speechStart: null,
      speakingSeconds,
      wordsPerMinute: numberOr0(metrics.words_per_minute),
      fillersPerMinute: perMinute(fillerCount, speakingSeconds),
      pauses: classified,
      ...pauseTallies(classified),
      cleanStretch: null,
      repeatCount: repeats.length,
      restarts: repeats.map((repeat) => restartOf([], repeat)),
    };
  }

  // Judged on the length the screen shows, to a tenth, so a pause that reads "5.0 s" is long.
  function isLongPause(length) {
    return roundToTenth(length) >= LONG_PAUSE_SECONDS;
  }

  // True for a pause the report counts: every mid-sentence pause, and a long one anywhere.
  function isCountedPause(pause) {
    return pause.midSentence || pause.long;
  }

  // The pause numbers the cards, headline and tips read: `pauseCount` and `longestPause` cover
  // every counted pause, a long mid-sentence pause once; the other two split them by kind.
  function pauseTallies(classified) {
    const counted = classified.filter(isCountedPause);
    const midSentence = classified.filter((pause) => pause.midSentence);
    return {
      pauseCount: counted.length,
      longestPause: longest(counted.map((pause) => pause.length)),
      midSentencePauseCount: midSentence.length,
      longestMidSentencePause: longest(midSentence.map((pause) => pause.length)),
      longPauseCount: classified.filter((pause) => pause.long).length,
    };
  }

  // One event per filler in time order; "you know" is one event spanning both words.
  function fillerEvents(list, kinds) {
    const events = [];
    for (let i = 0; i < list.length; i += 1) {
      if (kinds[i] === null) {
        continue;
      }
      const pair =
        normalizeWord(list[i].text) === "you" &&
        kinds[i + 1] === HABIT &&
        normalizeWord(list[i + 1].text) === "know";
      const last = pair ? i + 1 : i;
      events.push({
        index: i,
        text: pair ? "you know" : normalizeWord(list[i].text),
        kind: kinds[i],
        start: list[i].start,
        end: list[last].end,
      });
      i = last;
    }
    return events;
  }

  function countHabits(fillers) {
    const counts = {};
    HABIT_WORDS.forEach((habit) => {
      counts[habit] = fillers.filter((event) => event.text === habit).length;
    });
    return counts;
  }

  // The most-used habit as {text, count}; a tie goes to the word listed first in HABIT_WORDS.
  function topHabit(habitCounts) {
    let best = null;
    HABIT_WORDS.forEach((habit) => {
      if (habitCounts[habit] > 0 && (best === null || habitCounts[habit] > best.count)) {
        best = { text: habit, count: habitCounts[habit] };
      }
    });
    return best;
  }

  // A pause is mid-sentence unless the word right before it ends a sentence.
  function isMidSentence(list, at) {
    return isInsideSpeech(list, at) && !SENTENCE_END.test(list[wordBefore(list, at)].text);
  }

  // True when a word has ended by `at` and another follows it. Silence before the first word
  // or after the last is not a pause (backend/metrics.py), though pauses.js can report one.
  function isInsideSpeech(list, at) {
    const before = wordBefore(list, at);
    return before !== -1 && before !== list.length - 1;
  }

  // The index of the last word ending by `at`, or -1: the rule Results uses to place the pause
  // marker.
  function wordBefore(list, at) {
    let before = -1;
    list.forEach((word, index) => {
      if (word.end <= at + MILLISECOND) {
        before = index;
      }
    });
    return before;
  }

  // The longest stretch of speech with no filler, no counted pause (mid-sentence, or 5 s+
  // anywhere) and no restart, as {start, end, seconds}. Every filler and break cuts the take;
  // a restart cuts from the first copy of the phrase to the moment the speaker starts it over.
  function longestCleanStretch(list, fillers, breaks, repeats) {
    const cuts = [
      ...fillers.map((event) => [event.start, event.end]),
      ...breaks.map((pause) => [pause.at, pause.at + pause.length]),
      ...repeatCuts(list, repeats),
    ].sort((a, b) => a[0] - b[0]);
    let best = { start: 0, end: 0, seconds: 0 };
    let from = list[0].start;
    const consider = (to) => {
      const seconds = roundToTenth(to - from);
      if (seconds > best.seconds) {
        best = { start: from, end: to, seconds };
      }
    };
    cuts.forEach(([cutStart, cutEnd]) => {
      consider(cutStart);
      from = Math.max(from, cutEnd);
    });
    consider(list[list.length - 1].end);
    return best;
  }

  // [first copy start, restart] for each backend repeat {text, at}: the restart is the first
  // word after as many words as the phrase has, skipping hesitations as the backend does.
  // When no word starts at `at`, the cut shrinks to that instant.
  function repeatCuts(list, repeats) {
    return repeats.map((repeat) => {
      const first = list.findIndex((word) => Math.abs(word.start - repeat.at) < MILLISECOND);
      if (first === -1) {
        return [repeat.at, repeat.at];
      }
      let index = first;
      let counted = 0;
      while (index < list.length && (counted < repeat.words || isHesitation(list[index].text))) {
        if (!isHesitation(list[index].text)) {
          counted += 1;
        }
        index += 1;
      }
      return [repeat.at, index < list.length ? list[index].start : repeat.at];
    });
  }

  // A backend repeat as Results draws it: {at, text, secondCopy}, where secondCopy lists the
  // indexes of the words that say the phrase again (none when they cannot be found). Every kind
  // of repeat has the same {text, at}: `at` starts the first copy and `text` is that copy, so
  // the first copy is walked word by word from `at`; the second starts at the first of the next
  // SECOND_COPY_SEARCH_WORDS words that begins the phrase (see saysAgain). From there as many
  // words as the phrase has are marked; um, uh, hmm and bare punctuation are passed over.
  function restartOf(list, repeat) {
    const restart = { at: repeat.at, text: repeat.text, secondCopy: [] };
    const phrase = repeat.text.split(" ").map(normalizeWord).filter(Boolean);
    const first = list.findIndex((word) => word.start >= repeat.at - MILLISECOND);
    if (phrase.length === 0 || first === -1) {
      return restart;
    }
    const firstCopy = phraseCopyFrom(list, first, phrase);
    if (firstCopy.length === 0) {
      return restart;
    }
    const isFragment = phrase.length === 1 && CUTOFF_MARK.test(list[firstCopy[0]].text);
    let index = firstCopy[firstCopy.length - 1] + 1;
    let looked = 0;
    for (; index < list.length && looked < SECOND_COPY_SEARCH_WORDS; index += 1) {
      if (isRepeatSkip(list[index].text)) {
        continue;
      }
      if (saysAgain(phrase[0], normalizeWord(list[index].text), isFragment)) {
        restart.secondCopy = phraseCopyFrom(list, index, phrase);
        break;
      }
      looked += 1;
    }
    return restart;
  }

  // The indexes of the words from `start` on that say `phrase` once more, by count.
  function phraseCopyFrom(list, start, phrase) {
    const copy = [];
    for (let index = start, said = 0; said < phrase.length && index < list.length; index += 1) {
      if (!isRepeatSkip(list[index].text)) {
        copy.push(index);
        said += phraseWordsIn(list[index].text, phrase[said] || "");
      }
    }
    return copy;
  }

  // How many phrase words one spoken word holds: two for "bullying—the" when the phrase has
  // "bullying" there, since the script alignment splits it; one otherwise.
  function phraseWordsIn(text, expected) {
    const token = normalizeWord(text);
    if (token === expected) {
      return 1;
    }
    return Math.max(1, token.split(JOINING_DASH).filter(Boolean).length);
  }

  function isRepeatSkip(text) {
    const token = normalizeWord(text);
    return token === "" || REPEAT_SKIP_WORDS.includes(token);
  }

  // Whether `said` says `token` again, as backend says_again: the same stem, or the cut-off
  // fragment finished ("sa—" then "says").
  function saysAgain(token, said, isFragment) {
    if (stem(said) === stem(token)) {
      return true;
    }
    return isFragment && token.length >= CUTOFF_MIN_FRAGMENT_LETTERS && said.startsWith(token);
  }

  // A normalized word without its contraction or plural ending: "I'm" -> "i".
  function stem(token) {
    const bare = token.replace(CONTRACTION, "");
    return bare.length > 3 && bare.endsWith("s") && !bare.endsWith("ss") ? bare.slice(0, -1) : bare;
  }

  // The backend's repeats as {at, text, words}, skipping any entry without a numeric `at`.
  function validRepeats(repeats) {
    if (!Array.isArray(repeats)) {
      return [];
    }
    return repeats
      .filter((repeat) => repeat && isFiniteNumber(repeat.at))
      .map((repeat) => {
        const text = String(repeat.text || "");
        return {
          at: repeat.at,
          text,
          words: Math.max(1, text.split(" ").filter(Boolean).length),
        };
      });
  }

  // A copy of the word list where every entry has a string text and numeric times, so one
  // malformed entry can never throw; indexes stay aligned with the stored transcript.
  function toWords(words) {
    return (Array.isArray(words) ? words : []).map((word) => ({
      text: String((word && word.text) || ""),
      start: numberOr0(word && word.start),
      end: numberOr0(word && word.end),
    }));
  }

  // Only [number, number] pairs are pauses; anything else in the list is skipped.
  function pausePairs(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(isPausePair).map((pause) => [pause[0], pause[1]]);
  }

  function isPausePair(pause) {
    return Array.isArray(pause) && isFiniteNumber(pause[0]) && isFiniteNumber(pause[1]);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function perMinute(count, seconds) {
    return seconds > 0 ? roundToTenth(count / (seconds / SECONDS_PER_MINUTE)) : 0;
  }

  function longest(values) {
    return values.length > 0 ? roundToTenth(Math.max(...values)) : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function roundToMillisecond(value) {
    return Math.round(value * 1000) / 1000;
  }

  app.delivery = {
    analyze,
    classify,
    isHesitation,
    isCountedPause,
    isLongPause,
    HESITATION,
    HABIT,
    HABIT_WORDS,
    LONG_PAUSE_SECONDS,
  };
})();
