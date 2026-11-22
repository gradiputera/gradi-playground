# Design

## Context

`services/account-service/` holds only a README and its OpenSpec folder. The platform layer already provides:
- the `account` schema, owned by the `account_service` login role (`search_path = account`), which cannot reach the other service schemas;
- a local-only role password in `supabase/seed.sql`;
- asymmetric Supabase signing keys, published through JWKS.

payment-service (Go) and ledger-service (Java) run on Vercel with the skeleton pattern. This change follows it in PHP 8.4 with Laravel 13.

The local machine has PHP 8.4.28 from Laragon at `C:\laragon\bin\php\php-8.4-nts-Win32-vs17-x64-latest` (no `pdo_pgsql`, which only the integration tests need) and Composer at `C:\laragon\bin\composer\composer.phar`. Docker does not work locally.

Everything in the Appendix was prototyped on a temporary branch. The `account-service` workflow passed on its first run:
- 21 tests, including the 4 integration tests against local Supabase, none skipped;
- `composer validate` and `openspec validate`;
- the oasdiff check;
- the Docker build;
- the container smoke test (FrankenPHP as a non-root user, migrations applied, `/health` and 401).

## Goals / Non-Goals

**Goals:**
- A deployable, tested Laravel skeleton that validates Supabase tokens and owns its migrations.
- The `accounts` table and a mass-assignment-safe `Account` model, ready for step 5.

**Non-Goals:**
- Seeding accounts, balance endpoints, sandbox reset logic, guest restrictions, the site fault flag and telemetry: later steps.
- Any hosted action.

## Decisions

### D1. Minimal Laravel 13 application
The app is hand-assembled instead of `laravel/laravel`'s full skeleton, keeping it to about 30 files:
- `bootstrap/app.php` registers only API routes (no `/api` prefix), the request-log middleware, and a JSON-only error rule (`shouldRenderJsonWhen(fn () => true)`), so no HTML error page or stack trace is ever sent;
- `bootstrap/app.php` also binds `TokenVerifier` to `JwksTokenVerifier`.

Laravel 13 merges the app's `config/` files over its defaults, so only the five overrides exist:

| File | Setting |
|---|---|
| `database.php` | Only `pgsql`, from `DATABASE_URL`, `search_path = account`, 10-second connect timeout (`PDO::ATTR_TIMEOUT`, which `pdo_pgsql` maps to `connect_timeout`) |
| `logging.php` | JSON lines on stdout only |
| `cache.php` | File store for the JWKS (no cache table) |
| `session.php` | `array` driver: a stateless API with no session table or cookie |
| `services.php` | `SUPABASE_URL` |

`env()` is read only in `config/`, so `php artisan config:cache` at container start keeps working. `APP_DEBUG` defaults to false. The image sets `APP_DEBUG=false` and `APP_ENV=production`, and no committed file sets it to true.

### D2. JWT validation with firebase/php-jwt
`JwksTokenVerifier::verifyWithKeys()` is pure and unit-tested. It runs these checks in order:
1. the header `alg` must be ES256 or RS256;
2. the key set keeps only public EC or RSA keys with a `kid` and an allowed `alg`; symmetric and private keys are ignored;
3. `JWT::decode` checks the signature, the algorithm against the key's algorithm, and `exp`/`nbf`/`iat` with a 30-second leeway;
4. then `iss`, `aud` (`authenticated`), a numeric `exp` and a non-empty `sub` are checked.

Network and cache behaviour:
- the JWKS comes from the Laravel HTTP client (5-second connect and response timeout) and is cached for an hour in the file cache;
- a rejected token clears the cache at most once every 5 minutes, through an atomic `Cache::add` lock, so a rotated key is picked up without a fetch storm.

`AuthenticateSupabase` answers 401 with `WWW-Authenticate: Bearer` and stores only `Identity(userId, anonymous)` on the request. `docs/security/auth.md` names this library for PHP.

### D3. Migrations at startup
The container entrypoint runs `php artisan migrate --force` before starting FrankenPHP. The `migrations` history table and `accounts` live in `account`, through the connection's `search_path` and the role's own default. Laravel's migrator takes a lock (`--isolated` is not needed on Postgres), and an up-to-date schema is a no-op ("Nothing to migrate"). The hosted URL uses the session pooler on port 5432, the same as the other services.

### D4. `accounts` table and `Account` model
- **Columns:**
  - `id` uuid primary key (`HasUuids`);
  - `user_id` uuid;
  - `currency` `char(3)` with a `^[A-Z]{3}$` check;
  - `balance_minor` `bigint` default 0;
  - `created_at` and `updated_at` as `timestamptz`.
