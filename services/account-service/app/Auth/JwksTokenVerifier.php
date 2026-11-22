<?php

namespace App\Auth;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Validates Supabase Auth access tokens with firebase/php-jwt (ADR 0007): the signature with a key
 * from the project's JWKS, the algorithm (ES256 or RS256 only), iss, aud (authenticated),
 * exp (required) and sub (required).
 *
 * The JWKS is cached for an hour. After a rejected token it is fetched again at most once every
 * 5 minutes. Every fetch has a 5-second timeout.
 */
class JwksTokenVerifier implements TokenVerifier
{
    public const AUDIENCE = 'authenticated';

    /** Asymmetric algorithms Supabase signing keys use; none and HS256 are rejected. */
    public const ALGORITHMS = ['ES256', 'RS256'];

    private const CACHE_KEY = 'supabase-jwks';

    private const REFETCH_LOCK = 'supabase-jwks-refetch';

    public function __construct(private readonly Cache $cache) {}

    public function verify(string $token): Identity
    {
        try {
            return self::verifyWithKeys($token, $this->keys(), self::issuer());
        } catch (InvalidToken $e) {
            // Keys may have rotated: refresh them, at most once every 5 minutes.
            if ($this->cache->add(self::REFETCH_LOCK, true, 300)) {
                $this->cache->forget(self::CACHE_KEY);
            }
            throw $e;
        }
    }

    /**
     * Verifies a token against a JWKS document. Pure: no network, no cache.
     *
     * @param  array<string, mixed>  $jwks
     *
     * @throws InvalidToken
     */
    public static function verifyWithKeys(string $token, array $jwks, string $issuer): Identity
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidToken('malformed token');
        }
        $header = json_decode((string) JWT::urlsafeB64Decode($parts[0]), true);
        if (! is_array($header) || ! in_array($header['alg'] ?? null, self::ALGORITHMS, true)) {
            throw new InvalidToken('algorithm not allowed');
        }

        $keySet = self::keySet($jwks);
        if ($keySet === []) {
            throw new InvalidToken('no signing keys loaded');
        }

        JWT::$leeway = 30;
        try {
            $claims = (array) JWT::decode($token, $keySet);
        } catch (Throwable $e) {
            throw new InvalidToken('signature or time claims invalid', previous: $e);
        }

        if (($claims['iss'] ?? null) !== $issuer) {
            throw new InvalidToken('wrong issuer');
        }
        $aud = $claims['aud'] ?? null;
        if (! (is_string($aud) ? $aud === self::AUDIENCE : is_array($aud) && in_array(self::AUDIENCE, $aud, true))) {
            throw new InvalidToken('wrong audience');
        }
        if (! is_int($claims['exp'] ?? null) && ! is_float($claims['exp'] ?? null)) {
            throw new InvalidToken('token has no expiry');
        }
        $sub = $claims['sub'] ?? null;
        if (! is_string($sub) || $sub === '') {
            throw new InvalidToken('token has no subject');
        }

        return new Identity($sub, ($claims['is_anonymous'] ?? false) === true);
    }

    /**
     * Keeps only public ES256 and RS256 keys; symmetric and private keys are ignored.
     *
     * @param  array<string, mixed>  $jwks
     * @return array<string, Key>
     */
    public static function keySet(array $jwks): array
    {
        $usable = array_values(array_filter(
            $jwks['keys'] ?? [],
            fn ($key) => is_array($key)
                && in_array($key['alg'] ?? null, self::ALGORITHMS, true)
                && in_array($key['kty'] ?? null, ['EC', 'RSA'], true)
                && isset($key['kid'])
                && ! isset($key['d']),
        ));
        if ($usable === []) {
            return [];
        }

        return JWK::parseKeySet(['keys' => $usable]);
    }

    /** The issuer Supabase Auth puts in tokens for this project. */
    public static function issuer(): string
    {
        return config('services.supabase.url').'/auth/v1';
    }

    /** @return array<string, mixed> */
    private function keys(): array
    {
        $cached = $this->cache->get(self::CACHE_KEY);
        if (is_array($cached)) {
            return $cached;
        }

        $url = config('services.supabase.url').'/auth/v1/.well-known/jwks.json';
        try {
            $response = Http::connectTimeout(5)->timeout(5)->acceptJson()->get($url);
        } catch (Throwable $e) {
            Log::warning('jwks fetch failed', ['error' => $e->getMessage()]);

            return [];
        }
        if (! $response->successful() || ! is_array($response->json())) {
            Log::warning('jwks fetch failed', ['status' => $response->status()]);

            return [];
        }

        $jwks = $response->json();
        $this->cache->put(self::CACHE_KEY, $jwks, 3600);
        Log::info('jwks loaded', ['keys' => count(self::keySet($jwks))]);

        return $jwks;
    }
}
