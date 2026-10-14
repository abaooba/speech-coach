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
  // Word times and pause starts are millisecond values; allow for float error when comparing.
  const MILLISECOND = 0.001;

  // How the backend reads a repeat (backend/metrics.py find_repeats, backend/script_align.py),
  // so Results can find the words that say a phrase again. These sounds, the same set as
  // backend REPEAT_SKIP_WORDS, and bare punctuation ("—" said on its own) are never part of a
  // phrase. "mhm" stands for every spelling AGREEMENT_SOUND matches, as backend filler_key
  // reads them: mhmm, mm-hmm, mm-hm, uh-huh.
  const REPEAT_SKIP_WORDS = ["um", "uh", "hmm", "mhm"];
  const AGREEMENT_SOUND = /^(?:m+-?h+m+|u+h+-h+u+h+)$/;
  const AGREEMENT_KEY = "mhm";
  // After a free-talk first copy the second starts within this many words: a restart leaves at
  // most 2 abandoned words, a cut-off restart starts again within 4 (CUTOFF_LOOKAHEAD_WORDS).
  // A script restart has no such limit (see restartOf).
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

  // Whether a normalized word is a sound repeats skip: um, uh, hmm, or mhm in any spelling.
  function isRepeatSkip(token) {
    return REPEAT_SKIP_WORDS.includes(AGREEMENT_SOUND.test(token) ? AGREEMENT_KEY : token);
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
    const repeats = validRepeats(given.repeats, given.script);
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
    const restarts = restartsOf(list, repeats);
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
      cleanStretch: longestCleanStretch(list, fillers, breaks, repeats, restarts),
      repeatCount: repeats.length,
      restarts,
      followedScript: isScriptBlock(given.script),
      ...scriptSlipsOf(list, given.script),
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
      restarts: restartsOf([], repeats),
      followedScript: isScriptBlock(metrics.script),
      ...scriptSlipsOf([], metrics.script),
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

  // True when the pause follows a word and another word comes after that one. Silence before
  // the first word or after the last is not a pause (backend/metrics.py), though pauses.js can
  // report one.
  function isInsideSpeech(list, at) {
    const before = wordBefore(list, at);
    return before !== -1 && before !== list.length - 1;
  }

  // The index of the word a pause starting at `at` follows, or -1: the last word that has ended
  // by `at` or is still going then. A pause pauses.js adds starts when the voice went quiet,
  // which can fall inside the transcript's time for the word just said ("sad." runs to 35.738,
  // quiet from 35.4): that word, not the one before it, decides whether the pause counts.
  function wordBefore(list, at) {
    let before = -1;
    list.forEach((word, index) => {
      if (word.start < at - MILLISECOND || word.end <= at + MILLISECOND) {
        before = index;
      }
    });
    return before;
  }

  // wordBefore for a stored transcript, so Results draws each pause marker right after the word
  // that decided whether the pause counts.
  function wordBeforePause(words, at) {
    return wordBefore(toWords(words), at);
  }

  // The longest stretch of speech with no filler, no counted pause (mid-sentence, or 5 s+
  // anywhere) and no restart, as {start, end, seconds}. Every filler and break cuts the take;
  // a restart cuts from the first copy of the phrase to the moment the speaker starts it over.
  // `restarts` are the repeats as restartsOf reads them, in the same order.
  function longestCleanStretch(list, fillers, breaks, repeats, restarts) {
    const cuts = [
      ...fillers.map((event) => [event.start, event.end]),
      ...breaks.map((pause) => [pause.at, pause.at + pause.length]),
      ...repeatCuts(list, repeats, restarts),
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

  // [first copy start, restart] for each backend repeat {text, at}. The restart is the first
  // word of the second copy restartOf found, the one Results underlines, so the words the
  // speaker abandoned between the copies ("day—") are cut too. When no second copy was found,
  // it is the first word after as many words as the phrase has, skipping hesitations as the
  // backend does; when no word starts at `at` either, the cut shrinks to that instant.
  function repeatCuts(list, repeats, restarts) {
    return repeats.map((repeat, order) => {
      const secondCopy = restarts[order].secondCopy;
      if (secondCopy.length > 0) {
        return [repeat.at, list[secondCopy[0]].start];
      }
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
  // the first copy is the phrase's words from `at` on. The second copy starts at the word after
  // it that says the most of the phrase (see copyMatch), the earliest on a tie, as backend
  // _cut_off_match picks it, so a false start on the same first word ("I, uh, I think") stays
  // plain. A free-talk repeat looks SECOND_COPY_SEARCH_WORDS words ahead; a script restart
  // (`fromScript`) can drop any number of words before it goes back, so it looks up to
  // `searchUntil`, where the next repeat begins (Infinity: to the end of the take). A copy that
  // says less than two words of a longer phrase is not one.
  function restartOf(pieces, repeat, searchUntil) {
    const restart = { at: repeat.at, text: repeat.text, secondCopy: [] };
    const phrase = phrasePiecesOf(repeat.text);
    const first = pieces.findIndex((piece) => piece.start >= repeat.at - MILLISECOND);
    const firstEnd = first + phrase.length - 1;
    if (phrase.length === 0 || first === -1 || firstEnd >= pieces.length) {
      return restart;
    }
    const isFragment = pieces[firstEnd].cutOff;
    const lastCandidate = repeat.fromScript
      ? pieces.length - 1
      : Math.min(pieces.length - 1, firstEnd + SECOND_COPY_SEARCH_WORDS);
    let best = { said: 0, slips: 0, from: -1, to: -1 };
    for (let from = firstEnd + 1; from <= lastCandidate; from += 1) {
      if (pieces[from].start > searchUntil + MILLISECOND) {
        break;
      }
      const match = copyMatch(pieces, from, phrase, isFragment);
      const better =
        match.said > best.said || (match.said === best.said && match.slips < best.slips);
      if (match.said > 0 && better) {
        best = { ...match, from };
      }
    }
    if (best.said >= Math.min(2, phrase.length)) {
      const indexes = pieces.slice(best.from, best.to + 1).map((piece) => piece.index);
      restart.secondCopy = [...new Set(indexes)];
    }
    return restart;
  }

  // How much of `phrase` the pieces from `from` on say again: {said, slips, to}. The first piece
  // must say the phrase's first word. Each next phrase word is said by the next piece, or by
  // the one after with one word inserted before it ("I'm going to— I am going"), or the next
  // piece misreads it when the piece after says the phrase word after ("the few choices a").
  // Inserted and misread words are slips; the walk stops at the first phrase word not said.
  // `to` is the last piece of the copy. The last phrase word is a cut-off fragment when
  // `isFragment`, so a word it begins finishes it ("ner—" then "nervous").
  function copyMatch(pieces, from, phrase, isFragment) {
    const says = (position, at) =>
      at < pieces.length &&
      saysAgain(phrase[position], pieces[at].token, isFragment && position === phrase.length - 1);
    if (!says(0, from)) {
      return { said: 0, slips: 0, to: from };
    }
    let said = 1;
    let slips = 0;
    let at = from + 1;
    for (let position = 1; position < phrase.length; position += 1) {
      if (says(position, at)) {
        said += 1;
        at += 1;
      } else if (says(position, at + 1)) {
        said += 1;
        slips += 1;
        at += 2;
      } else if (position + 1 < phrase.length && says(position + 1, at + 1)) {
        slips += 1;
        at += 1;
      } else {
        break;
      }
    }
    return { said, slips, to: at - 1 };
  }

  // The spoken words as the backend compares them for a repeat, as {index, token, start,
  // cutOff}: um, uh, hmm, mhm and bare punctuation ("—" said on its own) left out, and two words
  // joined by a dash ("bullying—the") split into two pieces of the same word, as
  // backend/script_align.py reads them. `index` is the word's place in the transcript;
  // `cutOff` says the word ends in a cut-off dash ("ner—").
  function repeatPieces(list) {
    return list.flatMap((word, index) => {
      const token = normalizeWord(word.text);
      if (token === "" || isRepeatSkip(token)) {
        return [];
      }
      const parts = isHesitation(word.text) ? [token] : token.split(JOINING_DASH);
      const cutOff = CUTOFF_MARK.test(word.text);
      return parts
        .filter(Boolean)
        .map((part) => ({ index, token: straightApostrophes(part), start: word.start, cutOff }));
    });
  }

  // A repeat's text as the same pieces: "bullying the fear", or "well-known fact" in two.
  function phrasePiecesOf(text) {
    return text
      .split(" ")
      .flatMap((word) => normalizeWord(word).split(JOINING_DASH))
      .filter(Boolean)
      .map(straightApostrophes);
  }

  function straightApostrophes(token) {
    return token.replace(/[‘’]/g, "'");
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

  // Each repeat drawn on Results (see restartOf), in the backend's order. A script restart
  // searches up to where the next repeat begins.
  function restartsOf(list, repeats) {
    const pieces = repeatPieces(list);
    return repeats.map((repeat) => {
      const later = repeats.filter((other) => other.at > repeat.at + MILLISECOND);
      const searchUntil = Math.min(Infinity, ...later.map((other) => other.at));
      return restartOf(pieces, repeat, searchUntil);
    });
  }

  // The script words a take read from a script did not read as written (metrics.script, from
  // backend/script_align.py): `misreads` as {at, word, said, wordIndex}, where `word` is the
  // script word, `said` what was said in its place and `wordIndex` the transcript index of the
  // word that said it (-1 when no word does); `skips` as {at, word}, where `at` is where the
  // skipped word belonged: the end of the word said before it, or the start of the take. An
  // entry without a numeric `at` and a text `word` (and, for a misread, `said`) is left out, and
  // a take without a script block has neither.
  function scriptSlipsOf(list, script) {
    const block = isScriptBlock(script) ? script : {};
    const misreads = (Array.isArray(block.misread) ? block.misread : [])
      .filter((slip) => isSlip(slip) && typeof slip.said === "string")
      .map((slip) => ({
        at: slip.at,
        word: slip.word,
        said: slip.said,
        wordIndex: wordSaying(list, slip.at, slip.said),
      }));
    const skips = (Array.isArray(block.skipped) ? block.skipped : [])
      .filter(isSlip)
      .map((slip) => ({ at: slip.at, word: slip.word }));
    return { misreads, skips };
  }

  function isSlip(slip) {
    return Boolean(slip) && isFiniteNumber(slip.at) && typeof slip.word === "string";
  }

  // True when the take's metrics carry a script block: the backend lined the take up against
  // the script it was sent and found that the take follows it. Free talk has no block, and nor
  // has a take that strays from its script (backend/script_align.py MIN_SCRIPT_FOLLOWED_SHARE),
  // which the backend scores as free talk: its misreads and skips are empty, as a flawless
  // read's are, so the report's followedScript tells the two apart.
  function isScriptBlock(script) {
    return Boolean(script) && typeof script === "object" && !Array.isArray(script);
  }

  // The index of the word starting at `at` that says `said`: the whole word, or one of the two
  // halves of a dash-joined word ("short-endure,"), which the alignment reads as two. -1 when
  // no word does.
  function wordSaying(list, at, said) {
    const token = straightApostrophes(normalizeWord(said));
    return list.findIndex((word) => {
      if (Math.abs(word.start - at) >= MILLISECOND) {
        return false;
      }
      const whole = straightApostrophes(normalizeWord(word.text));
      return whole === token || whole.split(JOINING_DASH).includes(token);
    });
  }

  // The backend's repeats as {at, text, words, fromScript}, skipping any entry without a
  // numeric `at`. `fromScript` marks a script restart: one metrics.script.restarts also lists.
  function validRepeats(repeats, script) {
    if (!Array.isArray(repeats)) {
      return [];
    }
    const scriptRestarts = script && Array.isArray(script.restarts) ? script.restarts : [];
    return repeats
      .filter((repeat) => repeat && isFiniteNumber(repeat.at))
      .map((repeat) => {
        const text = String(repeat.text || "");
        return {
          at: repeat.at,
          text,
          words: Math.max(1, text.split(" ").filter(Boolean).length),
          fromScript: scriptRestarts.some(
            (restart) => restart && restart.at === repeat.at && restart.text === repeat.text,
          ),
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
    wordBeforePause,
    HESITATION,
    HABIT,
    HABIT_WORDS,
    LONG_PAUSE_SECONDS,
  };
})();