- **Uniqueness:** `(user_id, currency)` is unique, which meets "one or more accounts per user, each with a currency" without duplicate currencies.
- **Model and fillable fields:** `App\Models\Account` pins `$connection = 'pgsql'` and `$table = 'accounts'`, so it is pinned to the `account` schema through the connection's `search_path`. It has `$fillable = ['currency']` only, and casts `balance_minor` to an integer.

### D5. FrankenPHP container
Build stage:
- `dunglas/frankenphp:1.14.0-php8.4.28-trixie`, plus Composer from `composer:2.11.2` and the `zip` extension;
- dependencies install without dev packages, from `composer.lock`, with a classmap-authoritative autoloader.

Runtime stage:
- the same FrankenPHP image with `pdo_pgsql` and `opcache`;
- a non-root `app` user (uid 10001), with `setcap -r` because port 8080 needs no capability;
- production `php.ini` (no displayed errors, `expose_php=Off`, OPcache without timestamp checks).

Caddyfile:
- `admin off`, `auto_https off` and `grace_period 20s` (SIGTERM drain);
- listens on `:{$PORT:80}`;
- `php_server` on `/app/public`;
- no access log, because Laravel logs requests itself without IPs or headers.

The entrypoint exits 1 with a JSON line when `DATABASE_URL` or `SUPABASE_URL` is missing. Otherwise it caches config, migrates, and `exec`s FrankenPHP, so FrankenPHP receives signals directly.

