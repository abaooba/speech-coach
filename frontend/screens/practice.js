/* screens/practice.js: app.screens.practice, the home screen (DESIGN.md sections 6 and 7).
   mount() builds the passage chips, passage card, timer, record button, hint and state block
   inside its root once; render(state, detail) is the only function that changes that DOM
   afterwards. Capturing audio, driving the timer and uploading belong to a later task. */
(function () {
  "use strict";

  const STATES = ["idle", "recording", "uploading", "error"];

  const HINT_TEXT = "Tap to record. Stop uploads automatically.";
  const LOADING_TITLE = "Analyzing your speech";
  const LOADING_BODY = "Usually 5 to 15 seconds.";
  const TIMER_START = "0:00";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIC_ICON_SIZE = "28";
  const STOP_ICON_SIZE = "24";

  // The screen's <section>; its data-state attribute drives the CSS for every state.
  let root = null;
  // The one string every other piece of this screen is derived from.
  let state = "idle";
  let selectedPassageId = null;

  // Nodes built by mount() and repainted by render(); the timer is owned by the next task.
  const nodes = {
    chips: [],
    cardTitle: null,
    cardTarget: null,
    cardText: null,
    recordButton: null,
    recordLabel: null,
    stateBlock: null,
  };

  // The state table from DESIGN.md section 7 as plain data, so it can be tested without a DOM.
  // showHint and showRecord mirror the [data-state] rules in styles.css.
  function viewFor(nextState) {
    if (!STATES.includes(nextState)) {
      throw new Error("practice: unknown state " + JSON.stringify(nextState));
    }
    const recording = nextState === "recording";
    return {
      dataState: nextState,
      recordLabel: recording ? "Stop" : "Record",
      recordAriaLabel: recording ? "Stop recording" : "Start recording",
      recordPressed: recording,
      chipsDisabled: nextState !== "idle",
      showHint: nextState === "idle" || recording,
      showRecord: nextState !== "uploading",
    };
  }

  function selectedPassage() {
    const passages = app.passages || [];
    return passages.find((entry) => entry.id === selectedPassageId) || passages[0] || null;
  }

  function mount(screenRoot) {
    root = screenRoot;
    const passages = app.passages || [];
    selectedPassageId = passages.length > 0 ? passages[0].id : null;

    const body = root.querySelector(".screen__body");
    body.appendChild(buildChipRow(passages));
    body.appendChild(buildPassageCard());
    body.appendChild(buildTimer());
    body.appendChild(buildRecordButton());
    nodes.recordLabel = app.ui.el("span", { class: "btn-record__label" });
    body.appendChild(nodes.recordLabel);
    body.appendChild(app.ui.el("p", { class: "practice__hint", text: HINT_TEXT }));
    nodes.stateBlock = app.ui.el("div", { class: "practice__state" });
    body.appendChild(nodes.stateBlock);

    render("idle");
  }

  function buildChipRow(passages) {
    nodes.chips = passages.map((passage) =>
      app.ui.el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": "false",
        dataset: { passageId: passage.id },
        text: passage.title,
        onClick: () => selectPassage(passage.id),
      }),
    );
    return app.ui.el("div", { class: "chip-row" }, nodes.chips);
  }

  function buildPassageCard() {
    nodes.cardTitle = app.ui.el("h2", { class: "passage-card__title" });
    nodes.cardTarget = app.ui.el("p", { class: "passage-card__target" });
    nodes.cardText = app.ui.el("p", { class: "passage-card__text" });
    return app.ui.el("section", { class: "passage-card" }, [
      nodes.cardTitle,
      nodes.cardTarget,
      nodes.cardText,
    ]);
  }

  function buildTimer() {
    return app.ui.el("div", { class: "practice__timer" }, [
      app.ui.el("span", { class: "rec-dot", "aria-hidden": "true" }),
      app.ui.el("div", { class: "timer num", "aria-live": "off", text: TIMER_START }),
    ]);
  }

  function buildRecordButton() {
    nodes.recordButton = app.ui.el("button", { class: "btn-record", type: "button" }, [
      micIcon(),
      stopIcon(),
    ]);
    return nodes.recordButton;
  }

  // Chips only respond in idle; the disabled flag already blocks taps in the other states.
  function selectPassage(passageId) {
    if (state !== "idle") {
      return;
    }
    selectedPassageId = passageId;
    render("idle");
  }

  // Applies one state to the screen. `detail` is only read for "error":
  // {title, body, actionLabel, onAction}, passed straight to app.ui.renderState.
  function render(nextState, detail) {
    const view = viewFor(nextState);
    state = nextState;
    root.dataset.state = view.dataState;

    paintChips(view);
    paintPassageCard(selectedPassage());
    paintRecordButton(view);
    paintStateBlock(view.dataState, detail || {});
  }

  function paintChips(view) {
    nodes.chips.forEach((chip) => {
      const selected = chip.dataset.passageId === selectedPassageId;
      chip.classList.toggle("chip--selected", selected);
      chip.setAttribute("aria-pressed", String(selected));
      chip.disabled = view.chipsDisabled;
    });
  }

  function paintPassageCard(passage) {
    if (!passage) {
      nodes.cardTitle.textContent = "";
      nodes.cardTarget.textContent = "";
      nodes.cardText.textContent = "";
      return;
    }
    const [lo, hi] = passage.targetWpm;
    nodes.cardTitle.textContent = passage.title;
    nodes.cardTarget.textContent = "Target " + lo + " to " + hi + " wpm";
    nodes.cardText.textContent = passage.text;
  }

  function paintRecordButton(view) {
    nodes.recordButton.setAttribute("aria-label", view.recordAriaLabel);
    nodes.recordButton.setAttribute("aria-pressed", String(view.recordPressed));
    nodes.recordLabel.textContent = view.recordLabel;
  }

  function paintStateBlock(dataState, detail) {
    if (dataState === "uploading") {
      app.ui.renderState(nodes.stateBlock, {
        kind: "loading",
        title: LOADING_TITLE,
        body: LOADING_BODY,
      });
    } else if (dataState === "error") {
      app.ui.renderState(nodes.stateBlock, {
        kind: "error",
        title: detail.title,
        body: detail.body,
        actionLabel: detail.actionLabel,
        onAction: detail.onAction,
      });
    } else {
      app.ui.clear(nodes.stateBlock);
    }
  }

  // Coming back to the screen starts a fresh take unless one is already in flight.
  function show() {
    if (state !== "recording" && state !== "uploading") {
      render("idle");
    }
  }

  // Nothing to release yet: this screen holds no recorder, stream or interval.
  function hide() {}

  // White on the record button in both color schemes; the button itself uses --record.
  function micIcon() {
    const svg = svgEl("svg", {
      class: "btn-record__mic",
      width: MIC_ICON_SIZE,
      height: MIC_ICON_SIZE,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "white",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    });
    svg.appendChild(svgEl("path", { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" }));
    svg.appendChild(svgEl("path", { d: "M19 11a7 7 0 0 1-14 0" }));
    svg.appendChild(svgEl("line", { x1: "12", y1: "18", x2: "12", y2: "22" }));
    svg.appendChild(svgEl("line", { x1: "8", y1: "22", x2: "16", y2: "22" }));
    return svg;
  }

  function stopIcon() {
    const svg = svgEl("svg", {
      class: "btn-record__stop",
      width: STOP_ICON_SIZE,
      height: STOP_ICON_SIZE,
      viewBox: "0 0 24 24",
      fill: "white",
      "aria-hidden": "true",
    });
    svg.appendChild(svgEl("rect", { x: "4", y: "4", width: "16", height: "16", rx: "3" }));
    return svg;
  }

  // SVG elements need their own namespace and take class via setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  app.screens.practice = {
    mount,
    show,
    hide,
    STATES,
    viewFor,
    render,
    selectedPassage,
    get state() {
      return state;
    },
  };
})();
