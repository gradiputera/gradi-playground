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
