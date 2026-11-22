"""Entry point: checks the configuration, applies migrations, then serves HTTP with uvicorn."""

import os
import sys

import uvicorn

from reporting_service import log
from reporting_service.app import create_app
from reporting_service.auth import JwksKeys, TokenVerifier, issuer_for
from reporting_service.db import migrate
from reporting_service.webhooks import webhook_key


def main() -> None:
    database_url = os.environ.get("DATABASE_URL", "")
    supabase_url = os.environ.get("SUPABASE_URL", "")
    secret = os.environ.get("WEBHOOK_SECRET", "")
    try:
        if not database_url or not supabase_url or not secret:
            raise ValueError("DATABASE_URL, SUPABASE_URL and WEBHOOK_SECRET must be set")
        port = int(os.environ.get("PORT") or "80")
        key = webhook_key(secret)
        applied = migrate(database_url)
    except Exception as err:
        # The exception type and message only; never the configuration values.
        log.error("reporting-service stopped", error=f"{type(err).__name__}: {err}")
        sys.exit(1)
    log.info("migrations applied", applied=applied)

    issuer = issuer_for(supabase_url)
    verifier = TokenVerifier(JwksKeys(f"{issuer}/.well-known/jwks.json"), issuer)
    config = uvicorn.Config(
        create_app(verifier, key),
        host="0.0.0.0",  # noqa: S104 - the container must accept outside connections
        port=port,
        log_config=None,
        access_log=False,
        server_header=False,
        timeout_keep_alive=60,
        # Vercel sends SIGTERM and allows 30 seconds; finish in-flight requests within 20.
        timeout_graceful_shutdown=20,
    )
    log.info("listening", port=port)
    uvicorn.Server(config).run()
    log.info("shut down")


if __name__ == "__main__":
    main()
