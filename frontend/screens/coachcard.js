/* screens/coachcard.js: app.screens.coachCard, the Coach card at the top of Results
   (docs/superpowers/specs/2026-10-17-guided-coach-design.md Phase 5 item 7). build(input) draws
   it node by node: the coach's headline about this take, a bar of the take marking where each
   tip's moments fall, the tips (one open, the others folded rows), who wrote them, and the
   grammar check (app.language) in its footer. Results draws it at once from the rule takeaway
   and rule tips, and again when the coach notes arrive. contentOf and ruleMomentIds are pure. */
(function () {
  "use strict";

  const TITLE = "Coach";
  const TITLE_ID = "coach-title";
  const STATUS_TEXT = "Writing notes on this take…";
  // Who wrote the notes, by the reply's `source` (tips.js SOURCES).
  const BY_LINE = Object.freeze({
    ai: "Written for this take by Claude, from the research library.",
    library: "The research library's own words, picked for this take.",
  });
  const DRILL_TITLE = "Try this";
  const PEER_REVIEWED_TYPE = "peer_reviewed";
  const PEER_REVIEWED_BADGE = "Peer-reviewed";
  // Read after a citation link's text, so a screen reader hears where the link goes.
  const NEW_TAB_NOTE = ", opens in a new tab";
  const CHECK_LABEL = "Check grammar & vocabulary";
  const CHECKING_LABEL = "Checking grammar & vocabulary…";
  const CHECK_NOTE = "Sends your transcript to Anthropic for one check.";
  const CHECK_ERROR = "Couldn't check right now, try again later.";
  const TRY_AGAIN = "Try again";
  const CHECK_READY = "Grammar & vocabulary ready.";
  const TIP_ID_PREFIX = "coach-tip-";
  const BODY_ID_SUFFIX = "-body";
  const SPACE = " ";
  const ELLIPSIS = "…";
  const SEPARATOR = " · ";
  const QUOTED = /[“"]([^”"]+)[”"]/;

  // A rule tip names at most this many moments, as its own text lists at most three clocks.
  const MAX_RULE_MOMENTS = 3;
  // Words a folded row shows around a moment: before it, and after it (more after a filler,
  // which has no words of its own to show).
  const WORDS_BEFORE = 3;
  const WORDS_AFTER = 2;
  const WORDS_AFTER_FILLER = 3;

  const ICON = Object.freeze({ check: 12, chevron: 20, button: 20, alert: 16, retry: 20 });

  // What each kind of moment is called on a chip and a folded row, and its mark on the take bar
  // and the chips (the speech map's shapes; null for a kind the bar does not draw). A filler's
  // chip names the filler it was ("0:08 um").
  const KINDS = Object.freeze({
    restart: { chip: () => "Restart", row: "Restart", mark: "restart" },
    filler: { chip: (moment) => moment.text || "Filler", row: "Filler", mark: "filler" },
    "long-pause": { chip: () => "Long pause", row: "Long pause", mark: "long", timed: true },
    pause: { chip: () => "Pause", row: "Mid-sentence pause", mark: "pause", timed: true },
    misread: { chip: () => "Misread", row: "Misread", mark: "misread" },
    skip: { chip: () => "Skipped", row: "Skipped word", mark: null },
    stumble: { chip: () => "Possible stumble", row: "Possible stumble", mark: null },
    unclear: { chip: () => "Unclear", row: "May be unclear", mark: null },
  });
  // The transcript's mark for a moment's words inside a folded row.
  const WORD_MARKS = Object.freeze({
    restart: "tok tok--restart",
    filler: "tok tok--filler",
  });
  // How the headline's quoted words look: as their transcript mark for a restart or a filler,
  // plain for anything else.
  const QUOTE_KINDS = Object.freeze({ restart: "restart", filler: "filler" });
  const PLAIN_QUOTE = "pause";

  // --- what the card says ---

  // The card's content from what Results knows: {headline: {text, momentId} | null, tips:
  // [{key, text, drill, citation | null, momentIds}], source: "ai" | "library" | null}. Claude's
  // notes, when they came, give the tips and, with a headline, the headline; until then (or
  // when they have none) the rule takeaway heads the rule tips, each rule tip pointing at the
  // moments its own words name. Pure.
  function contentOf(input) {
    const moments = listOf(input.moments);
    const notes = input.notes || null;
    const takeaway = input.takeaway || null;
    if (notes) {
      return {
        headline: notes.headline || takeaway,
        tips: notes.tips.map((tip) => ({
          key: tip.entryId,
          text: tip.text,
          drill: tip.drill || "",
          citation: tip.citation || null,
          momentIds: listOf(tip.momentIds),
        })),
        source: notes.source,
      };
    }
    return {
      headline: takeaway,
      tips: listOf(input.ruleTips).map((tip) => ({
        key: tip.id,
        text: tip.text,
        drill: "",
        citation: null,
        momentIds: ruleMomentIds(tip.id, moments, input.topHabit),
      })),
      source: null,
    };
  }

  // The moments a rule tip (tips.js RULES) is about: its fillers (the habit's own word for
  // "habit"), its longest mid-sentence pause, its longest freeze, or its restarts; none for the
  // pace tips and the clean one. Pure.
  function ruleMomentIds(tipId, moments, topHabit) {
    const ofKind = (kind) => listOf(moments).filter((moment) => moment && moment.kind === kind);
    const first = (list) => list.slice(0, MAX_RULE_MOMENTS).map((moment) => moment.id);
    const longest = (list) => {
      const best = list.reduce(
        (top, moment) => (top === null || moment.seconds > top.seconds ? moment : top),
        null,
      );
      return best ? [best.id] : [];
    };
    switch (tipId) {
      case "fillers":
        return first(ofKind("filler"));
      case "habit": {
        const habit = topHabit && typeof topHabit.text === "string" ? topHabit.text : "";
        const word = habit.toLowerCase();
        return first(ofKind("filler").filter((moment) => moment.text.toLowerCase() === word));
      }
      case "break-long":
        return longest(ofKind("pause"));
      case "freeze":
        return longest(ofKind("long-pause"));
      case "repeats":
        return first(ofKind("restart"));
      default:
        return [];
    }
  }

  // --- the card ---

  // Draws the card. `input`: {session, moments, takeaway, ruleTips, topHabit, notes, seconds (the
  // take's speaking time, the bar's length), pending (true while the notes are on their way),
  // targetOf(momentId) -> transcript id | null, onShowMoment(target), isCurrent() (false once
  // Results has moved on), state}. `state` is one object per take shown, kept by Results across
  // draws: the open tip and the grammar check live in it, so a redraw keeps both. Returns
  // {node, heading, clearStatus(), startCheck(moveFocus)}, or null when the coach has nothing to
  // say (no headline and no tip: coach.js and tips.js both missing).
  function build(input) {
    const ui = app.ui;
    const state = input.state;
    const first = contentOf(input);
    if (!first.headline && first.tips.length === 0) {
      return null;
    }
    const card = ui.el("section", { class: "coach-card", "aria-labelledby": TITLE_ID });
    const handle = { node: card, heading: null, clearStatus, startCheck };
    let head = null;
    let status = null;

    function fill() {
      ui.clear(card);
      const content = contentOf(input);
      const byId = new Map(listOf(input.moments).map((moment) => [moment.id, moment]));
      const tips = content.tips.map((tip) => ({
        ...tip,
        moments: tip.momentIds.map((id) => byId.get(id)).filter(Boolean),
      }));
      const found = tips.findIndex((tip) => tip.key === state.openKey);
      const openIndex = found === -1 ? 0 : found;

      handle.heading = ui.el("h2", {
        class: "results__heading coach-card__title",
        id: TITLE_ID,
        tabindex: "-1",
        text: TITLE,
      });
      status = input.pending ? statusNode() : null;
      head = ui.el("div", { class: "coach-card__head" }, [handle.heading, status]);
      card.appendChild(head);
      if (content.headline) {
        card.appendChild(headlineNode(content.headline, byId));
      }
      const bar = barNode(tips, openIndex, input.seconds);
      if (bar) {
        card.appendChild(bar);
      }
      if (tips.length > 0) {
        card.appendChild(
          ui.el(
            "ol",
            { class: "coach-card__tips", role: "list" },
            tips.map((tip, index) =>
              index === openIndex ? openTip(tip, index) : foldedTip(tip, index),
            ),
          ),
        );
      }
      if (content.source && BY_LINE[content.source]) {
        card.appendChild(ui.el("p", { class: "coach-card__by", text: BY_LINE[content.source] }));
      }
      if (canCheck(input.session)) {
        const slot = ui.el("div", { class: "coach-card__lang" });
        state.drawFoot = () => drawFoot(slot);
        drawFoot(slot);
        card.appendChild(slot);
      }
    }

    // One tip opens and the others fold; focus moves to the open tip's first moment, or to its
    // words when it names none.
    function openAt(key) {
      state.openKey = key;
      fill();
      const open = findDeep(card, "coach-tip--open");
      if (open) {
        focusIfPossible(findDeep(open, "moment-chip") || findDeep(open, "coach-tip__text"));
      }
    }

    function openTip(tip, index) {
      const id = TIP_ID_PREFIX + (index + 1);
      return ui.el("li", { class: "coach-tip coach-tip--open", id }, tipParts(tip, true));
    }

    function foldedTip(tip, index) {
      const bodyId = TIP_ID_PREFIX + (index + 1) + BODY_ID_SUFFIX;
      const first = tip.moments[0];
      const lines = [];
      if (first) {
        lines.push(ui.el("span", { class: "coach-tip__kind num", text: kindLine(tip.moments) }));
      }
      lines.push(ui.el("span", { class: "coach-tip__words" }, rowWords(tip)));
      const chevron = ui.icon("chevron-down", ICON.chevron);
      chevron.setAttribute("class", "coach-tip__chevron");
      const row = ui.el(
        "button",
        {
          class: "coach-tip__row",
          type: "button",
          "aria-expanded": "false",
          "aria-controls": bodyId,
          onClick: () => openAt(tip.key),
        },
        [markNode(first), ui.el("span", { class: "coach-tip__lines" }, lines), chevron],
      );
      const bodyAttrs = { class: "coach-tip__body", id: bodyId, hidden: "" };
      const hiddenBody = ui.el("div", bodyAttrs, tipParts(tip, false));
      return ui.el("li", { class: "coach-tip" }, [row, hiddenBody]);
    }

    // A tip's moment chips, its words, its drill and its source. The chips of a hidden body do
    // nothing a sighted reader could reach, so they are drawn only in the open tip.
    function tipParts(tip, withChips) {
      const parts = [];
      if (withChips && tip.moments.length > 0) {
        parts.push(ui.el("div", { class: "coach-tip__moments" }, tip.moments.map(momentChip)));
      }
      parts.push(ui.el("p", { class: "coach-tip__text", tabindex: "-1", text: tip.text }));
      if (tip.drill) {
        parts.push(
          ui.el("div", { class: "coach-tip__drill" }, [
            ui.el("p", { class: "coach-tip__drill-title", text: DRILL_TITLE }),
            ui.el("p", { class: "coach-tip__drill-text", text: tip.drill }),
          ]),
        );
      }
      if (tip.citation) {
        parts.push(citeNode(tip.citation));
      }
      return parts;
    }

    // "0:32 Restart": one moment as a button that shows it in the transcript, or as still text
    // when the transcript has no mark for it (a skipped word).
    function momentChip(moment) {
      const label = KINDS[moment.kind] ? KINDS[moment.kind].chip(moment) : moment.kind;
      const parts = [markNode(moment), moment.clock + SPACE + label];
      const target = typeof input.targetOf === "function" ? input.targetOf(moment.id) : null;
      if (!target) {
        return ui.el("span", { class: "moment-chip moment-chip--still num" }, parts);
      }
      return ui.el(
        "button",
        {
          class: "moment-chip num",
          type: "button",
          "aria-label": "Show " + moment.clock + SPACE + label.toLowerCase() + " in transcript",
          onClick: () => input.onShowMoment(target),
        },
        parts,
      );
    }

    // The footer: the button and its note, the busy button, the error with Try again, or the
    // check's result, from state.language.
    function drawFoot(slot) {
      ui.clear(slot);
      const check = languageState();
      if (check.phase === "ok") {
        slot.appendChild(app.language.build(check.result));
        return;
      }
      if (check.phase === "error") {
        slot.appendChild(
          ui.el("div", { class: "coach-card__foot" }, [
            ui.el("p", { class: "lang-check__error" }, [ui.icon("alert", ICON.alert), CHECK_ERROR]),
            ui.el(
              "button",
              {
                class: "btn btn--secondary btn--block lang-check__retry",
                type: "button",
                onClick: () => startCheck(true),
              },
              [ui.icon("rotate-ccw", ICON.retry), TRY_AGAIN],
            ),
          ]),
        );
        return;
      }
      const loading = check.phase === "loading";
      const button = ui.el(
        "button",
        {
          class: "btn btn--secondary btn--block coach-card__check",
          type: "button",
          onClick: () => startCheck(true),
        },
        [
          loading
            ? ui.el("span", { class: "spinner coach-card__spinner", "aria-hidden": "true" })
            : ui.icon("text-check", ICON.button),
          loading ? CHECKING_LABEL : CHECK_LABEL,
        ],
      );
      if (loading) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
      slot.appendChild(
        ui.el("div", { class: "coach-card__foot" }, [
          button,
          ui.el("p", { class: "coach-card__note", text: CHECK_NOTE }),
        ]),
      );
    }

    // The grammar check's state for this take; the first draw also reads a result kept from an
    // earlier visit, which then takes the button's place with no loading state.
    function languageState() {
      if (!state.language) {
        state.language = { phase: "idle", result: null };
        app.language.cached(input.session).then((kept) => {
          if (kept && state.language.phase === "idle") {
            state.language = { phase: "ok", result: kept };
            redrawFoot();
          }
        });
      }
      return state.language;
    }

    function redrawFoot() {
      if (typeof state.drawFoot === "function") {
        state.drawFoot();
      }
    }

    // Asks for the check (app.language.check, once per take). When it answers, the footer shows
    // the result or the error, the live region says which, and with `moveFocus` focus goes to
    // the result's title or to Try again, since the button it was on is gone.
    function startCheck(moveFocus) {
      if (!canCheck(input.session)) {
        return;
      }
      const check = languageState();
      if (check.phase === "loading" || check.phase === "ok") {
        return;
      }
      state.language = { phase: "loading", result: null };
      redrawFoot();
      app.language.check(input.session).then((result) => {
        const ok = Boolean(result) && result.status === "ok";
        state.language = ok ? { phase: "ok", result } : { phase: "error", result: null };
        redrawFoot();
        if (typeof input.isCurrent === "function" && !input.isCurrent()) {
          return;
        }
        ui.announce(ok ? CHECK_READY : CHECK_ERROR);
        if (moveFocus) {
          const latest = state.card || card;
          focusIfPossible(findDeep(latest, ok ? "lang-check__title" : "lang-check__retry"));
        }
      });
    }

    function clearStatus() {
      input.pending = false;
      if (status && head) {
        head.removeChild(status);
        status = null;
      }
    }

    fill();
    state.card = card;
    return handle;
  }

  function statusNode() {
    const ui = app.ui;
    return ui.el("span", { class: "coach-card__status", role: "status" }, [
      ui.el("span", { class: "spinner coach-card__spinner", "aria-hidden": "true" }),
      STATUS_TEXT,
    ]);
  }

  // The headline, its first quoted words in their moment's transcript mark.
  function headlineNode(headline, byId) {
    const ui = app.ui;
    const moment = headline.momentId ? byId.get(headline.momentId) : null;
    const kind = (moment && QUOTE_KINDS[moment.kind]) || PLAIN_QUOTE;
    const text = String(headline.text);
    const match = QUOTED.exec(text);
    const parts = [];
    if (match) {
      parts.push(text.slice(0, match.index));
      parts.push(
        ui.el("span", {
          class: "coach-card__quote coach-card__quote--" + kind,
          text: "“" + match[1] + "”",
        }),
      );
      parts.push(text.slice(match.index + match[0].length));
    } else {
      parts.push(text);
    }
    return ui.el(
      "p",
      { class: "coach-card__headline" },
      parts.filter((part) => part !== ""),
    );
  }

  // The take bar: a thin track of the whole take, each tip's moments marked where they fall
  // (the speech map's shapes; a long pause as long as it lasted), the open tip's ringed. Null
  // when no tip names a moment the bar draws, or the take has no speaking time.
  function barNode(tips, openIndex, seconds) {
    const ui = app.ui;
    if (!(seconds > 0)) {
      return null;
    }
    const seen = new Set();
    const marks = [];
    tips.forEach((tip, index) => {
      tip.moments.forEach((moment) => {
        const kind = KINDS[moment.kind] ? KINDS[moment.kind].mark : null;
        if (!kind || seen.has(moment.id)) {
          return;
        }
        seen.add(moment.id);
        const classes = ["coach-card__mark", "coach-card__mark--" + kind];
        if (index === openIndex) {
          classes.push("coach-card__mark--open");
        }
        let style = "left: " + percent(moment.at, seconds);
        if (KINDS[moment.kind].timed) {
          style += "; width: " + percent(moment.seconds, seconds);
        }
        marks.push(ui.el("span", { class: classes.join(SPACE), style }));
      });
    });
    if (marks.length === 0) {
      return null;
    }
    return ui.el("div", { class: "coach-card__bar", "aria-hidden": "true" }, [
      ui.el("div", { class: "coach-card__track" }, marks),
      ui.el("div", { class: "coach-card__ends num" }, [
        ui.el("span", { text: ui.formatClock(0) }),
        ui.el("span", { text: ui.formatClock(seconds) }),
      ]),
    ]);
  }

  function percent(value, whole) {
    const share = Math.min(1, Math.max(0, Number(value) / whole));
    return Math.round(share * 1000) / 10 + "%";
  }

  // A moment's small mark (the take bar's shape), or nothing for a kind it has none for.
  function markNode(moment) {
    const kind = moment && KINDS[moment.kind] ? KINDS[moment.kind].mark : null;
    if (!kind) {
      return null;
    }
    return app.ui.el("span", {
      class: "moment-mark moment-mark--" + kind,
      "aria-hidden": "true",
    });
  }

  // "0:24 Long pause · 5.6 s" for one moment, "0:04 and 0:19 · Filler" for several.
  function kindLine(moments) {
    const first = moments[0];
    const kind = KINDS[first.kind] || { row: first.kind };
    if (moments.length === 1) {
      const timed = kind.timed && Number.isFinite(first.seconds);
      const length = timed ? SEPARATOR + first.seconds.toFixed(1) + " s" : "";
      return first.clock + SPACE + kind.row + length;
    }
    return joinClocks(moments.map((moment) => moment.clock)) + SEPARATOR + kind.row;
  }

  // "0:04", "0:04 and 0:19", "0:04, 0:19 and 0:32".
  function joinClocks(clocks) {
    if (clocks.length === 1) {
      return clocks[0];
    }
    return clocks.slice(0, -1).join(", ") + " and " + clocks[clocks.length - 1];
  }

  // A folded row's one line: each moment's words with the moment marked as the transcript marks
  // it, " · " between two; the tip's own words when it names no moment.
  function rowWords(tip) {
    if (tip.moments.length === 0) {
      return [tip.text];
    }
    return tip.moments.flatMap((moment, index) => [
      ...(index > 0 ? [SEPARATOR] : []),
      ...momentWords(moment),
    ]);
  }

  // One moment's words, marked: "…to work, and [5.6 s] the traffic…", "[um] I went to…",
  // "…wanted to buy [the few— the few] things for…".
  function momentWords(moment) {
    const ui = app.ui;
    const before = lastWords(moment.before, WORDS_BEFORE);
    const timed = moment.kind === "pause" || moment.kind === "long-pause";
    const afterCount = moment.kind === "filler" ? WORDS_AFTER_FILLER : WORDS_AFTER;
    const after = firstWords(moment.after, afterCount);
    let mark;
    if (timed) {
      const long = moment.kind === "long-pause" ? " tok--pause-long" : "";
      const seconds = Number(moment.seconds) || 0;
      const text = seconds.toFixed(1) + " s";
      mark = ui.el("span", { class: "tok--pause" + long + " num", text });
    } else if (WORD_MARKS[moment.kind]) {
      mark = ui.el("span", { class: WORD_MARKS[moment.kind], text: moment.text });
    } else {
      mark = moment.text;
    }
    const parts = [];
    if (before && moment.kind !== "filler") {
      parts.push(ELLIPSIS + before, SPACE);
    }
    parts.push(mark);
    if (after) {
      parts.push(SPACE, after + ELLIPSIS);
    } else {
      parts.push(ELLIPSIS);
    }
    return parts;
  }

  function lastWords(text, count) {
    return String(text || "").split(/\s+/).filter(Boolean).slice(-count).join(SPACE);
  }

  function firstWords(text, count) {
    return String(text || "").split(/\s+/).filter(Boolean).slice(0, count).join(SPACE);
  }

  // The source line: the citation as a link that opens in a new tab (plain text without a web
  // url), then the badge for a peer-reviewed source.
  function citeNode(citation) {
    const ui = app.ui;
    const parts = [];
    if (citation.url) {
      parts.push(
        ui.el(
          "a",
          { href: citation.url, target: "_blank", rel: "noopener", text: citation.label },
          [ui.el("span", { class: "sr-only", text: NEW_TAB_NOTE })],
        ),
      );
    } else {
      parts.push(ui.el("span", { text: citation.label }));
    }
    if (citation.type === PEER_REVIEWED_TYPE) {
      parts.push(
        ui.el("span", { class: "badge-peer" }, [ui.icon("check", ICON.check), PEER_REVIEWED_BADGE]),
      );
    }
    return ui.el("p", { class: "coach-tip__cite" }, parts);
  }

  // --- small helpers ---

  function canCheck(session) {
    return Boolean(app.language) && typeof app.language.canCheck === "function" &&
      app.language.canCheck(session);
  }

  function findDeep(node, name) {
    for (const child of (node && node.children) || []) {
      if (child.classList && child.classList.contains(name)) {
        return child;
      }
      const found = findDeep(child, name);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function focusIfPossible(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  app.screens.coachCard = { build, contentOf, ruleMomentIds };
})();
