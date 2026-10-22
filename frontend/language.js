/* language.js: app.language, the grammar and vocabulary check the speaker asks for on one take
   (POST /api/language-check, backend/language/check.py). canCheck(session) says whether a take
   gets the button, and isReadTake(session) whether it was read aloud; check(session) asks once
   and keeps an "ok" result in the store flag languageCheck:<id>, so reopening never asks again;
   cached(session) reads that flag; build(result) draws the "Grammar & vocabulary" block.
   requestBody, parse and changedWords are pure. */
(function () {
  "use strict";

  const CHECK_URL = "/api/language-check";
  const OK = 200;
  const OK_STATUS = "ok";
  const UNAVAILABLE = Object.freeze({ status: "unavailable" });
  const FLAG_PREFIX = "languageCheck:";

  // A take this short has too few sentences to say anything useful about (the spec's call).
  const MIN_WORDS = 20;
  // The server refuses more (check.py MAX_TRANSCRIPT_CHARACTERS); it counts code points.
  const MAX_TRANSCRIPT_CHARACTERS = 8000;
  // The server's caps (check.py MAX_FIXES, MAX_WORDS, MAX_OPTIONS, MAX_REWRITES), kept here too
  // so a reply that broke them still reads short.
  const MAX_FIXES = 3;
  const MAX_WORDS = 2;
  const MAX_OPTIONS = 3;
  const MAX_REWRITES = 2;
  // What JSON writes as a 6-byte \uXXXX escape: the C0 control characters (U+0000 to U+001F;
  // NUL is refused by the server) and a lone half of a surrogate pair. None is ever sent.
  const ESCAPED =
    /[\u0000-\u001f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
  const SPACE = " ";
  // Punctuation at either end of a word, the rule results.js bareText uses: "work," is "work".
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;
  const HESITATION = "hesitation";
  const PASSAGE_KIND = "passage";

  // Copy (docs/superpowers/specs/2026-10-17-guided-coach-design.md Phase 4; the design's 2b).
  const TITLE = "Grammar & vocabulary";
  const GRAMMAR_LABEL = "Grammar";
  const WORDS_LABEL = "Stronger words";
  const SAY_LABEL = "Say it better";
  const SAID_PREFIX = "You said: ";
  const BETTER_PREFIX = "Better: ";
  const PRAISE_FALLBACK = "Clear and correct. Nothing to fix in this take.";
  const NOTE = "Checked by Anthropic. Hints only: nothing here changes your score.";
  const ARROW_SIZE = 16;
  const PRAISE_ICON_SIZE = 16;

  // --- which takes get the button ---

  // True for a take the speaker talked (not read from a script) with at least MIN_WORDS words,
  // hesitation sounds left out. A Read take's words are the passage's, not the speaker's own.
  function canCheck(session) {
    if (!session || typeof session !== "object" || !session.id) {
      return false;
    }
    if (!Array.isArray(session.transcript) || isReadTake(session)) {
      return false;
    }
    return spokenWordCount(session.transcript) >= MIN_WORDS;
  }

  // A take that followed its script (the backend's script block), or one recorded on a passage
  // that is read aloud: a Read tab passage, a Path cold read, the benchmark read, or a retired
  // passage an old take still carries. The rank (rankcard.js, results.js) and the Progress charts
  // split takes on this same rule, so the three never disagree on what counts as reading.
  function isReadTake(session) {
    if (!session || typeof session !== "object") {
      return false;
    }
    const script = session.metrics && session.metrics.script;
    if (script && typeof script === "object") {
      return true;
    }
    const passage = knownPassages().find((entry) => entry && entry.id === session.passageId);
    return Boolean(passage) && passage.kind === PASSAGE_KIND;
  }

  function knownPassages() {
    const passages = app.passages;
    if (!passages) {
      return [];
    }
    const call = (name) => {
      try {
        return typeof passages[name] === "function" ? passages[name]() : null;
      } catch {
        return null;
      }
    };
    const benchmark = call("benchmark");
    return [
      ...Array.from(passages),
      ...listOf(call("coldReads")),
      ...listOf(call("retired")),
      ...(benchmark ? [benchmark.read, benchmark.talk] : []),
    ];
  }

  // Words with text, an um or uh not counted (app.delivery's own rule, when it is loaded).
  function spokenWordCount(transcript) {
    const said = transcript.filter((word) => Boolean(word) && textOf(word).trim() !== "");
    const delivery = app.delivery;
    if (!delivery || typeof delivery.classify !== "function") {
      return said.length;
    }
    const kinds = delivery.classify(said);
    return said.filter((_, index) => kinds[index] !== HESITATION).length;
  }

  // --- the request and the reply ---

  // The JSON body: the take's id and its words, space-joined, without any character JSON would
  // escape (ESCAPED; NUL among them, which the server refuses) and cut at
  // MAX_TRANSCRIPT_CHARACTERS whole characters, so no half an emoji is sent.
  function requestBody(session) {
    const words = listOf(session && session.transcript).map(textOf);
    const text = words.join(SPACE).replace(ESCAPED, "");
    return {
      session_id: String(session && session.id),
      transcript: Array.from(text).slice(0, MAX_TRANSCRIPT_CHARACTERS).join(""),
    };
  }

  // The server's reply as {status: "ok", fixes: [{said, better, why}], words: [{said, options}],
  // rewrites: [{said, better}], praise: string | null}, or null for a reply that is not a check
  // (including {status: "unavailable"}). A missing list is empty; a list that is not one fails
  // the reply. An item without its words is dropped, the caps trim from the end. Pure.
  function parse(reply) {
    if (!reply || typeof reply !== "object" || reply.status !== OK_STATUS) {
      return null;
    }
    const lists = ["fixes", "words", "rewrites"];
    if (lists.some((name) => reply[name] !== undefined && !Array.isArray(reply[name]))) {
      return null;
    }
    return {
      status: OK_STATUS,
      fixes: listOf(reply.fixes).map(parseFix).filter(Boolean).slice(0, MAX_FIXES),
      words: listOf(reply.words).map(parseWord).filter(Boolean).slice(0, MAX_WORDS),
      rewrites: listOf(reply.rewrites).map(parseRewrite).filter(Boolean).slice(0, MAX_REWRITES),
      praise: isText(reply.praise) ? reply.praise.trim() : null,
    };
  }

  function parseFix(item) {
    if (!item || !isText(item.said) || !isText(item.better)) {
      return null;
    }
    const why = isText(item.why) ? item.why.trim() : "";
    return { said: item.said.trim(), better: item.better.trim(), why };
  }

  function parseWord(item) {
    if (!item || !isText(item.said)) {
      return null;
    }
    const options = listOf(item.options)
      .filter(isText)
      .map((option) => option.trim())
      .slice(0, MAX_OPTIONS);
    return options.length > 0 ? { said: item.said.trim(), options } : null;
  }

  function parseRewrite(item) {
    if (!item || !isText(item.said) || !isText(item.better)) {
      return null;
    }
    return { said: item.said.trim(), better: item.better.trim() };
  }

  // --- one request per take, kept ---

  // Checks waiting for their reply, by take id: a second tap (or a sheet link and the card at
  // once) shares the request already open.
  const openChecks = new Map();

  // The take's check: the result kept from an earlier visit, or the server's answer, kept when
  // it is one. Anything else is {status: "unavailable"} and nothing is kept, so "Try again"
  // asks again. Never rejects.
  function check(session) {
    if (!canCheck(session) || !canAsk()) {
      return Promise.resolve(UNAVAILABLE);
    }
    const key = String(session.id);
    if (!openChecks.has(key)) {
      const asked = ask(session);
      const forget = () => openChecks.delete(key);
      openChecks.set(key, asked);
      asked.then(forget, forget);
    }
    return openChecks.get(key);
  }

  async function ask(session) {
    const kept = await cached(session);
    if (kept !== null) {
      return kept;
    }
    let result = null;
    try {
      const reply = await app.api.postJson(CHECK_URL, requestBody(session));
      result = reply && reply.status === OK ? parse(reply.body) : null;
    } catch {
      result = null;
    }
    if (result === null) {
      return UNAVAILABLE;
    }
    try {
      await app.store.setFlag(FLAG_PREFIX + session.id, result);
    } catch {
      // Shown all the same; the next visit asks again.
    }
    return result;
  }

  // The result kept for this take, or null (none, not a result, or a store that cannot be
  // read). Never rejects.
  async function cached(session) {
    if (!session || !session.id || !app.store || typeof app.store.getFlag !== "function") {
      return null;
    }
    try {
      return parse(await app.store.getFlag(FLAG_PREFIX + session.id));
    } catch {
      return null;
    }
  }

  function canAsk() {
    const store = app.store;
    const api = app.api;
    return Boolean(
      store &&
        typeof store.getFlag === "function" &&
        typeof store.setFlag === "function" &&
        api &&
        typeof api.postJson === "function",
    );
  }

  // --- the changed words of a fix ---

  // `better` as runs of words, {text, changed}: the words of a longest common run with `said`
  // (compared lower-case, without punctuation at either end) are unchanged, every other word
  // changed, and neighbours of one kind join into one run. Pure.
  function changedWords(said, better) {
    const before = wordsOf(said);
    const after = wordsOf(better);
    if (after.length === 0) {
      return [];
    }
    const kept = commonWords(before.map(compareForm), after.map(compareForm));
    const runs = [];
    after.forEach((word, index) => {
      const changed = !kept.has(index);
      const last = runs[runs.length - 1];
      if (last && last.changed === changed) {
        last.text += SPACE + word;
      } else {
        runs.push({ text: word, changed });
      }
    });
    return runs;
  }

  // The indexes in `b` of one longest common subsequence of `a` and `b`.
  function commonWords(a, b) {
    const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i][j] =
          a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const kept = new Set();
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        kept.add(j);
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
    return kept;
  }

  function wordsOf(text) {
    return String(text || "").split(/\s+/).filter(Boolean);
  }

  function compareForm(word) {
    return word.replace(EDGE_PUNCTUATION, "").toLowerCase();
  }

  // --- the block ---

  // The "Grammar & vocabulary" block for an "ok" result: its title, then Grammar, Stronger words
  // and Say it better, each only when it has items, or the praise line when none has; then the
  // note. Built node by node: the model's words never go through markup.
  function build(result) {
    const ui = app.ui;
    const parts = [ui.el("h3", { class: "lang-check__title", tabindex: "-1", text: TITLE })];
    if (result.fixes.length > 0) {
      parts.push(block(GRAMMAR_LABEL, result.fixes.length, result.fixes.map(fixRow)));
    }
    if (result.words.length > 0) {
      parts.push(block(WORDS_LABEL, null, result.words.map(wordRow)));
    }
    if (result.rewrites.length > 0) {
      parts.push(block(SAY_LABEL, null, result.rewrites.map(sayRow)));
    }
    if (parts.length === 1) {
      parts.push(
        ui.el("p", { class: "lang-check__praise" }, [
          ui.icon("check", PRAISE_ICON_SIZE),
          result.praise || PRAISE_FALLBACK,
        ]),
      );
    }
    parts.push(ui.el("p", { class: "lang-check__note", text: NOTE }));
    return ui.el("div", { class: "lang-check" }, parts);
  }

  function block(label, count, rows) {
    const ui = app.ui;
    const labelParts = [label];
    if (count !== null) {
      labelParts.push(ui.el("span", { class: "lang-block__count num", text: String(count) }));
    }
    return ui.el("div", { class: "lang-block" }, [
      ui.el("p", { class: "lang-block__label" }, labelParts),
      ...rows,
    ]);
  }

  // "You said: I take the bus" struck through, an arrow, "Better: I took the bus" with "took"
  // marked, then the one-line reason. The two prefixes are for screen readers only.
  function fixRow(fix) {
    const ui = app.ui;
    const better = changedWords(fix.said, fix.better).flatMap((run, index) => {
      const gap = index > 0 ? [SPACE] : [];
      const mark = () => ui.el("mark", { class: "lang-fix__hl", text: run.text });
      return [...gap, run.changed ? mark() : run.text];
    });
    const parts = [
      ui.el("p", { class: "lang-fix__line" }, [
        ui.el("span", { class: "lang-fix__said" }, [srOnly(SAID_PREFIX), fix.said]),
        ui.icon("arrow-right", ARROW_SIZE),
        ui.el("span", { class: "lang-fix__better" }, [srOnly(BETTER_PREFIX), ...better]),
      ]),
    ];
    if (fix.why) {
      parts.push(ui.el("p", { class: "lang-fix__why", text: fix.why }));
    }
    return ui.el("div", { class: "lang-fix" }, parts);
  }

  function wordRow(word) {
    const ui = app.ui;
    return ui.el("div", { class: "lang-word" }, [
      ui.el("span", { class: "lang-word__said", text: word.said }),
      ...word.options.map((option) => ui.el("span", { class: "lang-pill", text: option })),
    ]);
  }

  // The sentence as said on one muted line, then the rewrite to read aloud. No button says it
  // for the speaker: the "Hear it" that used to sit here stayed silent on the owner's iPhone,
  // so it only disappointed.
  function sayRow(rewrite) {
    const ui = app.ui;
    return ui.el("div", { class: "lang-say" }, [
      ui.el("p", { class: "lang-say__orig", text: rewrite.said }),
      ui.el("p", { class: "lang-say__better", text: rewrite.better }),
    ]);
  }

  function srOnly(text) {
    return app.ui.el("span", { class: "sr-only", text });
  }

  // --- small helpers ---

  function textOf(word) {
    return String((word && word.text) || "");
  }

  function isText(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  app.language = { canCheck, isReadTake, requestBody, parse, check, cached, changedWords, build };
})();
