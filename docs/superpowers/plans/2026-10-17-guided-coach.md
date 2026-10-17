# Guided coach: implementation plan

Spec (binding authority): docs/superpowers/specs/2026-10-17-guided-coach-design.md.
Each task below names the spec section it builds; read that section in full before starting.
Test-change table: docs/superpowers/specs/2026-10-17-guided-coach-test-changes.md (append a row
for every existing test you edit or delete: test, old pin, new pin, why).

## Global Constraints

- Branch `guided-coach`. Never push, never touch main, never read or print .env.
- Test first. Before every commit: `.venv/bin/pytest -q`, `.venv/bin/ruff check .`,
  `node --test frontend/tests` all pass.
- Existing tests may be edited or deleted ONLY where a spec decision changes what they pin; each
  goes in the change table. Never weaken a check that still applies.
- Do not edit docs/PLAN.md, docs/challenge-notes.md, CLAUDE.md, tasks/queue.json, automation/,
  .claude/.
- Python 3.13, type hints, ruff line length 100. Pure functions for metrics, no I/O in them.
- Frontend: vanilla ES2020, no frameworks/build/CDN, one `app` namespace, follow
  frontend/DESIGN.md tokens and classes.
- Audience: non-native speakers and anyone wanting to speak fluently. Never debate wording.
- Anthropic code: model `claude-haiku-5-5`, client injected so tests use a fake (pytest runs with
  --disable-socket), key from env only and never logged. Load the `claude-api` skill before
  writing Anthropic SDK code.
- Small commits, clear messages, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Accounts removal, frontend part 1 (spec Phase 1, F1 + F2)

Build F1 (`app.api.postJson` and tips.js switched to it) and F2 (History session-ended note
removed) exactly as the spec's Phase 1 says. app.auth stays loaded and working after this task;
only tips.js stops depending on it. Edit the pinned tests the spec lists for F1/F2 (api.test.js
key list, coach_notes.test.js, coach_notes_results.test.js fake-auth parts,
history_session_note.test.js deleted) and record each in the change table.

### Task 2: Accounts removal, frontend part 2 (spec Phase 1, F3 + F4)

Build F3 (account screen gone: index.html link/section/scripts, app.js SCREEN_NAMES, sw.js SHELL,
styles.css account section, DESIGN.md, docs/ARCHITECTURE.md L68) and F4 (store.js local-only with
the one-time flag migration; delete frontend/auth.js and frontend/screens/account.js and the
frontend account/auth/sync tests and fake-account-server.js). store.js keeps exactly eight public
functions. Keep CACHE_NAME as it is in this task. The backend still has accounts after this task;
that is fine. New test frontend/tests/store_local_only.test.js. Change table rows for every test.

### Task 3: Accounts removal, backend + config (spec Phase 1, B1 + B2 + B3)

Build B1 (/api/advice guest-only), B2 (delete auth.py, db.py, sessions_api.py, lifespan, routers,
limits rows, dead nul_free helpers, conftest DB fixture, smoke_deploy check_accounts) and B3
(requirements.txt, render.yaml, .env.example, README deploy section, frontend/README.md and
docs/ARCHITECTURE.md + docs/architecture.svg Neon references). New tests
backend/tests/test_advice_ignores_session_cookie.py and backend/tests/test_no_accounts.py. Delete
the backend account tests and edit the mixed ones the spec lists; change table rows for each.
Do NOT change user-facing privacy copy yet beyond removing claims about accounts that become false
(e.g. "Guests need no account" may become "No account needed."); Task 12 finalizes copy.

### Task 4: Word confidence (spec Phase 2)

Build spec Phase 2 exactly: `Word.confidence: float | None = None`, both providers fill it,
/api/analyze transcript entries carry `confidence` when present, confidence never enters metrics.
New backend/tests/test_word_confidence.py. Update the three pinned tests the spec names (change
table).

### Task 5: Coach that quotes the take, backend (spec Phase 3)

