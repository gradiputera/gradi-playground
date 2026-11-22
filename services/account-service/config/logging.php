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
