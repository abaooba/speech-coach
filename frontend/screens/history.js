/* screens/history.js: app.screens.history (DESIGN.md sections 1, 6 and 9), one row per session:
   formatStats(session) ("152 wpm · 3.1 /min") and the pure statusFor(summary) ("On target").
   A tap reopens Results; the trash button asks "Delete? Yes / No" in place, one row at a time.
   It deletes nothing before Yes and computes no metric itself (app.screens.results.summarize). */
(function () {
  "use strict";

  // The stats line: the units the Results cards use, joined by a middle dot.
  const WPM_UNIT = " wpm";
  const FILLERS_UNIT = " /min";
  const STATS_SEPARATOR = " · ";
  const FILLERS_DECIMALS = 1;

  // Status words (DESIGN.md sections 6 and 8). Pace is judged against the take's own band, ends
  // included; fillers by the Results and tips rule, where more than 3 a minute is high (keep
  // MAX_FILLERS_PER_MINUTE equal to the one in screens/results.js and tips.js).
  const ON_TARGET = "On target";
  const TOO_SLOW = "Too slow";
  const TOO_FAST = "Too fast";
  const FILLERS_HIGH = "Fillers over 3";
  const MISS_SEPARATOR = " · ";
  const MAX_FILLERS_PER_MINUTE = 3;
  const TONE_OK = "ok";
  const TONE_WARN = "warn";
  const STATUS_CLASS = "session-row__status";
  const STATUS_ICONS = { [TONE_OK]: "check", [TONE_WARN]: "alert" };
  // The micro type size, so the icon is as tall as the words beside it.
  const STATUS_ICON_SIZE = 12;

  // Fixed copy for the empty state (DESIGN.md section 8) and the delete controls (section 6).
  const EMPTY_TITLE = "No sessions yet";
  const EMPTY_BODY = "Your first recording will show up here.";
  const EMPTY_ICON = "mic";
  const RECORD_LABEL = "Record";
  const DELETE_ICON = "trash";
  const DELETE_LABEL_PREFIX = "Delete session from ";
  const CONFIRM_LABEL_SUFFIX = "?";
  const CONFIRM_PROMPT = "Delete?";
  const YES_LABEL = "Yes";
  const NO_LABEL = "No";
  const DELETED_ANNOUNCEMENT = "Session deleted";

  // The screen's .screen__body; show() rebuilds everything inside it.
  let body = null;

  // Counts show() calls so a slow load from an earlier visit cannot paint over a newer one.
  let showCount = 0;

  // Puts the trash button back on the one row currently showing "Delete? Yes / No", leaving
  // focus where it is; null when no row is confirming.
  let closeOpenConfirm = null;

  // Where focus lands after a delete: the open button of each row on screen, top to bottom, or
  // the empty state's Record action when no row is left.
  let openButtons = [];
  let emptyAction = null;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  // "152 wpm · 3.1 /min" for one stored session. Reads app.screens.results.summarize when
  // called, never at load, so a change there reaches this screen too.
  function formatStats(session) {
    return statsText(app.screens.results.summarize(session));
  }

  function statsText(summary) {
    const fillers = summary.fillersPerMinute.toFixed(FILLERS_DECIMALS);
    return summary.wpm + WPM_UNIT + STATS_SEPARATOR + fillers + FILLERS_UNIT;
  }

  // What a take missed, pace first and then fillers ("Too slow · Fillers over 3"), or
  // "On target": {text, tone}. Null when nothing was measured, that is when wpm is not above 0.
  // Pace is checked only when the summary carries a [lo, hi] band. Pure: no DOM, no app.ui.
  function statusFor(summary) {
    if (!summary || !(summary.wpm > 0)) {
      return null;
    }
    const misses = [];
    const pace = paceMiss(summary.wpm, summary.target);
    if (pace !== null) {
      misses.push(pace);
    }
    if (summary.fillersPerMinute > MAX_FILLERS_PER_MINUTE) {
      misses.push(FILLERS_HIGH);
    }
    if (misses.length === 0) {
      return { text: ON_TARGET, tone: TONE_OK };
    }
    return { text: misses.join(MISS_SEPARATOR), tone: TONE_WARN };
  }

  // "Too slow" under the band, "Too fast" over it; null inside it or without a band.
  function paceMiss(wpm, target) {
    if (!isBand(target)) {
      return null;
    }
    const [lo, hi] = target;
    if (wpm < lo) {
      return TOO_SLOW;
    }
    return wpm > hi ? TOO_FAST : null;
  }

  function isBand(target) {
    return Array.isArray(target) && target.length === 2 && target.every(Number.isFinite);
  }

  function show() {
    return draw(++showCount);
  }

  // Loads the sessions and paints them, unless a newer show() started while the store was read.
  async function draw(ticket) {
    const sessions = await loadSessions();
    if (ticket !== showCount) {
      return;
    }
    closeOpenConfirm = null;
    if (sessions.length === 0) {
      renderEmpty();
    } else {
      renderList(sessions);
    }
  }

  // The stored sessions newest first, or none when the store cannot be read: a broken database
  // shows "No sessions yet" rather than a console error.
  async function loadSessions() {
    try {
      const sessions = await app.store.list();
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  // Nothing to release: show() rebuilds the body from the store every time.
  function hide() {}

  function renderEmpty() {
    const block = app.ui.renderState(body, {
      kind: "empty",
      icon: EMPTY_ICON,
      title: EMPTY_TITLE,
      body: EMPTY_BODY,
      actionLabel: RECORD_LABEL,
      onAction: () => app.router.go("practice"),
    });
    openButtons = [];
    emptyAction = block.querySelector(".state__action");
  }

  function renderList(sessions) {
    const built = sessions.map((session, index) => buildRow(session, index));
    openButtons = built.map((entry) => entry.open);
    emptyAction = null;
    app.ui.clear(body);
    // The list role survives list-style: none in Safari, so VoiceOver still counts the rows.
    const rows = built.map((entry) => entry.row);
    body.appendChild(app.ui.el("ul", { class: "session-list", role: "list" }, rows));
  }

  // One row and its open button. The row holds the open button, then the delete control. The
  // control is always the row's last child and swaps between the trash button and the
  // "Delete? Yes / No" group, so swapping is a remove followed by an append. `index` is the
  // row's place in the list, where focus goes back to after this session is deleted.
  function buildRow(session, index) {
    const date = app.ui.formatDate(session.createdAt);
    const open = buildOpenButton(session, date);
    const row = app.ui.el("li", { class: "session-row" }, open);
    let control = buildDeleteButton(date, askToConfirm);
    row.appendChild(control);

    function replaceControl(next) {
      row.removeChild(control);
      control = next;
      row.appendChild(control);
    }

    // No focuses the trash button it brings back. Another row's trash closing this prompt
    // leaves focus alone, because that row's prompt takes it next.
    function restoreDeleteButton(moveFocus) {
      replaceControl(buildDeleteButton(date, askToConfirm));
      closeOpenConfirm = null;
      if (moveFocus) {
        focusIfPossible(control);
      }
    }

    function askToConfirm() {
      if (closeOpenConfirm !== null) {
        closeOpenConfirm();
      }
      // One answer per prompt: a double tap on Yes, or No right after it, does nothing more
      // while the delete runs.
      let answered = false;
      const once = (action) => () => {
        if (!answered) {
          answered = true;
          action();
        }
      };
      const yes = buildAnswer(
        YES_LABEL,
        "btn btn--danger",
        once(() => removeSession(session, index)),
      );
      const no = buildAnswer(NO_LABEL, "btn btn--ghost", once(() => restoreDeleteButton(true)));
      replaceControl(buildConfirm(date, yes, no));
      closeOpenConfirm = () => restoreDeleteButton(false);
      focusIfPossible(no);
    }

    return { row, open };
  }

  // Title over date, then the stats and the status word, both from one summary of the take.
  function buildOpenButton(session, date) {
    const summary = app.screens.results.summarize(session);
    const status = statusFor(summary);
    return app.ui.el(
      "button",
      {
        class: "session-row__open",
        type: "button",
        onClick: () => app.router.go("results", { id: session.id }),
      },
      [
        app.ui.el("div", { class: "session-row__text" }, [
          app.ui.el("div", { class: "session-row__title", text: session.passageTitle }),
          app.ui.el("div", { class: "session-row__date", text: date }),
        ]),
        app.ui.el("span", { class: "session-row__stats num", text: statsText(summary) }),
        status === null ? null : buildStatus(status),
      ],
    );
  }

  // The words, then the check or alert icon, which the stylesheet draws first; the text stays
  // the words alone.
  function buildStatus(status) {
    const className = STATUS_CLASS + " " + STATUS_CLASS + "--" + status.tone;
    return app.ui.el(
      "span",
      { class: className, text: status.text },
      app.ui.icon(STATUS_ICONS[status.tone], STATUS_ICON_SIZE),
    );
  }

  // A muted trash icon with no visible word. The label names the session by date, so a screen
  // reader hears which one it would remove. The icon is drawn fresh for every button.
  function buildDeleteButton(date, onClick) {
    return app.ui.el(
      "button",
      {
        class: "icon-btn session-row__delete",
        type: "button",
        "aria-label": DELETE_LABEL_PREFIX + date,
        onClick,
      },
      app.ui.icon(DELETE_ICON),
    );
  }

  function buildAnswer(label, className, onClick) {
    return app.ui.el("button", { class: className, type: "button", text: label, onClick });
  }

  // "Delete?" with Yes (removes, then redraws the list) and No (puts the trash button back), in
  // a group whose label asks about this session by date.
  function buildConfirm(date, yes, no) {
    const attrs = {
      class: "session-row__confirm",
      role: "group",
      "aria-label": DELETE_LABEL_PREFIX + date + CONFIRM_LABEL_SUFFIX,
    };
    return app.ui.el("span", attrs, [CONFIRM_PROMPT, yes, no]);
  }

  // Deletes the session, then redraws the list from the store. When the delete fails, the
  // redraw still runs and shows the row where it was, which is the truth about what is stored,
  // and nothing is announced. Focus moves to the row now in that place, or to the empty state's
  // action, unless a newer show() started meanwhile.
  async function removeSession(session, index) {
    let removed = false;
    try {
      await app.store.remove(session.id);
      removed = true;
    } catch {
      // Nothing extra to show: the redraw below reflects whatever the store still holds.
    }
    const ticket = ++showCount;
    await draw(ticket);
    if (ticket === showCount) {
      focusIfPossible(focusTargetAt(index));
    }
    if (removed) {
      app.ui.announce(DELETED_ANNOUNCEMENT);
    }
  }

  function focusTargetAt(index) {
    if (openButtons.length === 0) {
      return emptyAction;
    }
    return openButtons[Math.min(index, openButtons.length - 1)];
  }

  // Moves keyboard focus when the node can take it; the test fakes have no focus().
  function focusIfPossible(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }

  app.screens.history = { mount, show, hide, formatStats, statusFor };
})();
