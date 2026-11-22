import { createJwksVerifier } from './auth/verifier.ts';
import { migrateDatabase } from './db/migrate.ts';
import { createApp } from './http/app.ts';
import { log } from './log.ts';
import { webhookKey } from './webhooks/signature.ts';

async function main(): Promise<void> {
  const { DATABASE_URL, SUPABASE_URL, WEBHOOK_SECRET } = process.env;
  if (!DATABASE_URL || !SUPABASE_URL || !WEBHOOK_SECRET) {
    throw new Error('DATABASE_URL, SUPABASE_URL and WEBHOOK_SECRET must be set');
  }
  const port = Number(process.env['PORT'] || '80');
  const key = webhookKey(WEBHOOK_SECRET);

  await migrateDatabase(DATABASE_URL);
  log.info('migrations applied');

  const app = createApp({ verifyToken: createJwksVerifier(SUPABASE_URL), webhookKey: key });
  const server = app.listen(port, () => log.info('listening', { port }));
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 60_000;

  // Vercel sends SIGTERM and allows 30 seconds; finish in-flight requests within 20.
  process.once('SIGTERM', () => {
    const force = setTimeout(() => process.exit(0), 20_000);
    force.unref();
    server.close(() => {
      log.info('shut down');
      process.exit(0);
    });
    server.closeIdleConnections();
  });
}

main().catch((err: unknown) => {
  log.error('notification-service stopped', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
