/* screens/onboarding.js: app.screens.onboarding, the first-launch screen (DESIGN.md sections 1
   and 8): what is measured, what happens to audio and transcripts, and one button that saves
   the "onboarded" flag and opens Practice. COPY holds every string, so tests check it without a
   DOM. It never asks for the microphone, and app.js, not this file, decides when it shows. */
(function () {
  "use strict";

  const COPY = Object.freeze({
    lead: "Record a practice speech. Get your pace, pauses and filler words in seconds.",
    items: Object.freeze([
      "Words per minute against a target range",
      "Pauses over 1.5 seconds and filler words like um",
      "A chart of every session on this phone",
    ]),
    // 1,500: the longest excerpt POST /api/advice carries (tips.js MAX_EXCERPT_CHARACTERS).
    privacy:
      "Audio is deleted right after analysis. " +
      "Coach notes send the first 1,500 characters of your transcript to Anthropic.",
    button: "Start practicing",
  });

  // One app.ui icon per list item, in COPY.items order: speaking pace, spotting pauses and
  // fillers, the progress chart.
  const ITEM_ICONS = ["mic", "search", "chart"];
  const ITEM_ICON_SIZE = 24;

  const ONBOARDED_FLAG = "onboarded";
  const NEXT_SCREEN = "practice";

  function mount(root) {
    const body = root.querySelector(".screen__body");
    body.appendChild(app.ui.el("p", { class: "onboarding__lead", text: COPY.lead }));
    // role="list" because Safari drops a list's implied role along with its bullets.
    body.appendChild(
      app.ui.el("ul", { class: "onboarding__list", role: "list" }, COPY.items.map(listItem)),
    );
    body.appendChild(app.ui.el("p", { class: "onboarding__privacy", text: COPY.privacy }));
    body.appendChild(
      app.ui.el(
        "button",
        { class: "btn btn--primary btn--block", type: "button", onClick: startPracticing },
        COPY.button,
      ),
    );
  }

  // An icon (decorative: app.ui.icon sets aria-hidden) beside the item's words.
  function listItem(text, index) {
    return app.ui.el("li", {}, [app.ui.icon(ITEM_ICONS[index], ITEM_ICON_SIZE), text]);
  }

  // Practice opens once the flag is saved, so a reload goes straight there. When storage is
  // blocked Practice still opens; the next launch shows this screen again.
  async function startPracticing() {
    try {
      await app.store.setFlag(ONBOARDED_FLAG, true);
    } catch {
      // Nothing to repair here: the flag stays unset and the speaker keeps going.
    }
    app.router.go(NEXT_SCREEN);
  }

  // The screen is fixed copy, built once by mount: showing or hiding it changes nothing.
  function show() {}

  function hide() {}

  app.screens.onboarding = { mount, show, hide, COPY };
})();
