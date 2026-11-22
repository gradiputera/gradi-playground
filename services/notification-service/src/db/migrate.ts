import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
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
 * Applies pending Drizzle Kit migrations (drizzle/) to the notification schema and returns how many
 * ran. The history table, notification.__drizzle_migrations, has Drizzle's own format.
 *
 * Drizzle's built-in migrator always runs CREATE SCHEMA IF NOT EXISTS, which needs CREATE on the
 * database; the service role rightly lacks it (the platform layer owns schemas). So this applies the
 * same files itself:
 * - a Postgres advisory lock serialises concurrent cold starts;
 * - each migration runs in its own transaction, together with its history row;
 * - an up-to-date schema is a no-op.
 */
export async function migrateDatabase(databaseUrl: string): Promise<number> {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const sql = connect(databaseUrl);
  let applied = 0;
  try {
    await sql`select pg_advisory_lock(hashtext('notification-service.migrations'))`;
    await sql`create table if not exists notification.__drizzle_migrations (
                id serial primary key,
                hash text not null,
                created_at bigint
              )`;
    const [last] = await sql<{ created_at: string }[]>`
      select created_at from notification.__drizzle_migrations order by created_at desc limit 1`;
    const appliedUpTo = last ? Number(last.created_at) : -1;

    for (const migration of migrations) {
      if (migration.folderMillis <= appliedUpTo) {
        continue;
      }
      await sql.begin(async (tx) => {
        for (const statement of migration.sql) {
          if (statement.trim() !== '') {
            await tx.unsafe(statement);
          }
        }
        await tx`insert into notification.__drizzle_migrations (hash, created_at)
                 values (${migration.hash}, ${migration.folderMillis})`;
      });
      applied += 1;
    }
    return applied;
  } finally {
    // Closing the only connection also releases the session-level advisory lock.
    await sql.end({ timeout: 5 });
  }
}
