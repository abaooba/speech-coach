/* screens/history.js: app.screens.history, the History screen (DESIGN.md sections 1 and 6).
   formatStats(session) turns one stored session into its "152 wpm · 3.1 per min" line through
   app.screens.results.summarize, so both screens show the same numbers. show() lists every
   session from app.store newest first: tapping a row opens its Results, and Delete asks
   "Delete? Yes / No" in place before app.store.remove runs. Only one row confirms at a time. */
(function () {
  "use strict";

  // The stats line: the units the Results cards use, joined by a middle dot.
  const WPM_UNIT = " wpm";
  const FILLERS_UNIT = " per min";
  const STATS_SEPARATOR = " · ";
  const FILLERS_DECIMALS = 1;

  // Fixed copy for the empty state (DESIGN.md section 8) and the delete controls (section 6).
  const EMPTY_TITLE = "No sessions yet";
  const EMPTY_BODY = "Your first recording will show up here.";
  const RECORD_LABEL = "Record";
  const DELETE_LABEL = "Delete";
  const DELETE_LABEL_PREFIX = "Delete session from ";
  const CONFIRM_PROMPT = "Delete?";
  const YES_LABEL = "Yes";
  const NO_LABEL = "No";

  // The screen's .screen__body; show() rebuilds everything inside it.
  let body = null;

  // Counts show() calls so a slow load from an earlier visit cannot paint over a newer one.
  let showCount = 0;

  // Puts the Delete button back on the one row currently showing "Delete? Yes / No"; null when
  // no row is confirming.
  let closeOpenConfirm = null;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  // "152 wpm · 3.1 per min" for one stored session. Reads app.screens.results.summarize when
  // called, never at load, so a change there reaches this screen too.
  function formatStats(session) {
    const summary = app.screens.results.summarize(session);
    const fillers = summary.fillersPerMinute.toFixed(FILLERS_DECIMALS);
    return summary.wpm + WPM_UNIT + STATS_SEPARATOR + fillers + FILLERS_UNIT;
  }

  async function show() {
    const ticket = ++showCount;
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
    app.ui.renderState(body, {
      kind: "empty",
      title: EMPTY_TITLE,
      body: EMPTY_BODY,
      actionLabel: RECORD_LABEL,
      onAction: () => app.router.go("practice"),
    });
  }

  function renderList(sessions) {
    const rows = sessions.map((session) => buildRow(session));
    app.ui.clear(body);
    body.appendChild(app.ui.el("ul", { class: "session-list" }, rows));
  }

  // One row: the open button, then the delete control. The control is always the row's last
  // child and swaps between the Delete button and the "Delete? Yes / No" prompt, so swapping is
  // a remove followed by an append.
  function buildRow(session) {
    const date = app.ui.formatDate(session.createdAt);
    const row = app.ui.el("li", { class: "session-row" }, buildOpenButton(session, date));
    let control = buildDeleteButton(date, askToConfirm);
    row.appendChild(control);

    function replaceControl(next) {
      row.removeChild(control);
      control = next;
      row.appendChild(control);
    }

    function restoreDeleteButton() {
      replaceControl(buildDeleteButton(date, askToConfirm));
      closeOpenConfirm = null;
    }

    function askToConfirm() {
      if (closeOpenConfirm !== null) {
        closeOpenConfirm();
      }
      replaceControl(buildConfirm(session.id, restoreDeleteButton));
      closeOpenConfirm = restoreDeleteButton;
    }

    return row;
  }

  function buildOpenButton(session, date) {
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
        app.ui.el("span", { class: "session-row__stats num", text: formatStats(session) }),
      ],
    );
  }

  // The label names the session by date, so a screen reader hears which one Delete would remove.
  function buildDeleteButton(date, onClick) {
    return app.ui.el("button", {
      class: "btn btn--ghost session-row__delete",
      type: "button",
      "aria-label": DELETE_LABEL_PREFIX + date,
      text: DELETE_LABEL,
      onClick,
    });
  }

  // "Delete?" with Yes (removes, then redraws the list) and No (puts the Delete button back).
  function buildConfirm(id, onNo) {
    return app.ui.el("span", { class: "session-row__confirm" }, [
      CONFIRM_PROMPT,
      app.ui.el("button", {
        class: "btn btn--danger",
        type: "button",
        text: YES_LABEL,
        onClick: () => removeSession(id),
      }),
      app.ui.el("button", {
        class: "btn btn--ghost",
        type: "button",
        text: NO_LABEL,
        onClick: onNo,
      }),
    ]);
  }

  // Deletes the session, then redraws the list from the store. When the delete fails, the
  // redraw still runs and shows the row where it was, which is the truth about what is stored.
  async function removeSession(id) {
    try {
      await app.store.remove(id);
    } catch {
      // Nothing extra to show: the redraw below reflects whatever the store still holds.
    }
    await show();
  }

  app.screens.history = { mount, show, hide, formatStats };
})();
