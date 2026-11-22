<?php

namespace Tests\Integration;

use App\Models\Account;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Runs against the local Supabase stack. Skipped unless ACCOUNT_TEST_DATABASE_URL,
 * ACCOUNT_TEST_SUPABASE_URL and ACCOUNT_TEST_SUPABASE_KEY are set (the account-service CI workflow
 * sets them).
 */
class LocalStackTest extends TestCase
{
    private string $supabaseUrl = '';

    private string $supabaseKey = '';

    protected function setUp(): void
    {
        $databaseUrl = (string) getenv('ACCOUNT_TEST_DATABASE_URL');
        $this->supabaseUrl = (string) getenv('ACCOUNT_TEST_SUPABASE_URL');
        $this->supabaseKey = (string) getenv('ACCOUNT_TEST_SUPABASE_KEY');
        if ($databaseUrl === '' || $this->supabaseUrl === '' || $this->supabaseKey === '') {
            $this->markTestSkipped('integration environment not set');
        }
        // The application reads these when it boots in parent::setUp().
        foreach (['DATABASE_URL' => $databaseUrl, 'SUPABASE_URL' => $this->supabaseUrl] as $name => $value) {
            putenv("{$name}={$value}");
            $_ENV[$name] = $_SERVER[$name] = $value;
        }

        parent::setUp();
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]));
    }

    public function test_migrations_create_tables_in_own_schema_and_rerun_is_no_op(): void
    {
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]));
        $this->assertStringContainsString('Nothing to migrate', Artisan::output());

        $row = DB::selectOne("select to_regclass('account.accounts') is not null as accounts,
                                     to_regclass('account.migrations') is not null as history");
        $this->assertTrue($row->accounts);
        $this->assertTrue($row->history);
        $this->assertSame(1, DB::table('migrations')->where('migration', '2026_11_22_000001_create_accounts_table')->count());
    }

    public function test_accounts_store_integer_minor_units_with_iso_currency(): void
    {
        $account = new Account(['currency' => 'USD']);
        $account->user_id = (string) Str::uuid();
        $account->balance_minor = 12_345;
        $account->save();

        $stored = Account::query()->findOrFail($account->id);
        $this->assertSame(12_345, $stored->balance_minor);
        $this->assertSame('USD', $stored->currency);
        $stored->delete();

        try {
            DB::table('accounts')->insert(['id' => (string) Str::uuid(), 'user_id' => (string) Str::uuid(), 'currency' => 'usd']);
            $this->fail('lowercase currency was accepted');
        } catch (QueryException $e) {
            $this->assertSame('23514', $e->getCode(), 'check_violation');
        }
    }

    public function test_role_cannot_reach_other_schemas(): void
    {
        foreach (['ledger', 'payment', 'notification', 'reporting'] as $schema) {
            try {
                DB::select("select 1 from {$schema}.any_table");
                $this->fail("schema {$schema} was reachable");
            } catch (QueryException $e) {
                $this->assertSame('42501', $e->getCode(), "insufficient_privilege on {$schema}");
            }
        }
    }

    public function test_supabase_guest_token_is_accepted(): void
    {
        $this->postJson('/sandbox/reset')->assertUnauthorized();

        $signup = Http::withHeaders(['apikey' => $this->supabaseKey])
            ->connectTimeout(10)
            ->timeout(10)
            ->post(rtrim($this->supabaseUrl, '/').'/auth/v1/signup', (object) []);
        $this->assertSame(200, $signup->status(), 'anonymous sign-in');

        $this->postJson('/sandbox/reset', [], ['Authorization' => 'Bearer '.$signup->json('access_token')])
            ->assertStatus(501);
    }
}
