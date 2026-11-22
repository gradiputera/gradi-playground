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
