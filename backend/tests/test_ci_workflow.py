"""CI runs exactly the three checks CLAUDE.md asks for before every commit, on the versions the
repo targets, and the README shows its badge."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
BADGE = "https://github.com/abaooba/speech-coach/actions/workflows/ci.yml/badge.svg"


def test_workflow_runs_ruff_pytest_and_the_node_tests() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    for command in ("ruff check .", "pytest -q", "node --test frontend/tests"):
        assert f"run: {command}" in text, command


def test_workflow_installs_both_requirement_files() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "pip install -r requirements.txt -r requirements-dev.txt" in text


def test_workflow_pins_python_313() -> None:
    assert 'python-version: "3.13"' in WORKFLOW.read_text(encoding="utf-8")


def test_workflow_runs_on_pushes_to_main_and_pull_requests() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "pull_request:" in text
    assert "branches: [main]" in text


def test_readme_shows_the_ci_badge_near_the_top() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert BADGE in readme
    assert readme.index(BADGE) < readme.index("## Screenshots")


def test_workflow_token_is_read_only() -> None:
    assert "permissions:\n  contents: read" in WORKFLOW.read_text(encoding="utf-8")
