import { defineConfig } from 'drizzle-kit';

// Drizzle Kit only generates SQL from src/db/schema.ts. Migrations are applied by the service at
// startup (src/db/migrate.ts), with the history table in the notification schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  migrations: {
    schema: 'notification',
    table: '__drizzle_migrations',
  },
});
