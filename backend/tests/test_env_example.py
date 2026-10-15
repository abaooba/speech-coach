"""`.env.example` and the README's deploy steps name every secret render.yaml declares.

A developer copies .env.example to .env and fills it in; a deployer pastes the same names into
Render. Both lists are read here so neither can fall behind render.yaml (test_render_blueprint.py).
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")

SECRETS = [
    "ASSEMBLYAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "SESSION_SECRET",
]


def deploy_section() -> str:
    start = README.index("## Deploy to Render")
    end = README.index("### Install on a phone")
    return README[start:end]


def test_env_example_lists_every_secret_with_an_empty_value() -> None:
    for name in SECRETS:
        assert re.search(rf"^{name}=$", ENV_EXAMPLE, re.MULTILINE), f"{name}= missing or filled"


def test_env_example_holds_no_value_for_any_secret() -> None:
    for name in SECRETS:
        assert not re.search(rf"^{name}=.+$", ENV_EXAMPLE, re.MULTILINE), f"{name} has a value"


def test_readme_deploy_step_names_every_secret() -> None:
    section = deploy_section()
    for name in SECRETS:
        assert f"`{name}`" in section, f"the deploy section does not name {name}"


def test_readme_says_what_each_optional_secret_turns_on() -> None:
    section = deploy_section()
    assert "coach notes" in section.lower()
    assert "accounts" in section.lower()
    assert "Starter" in section, "the deploy section names the plan that stops the cold start"


def test_readme_deploy_step_tells_the_owner_to_change_render_yaml_too() -> None:
    assert "`plan: starter`" in deploy_section()
