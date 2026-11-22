<?php

namespace Tests\Unit;

use App\Auth\InvalidToken;
use App\Auth\JwksTokenVerifier;
use Firebase\JWT\JWT;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class TokenVerifierTest extends TestCase
{
    private const ISSUER = 'https://project.example/auth/v1';

    private const USER = '6f1c7d0e-0000-4000-8000-000000000001';

    /** @var array{private: string, jwk: array<string, string>}|null */
    private static ?array $ec = null;

    /** @var array{private: string, jwk: array<string, string>}|null */
    private static ?array $otherEc = null;

    /** @var array{private: string, jwk: array<string, string>}|null */
    private static ?array $rsa = null;

    public static function setUpBeforeClass(): void
    {
        self::$ec = self::ecKey('ec-key');
        self::$otherEc = self::ecKey('ec-key');
        self::$rsa = self::rsaKey('rsa-key');
    }

    /** @return array<string, mixed> */
    private static function jwks(): array
    {
        return ['keys' => [self::$ec['jwk'], self::$rsa['jwk']]];
    }

    /** @return array<string, mixed> */
    private static function claims(array $overrides = [], array $remove = []): array
    {
        $claims = array_merge([
            'sub' => self::USER,
            'iss' => self::ISSUER,
            'aud' => JwksTokenVerifier::AUDIENCE,
            'exp' => time() + 3600,
            'is_anonymous' => true,
        ], $overrides);
        foreach ($remove as $name) {
            unset($claims[$name]);
        }

        return $claims;
    }

    private static function es256(array $claims, ?array $key = null): string
    {
        $key ??= self::$ec;

        return JWT::encode($claims, $key['private'], 'ES256', $key['jwk']['kid']);
    }

    public function test_accepts_valid_guest_token(): void
    {
        $identity = JwksTokenVerifier::verifyWithKeys(self::es256(self::claims()), self::jwks(), self::ISSUER);

        $this->assertSame(self::USER, $identity->userId);
        $this->assertTrue($identity->anonymous);
    }

    public function test_accepts_valid_rs256_token(): void
    {
        $token = JWT::encode(self::claims(['is_anonymous' => false]), self::$rsa['private'], 'RS256', 'rsa-key');
        $identity = JwksTokenVerifier::verifyWithKeys($token, self::jwks(), self::ISSUER);

        $this->assertSame(self::USER, $identity->userId);
        $this->assertFalse($identity->anonymous);
    }

    /** @return iterable<string, array{0: callable(): string}> */
    public static function invalidTokens(): iterable
    {
        yield 'expired' => [fn () => self::es256(self::claims(['exp' => time() - 3600]))];
        yield 'no expiry' => [fn () => self::es256(self::claims(remove: ['exp']))];
        yield 'wrong issuer' => [fn () => self::es256(self::claims(['iss' => 'https://attacker.example/auth/v1']))];
        yield 'wrong audience' => [fn () => self::es256(self::claims(['aud' => 'anon']))];
        yield 'no subject' => [fn () => self::es256(self::claims(remove: ['sub']))];
        yield 'other signing key' => [fn () => self::es256(self::claims(), self::$otherEc)];
        yield 'alg none' => [fn () => self::unsigned(self::claims())];
        yield 'alg HS256' => [fn () => JWT::encode(self::claims(), str_repeat('s', 32), 'HS256', 'ec-key')];
        yield 'garbage' => [fn () => 'not-a-jwt'];
    }

    #[DataProvider('invalidTokens')]
    public function test_rejects_invalid_tokens(callable $token): void
    {
        $this->expectException(InvalidToken::class);
        JwksTokenVerifier::verifyWithKeys($token(), self::jwks(), self::ISSUER);
    }

    public function test_rejects_everything_without_usable_keys(): void
    {
        $this->expectException(InvalidToken::class);
        $jwks = ['keys' => [
            ['kty' => 'oct', 'alg' => 'HS256', 'kid' => 'sym', 'k' => 'c2VjcmV0'],
            self::$ec['jwk'] + ['d' => 'private-part'],
        ]];
        JwksTokenVerifier::verifyWithKeys(self::es256(self::claims()), $jwks, self::ISSUER);
    }

    // --- test key helpers ---

    /** @return array{private: string, jwk: array<string, string>} */
    private static function ecKey(string $kid): array
    {
        $options = self::opensslOptions(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        $key = openssl_pkey_new($options);
        openssl_pkey_export($key, $private, null, $options);
        $details = openssl_pkey_get_details($key);

        return ['private' => $private, 'jwk' => [
            'kty' => 'EC', 'crv' => 'P-256', 'alg' => 'ES256', 'use' => 'sig', 'kid' => $kid,
            'x' => JWT::urlsafeB64Encode($details['ec']['x']),
            'y' => JWT::urlsafeB64Encode($details['ec']['y']),
        ]];
    }

    /** @return array{private: string, jwk: array<string, string>} */
    private static function rsaKey(string $kid): array
    {
        $options = self::opensslOptions(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        $key = openssl_pkey_new($options);
        openssl_pkey_export($key, $private, null, $options);
        $details = openssl_pkey_get_details($key);

        return ['private' => $private, 'jwk' => [
            'kty' => 'RSA', 'alg' => 'RS256', 'use' => 'sig', 'kid' => $kid,
            'n' => JWT::urlsafeB64Encode($details['rsa']['n']),
            'e' => JWT::urlsafeB64Encode($details['rsa']['e']),
        ]];
    }

    /**
     * PHP on Windows needs an openssl.cnf to generate keys; OPENSSL_CONF points at one there.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function opensslOptions(array $options): array
    {
        $config = getenv('OPENSSL_CONF');

        return is_string($config) && $config !== '' ? $options + ['config' => $config] : $options;
    }

    private static function unsigned(array $claims): string
    {
        return JWT::urlsafeB64Encode('{"alg":"none","typ":"JWT"}').'.'
            .JWT::urlsafeB64Encode((string) json_encode($claims)).'.';
    }
}
