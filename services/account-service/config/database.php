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
