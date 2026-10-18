/* sheet.js: app.sheet, the bottom sheet that follows every take and Path level result, and the
   one-time guide sheets that explain each tab on a first visit (docs/superpowers/specs/
   2026-10-17-guided-coach-design.md Phase 5; markup and sizes in frontend/DESIGN.md and
   styles.css section "Sheet").
     app.sheet.open({label, line, why?, status?, title?, icon?, primary, secondary?, extra?,
                     content?, onClose?}) -> {update(line), clearStatus(), close()}
       label     "Coach" or "Guide" (the dialog's name); icon "mic" (default) or "compass"
       line      the one-sentence coach line; with `title` it is a guide's body text instead
       status    {kind: "loading" | "ok" | "pill", text} on the label row's right side
       primary   {label, icon?, onSelect}: the one big next-step button
       secondary, extra   {label, icon?, onSelect}: the small links under it
       content   a node shown between the line and the primary button (the level guide's loop)
     app.sheet.guideOnce(name, {title, line, primary, content?}) -> Promise<boolean shown>
       shows a guide the first time only, using the store flag `guideSeen:<name>`; primary is
       the button's label (or {label, onSelect}).
   Only one sheet is open at a time. While it is open the rest of the page is inert, Tab stays
   inside it, Esc, the scrim and the handle close it, and focus returns to what opened it. With
   no document.body (a test fake) every call does nothing. A route change (hashchange) closes it.
   `line` is a string or parts [{text}, {text, quote: "restart" | "filler" | "pause"}];
   app.sheet.quoteParts(text, kind) builds parts from a line naming one quoted phrase, and
   app.sheet.lineParts(headline, moments) from a coach headline {text, momentId}, its quote in the
   mark of the moment it names. app.sheet.fillLine(node, parts, quoteClass?) draws parts into a
   node (quotes as span.<quoteClass>--<kind>, "sheet__quote" by default). Results, the Coach card
   and the Level screen draw the coach's line with these three. */
