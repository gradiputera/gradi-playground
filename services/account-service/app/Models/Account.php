<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A sandbox account. Stored in account.accounts through the pgsql connection, whose search_path is
 * the account schema (ADR 0004).
 *
 * Only currency is mass-assignable. user_id comes from the verified token and balance_minor changes
 * only through explicit domain operations, so neither can be set from request input.
 */
class Account extends Model
{
    use HasUuids;

    protected $connection = 'pgsql';

    protected $table = 'accounts';

    /** @var list<string> */
    protected $fillable = ['currency'];

    protected function casts(): array
    {
        return [
            'balance_minor' => 'integer',
        ];
    }
}
