import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { AUDIENCE, createVerifier, type TokenVerifier } from '../src/auth/verifier.ts';

const ISSUER = 'https://project.example/auth/v1';
const USER = '6f1c7d0e-0000-4000-8000-000000000001';

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let ecKey: Key;
let otherEcKey: Key;
let rsaKey: Key;
let verify: TokenVerifier;

async function keyPair(alg: string, kid: string): Promise<{ privateKey: Key; jwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), alg, kid, use: 'sig' } };
}

function claims(overrides: JWTPayload = {}, remove: string[] = []): JWTPayload {
  const payload: JWTPayload = {
    sub: USER,
    iss: ISSUER,
    aud: AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    is_anonymous: true,
    ...overrides,
  };
  for (const name of remove) {
    delete payload[name];
  }
  return payload;
}

function sign(key: Key, alg: string, kid: string, payload: JWTPayload): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg, kid }).sign(key);
}

function b64url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

before(async () => {
  const ec = await keyPair('ES256', 'ec-key');
  const otherEc = await keyPair('ES256', 'ec-key');
  const rsa = await keyPair('RS256', 'rsa-key');
  ecKey = ec.privateKey;
  otherEcKey = otherEc.privateKey;
  rsaKey = rsa.privateKey;
  verify = createVerifier(createLocalJWKSet({ keys: [ec.jwk, rsa.jwk] }), ISSUER);
});

describe('token verifier', () => {
  it('accepts a valid guest token', async () => {
    const identity = await verify(await sign(ecKey, 'ES256', 'ec-key', claims()));
    assert.deepEqual(identity, { userId: USER, anonymous: true });
  });

  it('accepts a valid RS256 token', async () => {
    const identity = await verify(await sign(rsaKey, 'RS256', 'rsa-key', claims({ is_anonymous: false })));
    assert.deepEqual(identity, { userId: USER, anonymous: false });
  });

  it('rejects invalid tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify(claims()));
    const hsHeader = b64url('{"alg":"HS256","typ":"JWT","kid":"ec-key"}');
    const hsSignature = createHmac('sha256', 'shared-secret').update(`${hsHeader}.${payload}`).digest('base64url');
    const cases: Record<string, Promise<string> | string> = {
      expired: sign(ecKey, 'ES256', 'ec-key', claims({ exp: now - 3600 })),
      'no expiry': sign(ecKey, 'ES256', 'ec-key', claims({}, ['exp'])),
      'wrong issuer': sign(ecKey, 'ES256', 'ec-key', claims({ iss: 'https://attacker.example/auth/v1' })),
      'wrong audience': sign(ecKey, 'ES256', 'ec-key', claims({ aud: 'anon' })),
      'no subject': sign(ecKey, 'ES256', 'ec-key', claims({}, ['sub'])),
      'other signing key': sign(otherEcKey, 'ES256', 'ec-key', claims()),
      'alg none': `${b64url('{"alg":"none","typ":"JWT"}')}.${payload}.`,
      'alg HS256': `${hsHeader}.${payload}.${hsSignature}`,
      garbage: 'not-a-jwt',
    };
    for (const [name, token] of Object.entries(cases)) {
      await assert.rejects(verify(await token), `${name} must be rejected`);
    }
  });
});