(function () {
  "use strict";

  const CLOSE_MS = 200;
  const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
  const GUIDE_FLAG_PREFIX = "guideSeen:";
  const LABEL_ID = "sheet-label";
  const LINE_ID = "sheet-line";
  const TITLE_ID = "sheet-title";
  const OWN_MARK = "data-sheet";
  const LIVE_REGION_ID = "live";
  // A quoted phrase is marked as its transcript mark for a restart or a filler; anything else
  // (a pause, an unknown kind) is shown plain, as "pause".
  const MARKED_QUOTES = ["restart", "filler"];
  const PLAIN_QUOTE = "pause";
  const QUOTED = /[“"]([^”"]+)[”"]/;
  const DEFAULT_QUOTE_CLASS = "sheet__quote";

  let current = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  // The mark a quote of a moment of `kind` gets: its own for a restart or a filler, else plain.
  function quoteKind(kind) {
    return MARKED_QUOTES.includes(kind) ? kind : PLAIN_QUOTE;
  }

  // Fills `node` from a list of parts [{text}, {text, quote: kind}]: a quote part becomes
  // span.<quoteClass> <quoteClass>--<kind> inside curly quotes. Built node by node, never as
  // markup; whatever the node held before is replaced.
  function fillLine(node, parts, quoteClass) {
    const base = quoteClass || DEFAULT_QUOTE_CLASS;
    while (node.children && node.children.length > 0) {
      node.removeChild(node.children[0]);
    }
    node.textContent = "";
    listOf(parts).forEach((part) => {
      if (part && part.quote) {
        const name = base + " " + base + "--" + quoteKind(part.quote);
        node.appendChild(el("span", name, "“" + part.text + "”"));
      } else if (part) {
        node.appendChild(document.createTextNode(part.text));
      }
    });
  }

  // Fills `node` from a plain string or a list of parts (fillLine).
  function setLine(node, line) {
    if (Array.isArray(line)) {
      fillLine(node, line);
      return;
    }
    fillLine(node, []);
    node.textContent = line === undefined || line === null ? "" : String(line);
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function plainText(line) {
    return Array.isArray(line)
      ? line.map((part) => (part.quote ? "“" + part.text + "”" : part.text)).join("")
      : String(line === undefined || line === null ? "" : line);
  }

  // Turns a plain line into parts by wrapping its first quoted segment (“…” or "…") in a quote of
  // `kind` ("restart", "filler"; any other kind is shown plain). No quoted segment: [{text}].
  function quoteParts(text, kind) {
    const line = String(text === undefined || text === null ? "" : text);
    const match = QUOTED.exec(line);
    if (!match) {
      return [{ text: line }];
    }
    const quote = quoteKind(kind);
    const parts = [];
    if (match.index > 0) {
      parts.push({ text: line.slice(0, match.index) });
    }
    parts.push({ text: match[1], quote });
    const after = line.slice(match.index + match[0].length);
    if (after) {
      parts.push({ text: after });
    }
    return parts;
  }

  // A coach headline {text, momentId} as parts: its first quoted words in the mark of the moment
  // it names among `moments` (plain when it names none, or one not listed).
  function lineParts(headline, moments) {
    const given = headline && typeof headline === "object" ? headline : {};
    const moment = given.momentId
      ? listOf(moments).find((entry) => entry && entry.id === given.momentId)
      : null;
    return quoteParts(given.text, moment ? moment.kind : null);
  }

  function addIcon(parent, name, size) {
    const svg = app.ui && app.ui.icon ? app.ui.icon(name, size) : null;
    if (svg) {
      parent.appendChild(svg);
    }
    return svg;
  }

  function animates() {
    return (
      typeof globalThis.matchMedia === "function" && globalThis.matchMedia(MOTION_QUERY).matches
    );
  }

  function statusNode(status) {
    const kind = status.kind;
    if (kind === "ok") {
      const pill = el("span", "sheet__pill--ok");
      addIcon(pill, "check", 14);
      pill.appendChild(document.createTextNode(status.text));
      return pill;
    }
    if (kind === "pill") {
      return el("span", "sheet__pill", status.text);
    }
    const node = el("span", "sheet__status");
    node.setAttribute("role", "status");
    node.appendChild(el("span", "spinner sheet__spinner"));
    node.appendChild(document.createTextNode(status.text));
    return node;
  }

  function button(className, spec) {
    const node = el("button", className);
    node.setAttribute("type", "button");
    node.appendChild(document.createTextNode(spec.label));
    if (spec.icon) {
      addIcon(node, spec.icon, 20);
    }
    return node;
  }

  // Makes the rest of the page unreachable; returns a function that puts it back as it was.
  function hideBackground(body) {
    const undo = [];
    Array.from(body.children || []).forEach((node) => {
      if (node.getAttribute && node.getAttribute(OWN_MARK)) {
        return;
      }
      // The live region stays reachable, or update()'s announcement would be silent.
      if (node.getAttribute && node.getAttribute("id") === LIVE_REGION_ID) {
        return;
      }
      if ("inert" in node) {
        const before = node.inert;
        node.inert = true;
        undo.push(() => {
          node.inert = before;
        });
        return;
      }
      const before = node.getAttribute("aria-hidden");
      node.setAttribute("aria-hidden", "true");
      undo.push(() => {
        if (before === null) {
          node.removeAttribute("aria-hidden");
        } else {
          node.setAttribute("aria-hidden", before);
        }
      });
    });
    return () => undo.forEach((fn) => fn());
  }

  // Focus goes back to what opened the sheet; if that is gone (a route change replaced it), to
  // the current screen's heading, else the main region.
  function returnFocus(opener) {
    if (opener && opener.isConnected !== false && typeof opener.focus === "function") {
      opener.focus();
      return;
    }
    const find = typeof document.querySelector === "function" ? document.querySelector.bind(document) : null;
    const target = find && (find(".screen--active h1") || find("main"));
    if (target && typeof target.focus === "function") {
      target.setAttribute("tabindex", "-1");
      target.focus();
    }
  }

  const NO_OP_HANDLE = Object.freeze({
    update() {},
    clearStatus() {},
    close() {},
  });

  function open(options) {
    const body = document.body;
    if (!body || !options) {
      return NO_OP_HANDLE;
    }
    const prior = current;
    const opener = prior ? prior.opener : document.activeElement;
    if (prior) {
      prior.close(false);
    }

    const isGuide = Boolean(options.title);
    const scrim = el("div", "sheet-scrim");
    const sheet = el("div", "sheet");
    [scrim, sheet].forEach((node) => node.setAttribute(OWN_MARK, "1"));
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", isGuide ? TITLE_ID : LABEL_ID);
    sheet.setAttribute("aria-describedby", LINE_ID);

    const handle = el("button", "sheet__handle");
    handle.setAttribute("type", "button");
    handle.setAttribute("aria-label", "Close");
    sheet.appendChild(handle);

    const label = el("p", "sheet__label");
    label.setAttribute("id", LABEL_ID);
    addIcon(label, options.icon || (isGuide ? "compass" : "mic"), 20);
    label.appendChild(document.createTextNode(options.label || ""));
    let status = null;
    // Only the "Reading your take…" spinner goes when the line arrives; a pill ("Level 1
    // cleared") says something that stays true.
    const statusLoads = !options.status || (options.status.kind !== "ok" && options.status.kind !== "pill");
    if (options.status) {
      status = statusNode(options.status);
      status.className += " sheet__label-end";
      label.appendChild(status);
    }
    sheet.appendChild(label);

    if (isGuide) {
      const title = el("h2", "sheet__title", options.title);
      title.setAttribute("id", TITLE_ID);
      sheet.appendChild(title);
    }
    const line = el("p", isGuide ? "sheet__text" : "sheet__line");
    setLine(line, options.line || "");
    line.setAttribute("id", LINE_ID);
    sheet.appendChild(line);
    if (options.why) {
      sheet.appendChild(el("p", "sheet__why", options.why));
    }
    if (options.content) {
      const extra = el("div", "sheet__extra");
      extra.appendChild(options.content);
      sheet.appendChild(extra);
    }

    const primary = button("btn btn--primary btn--block sheet__primary", options.primary);
    sheet.appendChild(primary);
    const actions = [{ node: primary, spec: options.primary }];
    const links = [options.secondary, options.extra].filter(Boolean);
    if (links.length > 0) {
      const row = el("div", "sheet__links");
      links.forEach((spec, index) => {
        const link = button("btn btn--ghost" + (index === 1 ? " sheet__grammar" : ""), spec);
        row.appendChild(link);
        actions.push({ node: link, spec });
      });
      sheet.appendChild(row);
    }

    const restoreBackground = hideBackground(body);
    body.appendChild(scrim);
    body.appendChild(sheet);

    const tabOrder = [handle, ...actions.map((action) => action.node)];
    let closed = false;

    function removeNodes() {
      [scrim, sheet].forEach((node) => {
        try {
          body.removeChild(node);
        } catch (error) {
          // Already gone.
        }
      });
    }

    function close(restoreFocus = true) {
      if (closed) {
        return;
      }
      closed = true;
      if (current && current.sheet === sheet) {
        current = null;
      }
      document.removeEventListener("keydown", onKey);
      if (typeof globalThis.removeEventListener === "function") {
        globalThis.removeEventListener("hashchange", onRoute);
      }
      restoreBackground();
      if (animates()) {
        sheet.classList.add("sheet--closing");
        scrim.classList.add("sheet-scrim--closing");
        setTimeout(removeNodes, CLOSE_MS);
      } else {
        removeNodes();
      }
      if (restoreFocus) {
        returnFocus(opener);
      }
      if (typeof options.onClose === "function") {
        options.onClose();
      }
    }

    function onRoute() {
      close(false);
    }

    function onKey(event) {
      if (event.key === "Escape") {
        if (event.preventDefault) {
          event.preventDefault();
        }
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const index = tabOrder.indexOf(document.activeElement);
      const last = tabOrder.length - 1;
      let target = null;
      if (index === -1) {
        target = event.shiftKey ? tabOrder[last] : tabOrder[0];
      } else if (event.shiftKey && index === 0) {
        target = tabOrder[last];
      } else if (!event.shiftKey && index === last) {
        target = tabOrder[0];
      }
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("hashchange", onRoute);
    }
    scrim.addEventListener("click", () => close());
    handle.addEventListener("click", () => close());
    actions.forEach(({ node, spec }) => {
      node.addEventListener("click", () => {
        close();
        if (typeof spec.onSelect === "function") {
          spec.onSelect();
        }
      });
    });

    current = { sheet, opener, close };
    primary.focus();

    function clearStatus() {
      if (status && !closed) {
        label.removeChild(status);
        status = null;
      }
    }

    return {
      update(text) {
        if (closed) {
          return;
        }
        setLine(line, text);
        if (statusLoads) {
          clearStatus();
        }
        if (animates()) {
          line.classList.remove("sheet__line--fresh");
          void line.offsetWidth;
          line.classList.add("sheet__line--fresh");
        }
        if (app.ui && app.ui.announce) {
          app.ui.announce(plainText(text));
        }
      },
      clearStatus,
      close() {
        close();
      },
    };
  }

  // Shows a guide sheet the first time `name` is seen. Resolves true when it was shown.
  async function guideOnce(name, content) {
    if (!document.body || !app.store || !content || current !== null) {
      return false;
    }
    const flag = GUIDE_FLAG_PREFIX + name;
    try {
      if (await app.store.getFlag(flag)) {
        return false;
      }
      // Another sheet may have opened while the flag was read; a guide never stacks on it.
      if (current !== null) {
        return false;
      }
    } catch (error) {
      return false;
    }
    const primary =
      typeof content.primary === "string" ? { label: content.primary } : content.primary;
    open({
      label: "Guide",
      icon: "compass",
      title: content.title,
      line: content.line,
      content: content.content,
      primary,
    });
    try {
      await app.store.setFlag(flag, true);
    } catch (error) {
      // The guide is already on screen; it may show again next visit.
    }
    return true;
  }

  // --- First-visit guides ---------------------------------------------------------------------

  // The copy of each guide (fluency language only). The sheet's label is "Guide", and closing it
  // any way counts as seen.
  const GUIDES = Object.freeze({
    practice: {
      title: "Your first take",
      line:
        "Pick a topic, tap the red button and talk for a minute. Results show every pause, " +
        "um and restart at the second it happened.",
      primary: "Got it",
    },
    path: {
      title: "Your path",
      line:
        "Each level is one short drill: two takes with a quick review between them. " +
        "Clear a level to open the next one.",
      primary: "Got it",
    },
    progress: {
      title: "Your progress",
      line:
        "Every take adds a point to these charts. Practice on a few different days to see " +
        "your trend.",
      primary: "Got it",
    },
    history: {
      title: "Your takes",
      line: "Every take stays on this phone, and only there. Tap one to open its results again.",
      primary: "Got it",
    },
    level: {
      title: "How a level works",
      line:
        "Take 1, then a 30-second look at your moments, then take 2 with one fix in mind. " +
        "Take 2 decides the level.",
      primary: "Start take 1",
    },
  });
  const LOOP_STEPS = Object.freeze(["Take 1", "Review", "Take 2"]);
  const ONBOARDED_FLAG = "onboarded";

  // The take 1 -> review -> take 2 diagram of the level guide; take 2 is marked as the one that
  // counts. Decorative, not interactive.
  function loopDiagram() {
    const loop = el("div", "loop");
    loop.setAttribute("aria-hidden", "true");
    LOOP_STEPS.forEach((name, index) => {
      if (index > 0) {
        addIcon(loop, "arrow-right", 20);
      }
      const counts = index === LOOP_STEPS.length - 1;
      const node = el("div", "loop__node" + (counts ? " loop__node--counts" : ""));
      node.appendChild(el("span", "loop__pill", name));
      node.appendChild(el("span", "loop__note", counts ? "counts" : ""));
      loop.appendChild(node);
    });
    return loop;
  }

  // Shows the named guide the first time it is visited. Never while another sheet is open, never
  // before onboarding is done, never without a page. `options.primary` ({label, onSelect}) may
  // replace the guide's button (the level guide's "Start take 1" starts it). Resolves whether the
  // guide was shown; never rejects.
  async function firstVisit(name, options) {
    const guide = GUIDES[name];
    if (!guide || !document.body || !app.store || current !== null) {
      return false;
    }
    try {
      if ((await app.store.getFlag(ONBOARDED_FLAG)) !== true) {
        return false;
      }
      const given = options || {};
      const content = {
        title: guide.title,
        line: guide.line,
        primary: given.primary || guide.primary,
      };
      if (name === "level") {
        content.content = loopDiagram();
      }
      return await guideOnce(name, content);
    } catch (error) {
      return false;
    }
  }

  app.sheet = { open, guideOnce, firstVisit, quoteParts, lineParts, fillLine, GUIDES };
})();
