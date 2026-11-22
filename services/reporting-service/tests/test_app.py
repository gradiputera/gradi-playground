import base64

from fastapi.testclient import TestClient

from reporting_service.app import MAX_EVENT_BYTES, create_app
from reporting_service.auth import Identity, InvalidTokenError
from reporting_service.webhooks import sign, webhook_key

KEY = webhook_key("whsec_" + base64.b64encode(b"test-only-reporting").decode())
NOW = 1_800_000_000


def stand_in_verifier(token: str) -> Identity:
    """Stand-in for the JWKS verifier, which has its own tests."""
    if token != "good-token":
        raise InvalidTokenError("invalid token")
    return Identity(user_id="user-1", anonymous=True)


client = TestClient(create_app(stand_in_verifier, KEY, now=lambda: NOW))


def test_serves_health_without_a_token() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/json")
    assert res.json() == {"status": "ok"}


def test_requires_a_token_on_planned_endpoints_then_answers_501() -> None:
    for method, path in (("POST", "/sandbox/reset"), ("GET", "/reports/payments-per-day")):
        anonymous = client.request(method, path)
        assert anonymous.status_code == 401
        assert anonymous.headers["www-authenticate"] == 'Bearer realm="reporting-service"'

        bad = client.request(method, path, headers={"Authorization": "Bearer bad-token"})
        assert bad.status_code == 401

        good = client.request(method, path, headers={"Authorization": "Bearer good-token"})
        assert good.status_code == 501
        assert good.json()["error"] == "not_implemented"


def test_accepts_only_correctly_signed_webhooks_on_events_then_answers_501() -> None:
    body = b'{"specversion":"1.0","id":"evt-1","type":"payment.succeeded.v1"}'
    signed = {
        "content-type": "application/cloudevents+json",
        "webhook-id": "evt-1",
        "webhook-timestamp": str(NOW),
        "webhook-signature": "v1," + sign(KEY, "evt-1", NOW, body),
    }

    unsigned = client.post("/events", content=body, headers={"content-type": "application/json"})
    assert unsigned.status_code == 401

    tampered = client.post("/events", content=body + b" ", headers=signed)
    assert tampered.status_code == 401

    valid = client.post("/events", content=body, headers=signed)
    assert valid.status_code == 501

    too_large = client.post("/events", content=b"x" * (MAX_EVENT_BYTES + 1), headers=signed)
    assert too_large.status_code == 413


def test_answers_404_and_405_as_json() -> None:
    missing = client.get("/nope")
    assert missing.status_code == 404
    assert missing.json()["error"] == "not_found"

    wrong_method = client.get("/events")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["error"] == "method_not_allowed"

    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
