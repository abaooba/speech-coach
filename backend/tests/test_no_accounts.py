"""The app has no accounts: the old modules are gone and the old routes do not exist."""

import importlib.util

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module

OLD_ROUTES = [
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/me"),
    ("DELETE", "/api/me"),
    ("GET", "/api/sessions"),
    ("POST", "/api/sessions"),
    ("POST", "/api/sessions/import"),
    ("GET", "/api/progress"),
    ("PUT", "/api/progress"),
]


@pytest.mark.parametrize("module", ["auth", "db", "sessions_api"])
def test_the_account_modules_are_gone(module: str) -> None:
    assert importlib.util.find_spec(f"backend.{module}") is None


def test_openapi_lists_no_account_route() -> None:
    paths = app_module.app.openapi()["paths"]
    for path in paths:
        assert not path.startswith(("/api/auth", "/api/me", "/api/sessions", "/api/progress"))


@pytest.mark.parametrize(("method", "path"), OLD_ROUTES)
def test_old_routes_answer_404_or_405_never_503(method: str, path: str) -> None:
    client = TestClient(app_module.app)
    response = client.request(method, path, json={})
    assert response.status_code in (404, 405)
