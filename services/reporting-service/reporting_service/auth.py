"""Validates Supabase Auth access tokens with PyJWT (ADR 0007).

Checks the signature with a key from the project's JWKS, the algorithm (ES256 or RS256 only), iss,
aud (authenticated), exp (required) and sub (required).
"""

import json
import threading
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWK, PyJWKSet

AUDIENCE = "authenticated"

# Asymmetric algorithms Supabase signing keys use; none and HS256 are rejected.
ALGORITHMS = ("ES256", "RS256")

FETCH_TIMEOUT_SECONDS = 5
CACHE_SECONDS = 60 * 60
# An unknown key id triggers at most one JWKS fetch per cooldown; with no keys yet, the wait is shorter.
COOLDOWN_SECONDS = 5 * 60
EMPTY_COOLDOWN_SECONDS = 30


@dataclass(frozen=True)
class Identity:
    """What handlers learn about the caller. It never holds the token itself."""

    user_id: str
    anonymous: bool


class InvalidTokenError(Exception):
    """The token is missing, malformed, or fails a check. The message never contains the token."""


# Returns the signing key for a key id, or raises InvalidTokenError.
KeySource = Callable[[str], PyJWK]


def issuer_for(supabase_url: str) -> str:
    return supabase_url.rstrip("/") + "/auth/v1"


class TokenVerifier:
    """Verifies a token against any key source; the tests pass local keys."""

    def __init__(self, keys: KeySource, issuer: str) -> None:
        self._keys = keys
        self._issuer = issuer

    def __call__(self, token: str) -> Identity:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as err:
            raise InvalidTokenError("malformed token") from err
        alg, kid = header.get("alg"), header.get("kid")
        if alg not in ALGORITHMS or not isinstance(kid, str):
            raise InvalidTokenError("unsupported token")
        key = self._keys(kid)
        if key.algorithm_name != alg:
            raise InvalidTokenError("algorithm does not match the key")
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=list(ALGORITHMS),
                audience=AUDIENCE,
                issuer=self._issuer,
                leeway=30,
                options={"require": ["exp", "sub", "iss", "aud"]},
            )
        except jwt.PyJWTError as err:
            raise InvalidTokenError("invalid token") from err
        sub = claims.get("sub")
        if not isinstance(sub, str) or sub == "":
            raise InvalidTokenError("token has no subject")
        return Identity(user_id=sub, anonymous=claims.get("is_anonymous") is True)


def _http_get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:  # noqa: S310
        return json.load(response)


class JwksKeys:
    """Signing keys from the Supabase JWKS endpoint.

    Each fetch times out after 5 seconds and keys are cached for an hour. An unknown key id triggers
    a refetch at most once every 5 minutes, so forged key ids cannot flood the endpoint.
    """

    def __init__(
        self,
        url: str,
        fetch: Callable[[], Any] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetch = fetch or (lambda: _http_get_json(url))
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._attempted_at: float | None = None

    def __call__(self, kid: str) -> PyJWK:
        with self._lock:
            now = self._clock()
            stale = self._fetched_at is None or now - self._fetched_at >= CACHE_SECONDS
            if stale or kid not in self._keys:
                cooldown = COOLDOWN_SECONDS if self._keys else EMPTY_COOLDOWN_SECONDS
                if self._attempted_at is None or now - self._attempted_at >= cooldown:
                    self._refresh(now)
            key = self._keys.get(kid)
        if key is None:
            raise InvalidTokenError("unknown signing key")
        return key

    def _refresh(self, now: float) -> None:
        self._attempted_at = now
        try:
            keyset = PyJWKSet.from_dict(self._fetch())
        except Exception:
            # Keep the cached keys; a caller with an unknown key id gets 401.
            return
        self._keys = {key.key_id: key for key in keyset.keys if key.key_id}
        self._fetched_at = now
