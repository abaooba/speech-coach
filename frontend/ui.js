/* ui.js: app.ui, the DOM helpers every screen builds from. el() builds elements node by node
   (never from markup strings), icon() draws the shared SVG icons, renderState() builds the empty /
   error / loading blocks, announce() writes the live region, banner paints the strip at the top
   of the page for a take analyzed in the background, speak() says a word with the phone's
   built-in voice, the format helpers turn seconds and dates into text, and the theme helpers keep
   the Auto / Dark / Light choice in localStorage. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const LIVE_REGION_ID = "live";
  const ICON_SIZE = 20;
  const STATE_ICON_SIZE = 32;

  // Attribute names that el() treats specially; everything else goes through setAttribute.
  const CLASS_KEY = "class";
  const DATASET_KEY = "dataset";
  const TEXT_KEY = "text";

  // Icon geometry as data, never markup: each icon is a list of [tag, attributes] children drawn
  // in a 24-unit box with round 2-unit strokes in currentColor (lucide-style shapes). The two
  // triangles and half of contrast are filled with currentColor instead.
  const FILLED = { fill: "currentColor", stroke: "none" };
  const ICONS = deepFreeze({
    mic: [
      ["path", { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" }],
      ["path", { d: "M19 11a7 7 0 0 1-14 0" }],
      ["line", { x1: "12", y1: "18", x2: "12", y2: "22" }],
      ["line", { x1: "8", y1: "22", x2: "16", y2: "22" }],
    ],
    chart: [
      ["polyline", { points: "3 17 9 11 13 15 21 7" }],
      ["polyline", { points: "15 7 21 7 21 13" }],
    ],
    search: [
      ["circle", { cx: "11", cy: "11", r: "7" }],
      ["line", { x1: "16.65", y1: "16.65", x2: "21", y2: "21" }],
    ],
    alert: [
      ["polygon", { points: "12 3 22 20 2 20" }],
      ["line", { x1: "12", y1: "9", x2: "12", y2: "13" }],
      ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }],
    ],
    trash: [
      ["polyline", { points: "3 6 5 6 21 6" }],
      ["path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }],
      ["path", { d: "M10 11v6" }],
      ["path", { d: "M14 11v6" }],
      ["path", { d: "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }],
    ],
    check: [["polyline", { points: "20 6 9 17 4 12" }]],
    "arrow-right": [
      ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }],
      ["polyline", { points: "12 5 19 12 12 19" }],
    ],
    refresh: [
      ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }],
      ["path", { d: "M21 3v5h-5" }],
    ],
    "triangle-up": [["polygon", { points: "12 5 21 19 3 19", ...FILLED }]],
    "triangle-down": [["polygon", { points: "3 5 21 5 12 19", ...FILLED }]],
    dash: [["line", { x1: "5", y1: "12", x2: "19", y2: "12" }]],
    contrast: [
      ["circle", { cx: "12", cy: "12", r: "9" }],
      ["path", { d: "M12 3v18a9 9 0 0 0 0-18z", fill: "currentColor" }],
    ],
    flame: [
      [
        "path",
        {
          d:
            "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 " +
            "4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 " +
            "2.5 2.5z",
        },
      ],
    ],
    moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" }]],
    sun: [
      ["circle", { cx: "12", cy: "12", r: "4" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M12 20v2" }],
      ["path", { d: "m4.93 4.93 1.41 1.41" }],
      ["path", { d: "m17.66 17.66 1.41 1.41" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "m6.34 17.66-1.41 1.41" }],
      ["path", { d: "m19.07 4.93-1.41 1.41" }],
    ],
    // The Loop Path's screens: route is the nav's Path item, two dots joined by an S curve.
    route: [
      ["circle", { cx: "6", cy: "19", r: "3" }],
      ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }],
      ["circle", { cx: "18", cy: "5", r: "3" }],
    ],
    lock: [
      ["rect", { x: "3", y: "11", width: "18", height: "11", rx: "2" }],
      ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
    ],
    flag: [
      ["path", { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" }],
      ["line", { x1: "4", y1: "22", x2: "4", y2: "15" }],
    ],
    crown: [
      ["path", { d: "M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" }],
      ["path", { d: "M5 20h14" }],
    ],
    clock: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["polyline", { points: "12 6 12 12 16 14" }],
    ],
    play: [["polygon", { points: "6 3 20 12 6 21 6 3" }]],
    stop: [["rect", { x: "6", y: "6", width: "12", height: "12", rx: "2" }]],
    lightbulb: [
      [
        "path",
        {
          d:
            "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5" +
            ".7.7 1.3 1.5 1.5 2.5",
        },
      ],
      ["path", { d: "M9 18h6" }],
      ["path", { d: "M10 22h4" }],
    ],
    "external-link": [
      ["path", { d: "M15 3h6v6" }],
      ["path", { d: "M10 14 21 3" }],
      ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
    ],
    "chevron-left": [["path", { d: "m15 18-6-6 6-6" }]],
    calendar: [
      ["rect", { x: "3", y: "4", width: "18", height: "18", rx: "2" }],
      ["path", { d: "M16 2v4" }],
      ["path", { d: "M8 2v4" }],
      ["path", { d: "M3 10h18" }],
    ],
    close: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
    user: [
      ["circle", { cx: "12", cy: "7", r: "4" }],
      ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
    ],
    "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
    compass: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["polygon", { points: "16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" }],
    ],
    // Three text lines and a check: the grammar and vocabulary check.
    "text-check": [
      ["path", { d: "M4 6h12M4 11h9M4 16h5" }],
      ["path", { d: "m13 17 3 3 5-6" }],
    ],
    "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
    speaker: [
      ["polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }],
      ["path", { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }],
    ],
    // A phone outline with a small lock: takes are saved on the phone, behind no account.
    "phone-lock": [
      ["rect", { x: "5", y: "2", width: "14", height: "20", rx: "2" }],
      ["rect", { x: "9", y: "12", width: "6", height: "5", rx: "1" }],
      ["path", { d: "M10 12v-1.5a2 2 0 0 1 4 0V12" }],
    ],
    "rotate-ccw": [
      ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
      ["path", { d: "M3 3v5h5" }],
    ],
  });

  // The phone's built-in voice says a word or a sentence the way it is usually said: US English,
  // a little slower than its default, so a learner can hear each sound.
  const SPEECH_LANG = "en-US";
  const SPEECH_RATE = 0.85;
  // How long the voice may take to start before the tap counts as silent: a phone that claims a
  // voice but says nothing (an iPhone on silent, a home-screen app whose audio is stuck) never
  // fires onstart, and the speaker would otherwise wait on nothing.
  const SPEECH_START_TIMEOUT_MS = 3000;
  // What speak() tells its caller once the voice is done: it said the text, it failed to, or it
  // never started. A cut-off (the next word's tap, or the app's own cancel) counts as ended.
  const SPEECH_OUTCOMES = Object.freeze({ ended: "ended", failed: "failed", silent: "silent" });
  const CUT_OFF_ERRORS = Object.freeze(["canceled", "interrupted"]);

  // The theme is the one setting kept in localStorage, because it must apply before the first
  // paint. THEMES is also the toggle's cycle order. "auto" leaves the device setting in charge.
  const THEME_STORAGE_KEY = "speech-coach-theme";
  const THEMES = ["auto", "dark", "light"];
  const AUTO_THEME = "auto";
  const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

  function deepFreeze(value) {
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") {
        deepFreeze(child);
      }
    });
    return Object.freeze(value);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    applyAttributes(node, attrs || {});
    appendChildren(node, children);
    return node;
  }

  function applyAttributes(node, attrs) {
    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      if (key === CLASS_KEY) {
        node.className = value;
      } else if (key === DATASET_KEY) {
        Object.assign(node.dataset, value);
      } else if (key === TEXT_KEY) {
        node.textContent = value;
      } else if (isListenerKey(key, value)) {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value);
      }
    });
  }

  function isListenerKey(key, value) {
    return key.length > 2 && key.startsWith("on") && typeof value === "function";
  }

  function appendChildren(node, children) {
    if (children === undefined || children === null) {
      return;
    }
    const list = Array.isArray(children) ? children : [children];
    list.forEach((child) => {
      if (child === undefined || child === null) {
        return;
      }
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    });
  }

  function clear(root) {
    while (root.firstChild) {
      root.removeChild(root.firstChild);
    }
  }

  function hasIcon(name) {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(ICONS, name);
  }

  // A fresh decorative <svg> for a named icon, or null for a name not in ICONS. Callers set any
  // class with setAttribute, because an SVG element's className is read-only in browsers.
  function icon(name, size = ICON_SIZE) {
    if (!hasIcon(name)) {
      return null;
    }
    const svg = svgEl("svg", {
      viewBox: "0 0 24 24",
      width: String(size),
      height: String(size),
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      "data-icon": name,
    });
    ICONS[name].forEach(([tag, attrs]) => svg.appendChild(svgEl(tag, attrs)));
    return svg;
  }

  // Builds the shared empty / error / loading block (DESIGN.md section 6, "State block"). The
  // children are always [icon or spinner, title, body, action?, secondary action?, preview?].
  // Options: kind, title, body, actionLabel, onAction, icon, secondaryLabel, onSecondary, preview
  // (a Node or an array of Nodes, placed last inside figure.state__preview).
  function renderState(root, options) {
    const { kind, title, body, actionLabel, onAction } = options;
    const { icon: iconName, secondaryLabel, onSecondary, preview } = options;
    clear(root);

    const block = el("div", { class: "state state--" + kind });
    if (kind === "error") {
      block.setAttribute("role", "alert");
    } else if (kind === "loading") {
      block.setAttribute("role", "status");
    }

    block.appendChild(kind === "loading" ? spinner() : stateIcon(kind, iconName));
    block.appendChild(el("h2", { class: "state__title", text: title }));
    block.appendChild(el("p", { class: "state__body", text: body }));

    if (actionLabel) {
      const variant = kind === "error" ? "btn--primary" : "btn--secondary";
      block.appendChild(stateButton("state__action btn " + variant, actionLabel, onAction));
    }
    if (secondaryLabel) {
      block.appendChild(
        stateButton("state__secondary btn btn--ghost", secondaryLabel, onSecondary),
      );
    }
    // An optional preview under the words and actions: a figure the caller fills (Progress
    // shows an example trend there), never a sentence of its own.
    if (preview) {
      block.appendChild(el("figure", { class: "state__preview" }, preview));
    }

    root.appendChild(block);
    return block;
  }

  // A state block button; the label stays a child text node, as the screens' tests read it.
  function stateButton(className, label, onClick) {
    const attrs = { class: className, type: "button" };
    if (typeof onClick === "function") {
      attrs.onClick = onClick;
    }
    return el("button", attrs, label);
  }

  function spinner() {
    return el("div", { class: "spinner", "aria-hidden": "true" });
  }

  // The 32px decorative icon above the title: the caller's named icon, otherwise the alert
  // triangle for errors and a plain circle for everything else.
  function stateIcon(kind, iconName) {
    let name = null;
    if (hasIcon(iconName)) {
      name = iconName;
    } else if (kind === "error") {
      name = "alert";
    }
    if (name === null) {
      return plainCircleIcon();
    }
    const svg = icon(name, STATE_ICON_SIZE);
    svg.setAttribute("class", "state__icon");
    return svg;
  }

  function plainCircleIcon() {
    const svg = svgEl("svg", {
      class: "state__icon",
      width: String(STATE_ICON_SIZE),
      height: String(STATE_ICON_SIZE),
      viewBox: "0 0 32 32",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    });
    svg.appendChild(svgEl("circle", { cx: "16", cy: "16", r: "12" }));
    return svg;
  }

  // SVG elements need their own namespace and take class via setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  function announce(text) {
    const live = document.getElementById(LIVE_REGION_ID);
    if (live) {
      live.textContent = text;
    }
  }

  // True when this browser has a built-in voice to speak with (speechSynthesis and its
  // utterance). Where it has none, nothing offers to say a word aloud.
  function canSpeak() {
    const synth = globalThis.speechSynthesis;
    return (
      Boolean(synth) &&
      typeof synth.speak === "function" &&
      typeof synth.cancel === "function" &&
      typeof globalThis.SpeechSynthesisUtterance === "function"
    );
  }

  // The utterance being said, kept here so the browser cannot collect it mid-speech (Chrome
  // drops the events of an utterance nothing references).
  let currentUtterance = null;

  // Says `text` with the built-in voice, cutting off anything it was still saying. `onDone`, when
  // given, runs once with one of SPEECH_OUTCOMES: "ended" when the voice finished (or was cut
  // off), "failed" when it refused, "silent" when it never started within
  // SPEECH_START_TIMEOUT_MS, in which case the request is cancelled too. False when there is no
  // voice or it threw. WebKit leaves an utterance queued right after cancel() without its events
  // and sometimes without its voice, so cancel() is called only while something is being said,
  // and a synthesizer left paused (iOS does that after an interruption) is resumed first.
  function speak(text, onDone) {
    if (!canSpeak()) {
      return false;
    }
    try {
      const synth = globalThis.speechSynthesis;
      if (synth.speaking || synth.pending) {
        synth.cancel();
      }
      if (synth.paused && typeof synth.resume === "function") {
        synth.resume();
      }
      const utterance = new globalThis.SpeechSynthesisUtterance(String(text));
      utterance.lang = SPEECH_LANG;
      utterance.rate = SPEECH_RATE;
      const voice = deviceVoice(synth);
      if (voice !== null) {
        utterance.voice = voice;
      }
      watchUtterance(synth, utterance, onDone);
      currentUtterance = utterance;
      synth.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  // Wires the utterance's events to one `onDone(outcome)` call, and starts the watchdog that
  // treats a voice silent for SPEECH_START_TIMEOUT_MS as never coming. Without timers (an old
  // browser, the test sandbox) there is no watchdog. The test fakes may give onerror no event.
  function watchUtterance(synth, utterance, onDone) {
    let settled = false;
    let watchdog = null;
    const settle = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdog !== null && typeof clearTimeout === "function") {
        clearTimeout(watchdog);
      }
      if (currentUtterance === utterance) {
        currentUtterance = null;
      }
      if (typeof onDone === "function") {
        onDone(outcome);
      }
    };
    utterance.onstart = () => {
      if (watchdog !== null && typeof clearTimeout === "function") {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    utterance.onend = () => settle(SPEECH_OUTCOMES.ended);
    utterance.onerror = (event) => {
      const error = event && typeof event.error === "string" ? event.error : "";
      settle(CUT_OFF_ERRORS.includes(error) ? SPEECH_OUTCOMES.ended : SPEECH_OUTCOMES.failed);
    };
    if (typeof setTimeout === "function") {
      watchdog = setTimeout(() => {
        watchdog = null;
        settle(SPEECH_OUTCOMES.silent);
        try {
          synth.cancel();
        } catch {
          // The voice that never started cannot be cancelled either; nothing more to do.
        }
      }, SPEECH_START_TIMEOUT_MS);
    }
  }

  // An English voice that runs on the device (localService), US English first, or null: a
  // desktop browser may also offer network voices, which send the text to a speech service, and
  // the app never picks one. With none on the device the browser's default speaks.
  function deviceVoice(synth) {
    const listed = typeof synth.getVoices === "function" ? synth.getVoices() : [];
    const local = (Array.isArray(listed) ? listed : []).filter(
      (voice) => voice && voice.localService === true && typeof voice.lang === "string",
    );
    const english = local.filter((voice) => /^en\b/i.test(voice.lang));
    return (
      english.find((voice) => voice.lang.replace("_", "-").toLowerCase() === "en-us") ||
      english[0] ||
      null
    );
  }

  function formatClock(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(whole / 60);
    const rest = whole % 60;
    return minutes + ":" + String(rest).padStart(2, "0");
  }

  function formatDate(iso) {
    return formatLocal(iso, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDay(iso) {
    return formatLocal(iso, { month: "short", day: "numeric" });
  }

  // An ISO timestamp as US English text in local time, or "" when it is not a date.
  function formatLocal(iso, options) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    // Newer ICU builds put a narrow no-break space before "PM"; keep the documented plain space.
    return date.toLocaleString("en-US", options).replace(/\s/g, " ");
  }

  function knownTheme(choice) {
    return THEMES.includes(choice) ? choice : AUTO_THEME;
  }

  // The saved choice, or "auto" when nothing usable is saved or storage is blocked.
  function getTheme() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) {
        return AUTO_THEME;
      }
      return knownTheme(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      return AUTO_THEME;
    }
  }

  function setTheme(choice) {
    const theme = knownTheme(choice);
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
    } catch {
      // Storage is blocked or full: the choice still applies until the page reloads.
    }
    return applyTheme(theme);
  }

  // Sets data-theme on <html> to "dark" or "light", which force that scheme in styles.css.
  // Auto removes the attribute, so the device setting decides.
  function applyTheme(choice) {
    const theme = knownTheme(choice);
    const html = typeof document === "undefined" ? null : document.documentElement;
    if (!html || !html.dataset) {
      return theme;
    }
    if (theme === AUTO_THEME) {
      delete html.dataset.theme;
    } else {
      html.dataset.theme = theme;
    }
    pointThemeColor(html, theme);
    return theme;
  }

  // The browser bar follows the page: a forced theme points every theme-color meta at that
  // theme's --bg, and auto restores each meta's own per-scheme content, saved on first use.
  function pointThemeColor(html, theme) {
    const canQuery = typeof document.querySelectorAll === "function";
    if (!canQuery || typeof getComputedStyle !== "function") {
      return;
    }
    const forcedBackground =
      theme === AUTO_THEME ? "" : getComputedStyle(html).getPropertyValue("--bg").trim();
    document.querySelectorAll(THEME_COLOR_SELECTOR).forEach((meta) => {
      if (meta.dataset.originalContent === undefined) {
        meta.dataset.originalContent = meta.getAttribute("content") || "";
      }
      meta.setAttribute("content", forcedBackground || meta.dataset.originalContent);
    });
  }

  function nextTheme(choice) {
    const index = THEMES.indexOf(choice);
    return index === -1 ? AUTO_THEME : THEMES[(index + 1) % THEMES.length];
  }

  // --- the banner (DESIGN.md section 6, "Banner") ---

  // One strip at the top of every screen, over the page, for a take analyzed in the background
  // (Practice puts it up at Stop and takes it down when Results opens). Practice decides what it
  // says, and says it through announce(); this only paints it. A kind picks its color and icon:
  // "working" the accent with the spinner, "ready" green with the check, "failed" red with the
  // alert triangle. Its actions are secondary buttons: the one primary button stays the
  // screen's own. The strip's height goes to the page as --banner-h (0px while it is down), so
  // Practice's one-screen column and the page's scroll padding can make room for it.
  const BANNER_KINDS = Object.freeze(["working", "ready", "failed"]);
  const BANNER_CLASS = "banner";
  const BANNER_ICON_SIZE = 20;
  const BANNER_ICON_BY_KIND = Object.freeze({ ready: "check", failed: "alert" });
  const BANNER_HEIGHT_PROPERTY = "--banner-h";

  // The node index.html holds (mountBanner), and what it shows: {kind, title, body, actions},
  // or null while hidden. Both outlive any screen, so a banner put up on Practice is still
  // there on History.
  let bannerNode = null;
  let bannerShown = null;

  // Takes the node to paint in, or null when the page has none (the test fakes), and paints
  // whatever was asked for before it was mounted. The strip's height changes with the window's
  // width (its actions wrap), so a resize measures it again.
  function mountBanner(node) {
    bannerNode = node || null;
    paintBanner();
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("resize", publishBannerHeight);
    }
  }

  // Puts the banner up, or changes what it says. `actions` is a list of {label, onClick};
  // without one the banner has only its words.
  function showBanner(options) {
    const { kind, title, body, actions } = options || {};
    if (!BANNER_KINDS.includes(kind)) {
      throw new Error("banner: unknown kind " + JSON.stringify(kind));
    }
    bannerShown = {
      kind,
      title: String(title || ""),
      body: String(body || ""),
      actions: Array.isArray(actions) ? actions.slice() : [],
    };
    paintBanner();
  }

  function hideBanner() {
    bannerShown = null;
    paintBanner();
  }

  // What the banner shows now, or null while it is hidden.
  function currentBanner() {
    return bannerShown;
  }

  // Repaints the node from bannerShown. A repaint drops the button that had keyboard focus, so
  // focus that sat in the banner moves to the banner itself (tabindex -1, never a Tab stop)
  // while it stays up; when it goes down the router or the screen places focus next.
  function paintBanner() {
    if (bannerNode === null) {
      return;
    }
    const hadFocus = bannerHoldsFocus();
    clear(bannerNode);
    removeAttribute(bannerNode, "tabindex");
    if (bannerShown === null) {
      bannerNode.hidden = true;
      bannerNode.className = BANNER_CLASS;
      delete bannerNode.dataset.kind;
      publishBannerHeight();
      return;
    }
    const { kind, title, body, actions } = bannerShown;
    bannerNode.hidden = false;
    bannerNode.className = BANNER_CLASS + " " + BANNER_CLASS + "--" + kind;
    bannerNode.dataset.kind = kind;
    bannerNode.appendChild(el("div", { class: "banner__icon" }, bannerIcon(kind)));
    bannerNode.appendChild(
      el("div", { class: "banner__text" }, [
        el("p", { class: "banner__title", text: title }),
        el("p", { class: "banner__body", text: body }),
      ]),
    );
    if (actions.length > 0) {
      bannerNode.appendChild(
        el(
          "div",
          { class: "banner__actions" },
          actions.map((action) => bannerButton(action)),
        ),
      );
    }
    if (hadFocus) {
      bannerNode.setAttribute("tabindex", "-1");
      if (typeof bannerNode.focus === "function") {
        bannerNode.focus({ preventScroll: true });
      }
    }
    publishBannerHeight();
  }

  // Writes the strip's height to --banner-h on the root element: its box height while it is
  // up, 0px while it is down. The test fakes have no style or offsetHeight.
  function publishBannerHeight() {
    const style = document.documentElement && document.documentElement.style;
    if (!style || typeof style.setProperty !== "function") {
      return;
    }
    const height =
      bannerNode !== null && bannerShown !== null && typeof bannerNode.offsetHeight === "number"
        ? bannerNode.offsetHeight
        : 0;
    style.setProperty(BANNER_HEIGHT_PROPERTY, height + "px");
  }

  // The test fakes have no removeAttribute.
  function removeAttribute(node, name) {
    if (typeof node.removeAttribute === "function") {
      node.removeAttribute(name);
    }
  }

  function bannerIcon(kind) {
    return kind === "working" ? spinner() : icon(BANNER_ICON_BY_KIND[kind], BANNER_ICON_SIZE);
  }

  // A banner button; the label stays a child text node, as the screens' tests read it.
  function bannerButton(action) {
    const attrs = { class: "banner__action btn btn--secondary", type: "button" };
    if (typeof action.onClick === "function") {
      attrs.onClick = action.onClick;
    }
    return el("button", attrs, String(action.label || ""));
  }

  // True when keyboard focus sits in the banner, so a screen can place it after a banner action
  // takes the strip down. Some test fakes have no activeElement, and some no contains().
  function bannerHoldsFocus() {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || bannerNode === null || typeof bannerNode.contains !== "function") {
      return false;
    }
    return active === bannerNode || bannerNode.contains(active);
  }

  const banner = Object.freeze({
    mount: mountBanner,
    show: showBanner,
    hide: hideBanner,
    current: currentBanner,
    holdsFocus: bannerHoldsFocus,
    KINDS: BANNER_KINDS,
  });

  app.ui = {
    el,
    clear,
    renderState,
    announce,
    banner,
    canSpeak,
    speak,
    SPEECH_OUTCOMES,
    formatClock,
    formatDate,
    formatDay,
    icon,
    getTheme,
    applyTheme,
    setTheme,
    nextTheme,
  };
})();
