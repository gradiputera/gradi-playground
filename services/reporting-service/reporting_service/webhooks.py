"""Standard Webhooks verification, matching the platform dispatcher (eventbus.sign, ADR 0005).

webhook-signature carries one or more space-separated "v1,<base64 HMAC-SHA256>" values over
"<webhook-id>.<webhook-timestamp>.<raw body>", keyed with the base64 key of a whsec_ secret.
"""

import base64
import binascii
import hashlib
import hmac
import re

# Signed events older or newer than this are rejected, against replay.
TOLERANCE_SECONDS = 5 * 60

_TIMESTAMP = re.compile(r"[0-9]{1,12}")


def webhook_key(secret: str) -> bytes:
    """Decodes a whsec_<base64> secret into its key bytes; raises ValueError for any other form."""
    if not secret.startswith("whsec_"):
        raise ValueError("WEBHOOK_SECRET must use the whsec_<base64> form")
    try:
        key = base64.b64decode(secret.removeprefix("whsec_"), validate=True)
    except binascii.Error as err:
        raise ValueError("WEBHOOK_SECRET is not valid base64") from err
    if not key:
        raise ValueError("WEBHOOK_SECRET has an empty key")
    return key


def sign(key: bytes, msg_id: str, timestamp: int, body: bytes) -> str:
    digest = hmac.new(key, f"{msg_id}.{timestamp}.".encode() + body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def verify_webhook(
    key: bytes,
    msg_id: str | None,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    now: int,
) -> str | None:
    """Returns None for a valid delivery, otherwise the reason it was rejected."""
    if not msg_id or not timestamp or not signature:
        return "missing headers"
    if not _TIMESTAMP.fullmatch(timestamp):
        return "bad timestamp"
    sent_at = int(timestamp)
    if abs(now - sent_at) > TOLERANCE_SECONDS:
        return "timestamp out of tolerance"

    expected = base64.b64decode(sign(key, msg_id, sent_at, body))
    for candidate in signature.split(" "):
        version, _, value = candidate.partition(",")
        if version != "v1" or not value:
            continue
        try:
            given = base64.b64decode(value, validate=True)
        except binascii.Error:
            continue
        if hmac.compare_digest(given, expected):
            return None
    return "bad signature"
