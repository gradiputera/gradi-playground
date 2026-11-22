import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Opens one connection as the notification_service role, with timeouts. */
export function connect(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { statement_timeout: 30_000, application_name: 'notification-service' },
  });
}

/**
 * Applies pending Drizzle migrations to the notification schema, with the history table
 * (__drizzle_migrations) in the same schema. A Postgres advisory lock serialises concurrent cold
 * starts; an up-to-date schema is a no-op.
 */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const sql = connect(databaseUrl);
  try {
    await sql`select pg_advisory_lock(hashtext('notification-service.migrations'))`;
    await migrate(drizzle(sql), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'notification',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    // Closing the only connection also releases the session-level advisory lock.
    await sql.end({ timeout: 5 });
  }
}
