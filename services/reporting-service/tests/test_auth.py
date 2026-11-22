import base64
import hashlib
import hmac
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt import PyJWK
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from reporting_service.auth import (
    AUDIENCE,
    COOLDOWN_SECONDS,
    Identity,
    InvalidTokenError,
    JwksKeys,
    TokenVerifier,
)

ISSUER = "https://project.example/auth/v1"
USER = "6f1c7d0e-0000-4000-8000-000000000001"

EC_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_EC_KEY = ec.generate_private_key(ec.SECP256R1())
RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk(public_jwk: str, alg: str, kid: str) -> dict[str, Any]:
    return {**json.loads(public_jwk), "alg": alg, "kid": kid, "use": "sig"}


JWKS = {
    "keys": [
        _jwk(ECAlgorithm.to_jwk(EC_KEY.public_key()), "ES256", "ec-key"),
        _jwk(RSAAlgorithm.to_jwk(RSA_KEY.public_key()), "RS256", "rsa-key"),
    ]
}
KEYS = {jwk["kid"]: PyJWK(jwk) for jwk in JWKS["keys"]}


def local_keys(kid: str) -> PyJWK:
    if kid not in KEYS:
        raise InvalidTokenError("unknown signing key")
    return KEYS[kid]


verify = TokenVerifier(local_keys, ISSUER)


def claims(remove: tuple[str, ...] = (), **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sub": USER,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": int(time.time()) + 3600,
        "is_anonymous": True,
        **overrides,
    }
    for name in remove:
        del payload[name]
    return payload


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_accepts_a_valid_guest_token() -> None:
    token = jwt.encode(claims(), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"})
    assert verify(token) == Identity(user_id=USER, anonymous=True)


def test_accepts_a_valid_rs256_token() -> None:
    token = jwt.encode(claims(is_anonymous=False), RSA_KEY, algorithm="RS256", headers={"kid": "rsa-key"})
    assert verify(token) == Identity(user_id=USER, anonymous=False)


def test_rejects_invalid_tokens() -> None:
    now = int(time.time())
    payload = b64url(json.dumps(claims()).encode())
    hs_header = b64url(b'{"alg":"HS256","typ":"JWT","kid":"ec-key"}')
    hs_signature = b64url(
        hmac.new(b"shared-secret", f"{hs_header}.{payload}".encode(), hashlib.sha256).digest()
    )
    cases = {
        "expired": jwt.encode(claims(exp=now - 3600), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "no expiry": jwt.encode(claims(("exp",)), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "wrong issuer": jwt.encode(
            claims(iss="https://attacker.example/auth/v1"),
            EC_KEY,
            algorithm="ES256",
            headers={"kid": "ec-key"},
        ),
        "wrong audience": jwt.encode(
            claims(aud="anon"), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}
        ),
        "no subject": jwt.encode(claims(("sub",)), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "other signing key": jwt.encode(claims(), OTHER_EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "key of another algorithm": jwt.encode(
            claims(), EC_KEY, algorithm="ES256", headers={"kid": "rsa-key"}
        ),
        "unknown key id": jwt.encode(claims(), EC_KEY, algorithm="ES256", headers={"kid": "nope"}),
        "alg none": f"{b64url(b'{"alg":"none","typ":"JWT"}')}.{payload}.",
        "alg HS256": f"{hs_header}.{payload}.{hs_signature}",
        "garbage": "not-a-jwt",
    }
    for name, token in cases.items():
        with pytest.raises(InvalidTokenError):
            verify(token)
            pytest.fail(f"{name} must be rejected")


class FakeJwks:
    def __init__(self) -> None:
        self.calls = 0
        self.now = 1000.0

    def fetch(self) -> dict[str, Any]:
        self.calls += 1
        return JWKS

    def clock(self) -> float:
        return self.now


def test_jwks_keys_are_cached_and_unknown_ids_refetch_at_most_once_per_cooldown() -> None:
    fake = FakeJwks()
    keys = JwksKeys("https://project.example/jwks", fetch=fake.fetch, clock=fake.clock)

    assert keys("ec-key").key_id == "ec-key"
    assert keys("rsa-key").key_id == "rsa-key"
    assert fake.calls == 1, "known keys come from the cache"

    for _ in range(3):
        with pytest.raises(InvalidTokenError):
            keys("forged-kid")
    assert fake.calls == 1, "no refetch within the cooldown"

    fake.now += COOLDOWN_SECONDS
    with pytest.raises(InvalidTokenError):
        keys("forged-kid")
    assert fake.calls == 2, "one refetch after the cooldown"

    fake.now += 60 * 60
    keys("ec-key")
    assert fake.calls == 3, "the cache expires after an hour"


def test_jwks_fetch_failure_keeps_cached_keys() -> None:
    fake = FakeJwks()
    keys = JwksKeys("https://project.example/jwks", fetch=fake.fetch, clock=fake.clock)
    keys("ec-key")

    def failing() -> dict[str, Any]:
        raise OSError("timed out")

    keys._fetch = failing
    fake.now += 60 * 60
    assert keys("ec-key").key_id == "ec-key", "stale keys still verify while the endpoint is down"
