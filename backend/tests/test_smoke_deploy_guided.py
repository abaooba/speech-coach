"""scripts/smoke_deploy.py also checks the guided coach's two routes (final review finding 10).

"coach moments" sends /api/advice a take's moments and passes when the reply has the guided
coach's shape (a `headline` key, null or not, beside `tips`); "language check" sends
/api/language-check a transcript and passes on status "ok" or "unavailable" (the check is
optional: "unavailable" only means no key or a spent budget, which the coach notes check already
reports). Every request goes through httpx.MockTransport; pytest-socket blocks the network.
"""

import json

import httpx

from backend.advice.coach import AdviceRequest
from backend.language.check import LanguageCheckRequest
from scripts import smoke_deploy as smoke

BASE = "https://example.test"
NAMES = ["health", "coach notes", "coach moments", "language check"]


def client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def deploy(*, headline: bool = True, language: dict | None = None):
    """A fake deploy: advice answers with a headline key when `headline`, and the language
    check answers `language` (status ok by default)."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/api/advice" and request.method == "POST":
            body = {"tips": [{"entry_id": "filler-001", "moment_ids": []}], "source": "ai"}
            if headline:
                body["headline"] = None
            return httpx.Response(200, json=body)
        if path == "/api/language-check" and request.method == "POST":
            reply = language or {
                "status": "ok", "fixes": [], "words": [], "rewrites": [], "praise": None,
            }
            return httpx.Response(200, json=reply)
        return httpx.Response(404)

    return handler


def checks_of(handler) -> dict[str, tuple[bool, str]]:
    return {name: (ok, detail) for name, ok, detail in smoke.run(BASE, client_for(handler))}


def test_the_checks_run_in_order_and_a_guided_coach_deploy_passes_them_all() -> None:
    checks = smoke.run(BASE, client_for(deploy()))
    assert [name for name, _, _ in checks] == NAMES
    assert all(ok for _, ok, _ in checks), checks


def test_the_moments_body_is_a_valid_request_that_carries_moments() -> None:
    request = AdviceRequest.model_validate(smoke.MOMENTS_ADVICE_BODY)
    assert request.moments, "the check sends moments"


def test_the_moments_check_sends_the_moments_body() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/advice":
            seen.append(json.loads(request.content))
        return deploy()(request)

    smoke.run(BASE, client_for(handler))
    assert any("moments" in body for body in seen)
    assert any("moments" not in body for body in seen), "the coach notes check stays as it was"


def test_a_reply_without_a_headline_key_fails_coach_moments() -> None:
    ok, detail = checks_of(deploy(headline=False))["coach moments"]
    assert ok is False
    assert detail == (
        "POST /api/advice with moments answered without a headline: the deploy runs code "
        "from before the guided coach"
    )


def test_a_headline_key_passes_coach_moments() -> None:
    ok, detail = checks_of(deploy())["coach moments"]
    assert ok is True
    assert detail == "POST /api/advice with moments answered with a headline key"


def test_the_language_body_is_a_valid_request() -> None:
    LanguageCheckRequest.model_validate(smoke.LANGUAGE_BODY)


def test_the_language_check_passes_on_ok_and_on_unavailable() -> None:
    assert checks_of(deploy())["language check"] == (
        True, "POST /api/language-check answered with status 'ok'",
    )
    unavailable = deploy(language={"status": "unavailable"})
    assert checks_of(unavailable)["language check"] == (
        True,
        (
            "POST /api/language-check answered with status 'unavailable': no ANTHROPIC_API_KEY, "
            "or the hour's budget is spent"
        ),
    )


def test_the_language_check_fails_on_any_other_answer() -> None:
    odd = deploy(language={"status": "maybe"})
    assert checks_of(odd)["language check"] == (
        False, "POST /api/language-check answered with status 'maybe'",
    )

    def missing(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/language-check":
            return httpx.Response(404)
        return deploy()(request)

    assert checks_of(missing)["language check"] == (
        False, "POST /api/language-check answered 404",
    )

    def splash(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/language-check":
            return httpx.Response(200, text="<html>Bad gateway</html>")
        return deploy()(request)

    assert checks_of(splash)["language check"] == (
        False, "POST /api/language-check answered 200 with a non-JSON body",
    )


def test_a_dead_host_fails_the_new_checks_without_raising() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    checks = checks_of(down)
    assert checks["coach moments"] == (False, "POST /api/advice failed: ConnectError")
    assert checks["language check"] == (False, "POST /api/language-check failed: ConnectError")


def test_the_real_app_without_a_key_passes_both_new_checks(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from backend import app as app_module
    from backend.advice import coach

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    try:
        app_client = TestClient(app_module.app)
        advice = app_client.post("/api/advice", json=smoke.MOMENTS_ADVICE_BODY)
        assert advice.status_code == 200, advice.text
        assert "headline" in advice.json()
        language = app_client.post("/api/language-check", json=smoke.LANGUAGE_BODY)
        assert language.status_code == 200, language.text
        assert language.json()["status"] in smoke.LANGUAGE_STATUSES
    finally:
        coach.client_for_key.cache_clear()
