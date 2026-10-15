"""render.yaml declares every secret the backend reads from the environment, none with a value.

docs/PLAN.md T50: DATABASE_URL, ANTHROPIC_API_KEY and SESSION_SECRET join the two speech-to-text
keys as `sync: false` entries, so Render asks for them in the dashboard and the repo never holds
one. The health check path is the one backend/app.py serves.
"""

import re
from pathlib import Path

RENDER_YAML = (Path(__file__).resolve().parents[2] / "render.yaml").read_text(encoding="utf-8")

# Every environment variable a deploy needs that is a secret: backend/providers/__init__.py,
# backend/app.py ANTHROPIC_API_KEY_VARIABLE, backend/db.py DATABASE_URL_VARIABLE and
# backend/auth.py SESSION_SECRET_VARIABLE.
SECRETS = [
    "ASSEMBLYAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "SESSION_SECRET",
]

# `- key: NAME` followed by its one setting line, as the Blueprint spec writes an envVar.
ENV_ENTRY = re.compile(r"- key: (\w+)\n\s+(\w+): (.+)")


def env_entries() -> dict[str, tuple[str, str]]:
    """{name: (setting, value)} for every envVars entry in render.yaml."""
    return {name: (setting, value) for name, setting, value in ENV_ENTRY.findall(RENDER_YAML)}


def test_every_secret_is_declared_and_never_synced_from_the_repo() -> None:
    entries = env_entries()
    for name in SECRETS:
        assert name in entries, f"render.yaml does not declare {name}"
        assert entries[name] == ("sync", "false"), f"{name} must be `sync: false`, got {entries[name]}"


def test_no_secret_carries_a_value() -> None:
    for name in SECRETS:
        assert not re.search(rf"- key: {name}\n\s+value:", RENDER_YAML), f"{name} has a value"


def test_provider_choice_and_python_version_stay_set() -> None:
    entries = env_entries()
    assert entries["STT_PROVIDER"] == ("value", "assemblyai")
    assert entries["PYTHON_VERSION"] == ("value", '"3.13.5"')


def test_health_check_path_matches_the_route() -> None:
    assert "healthCheckPath: /api/health" in RENDER_YAML
