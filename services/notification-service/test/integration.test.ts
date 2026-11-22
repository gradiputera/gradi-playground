import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createJwksVerifier } from '../src/auth/verifier.ts';
import { connect, migrateDatabase } from '../src/db/migrate.ts';
import { createApp } from '../src/http/app.ts';
import { webhookKey } from '../src/webhooks/signature.ts';

// Runs against the local Supabase stack. Skipped unless NOTIFICATION_TEST_DATABASE_URL,
// NOTIFICATION_TEST_SUPABASE_URL and NOTIFICATION_TEST_SUPABASE_KEY are set (the
// notification-service CI workflow sets them).
const databaseUrl = process.env['NOTIFICATION_TEST_DATABASE_URL'] ?? '';
const supabaseUrl = process.env['NOTIFICATION_TEST_SUPABASE_URL'] ?? '';
const supabaseKey = process.env['NOTIFICATION_TEST_SUPABASE_KEY'] ?? '';
const skip = databaseUrl === '' || supabaseUrl === '' || supabaseKey === '' ? 'integration environment not set' : false;

describe('local Supabase stack', { skip }, () => {
  it('applies migrations into the notification schema, and a rerun is a no-op', async () => {
    await migrateDatabase(databaseUrl);
    assert.equal(await migrateDatabase(databaseUrl), 0, 'the second run applies nothing');
    const sql = connect(databaseUrl);
    try {
      const [tables] = await sql`select to_regclass('notification.inbox') is not null as inbox,
                                        to_regclass('notification.__drizzle_migrations') is not null as history`;
      assert.deepEqual({ ...tables }, { inbox: true, history: true });
      const [history] = await sql`select count(*)::int as applied from notification.__drizzle_migrations`;
      assert.equal(history?.['applied'], 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('refuses the role access to other schemas', async () => {
    const sql = connect(databaseUrl);
    try {
      for (const schema of ['account', 'ledger', 'payment', 'reporting']) {
        await assert.rejects(sql.unsafe(`select 1 from ${schema}.any_table`), (err: { code?: string }) => {
          assert.equal(err.code, '42501', `insufficient_privilege on ${schema}`);
          return true;
        });
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('accepts a Supabase guest token through the JWKS', async () => {
    const app = createApp({
      verifyToken: createJwksVerifier(supabaseUrl),
      webhookKey: webhookKey(`whsec_${Buffer.from('test-only-notification').toString('base64')}`),
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const anonymous = await fetch(`${base}/sandbox/reset`, { method: 'POST' });
      assert.equal(anonymous.status, 401);

      const signup = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: supabaseKey, 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(signup.status, 200, 'anonymous sign-in');
      const { access_token: token } = (await signup.json()) as { access_token: string };

      const withGuest = await fetch(`${base}/sandbox/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(withGuest.status, 501);
    } finally {
      server.close();
    }
  });
});
