"""Runs against the local Supabase stack.

Skipped unless REPORTING_TEST_DATABASE_URL, REPORTING_TEST_SUPABASE_URL and REPORTING_TEST_SUPABASE_KEY
are set (the reporting-service CI workflow sets them).
"""

import base64
import os

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import exc, text

from reporting_service.app import create_app
from reporting_service.auth import JwksKeys, TokenVerifier, issuer_for
from reporting_service.db import create_db_engine, migrate
from reporting_service.webhooks import webhook_key

DATABASE_URL = os.environ.get("REPORTING_TEST_DATABASE_URL", "")
SUPABASE_URL = os.environ.get("REPORTING_TEST_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("REPORTING_TEST_SUPABASE_KEY", "")

pytestmark = pytest.mark.skipif(
    not (DATABASE_URL and SUPABASE_URL and SUPABASE_KEY), reason="integration environment not set"
)


def test_applies_migrations_into_the_reporting_schema_and_a_rerun_is_a_no_op() -> None:
    migrate(DATABASE_URL)
    assert migrate(DATABASE_URL) == 0, "the second run applies nothing"
    engine = create_db_engine(DATABASE_URL)
    try:
        with engine.connect() as connection:
            tables = connection.execute(
                text(
                    "select to_regclass('reporting.inbox') is not null as inbox,"
                    " to_regclass('reporting.alembic_version') is not null as history"
                )
            ).one()
            assert (tables.inbox, tables.history) == (True, True)
            version = connection.execute(
                text("select version_num from reporting.alembic_version")
            ).scalar_one()
            assert version == "0001"
    finally:
        engine.dispose()


def test_refuses_the_role_access_to_other_schemas() -> None:
    engine = create_db_engine(DATABASE_URL)
    try:
        for schema in ("account", "ledger", "payment", "notification"):
            with engine.connect() as connection, pytest.raises(exc.DBAPIError) as raised:
                connection.execute(text(f"select 1 from {schema}.any_table"))  # noqa: S608 - fixed names
            assert raised.value.orig is not None
            assert raised.value.orig.args[0]["C"] == "42501", f"insufficient_privilege on {schema}"
    finally:
        engine.dispose()


def test_accepts_a_supabase_guest_token_through_the_jwks() -> None:
    issuer = issuer_for(SUPABASE_URL)
    verifier = TokenVerifier(JwksKeys(f"{issuer}/.well-known/jwks.json"), issuer)
    key = webhook_key("whsec_" + base64.b64encode(b"test-only-reporting").decode())
    client = TestClient(create_app(verifier, key))

    assert client.post("/sandbox/reset").status_code == 401

    signup = httpx2.post(
        f"{issuer}/signup",
        headers={"apikey": SUPABASE_KEY, "content-type": "application/json"},
        content=b"{}",
        timeout=10,
    )
    assert signup.status_code == 200, "anonymous sign-in"
    token = signup.json()["access_token"]

    with_guest = client.post("/sandbox/reset", headers={"Authorization": f"Bearer {token}"})
    assert with_guest.status_code == 501
