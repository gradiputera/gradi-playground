"""Database access as the reporting_service role, and the startup migrations (Alembic)."""

import ssl
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
SOCKET_TIMEOUT_SECONDS = 30
STATEMENT_TIMEOUT_MS = 30_000


def _ssl_context(sslmode: str | None) -> ssl.SSLContext | None:
    """Maps libpq's sslmode onto pg8000, which takes an SSL context instead."""
    if sslmode in (None, "disable"):
        return None
    if sslmode in ("allow", "prefer", "require"):
        # libpq's require encrypts without verifying the certificate; Supabase's pooler uses its own CA.
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    if sslmode == "verify-ca":
        context = ssl.create_default_context()
        context.check_hostname = False
        return context
    if sslmode == "verify-full":
        return ssl.create_default_context()
    raise ValueError("DATABASE_URL has an unsupported sslmode")


def _engine_url(database_url: str) -> tuple[URL, ssl.SSLContext | None]:
    """Accepts the postgres:// form every service uses and selects the pg8000 driver."""
    url = make_url(database_url)
    if url.drivername not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must start with postgres:// or postgresql://")
    sslmode = url.query.get("sslmode")
    if isinstance(sslmode, tuple):
        raise ValueError("DATABASE_URL has more than one sslmode")
    url = url.set(drivername="postgresql+pg8000").difference_update_query(["sslmode"])
    return url, _ssl_context(sslmode)


def create_db_engine(database_url: str) -> Engine:
    """No pooling: each use opens one connection and closes it, with timeouts on every step."""
    url, context = _engine_url(database_url)
    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={
            "ssl_context": context,
            "timeout": SOCKET_TIMEOUT_SECONDS,
            "application_name": "reporting-service",
        },
    )

    @event.listens_for(engine, "connect")
    def set_statement_timeout(dbapi_connection: Any, _record: Any) -> None:
        # Outside a transaction, so the setting lasts for the whole session.
        dbapi_connection.autocommit = True
        cursor = dbapi_connection.cursor()
        cursor.execute(f"set statement_timeout = {STATEMENT_TIMEOUT_MS}")
        cursor.close()
        dbapi_connection.autocommit = False

    return engine


def migrate(database_url: str) -> int:
    """Applies pending Alembic migrations to the reporting schema and returns how many ran.

    Everything runs in one transaction: a transaction-level advisory lock serialises concurrent cold
    starts, and the version table (reporting.alembic_version) commits together with the migrations.
    """
    applied: list[str] = []
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["on_version_apply"] = lambda **kwargs: applied.append(kwargs["step"].up_revision_id)

    engine = create_db_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text("select pg_advisory_xact_lock(hashtext('reporting-service.migrations'))"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    finally:
        engine.dispose()
    return len(applied)
