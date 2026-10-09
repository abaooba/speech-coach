# Speech Coach: conventions for any agent working in this repo

Read docs/PLAN.md first. It is the source of truth for priorities and scope.

## Project
Practice tool for debaters: record a speech, get pace / pause / filler
metrics, track progress. FastAPI backend in backend/, plain HTML/CSS/JS PWA
in frontend/. Spec: docs/superpowers/specs/2026-10-08-speech-coach-design.md

## How to work
- One task per session. Do exactly the task you were given, nothing else.
- Test first: write or extend tests, watch them fail, make them pass.
- Run `.venv/bin/pytest -q` and `.venv/bin/ruff check .` before every commit.
  Both must pass. Never skip, delete, weaken or mark tests as expected-fail.
- Commit small and often with clear messages. Never push. Never touch main.
- No placeholders, no TODO stubs, no "implement later". If a task cannot be
  finished, stop and say so in the report.
- Keep files focused. Pure functions for metrics, no I/O in them.
- Frontend: no frameworks, no build step, no CDN scripts. Vanilla only.
- Never read or print .env. Never add API keys to code or logs.
- Do not edit: docs/PLAN.md, docs/challenge-notes.md, CLAUDE.md,
  tasks/queue.json, anything under automation/ or .claude/, existing test
  files. New test files are fine.

## Style
- Python 3.13, type hints, ruff clean, line length 100.
- JS: ES2020, small modules, no globals except a single `app` namespace.
- Name things for a judge reading the code cold.