Alternative considered: nginx with PHP-FPM. Rejected because it needs two processes and a supervisor (owner's choice, recorded in this change).

### D6. Tests and CI
- **Unit tests** (plain PHPUnit, no Laravel):
  - `TokenVerifierTest`: ES256 and RS256 keys generated with OpenSSL. On Windows, `OPENSSL_CONF` points at PHP's `extras/ssl/openssl.cnf`;
  - `AccountTest`.
- **Feature tests** (`HttpApiTest`): Laravel's HTTP testing with a stand-in verifier.
- **Integration tests** (`LocalStackTest`): skipped unless three `ACCOUNT_TEST_*` variables are set; they set `DATABASE_URL` and `SUPABASE_URL` before the app boots.
- **CI workflow `account-service`:**
  - setup-php 8.4 with `pdo_pgsql` and Composer 2.11.2;
  - `composer validate --no-check-publish`. Exact pins are deliberate, so `--strict` pin warnings are not failures;
  - `composer install` and `openspec validate`;
  - oasdiff through its Docker image;
  - local Supabase, then PHPUnit with a JUnit report, and a check that the Integration suite ran 4 tests with none skipped;
  - the Docker build and the smoke test.
- **Dependabot:** watches `composer` and `docker` in the service folder.

### D7. Lockfile and secret scanning
- **Lockfile:** `composer.lock` is committed for reproducible builds. The plan ships the exact prototype lockfile in `openspec/changes/service-skeleton/assets/composer.lock`, and the tasks copy it, so `composer install` resolves the same versions that passed CI.
- **Secret scanning:** `vendor/` is gitignored but sits in the working tree after `composer install`. It contains a sample private key (php-jwt's README) and a MIME-type string that the file-system scan (`gitleaks detect --no-git`) reports. The tasks therefore scan what is being committed (`gitleaks git --staged`) and the branch's commits (`gitleaks git --log-opts=main..HEAD`), the same scope as the gitleaks CI check.

### D8. Dependencies and quotas
| Package / image | Version | License | Why |
|---|---|---|---|
| `laravel/framework` | 13.43.0 | MIT | HTTP kernel, routing, migrations, Eloquent, HTTP client, cache, logging |
| `firebase/php-jwt` | 7.2.2 | BSD-3-Clause | JWT and JWK handling |
| `phpunit/phpunit` (dev) | 13.4.8 | BSD-3-Clause | Tests; not installed in the image |
| `dunglas/frankenphp` image | 1.14.0-php8.4.28-trixie | MIT (FrankenPHP), PHP License (PHP) | Web server and PHP runtime |
| `composer` image | 2.11.2 | MIT | Build stage only |

Transitive dependencies come from Laravel (Symfony components and others) and are MIT or BSD licensed. They are pinned through `composer.lock`. BSD-3-Clause and the PHP License are permissive and compatible with the MIT-licensed repository.

Free-tier usage:
- **Vercel Hobby:** one more project.
- **Database:** one connection per request that touches the database. The skeleton has none, apart from migrations at start.
- **JWKS:** about one fetch per hour per warm container.

## Risks / Trade-offs

- [Classic mode boots Laravel on every request] → About 10 to 20 ms per request with OPcache, which is fine for a demo. FrankenPHP worker mode can come later if latency matters.
- [Exact pins trigger `composer validate --strict` warnings] → Deliberate (repository rule). CI runs `validate` without `--strict`.
- [The file cache lives in the container] → It is lost on scale-down, so the first request after a cold start fetches the JWKS once.
- [Root files touched by a service change] → `.github/workflows/account-service.yml` and two `dependabot.yml` entries, the same exception as the other services.
- [Local PHP lacks `pdo_pgsql` and Docker] → Unit and feature tests run locally. CI is authoritative for the integration tests, the image and the smoke test.

## Appendix

Copy every file exactly. Paths are relative to the repository root. `composer.lock` is not in this appendix: copy it from `services/account-service/openspec/changes/service-skeleton/assets/composer.lock`.

### A1. `services/account-service/composer.json` (full file)

````json
{
    "name": "gradiputera/account-service",
    "description": "Sandbox accounts and balances for gradi-playground.",
    "type": "project",
    "license": "MIT",
    "require": {
        "php": "^8.4",
        "firebase/php-jwt": "7.2.2",
        "laravel/framework": "13.43.0"
    },
    "require-dev": {
        "phpunit/phpunit": "13.4.8"
    },
    "autoload": {
        "psr-4": {
            "App\\": "app/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Tests\\": "tests/"
        }
    },
    "config": {
        "optimize-autoloader": true,
        "platform": {
            "php": "8.4.28"
        },
        "sort-packages": true
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}
````

### A2. `services/account-service/artisan` (full file)

````php
#!/usr/bin/env php
<?php

use Illuminate\Foundation\Application;
use Symfony\Component\Console\Input\ArgvInput;

define('LARAVEL_START', microtime(true));

require __DIR__.'/vendor/autoload.php';

/** @var Application $app */
$app = require_once __DIR__.'/bootstrap/app.php';

$status = $app->handleCommand(new ArgvInput);

exit($status);
````

### A3. `services/account-service/phpunit.xml` (full file)

````xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         failOnWarning="true"
         failOnRisky="true">
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
        <testsuite name="Integration">
            <directory>tests/Integration</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="APP_DEBUG" value="false"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="LOG_LEVEL" value="warning"/>
    </php>
</phpunit>
````

### A4. `services/account-service/bootstrap/app.php` (full file)

````php
<?php

use App\Auth\JwksTokenVerifier;
use App\Auth\TokenVerifier;
use App\Http\Middleware\LogRequest;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        apiPrefix: '',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(LogRequest::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // An API only: every error is JSON, never an HTML page or a stack trace.
        $exceptions->shouldRenderJsonWhen(fn () => true);
    })
    ->create();

$app->singleton(TokenVerifier::class, JwksTokenVerifier::class);

return $app;
````

### A5. `services/account-service/bootstrap/cache/.gitignore` (full file)

````text
*
!.gitignore
````

### A6. `services/account-service/public/index.php` (full file)

````php
<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

require __DIR__.'/../vendor/autoload.php';

/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
````

### A7. `services/account-service/routes/api.php` (full file)

````php
<?php

use App\Http\Controllers\HealthController;
use App\Http\Controllers\NotImplementedController;
use App\Http\Middleware\AuthenticateSupabase;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

// Planned endpoints: authenticated now, implemented by later changes (roadmap step 5).
Route::middleware(AuthenticateSupabase::class)->group(function (): void {
    Route::post('/sandbox/reset', NotImplementedController::class);
});
````

### A8. `services/account-service/config/database.php` (full file)

````php
<?php

// One connection: the account_service role, pinned to the account schema (ADR 0004).
// DATABASE_URL uses the same postgres://user:password@host:port/db?params format as every service.

return [

    'default' => 'pgsql',

    'connections' => [
        'pgsql' => [
            'driver' => 'pgsql',
            'url' => env('DATABASE_URL'),
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            // Every query, including the migrations history table, resolves to the account schema.
            'search_path' => 'account',
            'sslmode' => 'prefer',
            'options' => [
                // Fail fast when the database is unreachable.
                PDO::ATTR_TIMEOUT => 10,
            ],
        ],
    ],

    'migrations' => [
        'table' => 'migrations',
        'update_date_on_publish' => true,
    ],

];
````

### A9. `services/account-service/config/logging.php` (full file)

````php
<?php

use Monolog\Formatter\JsonFormatter;
use Monolog\Handler\StreamHandler;

// One JSON object per line on stdout, which Vercel collects as logs. Nothing is written to files.

return [

    'default' => 'stdout',

    'deprecations' => [
        'channel' => 'null',
        'trace' => false,
    ],

    'channels' => [
        'stdout' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'info'),
            'handler' => StreamHandler::class,
            'formatter' => JsonFormatter::class,
            'with' => [
                'stream' => 'php://stdout',
            ],
        ],

        'null' => [
            'driver' => 'monolog',
            'handler' => Monolog\Handler\NullHandler::class,
        ],
    ],

];
````

### A10. `services/account-service/config/cache.php` (full file)

````php
<?php

// The cache holds only the Supabase JWKS. A file store keeps it across requests without a cache
// table; tests use the array store (phpunit.xml).

