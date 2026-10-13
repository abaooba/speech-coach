"""The app closes its database connections when it stops (backend/app.py, lifespan).

The engine built from DATABASE_URL lives as long as the server. When the server stops, as on a
Render deploy, the connections it holds are closed rather than dropped with the process, and an
in-memory SQLite database (the tests) is not left open.
"""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from backend import app as app_module
from backend import db


@pytest.mark.parametrize("where", ["in memory", "in a file"])
def test_the_app_closes_its_database_connections_when_it_stops(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, where: str
) -> None:
    url = "sqlite://" if where == "in memory" else f"sqlite:///{tmp_path}/accounts.db"
    monkeypatch.setenv("DATABASE_URL", url)
    closed: list[Any] = []

    def record_closed(dbapi_connection: Any, connection_record: Any) -> None:
        closed.append(dbapi_connection)

    with TestClient(app_module.app):
        # Starting up created the tables, through the one connection the pool now holds.
        engine = db.configured_engine()
        assert engine is not None
        event.listen(engine, "close", record_closed)
        assert closed == []

    assert len(closed) == 1
