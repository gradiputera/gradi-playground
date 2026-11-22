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
