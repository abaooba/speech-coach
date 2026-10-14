"""The .gitignore keeps local databases and every .env variant out of git, but not .env.example.

Accounts run on SQLite in development (backend/db.py), so a stray database file holds email
addresses and password hashes; a `.env.local` or `.env.production` holds API keys as `.env` does.
Git itself answers which rule decides each path. `--no-index` judges the rules alone, so the
tracked .env.example is checked against them too, and the deciding rule must come from the
repo's .gitignore: a pattern in one developer's global excludes file protects no other clone.
"""

import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GITIGNORE = ".gitignore"

IGNORED_PATHS = [
    ".env",
    ".env.local",
    ".env.production",
    "backend/.env.test",
    "accounts.db",
    "backend/speech-coach.db",
    "dev.sqlite",
    "data/local.sqlite3",
]
ENV_EXAMPLE = ".env.example"


def git_env() -> dict[str, str]:
    """The environment without GIT_* variables, so a hook's GIT_DIR cannot redirect git."""
    return {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}


def deciding_rule(path: str) -> tuple[str, str]:
    """(file, pattern) of the ignore rule that decides `path`, or ("", "") when none matches.

    A negated pattern such as "!.env.example" keeps its "!": the path is not ignored.
    """
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "check-ignore", "--verbose", "--non-matching", "--no-index",
         path],
        env=git_env(),
        capture_output=True,
        text=True,
        check=False,
    )
    # 0: a rule matched, 1: none did; anything else is git failing, which must not read as "none".
    assert result.returncode in (0, 1), result.stderr
    # Each line reads "<file>:<line>:<pattern>\t<path>", or "::\t<path>" when nothing matches.
    rule = result.stdout.partition("\t")[0]
    source, _, rest = rule.partition(":")
    return source, rest.partition(":")[2]


@pytest.mark.parametrize("path", IGNORED_PATHS)
def test_local_databases_and_env_files_are_ignored_by_the_repo(path: str) -> None:
    source, pattern = deciding_rule(path)
    assert source == GITIGNORE, f"{path} would be committed (rule: {source or 'none'})"
    assert not pattern.startswith("!"), f"{path} is let back in by {pattern}"


def test_env_example_is_let_back_in() -> None:
    assert deciding_rule(ENV_EXAMPLE) == (GITIGNORE, "!" + ENV_EXAMPLE)


def test_env_example_is_still_tracked() -> None:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files", "--error-unmatch", ENV_EXAMPLE],
        env=git_env(),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
