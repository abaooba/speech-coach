"""scripts/smoke_deploy.py reads a deploy's answers the way a demo rehearsal needs them.

Every request goes through httpx.MockTransport; pytest-socket blocks the network.
"""

import httpx

from scripts import smoke_deploy as smoke

BASE = "https://example.test"


def client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def healthy_deploy(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/api/health":
        return httpx.Response(200, json={"status": "ok"})
    if path == "/api/me":
        return httpx.Response(401, json={"detail": "not signed in"})
    if path == "/api/advice" and request.method == "POST":
        return httpx.Response(200, json={"tips": [{"entry_id": "filler-001"}], "source": "ai"})
    return httpx.Response(404)


def guest_only_deploy(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/api/health":
        return httpx.Response(200, json={"status": "ok"})
    if path == "/api/me":
        return httpx.Response(503, json={"detail": "accounts are not configured"})
    if path == "/api/advice":
        return httpx.Response(200, json={"tips": [], "source": "library"})
    return httpx.Response(404)


def test_a_fully_configured_deploy_passes_every_check() -> None:
    checks = smoke.run(BASE, client_for(healthy_deploy))
    assert [name for name, _, _ in checks] == ["health", "accounts", "coach notes"]
    assert all(ok for _, ok, _ in checks), checks


def test_a_guest_only_deploy_fails_accounts_and_names_the_library_fallback() -> None:
    checks = {
        name: (ok, detail) for name, ok, detail in smoke.run(BASE, client_for(guest_only_deploy))
    }
    assert checks["health"][0] is True
    assert checks["accounts"] == (
        False,
        "GET /api/me answered 503: accounts are off (DATABASE_URL unset?)",
    )
    assert checks["coach notes"] == (
        False,
        (
            "POST /api/advice answered with source 'library': no ANTHROPIC_API_KEY, "
            "or the hour's budget is spent"
        ),
    )


def test_a_sleeping_or_dead_host_fails_health_without_raising() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    checks = smoke.run(BASE, client_for(down))
    assert checks[0][0] == "health"
    assert checks[0][1] is False
    assert "ConnectError" in checks[0][2]


def test_the_advice_body_is_a_valid_request() -> None:
    from backend.advice.coach import AdviceRequest

    AdviceRequest.model_validate(smoke.ADVICE_BODY)


def test_main_exit_code_follows_the_checks(capsys) -> None:
    assert smoke.main([BASE], client_for(healthy_deploy)) == 0
    assert smoke.main([BASE], client_for(guest_only_deploy)) == 1
    out = capsys.readouterr().out
    assert "PASS health" in out
    assert "FAIL accounts" in out
