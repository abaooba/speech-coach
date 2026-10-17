# Guided coach: existing tests changed or deleted

Owner decision 2026-10-17: existing tests may be edited or deleted where one of the guided-coach
decisions (docs/superpowers/specs/2026-10-17-guided-coach-design.md) changes what they pin. Every
change is listed here. A check that still applies is never weakened.

| Test | Old pin | New pin | Why (decision) |
|---|---|---|---|
| frontend/tests/api.test.js ("api.js assigns exactly app.api...") | app.api keys are exactly `analyze`, `messages` | keys are exactly `analyze`, `messages`, `postJson` | Accounts removed (owner decision 2026-10-17): tips.js posts advice through the new app.api.postJson |
| frontend/tests/coach_notes.test.js | coachNotes asks through a fake `app.auth.request(method, url, body)`; "without auth" gives null | same assertions (URL, POST, body, shared request, null cases) through a fake `app.api.postJson(url, body)`; "without app.api" gives null | Accounts removed (owner decision 2026-10-17): tips.js no longer depends on app.auth |
| frontend/tests/coach_notes_results.test.js | Results mounted with a fake `app.auth.request`; "without auth" keeps the tips | fake `app.api.postJson`; "without app.api" keeps the tips; every other check unchanged | Accounts removed (owner decision 2026-10-17): tips.js no longer depends on app.auth |
| frontend/tests/history_session_note.test.js | History shows a "session has ended" note above the rows when app.auth reports an ended session; `.history__note` CSS rule | deleted (note removed; the `.history__note` rule is removed with the account CSS in the F3 task) | Accounts removed (owner decision 2026-10-17) |
