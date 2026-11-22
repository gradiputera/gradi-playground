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
