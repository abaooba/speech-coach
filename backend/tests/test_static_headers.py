"""Cache-Control headers from the add_cache_headers middleware in backend/app.py.

The PWA shell (/, /index.html, /sw.js, /manifest.json) must always revalidate so a deploy
shows up on the next open; other static assets may be cached for an hour; /api responses
are never stored. sw.js and manifest.json are created by a later task, so their tests
accept a 404 and only check the header when the file exists.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app import app

SHELL_CACHE_CONTROL = "no-cache"
ASSET_CACHE_CONTROL = "public, max-age=3600"
API_CACHE_CONTROL = "no-store"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.mark.parametrize("path", ["/", "/index.html"])
def test_shell_pages_are_served_with_no_cache(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["cache-control"] == SHELL_CACHE_CONTROL


@pytest.mark.parametrize("path", ["/sw.js", "/manifest.json"])
def test_optional_shell_files_use_no_cache_once_they_exist(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code in {200, 404}
    if response.status_code == 200:
        assert response.headers["cache-control"] == SHELL_CACHE_CONTROL


@pytest.mark.parametrize("path", ["/styles.css", "/app.js"])
def test_static_assets_are_cached_for_an_hour(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["cache-control"] == ASSET_CACHE_CONTROL


def test_api_responses_are_never_stored(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["cache-control"] == API_CACHE_CONTROL


def test_api_errors_are_never_stored_either(client: TestClient) -> None:
    response = client.post("/api/analyze")
    assert response.status_code == 422
    assert response.headers["cache-control"] == API_CACHE_CONTROL


def test_missing_static_file_is_a_plain_404(client: TestClient) -> None:
    response = client.get("/nope.js")
    assert response.status_code == 404
    assert "cache-control" not in response.headers