return [

    'default' => env('CACHE_STORE', 'file'),

    'stores' => [
        'file' => [
            'driver' => 'file',
            'path' => storage_path('framework/cache/data'),
            'lock_path' => storage_path('framework/cache/data'),
        ],

        'array' => [
            'driver' => 'array',
            'serialize' => false,
        ],
    ],

    'prefix' => 'account-service-',

];
````

### A11. `services/account-service/config/session.php` (full file)

````php
<?php

// A stateless API: no session storage, no session cookie.

return [

    'driver' => 'array',

];
````

### A12. `services/account-service/config/services.php` (full file)

````php
<?php

// Read env() only in config files, so `php artisan config:cache` keeps working.

return [

    'supabase' => [
        // Project URL: the JWKS endpoint and the expected token issuer derive from it.
        'url' => rtrim((string) env('SUPABASE_URL', ''), '/'),
    ],

];
````

### A13. `services/account-service/app/Auth/Identity.php` (full file)

````php
<?php

namespace App\Auth;

/** What handlers learn about the caller. It never holds the token itself. */
final readonly class Identity
{
    public function __construct(
        public string $userId,
        public bool $anonymous,
    ) {}
}
````

### A14. `services/account-service/app/Auth/InvalidToken.php` (full file)

````php
<?php

namespace App\Auth;

use RuntimeException;

/** A token that must be rejected. The message is for logs and never contains the token. */
final class InvalidToken extends RuntimeException {}
````

### A15. `services/account-service/app/Auth/TokenVerifier.php` (full file)

````php
<?php

namespace App\Auth;

interface TokenVerifier
{
    /**
     * Returns the caller's identity, or throws InvalidToken for any token that must be rejected.
     *
     * @throws InvalidToken
     */
    public function verify(string $token): Identity;
}
````

### A16. `services/account-service/app/Auth/JwksTokenVerifier.php` (full file)

````php
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
````

### A17. `services/account-service/app/Http/Middleware/AuthenticateSupabase.php` (full file)

````php
<?php

namespace App\Http\Middleware;

use App\Auth\Identity;
use App\Auth\InvalidToken;
use App\Auth\TokenVerifier;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects requests without a valid Supabase bearer token with 401 and stores the caller's
 * Identity as the request attribute "identity". Token contents are never logged.
 */
class AuthenticateSupabase
{
    public function __construct(private readonly TokenVerifier $verifier) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        if ($token === null || $token === '') {
            return self::unauthorized('missing bearer token');
        }

        try {
            $identity = $this->verifier->verify($token);
        } catch (InvalidToken) {
            return self::unauthorized('invalid token');
        }

        $request->attributes->set('identity', $identity);

        return $next($request);
    }

    public static function identity(Request $request): Identity
    {
        return $request->attributes->get('identity');
    }

    private static function unauthorized(string $message): JsonResponse
    {
        return new JsonResponse(
            ['error' => 'unauthorized', 'message' => $message],
            401,
            ['WWW-Authenticate' => 'Bearer realm="account-service"'],
        );
    }
}
````

### A18. `services/account-service/app/Http/Middleware/LogRequest.php` (full file)

````php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/** Logs method, route, status and duration only: no headers, tokens, query strings or user ids. */
class LogRequest
{
    public function handle(Request $request, Closure $next): Response
    {
        $start = hrtime(true);
        $response = $next($request);

        Log::info('request', [
            'method' => $request->method(),
            'route' => $request->route()?->uri() ?? 'unmatched',
            'status' => $response->getStatusCode(),
            'duration_ms' => intdiv(hrtime(true) - $start, 1_000_000),
        ]);

        return $response;
    }
}
````

### A19. `services/account-service/app/Http/Controllers/HealthController.php` (full file)

````php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class HealthController
{
    public function __invoke(): JsonResponse
    {
        return new JsonResponse(['status' => 'ok']);
    }
}
````

### A20. `services/account-service/app/Http/Controllers/NotImplementedController.php` (full file)

````php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

/** Planned endpoints answer 501 until a later change implements them. They write nothing. */
class NotImplementedController
{
    public function __invoke(): JsonResponse
    {
        return new JsonResponse([
            'error' => 'not_implemented',
            'message' => 'This endpoint is planned and not implemented yet.',
        ], 501);
    }
}
````

### A21. `services/account-service/app/Models/Account.php` (full file)

````php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A sandbox account. Stored in account.accounts through the pgsql connection, whose search_path is
 * the account schema (ADR 0004).
 *
 * Only currency is mass-assignable. user_id comes from the verified token and balance_minor changes
 * only through explicit domain operations, so neither can be set from request input.
 */
class Account extends Model
{
    use HasUuids;

    protected $connection = 'pgsql';

    protected $table = 'accounts';

    /** @var list<string> */
    protected $fillable = ['currency'];

