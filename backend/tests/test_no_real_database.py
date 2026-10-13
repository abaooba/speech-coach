"""No test reaches the database that the developer's environment names (backend/tests/conftest.py).

backend/app.py loads .env when it is imported, so a DATABASE_URL kept there for local work, which
may well be the Neon database the app runs on, is in os.environ for the whole run. --disable-socket
does not stop psycopg: libpq opens its sockets in C, where pytest-socket cannot see them. So every
test starts with DATABASE_URL unset and no engine built from it; a test that wants a database
names one itself.

The environment also holds keys such as ANTHROPIC_API_KEY, so no assertion here prints it.
"""

import os
import subprocess
import sys
from pathlib import Path

from backend import db

REPO_ROOT = Path(__file__).resolve().parents[2]
# Stands in for a real database named in .env. Nothing listens on port 9, and nothing connects.
DATABASE_URL_FROM_DOT_ENV = "postgresql://speech_coach:not-a-real-password@127.0.0.1:9/neondb"


def test_while_a_test_runs_no_database_is_configured() -> None:
    database_url_is_set = db.DATABASE_URL_VARIABLE in os.environ

    assert not database_url_is_set
    assert db.configured_engine() is None


def test_a_database_url_in_the_environment_reaches_no_test() -> None:
    test_in_a_fresh_run = f"{__file__}::test_while_a_test_runs_no_database_is_configured"

    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", test_in_a_fresh_run],
        cwd=REPO_ROOT,
        # PYTEST_ADDOPTS is dropped so that options meant for this run, such as -k, cannot
        # leave the test above unselected.
        env={
            **{name: value for name, value in os.environ.items() if name != "PYTEST_ADDOPTS"},
            db.DATABASE_URL_VARIABLE: DATABASE_URL_FROM_DOT_ENV,
        },
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
