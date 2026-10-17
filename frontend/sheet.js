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
   no document.body (a test fake) every call does nothing. */
(function () {
  "use strict";

  const CLOSE_MS = 200;
  const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
  const GUIDE_FLAG_PREFIX = "guideSeen:";
  const LABEL_ID = "sheet-label";
  const LINE_ID = "sheet-line";
  const TITLE_ID = "sheet-title";
  const OWN_MARK = "data-sheet";

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
    const line = el("p", isGuide ? "sheet__text" : "sheet__line", options.line || "");
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
      restoreBackground();
      if (animates()) {
        sheet.classList.add("sheet--closing");
        scrim.classList.add("sheet-scrim--closing");
        setTimeout(removeNodes, CLOSE_MS);
      } else {
        removeNodes();
      }
      if (restoreFocus && opener && typeof opener.focus === "function") {
        opener.focus();
      }
      if (typeof options.onClose === "function") {
        options.onClose();
      }
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
        line.textContent = text;
        clearStatus();
        if (animates()) {
          line.classList.remove("sheet__line--fresh");
          void line.offsetWidth;
          line.classList.add("sheet__line--fresh");
        }
        if (app.ui && app.ui.announce) {
          app.ui.announce(text);
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
    if (!document.body || !app.store || !content) {
      return false;
    }
    const flag = GUIDE_FLAG_PREFIX + name;
    try {
      if (await app.store.getFlag(flag)) {
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

  app.sheet = { open, guideOnce };
})();
