import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sign, TOLERANCE_SECONDS, verifyWebhook, webhookKey } from '../src/webhooks/signature.ts';

// Same form as the local dispatcher secret in supabase/seed.sql (not a real credential).
const KEY = webhookKey(`whsec_${Buffer.from('test-only-notification').toString('base64')}`);
const NOW = 1_800_000_000;
const BODY = '{"id":"evt-1","type":"payment.succeeded.v1"}';

function headers(id: string, timestamp: number, signature: string) {
  return { id, timestamp: String(timestamp), signature };
}

describe('webhook signature', () => {
  it('accepts a valid signature', () => {
    const signature = `v1,${sign(KEY, 'evt-1', NOW, BODY)}`;
    assert.deepEqual(verifyWebhook(KEY, headers('evt-1', NOW, signature), BODY, NOW), { ok: true });
  });

  it('accepts a valid signature among several values', () => {
    const signature = `v1,${Buffer.alloc(32).toString('base64')} v1,${sign(KEY, 'evt-1', NOW, BODY)}`;
    assert.deepEqual(verifyWebhook(KEY, headers('evt-1', NOW, signature), BODY, NOW), { ok: true });
  });

  it('rejects missing headers', () => {
    const check = verifyWebhook(KEY, { id: 'evt-1', timestamp: undefined, signature: 'v1,x' }, BODY, NOW);
    assert.deepEqual(check, { ok: false, reason: 'missing headers' });
  });

  it('rejects a timestamp outside the tolerance, in both directions', () => {
    for (const sentAt of [NOW - TOLERANCE_SECONDS - 1, NOW + TOLERANCE_SECONDS + 1]) {
      const signature = `v1,${sign(KEY, 'evt-1', sentAt, BODY)}`;
      assert.deepEqual(verifyWebhook(KEY, headers('evt-1', sentAt, signature), BODY, NOW), {
        ok: false,
        reason: 'timestamp out of tolerance',
      });
    }
  });

  it('rejects a tampered body, id or timestamp, another key or version, and short values', () => {
    const signature = `v1,${sign(KEY, 'evt-1', NOW, BODY)}`;
    const otherKey = webhookKey(`whsec_${Buffer.from('other').toString('base64')}`);
    const checks = [
      verifyWebhook(KEY, headers('evt-1', NOW, signature), `${BODY} `, NOW),
      verifyWebhook(KEY, headers('evt-2', NOW, signature), BODY, NOW),
      verifyWebhook(KEY, headers('evt-1', NOW - 1, signature), BODY, NOW),
      verifyWebhook(otherKey, headers('evt-1', NOW, signature), BODY, NOW),
      verifyWebhook(KEY, headers('evt-1', NOW, `v2,${sign(KEY, 'evt-1', NOW, BODY)}`), BODY, NOW),
      verifyWebhook(KEY, headers('evt-1', NOW, 'v1,short'), BODY, NOW),
    ];
    for (const check of checks) {
      assert.deepEqual(check, { ok: false, reason: 'bad signature' });
    }
  });

  it('rejects a malformed timestamp', () => {
    const check = verifyWebhook(KEY, { id: 'evt-1', timestamp: '17e8', signature: 'v1,x' }, BODY, NOW);
    assert.deepEqual(check, { ok: false, reason: 'bad timestamp' });
  });

  it('accepts only whsec_ secrets with a key', () => {
    assert.throws(() => webhookKey('plain-secret'));
    assert.throws(() => webhookKey('whsec_'));
  });
});
