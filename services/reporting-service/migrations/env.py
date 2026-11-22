"""Alembic environment. The service passes an open connection (reporting_service/db.py)."""

from alembic import context

config = context.config
connection = config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Migrations run on service startup; there is no offline or standalone mode.")

context.configure(
    connection=connection,
    # The history table lives in the reporting schema, next to the service's tables.
    version_table_schema="reporting",
    on_version_apply=config.attributes.get("on_version_apply"),
)
with context.begin_transaction():
    context.run_migrations()