Build spec Phase 3 in backend/advice/coach.py (+ app.py response model). Requests without
`moments` must still work (old frontend in the browser cache) and return the new shape with
`headline: null` and `moment_ids: []`. New tests test_advice_moments_request.py,
test_advice_moments_prompt.py, test_advice_moments_api.py; update test_advice_api.py pins in the
change table.

### Task 6: Language check, backend (spec Phase 4, backend half)

Build `backend/language/` (`__init__.py`, `check.py`) and `POST /api/language-check` per spec
Phase 4: injected Anthropic client, 10 s timeout, shares backend/advice/budget.py, refuse NUL,
transcript ≤ 8,000 chars (else 400), structured JSON output with the caps in the spec, `said`
validation against the transcript, `{status: "unavailable"}` on any failure, `{status: "ok",
fixes, words, rewrites, praise}` on success. Add the route to backend/limits.py body limits if
that module requires every route. New backend/tests/test_language_check.py.

### Task 7: Frontend pure modules (spec Phase 5 items 1, 3, 4)

Build `app.delivery.findUnclear` (item 1), new frontend/coach.js `app.coach` with
`coachMoments(report, words)` and `coachTakeaway(moments, summary)` (item 3), tips.js sending
`moments` and `parseCoachNotes` reading `headline` + `momentIds` (item 3), and new
frontend/nextmove.js `app.nextMove` (item 4). Pure, no DOM. Add the new files to index.html
script order, sw.js SHELL and the backend shell-order list test as needed (change table). New
tests unclear_words.test.js, coach_moments.test.js, coach_takeaway.test.js,
coach_notes_moments.test.js, next_move.test.js.

### Task 8: Bottom sheet component (spec Phase 5 item 5 and the guideOnce half of item 9)

Build new frontend/sheet.js `app.sheet.open(...)` and `app.sheet.guideOnce(name, content)` with
the accessibility rules in the spec, styled from the chosen Superdesign mockup at
`.superpowers/guided-coach/design/` (read its README.md there for the picked direction; if the
folder is missing, follow DESIGN.md tokens). CSS in a new styles.css section. New
frontend/tests/sheet.test.js.

### Task 9: Results: Coach card, sheet after a take, hear words, language check UI (spec Phase 5 items 2, 6, 7 + Phase 4 frontend half)

Build the Coach card at the top of Results (item 7, replacing the bottom Tips section), the sheet
after a fresh take with `app.nextMove` (item 6), `.tok--unclear` + "Words to check" chips with
speechSynthesis (item 2), and the language check UI: new frontend/language.js `app.language`
(request, parse, `languageCheck:<id>` flag cache) rendered in the Coach card, hidden for
Read-passage takes and takes under 20 words. Follow the Superdesign mockups in
`.superpowers/guided-coach/design/`. Update Results outline pins (change table). New tests
results_coach_card.test.js, results_sheet.test.js, results_hear_words.test.js,
language_check.test.js.

### Task 10: Path levels + first-visit guides (spec Phase 5 items 8, 9)

Coach line in a level's Review after take 1, coach notes for the final take, the sheet after the
level result using `app.nextMove({after: {type: "level", ...}})`, and first-visit guide sheets on
Practice, Path, Progress, History and the first level via `app.sheet.guideOnce`. Follow the
Superdesign mockups. New tests level_coach.test.js, first_visit_guides.test.js.

### Task 11: Service worker + shell (spec Phase 5 item 10)

Make sure every new JS file is in index.html, sw.js SHELL and the shell-order tests, bump
CACHE_NAME, update the pinned pwa tests (change table). Skip any part an earlier task already did.

### Task 12: Copy and docs (spec Phase 6)

Build spec Phase 6: onboarding promise + privacy copy (exact wording in the spec), README Privacy,
how.html (coach moments, unclear-word hints never counted, language check sends the transcript
only on tap, no account), frontend/README.md, DESIGN.md (sheet, coach card, `.tok--unclear`,
word `confidence?`, the sheet as the one exception to one-primary-per-screen),
docs/ARCHITECTURE.md + architecture.svg (Anthropic arrows for coach + language check). Update
the pinned copy tests the spec names (change table). Fluency language only.
