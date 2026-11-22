<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Sandbox accounts: one per user and currency. Balances are integer minor units (ISO 4217).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->char('currency', 3);
            $table->bigInteger('balance_minor')->default(0);
            $table->timestampsTz();
            $table->unique(['user_id', 'currency']);
        });

        DB::statement("alter table accounts add constraint accounts_currency_iso4217 check (currency ~ '^[A-Z]{3}$')");
    }

    public function down(): void
    {
        Schema::dropIfExists('accounts');
    }
};
