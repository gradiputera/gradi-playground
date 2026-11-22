import base64

import pytest

from reporting_service.webhooks import TOLERANCE_SECONDS, sign, verify_webhook, webhook_key

# Same form as the local dispatcher secret in supabase/seed.sql (not a real credential).
KEY = webhook_key("whsec_" + base64.b64encode(b"test-only-reporting").decode())
NOW = 1_800_000_000
BODY = b'{"id":"evt-1","type":"payment.succeeded.v1"}'


def test_accepts_a_valid_signature() -> None:
    signature = "v1," + sign(KEY, "evt-1", NOW, BODY)
    assert verify_webhook(KEY, "evt-1", str(NOW), signature, BODY, NOW) is None


def test_accepts_a_valid_signature_among_several_values() -> None:
    signature = "v1," + base64.b64encode(bytes(32)).decode() + " v1," + sign(KEY, "evt-1", NOW, BODY)
    assert verify_webhook(KEY, "evt-1", str(NOW), signature, BODY, NOW) is None


def test_rejects_missing_headers() -> None:
    assert verify_webhook(KEY, "evt-1", None, "v1,x", BODY, NOW) == "missing headers"


def test_rejects_a_timestamp_outside_the_tolerance_in_both_directions() -> None:
    for sent_at in (NOW - TOLERANCE_SECONDS - 1, NOW + TOLERANCE_SECONDS + 1):
        signature = "v1," + sign(KEY, "evt-1", sent_at, BODY)
        assert (
            verify_webhook(KEY, "evt-1", str(sent_at), signature, BODY, NOW) == "timestamp out of tolerance"
        )


def test_rejects_tampering_another_key_or_version_and_bad_values() -> None:
    signature = "v1," + sign(KEY, "evt-1", NOW, BODY)
    other_key = webhook_key("whsec_" + base64.b64encode(b"other").decode())
    checks = [
        verify_webhook(KEY, "evt-1", str(NOW), signature, BODY + b" ", NOW),
        verify_webhook(KEY, "evt-2", str(NOW), signature, BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW - 1), signature, BODY, NOW),
        verify_webhook(other_key, "evt-1", str(NOW), signature, BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW), "v2," + sign(KEY, "evt-1", NOW, BODY), BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW), "v1,short", BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW), "v1,not*base64", BODY, NOW),
    ]
    assert checks == ["bad signature"] * len(checks)


def test_rejects_a_malformed_timestamp() -> None:
    assert verify_webhook(KEY, "evt-1", "17e8", "v1,x", BODY, NOW) == "bad timestamp"


def test_accepts_only_whsec_secrets_with_a_key() -> None:
    for secret in ("plain-secret", "whsec_", "whsec_not*base64"):
        with pytest.raises(ValueError, match="WEBHOOK_SECRET"):
            webhook_key(secret)