    protected function casts(): array
    {
        return [
            'balance_minor' => 'integer',
        ];
    }
}
````

### A22. `services/account-service/database/migrations/2026_11_22_000001_create_accounts_table.php` (full file)

````php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Sandbox accounts: one per user and currency. Balances are integer minor units (ISO 4217).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->char('currency', 3);
            $table->bigInteger('balance_minor')->default(0);
            $table->timestampsTz();
            $table->unique(['user_id', 'currency']);
        });

        DB::statement("alter table accounts add constraint accounts_currency_iso4217 check (currency ~ '^[A-Z]{3}$')");
    }

    public function down(): void
    {
        Schema::dropIfExists('accounts');
    }
};
````

### A23. `services/account-service/storage/framework/cache/data/.gitignore` (full file)

````text
*
!.gitignore
````

### A24. `services/account-service/storage/logs/.gitignore` (full file)

````text
*
!.gitignore
````

### A25. `services/account-service/tests/TestCase.php` (full file)

````php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase {}
````

### A26. `services/account-service/tests/Unit/TokenVerifierTest.php` (full file)

````php
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
````

### A27. `services/account-service/tests/Unit/AccountTest.php` (full file)

````php
<?php

namespace Tests\Unit;

use App\Models\Account;
use PHPUnit\Framework\TestCase;

class AccountTest extends TestCase
{
    public function test_only_currency_is_mass_assignable(): void
    {
        $account = new Account([
            'currency' => 'USD',
            'user_id' => '6f1c7d0e-0000-4000-8000-000000000001',
            'balance_minor' => 1_000_000,
            'id' => 'chosen-by-client',
        ]);

        $this->assertSame('USD', $account->currency);
        $this->assertNull($account->user_id);
        $this->assertNull($account->balance_minor);
        $this->assertNull($account->id);
    }

    public function test_model_is_pinned_to_the_account_connection_and_table(): void
    {
        $account = new Account;

        $this->assertSame('pgsql', $account->getConnectionName());
        $this->assertSame('accounts', $account->getTable());
    }
}
````

### A28. `services/account-service/tests/Feature/HttpApiTest.php` (full file)

````php
<?php

namespace Tests\Feature;

use App\Auth\Identity;
use App\Auth\InvalidToken;
use App\Auth\TokenVerifier;
use Tests\TestCase;

class HttpApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Stand-in for JwksTokenVerifier, which has its own tests.
        $this->app->instance(TokenVerifier::class, new class implements TokenVerifier
        {
            public function verify(string $token): Identity
            {
                if ($token !== 'good-token') {
                    throw new InvalidToken('invalid');
                }

                return new Identity('user-1', true);
            }
        });
    }

    public function test_health_needs_no_token(): void
    {
        $this->getJson('/health')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/json')
            ->assertExactJson(['status' => 'ok']);
    }

    public function test_planned_endpoint_requires_token_then_answers_501(): void
    {
        $this->postJson('/sandbox/reset')
            ->assertUnauthorized()
            ->assertHeader('WWW-Authenticate', 'Bearer realm="account-service"')
            ->assertJsonPath('error', 'unauthorized');

        $this->postJson('/sandbox/reset', [], ['Authorization' => 'Bearer bad-token'])
            ->assertUnauthorized();

        $this->postJson('/sandbox/reset', [], ['Authorization' => 'Bearer good-token'])
            ->assertStatus(501)
            ->assertJsonPath('error', 'not_implemented');
    }

    public function test_unknown_routes_and_methods(): void
    {
        $this->getJson('/nope')->assertNotFound();
        $this->getJson('/sandbox/reset')->assertMethodNotAllowed();
        // Errors are JSON even when the client does not ask for it, and never show a trace.
        $this->get('/nope')->assertNotFound()->assertHeader('Content-Type', 'application/json');
    }
}
````

### A29. `services/account-service/tests/Integration/LocalStackTest.php` (full file)

````php
<?php

namespace Tests\Integration;

use App\Models\Account;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Runs against the local Supabase stack. Skipped unless ACCOUNT_TEST_DATABASE_URL,
 * ACCOUNT_TEST_SUPABASE_URL and ACCOUNT_TEST_SUPABASE_KEY are set (the account-service CI workflow
 * sets them).
 */
class LocalStackTest extends TestCase
{
    private string $supabaseUrl = '';

    private string $supabaseKey = '';

