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
