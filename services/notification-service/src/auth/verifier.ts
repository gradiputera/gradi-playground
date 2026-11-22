import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Validates Supabase Auth access tokens with jose (ADR 0007): the signature with a key from the
// project's JWKS, the algorithm (ES256 or RS256 only), iss, aud (authenticated), exp (required)
// and sub (required).

export const AUDIENCE = 'authenticated';

/** Asymmetric algorithms Supabase signing keys use; none and HS256 are rejected. */
export const ALGORITHMS = ['ES256', 'RS256'];

/** What handlers learn about the caller. It never holds the token itself. */
export interface Identity {
  userId: string;
  anonymous: boolean;
}

export type TokenVerifier = (token: string) => Promise<Identity>;

export function issuerFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

/** Builds a verifier from any key source; the tests pass a local key set. */
export function createVerifier(keys: JWTVerifyGetKey, issuer: string): TokenVerifier {
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: AUDIENCE,
      algorithms: ALGORITHMS,
      requiredClaims: ['exp', 'sub'],
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new Error('token has no subject');
    }
    return { userId: payload.sub, anonymous: payload['is_anonymous'] === true };
  };
}

/**
 * Fetches signing keys from the Supabase JWKS endpoint: each fetch times out after 5 seconds, keys
 * are cached for an hour, and an unknown key id triggers at most one fetch every 5 minutes.
 */
export function createJwksVerifier(supabaseUrl: string): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(`${issuerFor(supabaseUrl)}/.well-known/jwks.json`), {
    timeoutDuration: 5_000,
    cacheMaxAge: 60 * 60 * 1_000,
    cooldownDuration: 5 * 60 * 1_000,
  });
  return createVerifier(jwks, issuerFor(supabaseUrl));
}