    protected function setUp(): void
    {
        $databaseUrl = (string) getenv('ACCOUNT_TEST_DATABASE_URL');
        $this->supabaseUrl = (string) getenv('ACCOUNT_TEST_SUPABASE_URL');
        $this->supabaseKey = (string) getenv('ACCOUNT_TEST_SUPABASE_KEY');
        if ($databaseUrl === '' || $this->supabaseUrl === '' || $this->supabaseKey === '') {
            $this->markTestSkipped('integration environment not set');
        }
        // The application reads these when it boots in parent::setUp().
        foreach (['DATABASE_URL' => $databaseUrl, 'SUPABASE_URL' => $this->supabaseUrl] as $name => $value) {
            putenv("{$name}={$value}");
            $_ENV[$name] = $_SERVER[$name] = $value;
        }

        parent::setUp();
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]));
    }

    public function test_migrations_create_tables_in_own_schema_and_rerun_is_no_op(): void
    {
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]));
        $this->assertStringContainsString('Nothing to migrate', Artisan::output());

        $row = DB::selectOne("select to_regclass('account.accounts') is not null as accounts,
                                     to_regclass('account.migrations') is not null as history");
        $this->assertTrue($row->accounts);
        $this->assertTrue($row->history);
        $this->assertSame(1, DB::table('migrations')->where('migration', '2026_11_22_000001_create_accounts_table')->count());
    }

    public function test_accounts_store_integer_minor_units_with_iso_currency(): void
    {
        $account = new Account(['currency' => 'USD']);
        $account->user_id = (string) Str::uuid();
        $account->balance_minor = 12_345;
        $account->save();

        $stored = Account::query()->findOrFail($account->id);
        $this->assertSame(12_345, $stored->balance_minor);
        $this->assertSame('USD', $stored->currency);
        $stored->delete();

        try {
            DB::table('accounts')->insert(['id' => (string) Str::uuid(), 'user_id' => (string) Str::uuid(), 'currency' => 'usd']);
            $this->fail('lowercase currency was accepted');
        } catch (QueryException $e) {
            $this->assertSame('23514', $e->getCode(), 'check_violation');
        }
    }

    public function test_role_cannot_reach_other_schemas(): void
    {
        foreach (['ledger', 'payment', 'notification', 'reporting'] as $schema) {
            try {
                DB::select("select 1 from {$schema}.any_table");
                $this->fail("schema {$schema} was reachable");
            } catch (QueryException $e) {
                $this->assertSame('42501', $e->getCode(), "insufficient_privilege on {$schema}");
            }
        }
    }

    public function test_supabase_guest_token_is_accepted(): void
    {
        $this->postJson('/sandbox/reset')->assertUnauthorized();

        $signup = Http::withHeaders(['apikey' => $this->supabaseKey])
            ->connectTimeout(10)
            ->timeout(10)
            ->post(rtrim($this->supabaseUrl, '/').'/auth/v1/signup', (object) []);
        $this->assertSame(200, $signup->status(), 'anonymous sign-in');

        $this->postJson('/sandbox/reset', [], ['Authorization' => 'Bearer '.$signup->json('access_token')])
            ->assertStatus(501);
    }
}
````

### A30. `services/account-service/docker/Caddyfile` (full file)

````text
# FrankenPHP (Caddy with PHP built in) serving the Laravel public/ folder.
{
	frankenphp
	admin off
	auto_https off
	skip_install_trust
	# Vercel sends SIGTERM and allows 30 seconds; finish in-flight requests within 20.
	grace_period 20s
}

:{$PORT:80} {
	root * /app/public
	php_server
}
````

### A31. `services/account-service/docker/php.ini` (full file)

````ini
; Production PHP settings for the account-service image.
expose_php = Off
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /dev/stderr
memory_limit = 256M
opcache.enable = 1
opcache.validate_timestamps = 0
opcache.memory_consumption = 64
````

### A32. `services/account-service/docker/entrypoint.sh` (full file)

````sh
#!/bin/sh
# Refuses to start without configuration, applies migrations, then serves HTTP.
set -eu

if [ -z "${DATABASE_URL:-}" ] || [ -z "${SUPABASE_URL:-}" ]; then
  echo '{"level":"ERROR","message":"account-service stopped: DATABASE_URL and SUPABASE_URL must be set"}'
  exit 1
fi

cd /app
php artisan config:cache --no-interaction >/dev/null
php artisan migrate --force --no-interaction
exec frankenphp run --config /etc/frankenphp/Caddyfile
````

### A33. `services/account-service/Dockerfile` (full file)

````dockerfile
# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).
# FrankenPHP serves Laravel from a single process (Caddy with PHP built in).

FROM composer:2.11.2 AS composer

FROM dunglas/frankenphp:1.14.0-php8.4.28-trixie AS build
COPY --from=composer /usr/bin/composer /usr/bin/composer
RUN install-php-extensions zip
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --no-scripts --no-autoloader --prefer-dist
COPY . .
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative --no-scripts

FROM dunglas/frankenphp:1.14.0-php8.4.28-trixie
RUN install-php-extensions pdo_pgsql opcache \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    # A non-root user binds 8080, so FrankenPHP needs no extra capability.
    && setcap -r /usr/local/bin/frankenphp \
    && mkdir -p /data/caddy /config/caddy \
    && chown -R app:app /data/caddy /config/caddy
