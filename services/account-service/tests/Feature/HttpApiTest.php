<?php

namespace Tests\Feature;

use App\Auth\Identity;
use App\Auth\InvalidToken;
use App\Auth\TokenVerifier;
use Tests\TestCase;

class HttpApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Stand-in for JwksTokenVerifier, which has its own tests.
        $this->app->instance(TokenVerifier::class, new class implements TokenVerifier
        {
            public function verify(string $token): Identity
            {
                if ($token !== 'good-token') {
                    throw new InvalidToken('invalid');
                }

                return new Identity('user-1', true);
            }
        });
    }

    public function test_health_needs_no_token(): void
    {
        $this->getJson('/health')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/json')
            ->assertExactJson(['status' => 'ok']);
    }

    public function test_planned_endpoint_requires_token_then_answers_501(): void
    {
        $this->postJson('/sandbox/reset')
            ->assertUnauthorized()
            ->assertHeader('WWW-Authenticate', 'Bearer realm="account-service"')
            ->assertJsonPath('error', 'unauthorized');

        $this->postJson('/sandbox/reset', [], ['Authorization' => 'Bearer bad-token'])
            ->assertUnauthorized();

        $this->postJson('/sandbox/reset', [], ['Authorization' => 'Bearer good-token'])
            ->assertStatus(501)
            ->assertJsonPath('error', 'not_implemented');
    }

    public function test_unknown_routes_and_methods(): void
    {
        $this->getJson('/nope')->assertNotFound();
        $this->getJson('/sandbox/reset')->assertMethodNotAllowed();
        // Errors are JSON even when the client does not ask for it, and never show a trace.
        $this->get('/nope')->assertNotFound()->assertHeader('Content-Type', 'application/json');
    }
}
