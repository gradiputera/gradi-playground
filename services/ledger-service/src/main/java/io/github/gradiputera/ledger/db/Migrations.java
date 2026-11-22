package io.github.gradiputera.ledger.db;

import java.util.Map;
import org.flywaydb.core.Flyway;

/**
 * Applies ledger-service's own migrations (Flyway, ADR 0006). The schema and its history table
 * ({@code flyway_schema_history}) both live in {@code ledger}, which the platform layer created
 * and the ledger_service role owns.
 *
 * <p>Threading: this is blocking JDBC work. It runs on the main thread before Vert.x starts, so it
 * never touches an event loop.
 */
public final class Migrations {

  private Migrations() {}

  /** Applies pending migrations and returns how many ran. Up-to-date schemas are a no-op. */
  public static int migrate(DatabaseUrl target) {
    Flyway flyway = Flyway.configure()
        .dataSource(target.jdbcUrl(), target.user(), target.password())
        .schemas("ledger")
        .defaultSchema("ledger")
        .createSchemas(false)
        .locations("classpath:db/migration")
        .connectRetries(0)
        // 10-second connect timeout and 30-second statement timeout for every migration connection.
        .jdbcProperties(Map.of("connectTimeout", "10", "options", "-c statement_timeout=30000"))
        .load();
    return flyway.migrate().migrationsExecuted;
  }
}
