// Package integration_test runs payment-service against the local Supabase stack. It is skipped
// unless PAYMENT_TEST_DATABASE_URL, PAYMENT_TEST_SUPABASE_URL and PAYMENT_TEST_SUPABASE_KEY are set
// (the payment-service CI workflow sets them).
package integration_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/gradiputera/gradi-playground/services/payment-service/internal/auth"
	"github.com/gradiputera/gradi-playground/services/payment-service/internal/httpapi"
	"github.com/gradiputera/gradi-playground/services/payment-service/internal/migrations"
)

type env struct{ databaseURL, supabaseURL, supabaseKey string }

func loadEnv(t *testing.T) env {
	t.Helper()
	e := env{
		databaseURL: os.Getenv("PAYMENT_TEST_DATABASE_URL"),
		supabaseURL: os.Getenv("PAYMENT_TEST_SUPABASE_URL"),
		supabaseKey: os.Getenv("PAYMENT_TEST_SUPABASE_KEY"),
	}
	if e.databaseURL == "" || e.supabaseURL == "" || e.supabaseKey == "" {
		t.Skip("integration environment not set")
	}
	return e
}

func TestMigrationsCreateTablesInOwnSchema(t *testing.T) {
	e := loadEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	for i := range 2 { // the second run must be a no-op
		if err := migrations.Up(ctx, e.databaseURL); err != nil {
			t.Fatalf("run %d: %v", i+1, err)
		}
	}

	db, err := sql.Open("pgx", e.databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var payments, history bool
	err = db.QueryRowContext(ctx, `select to_regclass('payment.payments') is not null,
	                                      to_regclass('payment.schema_migrations') is not null`).Scan(&payments, &history)
	if err != nil || !payments || !history {
		t.Fatalf("payments=%v schema_migrations=%v err=%v", payments, history, err)
	}
	var version int
	var dirty bool
	if err := db.QueryRowContext(ctx, `select version, dirty from payment.schema_migrations`).Scan(&version, &dirty); err != nil {
		t.Fatal(err)
	}
	if version != 1 || dirty {
		t.Fatalf("version=%d dirty=%v, want 1 and clean", version, dirty)
	}
}

func TestRoleCannotReachOtherSchemas(t *testing.T) {
	e := loadEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := sql.Open("pgx", e.databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, schema := range []string{"account", "ledger", "notification", "reporting"} {
		_, err := db.ExecContext(ctx, `select 1 from `+schema+`.any_table`)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" { // insufficient_privilege
			t.Fatalf("schema %s: want permission denied, got %v", schema, err)
		}
	}
}

// guestToken signs in anonymously against local Supabase Auth and returns the access token.
func guestToken(t *testing.T, e env) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(e.supabaseURL, "/")+"/auth/v1/signup", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("apikey", e.supabaseKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || resp.StatusCode != http.StatusOK || body.AccessToken == "" {
		t.Fatalf("anonymous sign-in: status %d, err %v", resp.StatusCode, err)
	}
	return body.AccessToken
}

func TestSupabaseGuestTokenIsAccepted(t *testing.T) {
	e := loadEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	verifier, err := auth.NewJWKSVerifier(ctx, e.supabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(httpapi.NewHandler(verifier.Middleware))
	defer server.Close()

	post := func(token string) int {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/payments", nil)
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	if status := post(""); status != http.StatusUnauthorized {
		t.Fatalf("without token: status %d, want 401", status)
	}
	if status := post(guestToken(t, e)); status != http.StatusNotImplemented {
		t.Fatalf("with guest token: status %d, want 501", status)
	}
}
