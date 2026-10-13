/* screens/account.js: app.screens.account (#/account), the optional account (docs/PLAN.md T49).
   A guest signs up or logs in; signed in, the speaker can add this device's takes to the account
   once, log out, or delete the account after a second tap. It talks only to app.auth, and one
   line says what the server keeps and how to erase it. COPY holds every string. */
(function () {
  "use strict";

  const COPY = Object.freeze({
    checkingTitle: "Checking your account",
    checkingBody: "This takes a moment.",
    unavailableTitle: "Accounts are not available right now",
    unavailableBody: "Your takes stay on this device, and everything else works as before.",
    unavailableAction: "Practice",
    offlineTitle: "Could not reach the server",
    offlineBody: "Check your connection, then try again.",
    retry: "Try again",
    lead:
      "An account keeps your takes on every device you use. " +
      "Without one, they stay on this device.",
    modes: "Sign up or log in",
    signUp: "Sign up",
    logIn: "Log in",
    email: "Email",
    password: "Password",
    passwordHint: "At least 10 characters.",
    createAccount: "Create account",
    privacy:
      "Your account keeps each take's metrics and transcript on our server, never audio. " +
      "Deleting the account here erases them.",
    signedInAs: "Signed in as ",
    offlineNote: "You are offline. Takes save on this device and sync later.",
    addTakes: "Add to account",
    keepTakes: "Keep on this device",
    waiting: "Your takes join your account once you are back online.",
    logOut: "Log out",
    deleteAccount: "Delete account",
    deleteGroup: "Delete account?",
    deletePrompt:
      "Delete your account and every take it keeps on our server? Takes on this device stay here.",
    cancel: "Cancel",
    signedIn: "Signed in",
    loggedOut: "Logged out",
    deleted: "Account deleted",
  });

  // "1 take", "3 takes".
  function takesText(count) {
    return count + (count === 1 ? " take" : " takes");
  }

  function offerText(count) {
    const them = count === 1 ? "it" : "them";
    return (
      "This device has " + takesText(count) + " from before you signed in. Add " + them +
      " to your account?"
    );
  }

  function addedText(count) {
    return "Added " + takesText(count) + " to your account.";
  }

  function keptHereText(count) {
    return takesText(count) + (count === 1 ? " stays" : " stay") + " on this device only.";
  }

  // The guest form's two choices, in the order the switch shows them.
  const SIGN_UP = "signUp";
  const LOG_IN = "logIn";
  const MODES = [SIGN_UP, LOG_IN];
  const EMAIL_INPUT_ID = "account-email";
  const PASSWORD_INPUT_ID = "account-password";
  const PASSWORD_HINT_ID = "account-password-hint";
  // backend/auth.py MAX_EMAIL_LENGTH and MAX_PASSWORD_LENGTH.
  const EMAIL_MAX_LENGTH = "254";
  const PASSWORD_MAX_LENGTH = "256";
  const ERROR_ICON = "alert";
  const ERROR_ICON_SIZE = 16;
  const PRACTICE_SCREEN = "practice";
  // auth.js's failure kinds this screen tells apart.
  const UNAVAILABLE = "unavailable";
  const SIGNED_OUT = "signed_out";

  // The screen's .screen__body; every view is rebuilt inside it.
  let body = null;
  // Counts show() calls, so an answer for an earlier visit never paints over a newer one.
  let showCount = 0;
  // The guest form's choice and what was typed, kept while the app is open, so switching between
  // Sign up and Log in keeps both fields. The password goes once it has been sent or the screen
  // is left. `fields` is the form on screen, {email, password, error, submit, busy}, or null.
  let mode = SIGN_UP;
  const typed = { email: "", password: "" };
  let fields = null;

  function el(tag, attrs, children) {
    return app.ui.el(tag, attrs, children);
  }

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  function show() {
    return check(++showCount);
  }

  // show() asks the server again every time; only a typed password is let go.
  function hide() {
    typed.password = "";
  }

  // Asks the server who this browser is signed in as, then draws the matching view.
  async function check(ticket) {
    app.ui.renderState(body, {
      kind: "loading",
      title: COPY.checkingTitle,
      body: COPY.checkingBody,
    });
    let email = null;
    let failure = null;
    try {
      email = await app.auth.me();
    } catch (error) {
      failure = error;
    }
    if (ticket !== showCount) {
      return;
    }
    if (failure === null) {
      await (email === null ? renderGuest(ticket) : renderSignedIn(ticket, email, {}));
      return;
    }
    if (failure && failure.kind === UNAVAILABLE) {
      renderUnavailable();
      return;
    }
    // No reply: a device signed in before keeps its account, which works offline; a guest can
    // only try again.
    const known = await lastKnownAccount();
    if (ticket !== showCount) {
      return;
    }
    if (known === null) {
      renderOffline();
    } else {
      await renderSignedIn(ticket, known, { offline: true });
    }
  }

  async function lastKnownAccount() {
    try {
      return await app.auth.account();
    } catch {
      return null;
    }
  }

  // Accounts are off on this server: guests carry on as before, so this is all there is to say.
  function renderUnavailable() {
    app.ui.renderState(body, {
      kind: "empty",
      title: COPY.unavailableTitle,
      body: COPY.unavailableBody,
      actionLabel: COPY.unavailableAction,
      onAction: () => app.router.go(PRACTICE_SCREEN),
    });
  }

  function renderOffline() {
    app.ui.renderState(body, {
      kind: "error",
      title: COPY.offlineTitle,
      body: COPY.offlineBody,
      actionLabel: COPY.retry,
      onAction: () => show(),
    });
  }

  // --- a guest: sign up or log in --------------------------------------------------------------

  // `focusTarget` is "lead" to move focus to the first line, or a mode to keep it on the switch.
  async function renderGuest(ticket, focusTarget) {
    if (ticket !== showCount) {
      return;
    }
    app.ui.clear(body);
    const lead = el("p", { class: "account__lead", tabindex: "-1", text: COPY.lead });
    const modes = buildModeSwitch();
    body.appendChild(lead);
    body.appendChild(modes);
    body.appendChild(buildForm());
    body.appendChild(el("p", { class: "account__privacy", text: COPY.privacy }));
    if (focusTarget === "lead") {
      focusIfPossible(lead);
    } else if (MODES.includes(focusTarget)) {
      focusIfPossible(modes.children[MODES.indexOf(focusTarget)]);
    }
  }

  // Sign up or Log in, as a segmented control (DESIGN.md section 6).
  function buildModeSwitch() {
    const options = MODES.map((name) => {
      const selected = name === mode;
      return el(
        "button",
        {
          class: "segmented__option" + (selected ? " segmented__option--selected" : ""),
          type: "button",
          "aria-pressed": String(selected),
          onClick: () => switchMode(name),
        },
        name === SIGN_UP ? COPY.signUp : COPY.logIn,
      );
    });
    return el(
      "div",
      { class: "segmented account__modes", role: "group", "aria-label": COPY.modes },
      options,
    );
  }

  function switchMode(name) {
    if (name === mode) {
      return;
    }
    keepTyped();
    mode = name;
    renderGuest(showCount, name);
  }

  function keepTyped() {
    if (fields !== null) {
      typed.email = valueOf(fields.email);
      typed.password = valueOf(fields.password);
    }
  }

  // The form for the current mode. The browser's own checks are off (novalidate): auth.js checks
  // what is typed and every slip reads in the same words.
  function buildForm() {
    const signingUp = mode === SIGN_UP;
    const email = el("input", {
      class: "account__input",
      id: EMAIL_INPUT_ID,
      type: "email",
      name: "email",
      autocomplete: "email",
      inputmode: "email",
      autocapitalize: "off",
      spellcheck: "false",
      maxlength: EMAIL_MAX_LENGTH,
      required: "",
    });
    email.value = typed.email;
    const passwordAttrs = {
      class: "account__input",
      id: PASSWORD_INPUT_ID,
      type: "password",
      name: "password",
      autocomplete: signingUp ? "new-password" : "current-password",
      maxlength: PASSWORD_MAX_LENGTH,
      required: "",
    };
    if (signingUp) {
      passwordAttrs["aria-describedby"] = PASSWORD_HINT_ID;
    }
    const password = el("input", passwordAttrs);
    password.value = typed.password;
    const error = el("p", { class: "account__error", role: "alert" });
    const submit = el(
      "button",
      { class: "btn btn--primary btn--block", type: "submit" },
      signingUp ? COPY.createAccount : COPY.logIn,
    );
    const form = { email, password, error, submit, busy: false };
    fields = form;
    const passwordField = el("div", { class: "account__field" }, [
      el("label", { class: "account__label", for: PASSWORD_INPUT_ID, text: COPY.password }),
      password,
      signingUp
        ? el("p", { class: "account__hint", id: PASSWORD_HINT_ID, text: COPY.passwordHint })
        : null,
    ]);
    return el(
      "form",
      { class: "account__form", novalidate: "", onSubmit: (event) => sendForm(event, form) },
      [
        el("div", { class: "account__field" }, [
          el("label", { class: "account__label", for: EMAIL_INPUT_ID, text: COPY.email }),
          email,
        ]),
        passwordField,
        error,
        submit,
      ],
    );
  }

  // Signs up or logs in with what was typed. Signed in, the account view replaces the form, with
  // focus on its first line; a failure shows its sentence above the button.
  async function sendForm(event, form) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (form.busy) {
      return;
    }
    form.busy = true;
    form.submit.disabled = true;
    showError(form.error, null);
    typed.email = valueOf(form.email);
    const ticket = showCount;
    let email;
    try {
      const password = valueOf(form.password);
      email =
        mode === SIGN_UP
          ? await app.auth.signUp(typed.email, password)
          : await app.auth.logIn(typed.email, password);
    } catch (error) {
      form.busy = false;
      form.submit.disabled = false;
      showError(form.error, sentenceFor(error));
      return;
    }
    // The password is not kept once it has done its job.
    typed.password = "";
    app.ui.announce(COPY.signedIn);
    await renderSignedIn(ticket, email, { focus: true });
  }

  function valueOf(input) {
    return typeof input.value === "string" ? input.value : "";
  }

  // auth.js's own sentence for a failure it names; anything else reads as a fault on our side.
  function sentenceFor(error) {
    const named = error && typeof error.kind === "string" && typeof error.message === "string";
    return named ? error.message : app.auth.messages.unknown;
  }

  // Shows `sentence` in the error line after the warning icon, or empties the line. The line
  // itself stays, so its role="alert" reads each new sentence out.
  function showError(line, sentence) {
    app.ui.clear(line);
    if (sentence) {
      line.appendChild(app.ui.icon(ERROR_ICON, ERROR_ICON_SIZE));
      line.appendChild(el("span", { text: sentence }));
    }
  }

  // --- signed in -------------------------------------------------------------------------------

  async function renderSignedIn(ticket, email, options) {
    fields = null;
    let offer = null;
    try {
      offer = await app.auth.guestImportOffer();
    } catch {
      offer = null;
    }
    if (ticket !== showCount) {
      return;
    }
    app.ui.clear(body);
    const status = el("p", { class: "account__status", tabindex: "-1" }, [
      COPY.signedInAs,
      el("strong", { text: email }),
    ]);
    body.appendChild(status);
    if (options.offline) {
      body.appendChild(el("p", { class: "account__note", text: COPY.offlineNote }));
    }
    if (offer !== null && offer.count > 0) {
      body.appendChild(buildOffer(offer.count, status));
    }
    body.appendChild(el("p", { class: "account__privacy", text: COPY.privacy }));
    const error = el("p", { class: "account__error", role: "alert" });
    const actions = el("div", { class: "account__actions" });
    actions.appendChild(buildLogOutButton(error));
    actions.appendChild(buildDeleteControl(error));
    body.appendChild(actions);
    body.appendChild(error);
    if (options.focus) {
      focusIfPossible(status);
    }
  }

  // The offer to add this device's guest takes, asked once an account: Add to account sends them,
  // Keep on this device leaves them here for good. Either answer replaces the card's buttons.
  function buildOffer(count, status) {
    const add = el("button", { class: "btn btn--primary", type: "button" }, COPY.addTakes);
    const keep = el("button", { class: "btn btn--ghost", type: "button" }, COPY.keepTakes);
    const card = el("section", { class: "tip-card account__offer" }, [
      el("p", { class: "account__offer-text", text: offerText(count) }),
      el("div", { class: "account__offer-actions" }, [add, keep]),
    ]);
    let answered = false;
    add.addEventListener("click", async () => {
      if (answered) {
        return;
      }
      answered = true;
      add.disabled = true;
      keep.disabled = true;
      let sentence = COPY.waiting;
      try {
        sentence = importOutcomeText(await app.auth.importGuestTakes());
      } catch {
        // The import stays queued in the store, so it finishes on a later load or reconnect.
        sentence = COPY.waiting;
      }
      const outcome = el("p", { class: "account__offer-text", tabindex: "-1", text: sentence });
      app.ui.clear(card);
      card.appendChild(outcome);
      app.ui.announce(sentence);
      focusIfPossible(outcome);
    });
    keep.addEventListener("click", async () => {
      if (answered) {
        return;
      }
      answered = true;
      add.disabled = true;
      keep.disabled = true;
      try {
        await app.auth.declineGuestImport();
      } catch {
        // Not remembered: the offer comes back on the next visit, which is the safe way to fail.
      }
      // A newer visit may have redrawn the screen meanwhile; then the card is gone already.
      if (Array.prototype.includes.call(body.children, card)) {
        body.removeChild(card);
      }
      focusIfPossible(status);
    });
    return card;
  }

  function importOutcomeText(result) {
    if (!result || result.waiting) {
      return COPY.waiting;
    }
    const kept = result.keptHere > 0 ? " " + keptHereText(result.keptHere) : "";
    return addedText(result.added) + kept;
  }

  function buildLogOutButton(error) {
    let leaving = false;
    return el(
      "button",
      {
        class: "btn btn--secondary",
        type: "button",
        onClick: async () => {
          if (leaving) {
            return;
          }
          leaving = true;
          showError(error, null);
          try {
            await app.auth.logOut();
          } catch (failure) {
            leaving = false;
            showError(error, sentenceFor(failure));
            return;
          }
          app.ui.announce(COPY.loggedOut);
          freshForm(LOG_IN);
          await renderGuest(showCount, "lead");
        },
      },
      COPY.logOut,
    );
  }

  // The Delete account button, which a tap swaps for "Delete your account ...?" with a red
  // Delete account and a ghost Cancel (as History's rows ask before deleting). Cancel brings the
  // button back; the red button deletes, once. Focus moves to Cancel, as to History's No.
  function buildDeleteControl(error) {
    const control = el("div", { class: "account__delete" });
    const trigger = () =>
      el(
        "button",
        { class: "btn btn--danger", type: "button", onClick: askFirst },
        COPY.deleteAccount,
      );
    let current = trigger();
    control.appendChild(current);

    function swapIn(next) {
      control.removeChild(current);
      current = next;
      control.appendChild(current);
    }

    function putButtonBack(moveFocus) {
      swapIn(trigger());
      if (moveFocus) {
        focusIfPossible(current);
      }
    }

    function askFirst() {
      showError(error, null);
      let answered = false;
      const confirm = el(
        "button",
        {
          class: "btn btn--danger",
          type: "button",
          onClick: async () => {
            if (answered) {
              return;
            }
            answered = true;
            confirm.disabled = true;
            cancel.disabled = true;
            await deleteNow(error, putButtonBack);
          },
        },
        COPY.deleteAccount,
      );
      const cancel = el(
        "button",
        {
          class: "btn btn--ghost",
          type: "button",
          onClick: () => {
            if (!answered) {
              answered = true;
              putButtonBack(true);
            }
          },
        },
        COPY.cancel,
      );
      swapIn(
        el(
          "div",
          { class: "account__confirm", role: "group", "aria-label": COPY.deleteGroup },
          [el("p", { class: "account__confirm-text", text: COPY.deletePrompt }), confirm, cancel],
        ),
      );
      focusIfPossible(cancel);
    }

    return control;
  }

  // Deletes the account. On success the sign-up form takes the screen, focus on its first line;
  // on failure the Delete account button comes back, focused, and the error line says why. A
  // session that ended meanwhile cannot delete anything and has signed this device out, so the
  // log-in form comes back with that sentence.
  async function deleteNow(error, putButtonBack) {
    try {
      await app.auth.deleteAccount();
    } catch (failure) {
      if (failure && failure.kind === SIGNED_OUT) {
        mode = LOG_IN;
        await renderGuest(showCount, "lead");
        if (fields !== null) {
          showError(fields.error, sentenceFor(failure));
        }
        return;
      }
      putButtonBack(true);
      showError(error, sentenceFor(failure));
      return;
    }
    app.ui.announce(COPY.deleted);
    freshForm(SIGN_UP);
    await renderGuest(showCount, "lead");
  }

  // The form as the next speaker on this device should find it, on `nextMode` (Log in after a log
  // out, Sign up once the account is deleted), with nothing typed left from the last one.
  function freshForm(nextMode) {
    mode = nextMode;
    typed.email = "";
    typed.password = "";
  }

  // Moves keyboard focus when the node can take it; the test fakes have no focus().
  function focusIfPossible(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }

  app.screens.account = { mount, show, hide, COPY };
})();
