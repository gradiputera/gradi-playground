<?php

// Read env() only in config files, so `php artisan config:cache` keeps working.

return [

    'supabase' => [
        // Project URL: the JWKS endpoint and the expected token issuer derive from it.
        'url' => rtrim((string) env('SUPABASE_URL', ''), '/'),
    ],

];
