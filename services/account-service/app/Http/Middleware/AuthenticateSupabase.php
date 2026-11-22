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