WORKDIR /app
COPY --from=build --chown=app:app /app /app
COPY docker/Caddyfile /etc/frankenphp/Caddyfile
COPY docker/php.ini /usr/local/etc/php/conf.d/zz-account-service.ini
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/account-service
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PORT=8080 APP_ENV=production APP_DEBUG=false LOG_LEVEL=info
EXPOSE 8080
USER app
ENTRYPOINT ["/usr/local/bin/account-service"]
````

### A34. `services/account-service/.dockerignore` (full file)

````text
.env
.env.*
vendor/
tests/
openspec/
storage/logs/*.log
bootstrap/cache/*.php
phpunit.xml
.phpunit.result.cache
.phpunit.cache/
README.md
Dockerfile
.dockerignore
vercel.json
````

### A35. `services/account-service/vercel.json` (full file)

````json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "container"
}
````

### A36. `services/account-service/.env.example` (full file)

````text
# Local development only. Copy to .env (gitignored). Hosted values live only in Vercel.
# Keep APP_DEBUG off outside your own machine.
APP_ENV=local
APP_DEBUG=false
# Local-only role password from supabase/seed.sql; never a real credential.
DATABASE_URL=postgres://account_service:local-dev-only-account@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
````

### A37. `services/account-service/README.md` (full file)

````md
# account-service

Customer sandbox accounts and balances. Built with PHP 8.4 and Laravel 13, served by FrankenPHP and packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, own-schema migrations, the `accounts` table and model, the container image and CI. `POST /sandbox/reset` answers `501` until roadmap step 5.

## Responsibilities

- Owns the `account` schema in the shared Supabase Postgres project. Migrations use Laravel migrations, with the history table (`migrations`) inside the `account` schema, applied on every start.
- Manages per-user sandbox accounts and balances in integer minor units with an ISO 4217 currency.
- Models are pinned to the `account` schema: they use the `pgsql` connection, whose `search_path` is `account`.
- No unguarded mass assignment: on `Account`, only `currency` is fillable. `user_id` comes from the verified token, and `balance_minor` changes only through domain operations.

## Data model

| Table | Holds |
|---|---|
| `accounts` | `id` (uuid), `user_id` (uuid), `currency` (ISO 4217, checked), `balance_minor` (bigint), timestamps; unique per (user, currency) |

## API

The contract is [contracts/openapi/account.yaml](../../contracts/openapi/account.yaml).

| Endpoint | Token | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /sandbox/reset` | required | `501` (planned: deletes the caller's rows in `account` and re-applies the seed) |

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`. Every error response is JSON, never an HTML page or a stack trace.

Tokens are Supabase Auth access tokens, validated by the service with `firebase/php-jwt` (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

## Events

- Publishes: none.
- Consumes: none.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `account_service` role. URL-encode special characters in the password. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |
| `APP_DEBUG` | Always `false` outside your own machine; the image sets it to `false`. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds (connect and response), cached for an hour. After a rejected token it is fetched again at most once every 5 minutes.
- **Database connection:** 10-second connect timeout.

## Local development

You need PHP 8.4 with `pdo_pgsql` and Composer 2, plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `account_service` password.
2. Install and run from this folder:
   ```bash
   composer install
   cp .env.example .env
   php artisan migrate
   php artisan serve --port 8081
   ```
3. Check it: `curl http://127.0.0.1:8081/health`.

Tests:
- `vendor/bin/phpunit` runs the unit and feature tests and skips the integration tests. On Windows, set `OPENSSL_CONF` to your PHP's `extras/ssl/openssl.cnf` so the tests can generate keys.
- To run the integration tests too, with the local stack running:
  ```bash
  eval "$(npx -y supabase@3.2.0 status -o env)"
  ACCOUNT_TEST_DATABASE_URL="postgres://account_service:local-dev-only-account@127.0.0.1:54322/postgres" \
  ACCOUNT_TEST_SUPABASE_URL="$API_URL" ACCOUNT_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
    vendor/bin/phpunit
  ```

Container: `docker build -t account-service .`, then run it with the three variables set. On start it:
1. caches the configuration;
2. applies migrations;
3. starts FrankenPHP.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role account_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/account-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://account_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`.

   Use session mode, not transaction mode (port 6543), the same as the other services.
3. **Check.** After the deploy:
   - `https://<account-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /sandbox/reset` without a token returns `401`.

## Related

- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0011: Per-user sandbox seed and reset](../../architecture/adr/0011-per-user-sandbox-seed-and-reset.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
````

### A38. `.github/workflows/account-service.yml` (full file)

````yaml
name: account-service

on:
  push:
    branches: [main]
    paths:
      - "services/account-service/**"
      - "contracts/openapi/account.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/account-service.yml"
  pull_request:
    paths:
      - "services/account-service/**"
      - "contracts/openapi/account.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/account-service.yml"

permissions:
  contents: read

jobs:
  account-service:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    defaults:
      run:
        working-directory: services/account-service
    env:
      # Dummy values so env() references in supabase/config.toml resolve. Not real credentials.
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: ci-dummy-client-id
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: ci-dummy-secret
      SUPABASE_AUTH_CAPTCHA_SECRET: ci-dummy-captcha
      # Local-only role password from supabase/seed.sql. Not a real credential.
      LOCAL_DATABASE_URL: postgres://account_service:local-dev-only-account@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: shivammathur/setup-php@v2
        with:
          php-version: "8.4"
          extensions: pdo_pgsql
          tools: composer:2.11.2
          coverage: none

      # Exact version pins are deliberate (repository rule), so pin warnings do not fail the build.
      - run: composer validate --no-check-publish

      - run: composer install --no-interaction --no-progress --prefer-dist

      - name: Validate service specs
        run: npx -y @fission-ai/openspec@latest validate --all --strict

      - name: Check the API contract for breaking changes
        if: github.event_name == 'pull_request'
        working-directory: .
        run: |
          git show "origin/${{ github.base_ref }}:contracts/openapi/account.yaml" > "$RUNNER_TEMP/account-base.yaml"
          cp contracts/openapi/account.yaml "$RUNNER_TEMP/account-revision.yaml"
          docker run --rm -v "$RUNNER_TEMP:/specs:ro" tufin/oasdiff:v1.39.0 \
            breaking --fail-on ERR /specs/account-base.yaml /specs/account-revision.yaml

      - uses: supabase/setup-cli@v3
        with:
          version: 3.2.0

      - name: Generate an ephemeral JWT signing key
        working-directory: .
        run: |
          echo '[]' > supabase/signing_keys.json
          supabase gen signing-key --algorithm ES256 --append

      # Database, auth and gateway only.
      - name: Start the local Supabase stack
        working-directory: .
        run: supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor

      # Unit and feature tests, plus the integration tests against the local stack.
      - name: Tests
        run: |
          eval "$(supabase status -o env)"
          ACCOUNT_TEST_DATABASE_URL="$LOCAL_DATABASE_URL" \
          ACCOUNT_TEST_SUPABASE_URL="$API_URL" \
          ACCOUNT_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
            vendor/bin/phpunit --log-junit "$RUNNER_TEMP/account-junit.xml"

      - name: Check that the integration tests ran
        run: |
          node -e '
            const xml = require("fs").readFileSync(process.argv[1], "utf8");
            const suite = xml.match(/<testsuite name="Integration"[^>]*>/);
            if (!suite) throw new Error("Integration suite missing");
            const attr = (n) => Number(suite[0].match(new RegExp(n + "=\"(\\d+)\""))[1]);
            if (attr("tests") !== 4 || attr("skipped") !== 0 || attr("failures") !== 0 || attr("errors") !== 0) {
              throw new Error("Integration suite: " + suite[0]);
            }
            console.log(suite[0]);
          ' "$RUNNER_TEMP/account-junit.xml"

      - name: Build the container image
        run: docker build -t account-service:ci .

      - name: Smoke test the container
        run: |
          eval "$(supabase status -o env)"
          docker run -d --name account-service --network host \
            -e PORT=8081 -e DATABASE_URL="$LOCAL_DATABASE_URL" -e SUPABASE_URL="$API_URL" \
            account-service:ci
          for i in $(seq 1 60); do
            curl -fsS http://127.0.0.1:8081/health && break
            sleep 1
          done
          test "$(curl -s http://127.0.0.1:8081/health)" = '{"status":"ok"}'
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8081/sandbox/reset)" = 401
          docker logs account-service

      - name: Stop the local Supabase stack
        if: always()
        working-directory: .
        run: supabase stop --no-backup
````

### A39. `contracts/openapi/account.yaml` (full file; adds the `501` response)

````yaml
openapi: 3.1.0
x-status: planned
info:
  title: account-service API
  version: 0.1.0
servers: []
security:
  - bearerAuth: []
paths:
  /health:
    get:
      summary: Health check
      security: []
      responses:
        "200":
          description: Service is healthy.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    const: ok
  /sandbox/reset:
    post:
      summary: Reset the caller's sandbox accounts to seed
      responses:
        "200":
          description: Caller's rows were deleted and the seed was re-applied.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
````

### A40. `.github/dependabot.yml` (append)

Append these lines at the end of the file, after the last line of the existing ledger-service `docker` entry (its `ignore` list ends with `- dependency-name: "maven"`). Keep the two-space indentation: each `- package-ecosystem` line starts with two spaces, at the same level as the existing entries. Change nothing else.

````yaml
  - package-ecosystem: composer
    directory: /services/account-service
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /services/account-service
    schedule:
      interval: weekly
````
