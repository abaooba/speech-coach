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
| frontend/tests/account_screen.test.js, account_screen_states.test.js | The #/account screen's copy, forms, states and focus | deleted (screen removed) | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/auth.test.js, auth_deadline.test.js | app.auth sign up, log in, log out, delete, request deadline | deleted (auth.js removed) | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/sync.test.js, sync_after_log_in.test.js, sync_list_wait.test.js, sync_ownership.test.js, fix_sync_deleted_elsewhere.test.js | store.js write-through, merge, queue, ownership, ended-session behaviour with a signed-in account | deleted (store.js is local-only; the local half is kept in store.test.js and store_local_only.test.js) | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/fake-account-server.js (helper) | In-memory account/sessions server for the sync tests | deleted (no test uses it) | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/store_path_fields.test.js | Topic and Path fields kept locally, and sent to and listed from the server for a signed-in speaker (3 local + 3 signed-in tests; devices load auth.js and a fake account server) | the 3 local tests kept unchanged in substance, devices load store.js only; the 3 signed-in/server tests removed | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/design_shell_docs.test.js ("index.html has the account screen...") | index.html has the account screen and loads auth.js and screens/account.js | index.html has no account screen and loads neither auth.js nor screens/account.js; the other checks (DESIGN.md rows, layout, script order) still hold against the smaller shell | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/app_nav_path.test.js | SCREENS list includes `account`; "Results and Account still mark no nav item" | `account` dropped from the list; "Results still marks no nav item" (the Results half unchanged) | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/fix_screens_app_boot.test.js | SCREEN_NAMES includes `account` | `account` dropped from the list (no such section or router name) | Accounts removed (owner decision 2026-10-17) |
| frontend/tests/path_screen_css.test.js ("the Path section is the last section") | Path section is after `/* 12. Account screen` | Path section is after `/* 11. Reduced motion` (section 12 removed); still the last section, still numbered 13 | Accounts removed (owner decision 2026-10-17) |
