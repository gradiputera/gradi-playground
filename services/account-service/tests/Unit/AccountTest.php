<?php

namespace Tests\Unit;

use App\Models\Account;
use PHPUnit\Framework\TestCase;

class AccountTest extends TestCase
{
    public function test_only_currency_is_mass_assignable(): void
    {
        $account = new Account([
            'currency' => 'USD',
            'user_id' => '6f1c7d0e-0000-4000-8000-000000000001',
            'balance_minor' => 1_000_000,
            'id' => 'chosen-by-client',
        ]);

        $this->assertSame('USD', $account->currency);
        $this->assertNull($account->user_id);
        $this->assertNull($account->balance_minor);
        $this->assertNull($account->id);
    }

    public function test_model_is_pinned_to_the_account_connection_and_table(): void
    {
        $account = new Account;

        $this->assertSame('pgsql', $account->getConnectionName());
        $this->assertSame('accounts', $account->getTable());
    }
}
