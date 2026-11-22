import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/http/app.ts';
import { sign, webhookKey } from '../src/webhooks/signature.ts';

const KEY = webhookKey(`whsec_${Buffer.from('test-only-notification').toString('base64')}`);
const NOW = 1_800_000_000;

let server: Server;
let base: string;

before(async () => {
  const app = createApp({
    // Stand-in for the JWKS verifier, which has its own tests.
    verifyToken: async (token) => {
      if (token !== 'good-token') {
        throw new Error('invalid');
      }
      return { userId: 'user-1', anonymous: true };
    },
    webhookKey: KEY,
    nowSeconds: () => NOW,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe('http api', () => {
  it('serves health without a token', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await res.json(), { status: 'ok' });
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('requires a token on sandbox reset, then answers 501', async () => {
    const anonymous = await fetch(`${base}/sandbox/reset`, { method: 'POST' });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer realm="notification-service"');

    const bad = await fetch(`${base}/sandbox/reset`, { method: 'POST', headers: { Authorization: 'Bearer bad-token' } });
    assert.equal(bad.status, 401);

    const good = await fetch(`${base}/sandbox/reset`, { method: 'POST', headers: { Authorization: 'Bearer good-token' } });
    assert.equal(good.status, 501);
    assert.equal(((await good.json()) as { error: string }).error, 'not_implemented');
  });

  it('accepts only correctly signed webhooks on /events, then answers 501', async () => {
    const body = '{"specversion":"1.0","id":"evt-1","type":"payment.succeeded.v1"}';
    const signed = {
      'content-type': 'application/cloudevents+json',
      'webhook-id': 'evt-1',
      'webhook-timestamp': String(NOW),
      'webhook-signature': `v1,${sign(KEY, 'evt-1', NOW, body)}`,
    };

    const unsigned = await fetch(`${base}/events`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    assert.equal(unsigned.status, 401);

    const tampered = await fetch(`${base}/events`, { method: 'POST', body: `${body} `, headers: signed });
    assert.equal(tampered.status, 401);

    const valid = await fetch(`${base}/events`, { method: 'POST', body, headers: signed });
    assert.equal(valid.status, 501);
  });

  it('answers 404 and 405 as JSON', async () => {
    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type') ?? '', /^application\/json/);

    const wrongMethod = await fetch(`${base}/events`);
    assert.equal(wrongMethod.status, 405);
  });
});
