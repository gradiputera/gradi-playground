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
