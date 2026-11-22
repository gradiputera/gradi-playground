<?php

namespace App\Auth;

use RuntimeException;

/** A token that must be rejected. The message is for logs and never contains the token. */
final class InvalidToken extends RuntimeException {}
