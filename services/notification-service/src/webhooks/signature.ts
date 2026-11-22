import { createHmac, timingSafeEqual } from 'node:crypto';

// Standard Webhooks verification, matching the platform dispatcher (eventbus.sign, ADR 0005):
// webhook-signature carries one or more space-separated "v1,<base64 HMAC-SHA256>" values over
// "<webhook-id>.<webhook-timestamp>.<raw body>", keyed with the base64 key of a whsec_ secret.

/** Signed events older or newer than this are rejected, against replay. */
export const TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: 'missing headers' | 'bad timestamp' | 'timestamp out of tolerance' | 'bad signature' };

/** Decodes a whsec_<base64> secret into its key bytes; throws for any other form. */
export function webhookKey(secret: string): Buffer {
  if (!secret.startsWith('whsec_')) {
    throw new Error('WEBHOOK_SECRET must use the whsec_<base64> form');
  }
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) {
    throw new Error('WEBHOOK_SECRET has an empty key');
  }
  return key;
}

export function sign(key: Buffer, id: string, timestamp: number, body: string): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

export function verifyWebhook(key: Buffer, headers: WebhookHeaders, body: string, nowSeconds: number): WebhookCheck {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: 'missing headers' };
  }
  if (!/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: 'bad timestamp' };
  }
  const sentAt = Number(timestamp);
  if (Math.abs(nowSeconds - sentAt) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp out of tolerance' };
  }

  const expected = Buffer.from(sign(key, id, sentAt, body), 'base64');
  for (const candidate of signature.split(' ')) {
    const [version, value] = candidate.split(',', 2);
    if (version !== 'v1' || !value) {
      continue;
    }
    const given = Buffer.from(value, 'base64');
    // timingSafeEqual needs equal lengths; the length of an HMAC-SHA256 is not secret.
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'bad signature' };
}
