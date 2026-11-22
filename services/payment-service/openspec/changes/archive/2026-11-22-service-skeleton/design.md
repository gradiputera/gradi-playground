# Design

## Context

`services/payment-service/` holds only a README and its OpenSpec folder. The platform layer (root `supabase/`) already provides:
- the `payment` schema, owned by the `payment_service` login role, whose `search_path` is `payment`;
- no access for that role to the other service schemas;
- a local-only password for the role in `supabase/seed.sql`;
- asymmetric JWT signing keys, so Supabase publishes a JWKS endpoint.

Supabase Auth access tokens:
- carry `iss = <SUPABASE_URL>/auth/v1`, `aud = authenticated`, `sub` (the user id) and `is_anonymous`;
- guests get the same audience.

Facts about the Vercel Container runtime (beta, Hobby):
- a root `Dockerfile` selects the Container preset, or `"framework": "container"` in `vercel.json` does;
- traffic goes to port 80 unless the project sets `PORT`;
- idle containers scale down after 5 minutes and get `SIGTERM` with a 30-second grace period;
- Hobby functions get 2 GB and 1 vCPU, a 300-second maximum duration, and 4.5 MB request and response bodies.

Vercel does not document whether a Root Directory subfolder works with the Container preset. The owner checks this when creating the project.

Everything in the Appendix was prototyped on a temporary branch. The `payment-service` CI workflow passed on its first run there:
- unit tests;
- `openspec validate`;
- the oasdiff check;
- integration tests against local Supabase, including a real guest token accepted through JWKS;
- the Docker build;
- the container smoke test.

## Goals / Non-Goals

**Goals:**
- A deployable, tested Go skeleton that validates Supabase tokens and owns its schema migrations.
- A pattern the other four services can copy: layout, CI steps, container and owner setup.

**Non-Goals:**
- Payment logic, the outbox, events, sandbox reset, guest restrictions, the site fault flag and telemetry: later roadmap steps.
- Running anything against hosted Supabase or Vercel: owner actions.

## Decisions

### D1. Standard library HTTP server
Go 1.22+ `ServeMux` patterns (`GET /health`, `POST /payments`) give method matching, 404 and 405 without a router dependency. Requests log only method, route pattern, status and duration through `log/slog` in JSON. No headers, query strings, tokens or user ids are logged.

### D2. JWT validation with golang-jwt and keyfunc
- **Parser options:** `golang-jwt/jwt/v5` is set up with `WithValidMethods(ES256, RS256)`, `WithIssuer`, `WithAudience("authenticated")`, `WithExpirationRequired` and a 30-second leeway. This rejects `none` and HS256 by construction. A missing `sub` is rejected too.
- **Key source:** `keyfunc/v3` wraps a `jwkset` HTTP storage:
  - each fetch times out after 5 seconds;
  - keys refresh hourly in the background;
  - the first fetch does not block startup, so a slow JWKS endpoint cannot fail a cold start;
  - an unknown `kid` triggers at most one refetch every 5 minutes, which needs a `golang.org/x/time/rate` limiter.
- **Identity:** handlers receive only `UserID` and `IsAnonymous`, never the token.
- **Alternative considered:** `lestrrat-go/jwx`. Rejected because it is a larger API, and the golang-jwt plus keyfunc pair is the combination named in `docs/security/auth.md`.

### D3. Migrations at startup
`golang-migrate` runs from the binary with an embedded `iofs` source and the `pgx/v5` driver, using `SchemaName: payment`. This keeps `schema_migrations` in `payment`.

Startup flow:
- the service applies migrations before it listens, under a 30-second deadline;
- golang-migrate takes a Postgres advisory lock, so concurrent cold starts are safe;
- an up-to-date schema is a no-op.

Alternatives considered:
- **A separate migration job in CI or run by the owner.** Rejected: CI must never reach the hosted database, and an extra owner command per deploy is easy to forget.
- **Transaction pooling (port 6543).** Not usable, because advisory locks need a session. Hosted `DATABASE_URL` uses the Supavisor **session** pooler on port 5432 (IPv4), with the user `payment_service.<project-ref>`.

### D4. Migration 1: `payments`
The table matches the event contracts (`contracts/events/payment.*.v1.json`):
- `amount_minor bigint > 0`;
- `currency` checked against `^[A-Z]{3}$`;
- `scenario` in `success`, `declined`, `timeout`, `insufficient_funds`;
- `outcome` in `succeeded`, `failed`.

`unique (user_id, idempotency_key)` backs the idempotency rule for step 5. The recipient email is **not** stored here: it belongs only to the notification schema (ADR 0014). Later columns arrive as expand migrations.

### D5. Planned endpoints answer 501 behind authentication
`POST /payments` and `POST /sandbox/reset` exist so the middleware, the contract and the smoke test have real routes to protect. They write nothing, so repeating them is harmless. The contract adds the `501` response. That change is additive, and oasdiff reports "no breaking changes".

### D6. Container image
- **Build:** a multi-stage build on `golang:1.27.4-alpine3.24` produces a static binary (`CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`).
- **Runtime:** the image is `gcr.io/distroless/static-debian13:nonroot`. It includes CA certificates, has no shell, and runs as a non-root user.
- **Port:** a non-root user cannot bind port 80, so the image sets `PORT=8080`, and the owner sets `PORT=8080` on Vercel. The code still defaults to 80 (ADR 0003) when nothing sets `PORT`.
- **`.dockerignore`:** keeps tests, env files, specs and docs out of the build context.

### D7. Tests and CI
- **Unit tests:** no network or database. They cover the router (health, 401, 501, 404, 405) and the JWT rules, with locally generated ES256 and RSA keys.
- **Integration tests:** in `internal/integration`, skipped unless three `PAYMENT_TEST_*` variables are set.
- **CI workflow `payment-service`:** triggers on the service folder, its contract, `supabase/` platform files, and the workflow itself. It runs:
  - gofmt and `go vet`;
  - the unit tests;
  - `openspec validate --all --strict` for the service;
  - oasdiff (PRs only, against the base branch);
  - local Supabase (database, auth, gateway) and the integration tests;
  - `docker build` and a container smoke test.
- **Dependabot:** watches `gomod` and `docker` in the service folder.

### D8. Dependencies and quotas
| Module | Version | License | Why |
|---|---|---|---|
| `github.com/golang-jwt/jwt/v5` | v5.3.1 | MIT | JWT parsing and claim validation |
| `github.com/MicahParks/keyfunc/v3` | v3.9.2 | Apache-2.0 | JWKS-backed `jwt.Keyfunc` |
| `github.com/MicahParks/jwkset` | v0.12.0 | Apache-2.0 | JWKS HTTP storage with timeouts and refresh |
| `github.com/golang-migrate/migrate/v4` | v4.20.1 | MIT | Schema migrations in the service's own schema |
| `github.com/jackc/pgx/v5` | v5.13.0 | MIT | Postgres driver (`database/sql` stdlib adapter) |
| `golang.org/x/time` | v0.15.0 | BSD-3-Clause | Rate limiter for unknown-`kid` refetches |

Apache-2.0 and BSD-3-Clause are permissive and compatible with the MIT-licensed repository. The CI-only tool `oasdiff` v1.39.0 (Apache-2.0) runs through `go run` and is not a module dependency.

Free-tier usage:
- **Vercel Hobby:** one project and the default region.
- **Database:** one Supabase connection per cold start for migrations; none while serving, since nothing reads the database yet.
- **JWKS:** about one fetch per hour per warm container.
- **Grafana:** no usage yet.

## Risks / Trade-offs

- [The Container runtime is beta and Root Directory support is not documented] → The owner checks it when creating the project. ADR 0003's fallback (Render, same Dockerfile) still applies.
- [Supavisor and a custom role] → The hosted URL uses `payment_service.<project-ref>` on the session pooler. If the pooler refuses the role, the direct connection needs IPv6, which Vercel may not offer. The owner then reports it, and a follow-up change decides.
- [Migrations on every cold start add latency] → A no-op check is one advisory lock and one query, which is acceptable for a demo. Revisit if cold starts show it.
- [The service refuses to start when the database is unreachable] → Deliberate: a service whose schema is unknown should not serve. `/health` therefore also signals database reachability at startup.
- [Root files touched by a service change] → `.github/workflows/payment-service.yml` and the two `dependabot.yml` entries are the service's own CI wiring, which GitHub only reads from the root. No other root file changes.
- [Local machine without Docker] → Unit tests, vet and the build run locally. CI is authoritative for the integration tests, the image and the smoke test.

## Appendix

Copy every file exactly. Paths are relative to the repository root.

### A1. `services/payment-service/go.mod` (full file)

````text
module github.com/gradiputera/gradi-playground/services/payment-service

go 1.27.4

require (
	github.com/MicahParks/jwkset v0.12.0
	github.com/MicahParks/keyfunc/v3 v3.9.2
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/golang-migrate/migrate/v4 v4.20.1
	github.com/jackc/pgx/v5 v5.13.0
	golang.org/x/time v0.15.0
)

require (
	github.com/jackc/pgerrcode v0.0.0-20220416144525-469b46aa5efa // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.3 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/text v0.41.0 // indirect
)
````

### A2. `services/payment-service/main.go` (full file)

````go
// Command payment-service serves the payment-service HTTP API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gradiputera/gradi-playground/services/payment-service/internal/auth"
	"github.com/gradiputera/gradi-playground/services/payment-service/internal/httpapi"
	"github.com/gradiputera/gradi-playground/services/payment-service/internal/migrations"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("payment-service stopped", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := os.Getenv("DATABASE_URL")
	supabaseURL := os.Getenv("SUPABASE_URL")
	if databaseURL == "" || supabaseURL == "" {
		return errors.New("DATABASE_URL and SUPABASE_URL must be set")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "80"
	}

	migrateCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	err := migrations.Up(migrateCtx, databaseURL)
	cancel()
	if err != nil {
		return err
	}
	slog.Info("migrations applied")

	verifier, err := auth.NewJWKSVerifier(ctx, supabaseURL)
	if err != nil {
		return err
	}

	server := &http.Server{
		Addr:              net.JoinHostPort("", port),
		Handler:           httpapi.NewHandler(verifier.Middleware),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	serveErr := make(chan error, 1)
	go func() {
		slog.Info("listening", "port", port)
		serveErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}
	// Vercel sends SIGTERM and allows 30 seconds; finish in-flight requests within 20.
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return err
	}
	slog.Info("shut down")
	return nil
}
````

### A3. `services/payment-service/internal/auth/auth.go` (full file)

````go
// Package auth makes payment-service an OAuth2 resource server: it validates Supabase Auth access
// tokens itself, with signing keys from the Supabase JWKS endpoint (ADR 0007).
package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/time/rate"
)

// Audience is the `aud` claim Supabase Auth puts in every user access token, guests included.
const Audience = "authenticated"

// signingMethods are the asymmetric algorithms Supabase signing keys use. Everything else, including
// `none` and the legacy shared-secret HS256, is rejected.
var signingMethods = []string{"ES256", "RS256"}

// Identity is what handlers learn about the caller. It never holds the token itself.
type Identity struct {
	UserID      string
	IsAnonymous bool
}

type claims struct {
	IsAnonymous bool `json:"is_anonymous"`
	jwt.RegisteredClaims
}

type contextKey struct{}

// FromContext returns the caller's identity set by Middleware.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(contextKey{}).(Identity)
	return id, ok
}

// Verifier validates bearer tokens.
type Verifier struct {
	keyfunc jwt.Keyfunc
	parser  *jwt.Parser
}

// NewVerifier builds a Verifier from a key function and the expected issuer.
func NewVerifier(kf jwt.Keyfunc, issuer string) *Verifier {
	return &Verifier{
		keyfunc: kf,
		parser: jwt.NewParser(
			jwt.WithValidMethods(signingMethods),
			jwt.WithIssuer(issuer),
			jwt.WithAudience(Audience),
			jwt.WithExpirationRequired(),
			jwt.WithLeeway(30*time.Second),
		),
	}
}

// NewJWKSVerifier fetches signing keys from the Supabase project at supabaseURL. The first fetch
// happens in the background, keys are refreshed hourly, and a token with an unknown key id triggers
// at most one extra fetch every five minutes. Every fetch has a 5-second timeout.
func NewJWKSVerifier(ctx context.Context, supabaseURL string) (*Verifier, error) {
	base := strings.TrimRight(supabaseURL, "/")
	jwksURL := base + "/auth/v1/.well-known/jwks.json"
	storage, err := jwkset.NewStorageFromHTTP(jwksURL, jwkset.HTTPClientStorageOptions{
		Ctx:                       ctx,
		HTTPTimeout:               5 * time.Second,
		NoErrorReturnFirstHTTPReq: true,
		RefreshInterval:           time.Hour,
		RefreshErrorHandler: func(_ context.Context, err error) {
			slog.Warn("jwks refresh failed", "error", err.Error())
		},
	})
	if err != nil {
		return nil, fmt.Errorf("jwks storage: %w", err)
	}
	client, err := jwkset.NewHTTPClient(jwkset.HTTPClientOptions{
		HTTPURLs:          map[string]jwkset.Storage{jwksURL: storage},
		RateLimitWaitMax:  5 * time.Second,
		RefreshUnknownKID: rate.NewLimiter(rate.Every(5*time.Minute), 1),
	})
	if err != nil {
		return nil, fmt.Errorf("jwks client: %w", err)
	}
	kf, err := keyfunc.New(keyfunc.Options{Ctx: ctx, Storage: client})
	if err != nil {
		return nil, fmt.Errorf("keyfunc: %w", err)
	}
	return NewVerifier(kf.Keyfunc, base+"/auth/v1"), nil
}

// Verify checks the token's signature, algorithm, issuer, audience and expiry.
func (v *Verifier) Verify(raw string) (Identity, error) {
	var c claims
	if _, err := v.parser.ParseWithClaims(raw, &c, v.keyfunc); err != nil {
		return Identity{}, err
	}
	if c.Subject == "" {
		return Identity{}, errors.New("token has no subject")
	}
	return Identity{UserID: c.Subject, IsAnonymous: c.IsAnonymous}, nil
}

// Middleware rejects requests without a valid bearer token with 401 and stores the identity in the
// request context. Token contents are never logged.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
		if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
			unauthorized(w, "missing bearer token")
			return
		}
		id, err := v.Verify(token)
		if err != nil {
			unauthorized(w, "invalid token")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, id)))
	})
}

func unauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="payment-service"`)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	fmt.Fprintf(w, `{"error":"unauthorized","message":%q}`+"\n", message)
}
````

### A4. `services/payment-service/internal/auth/auth_test.go` (full file)

````go
package auth_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/gradiputera/gradi-playground/services/payment-service/internal/auth"
)

const issuer = "https://project.example/auth/v1"

func newKeys(t *testing.T) (*ecdsa.PrivateKey, *auth.Verifier) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	kf := func(token *jwt.Token) (any, error) { return &key.PublicKey, nil }
	return key, auth.NewVerifier(kf, issuer)
}

func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"sub":          "6f1c7d0e-0000-4000-8000-000000000001",
		"iss":          issuer,
		"aud":          auth.Audience,
		"exp":          time.Now().Add(time.Hour).Unix(),
		"is_anonymous": true,
	}
}

func sign(t *testing.T, key *ecdsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	signed, err := jwt.NewWithClaims(jwt.SigningMethodES256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestVerifyAcceptsValidGuestToken(t *testing.T) {
	key, v := newKeys(t)
	id, err := v.Verify(sign(t, key, validClaims()))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if id.UserID != "6f1c7d0e-0000-4000-8000-000000000001" || !id.IsAnonymous {
		t.Fatalf("unexpected identity %+v", id)
	}
}

func TestVerifyRejectsInvalidTokens(t *testing.T) {
	key, v := newKeys(t)
	otherKey, _ := newKeys(t)

	with := func(name string, value any) jwt.MapClaims {
		c := validClaims()
		if value == nil {
			delete(c, name)
		} else {
			c[name] = value
		}
		return c
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims()).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	hs256, err := jwt.NewWithClaims(jwt.SigningMethodHS256, validClaims()).SignedString([]byte("shared-secret"))
	if err != nil {
		t.Fatal(err)
	}
	wrongKeyRS, err := jwt.NewWithClaims(jwt.SigningMethodRS256, validClaims()).SignedString(rsaKey)
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]string{
		"expired":           sign(t, key, with("exp", time.Now().Add(-time.Hour).Unix())),
		"no expiry":         sign(t, key, with("exp", nil)),
		"wrong issuer":      sign(t, key, with("iss", "https://attacker.example/auth/v1")),
		"wrong audience":    sign(t, key, with("aud", "anon")),
		"no subject":        sign(t, key, with("sub", nil)),
		"other signing key": sign(t, otherKey, validClaims()),
		"alg none":          unsigned,
		"alg HS256":         hs256,
		"RS256 wrong key":   wrongKeyRS,
		"garbage":           "not-a-jwt",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(token); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestMiddleware(t *testing.T) {
	key, v := newKeys(t)
	var seen auth.Identity
	handler := v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen, _ = auth.FromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))

	cases := []struct {
		name   string
		header string
		status int
	}{
		{"no header", "", http.StatusUnauthorized},
		{"not bearer", "Basic dXNlcjpwYXNz", http.StatusUnauthorized},
		{"empty bearer", "Bearer ", http.StatusUnauthorized},
		{"invalid token", "Bearer not-a-jwt", http.StatusUnauthorized},
		{"valid token", "Bearer " + sign(t, key, validClaims()), http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/payments", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status %d, want %d", rec.Code, tc.status)
			}
			if tc.status == http.StatusUnauthorized && rec.Header().Get("WWW-Authenticate") == "" {
				t.Fatal("missing WWW-Authenticate header")
			}
		})
	}
	if !seen.IsAnonymous || seen.UserID == "" {
		t.Fatalf("identity not passed to the handler: %+v", seen)
	}
}
````

### A5. `services/payment-service/internal/httpapi/server.go` (full file)

````go
// Package httpapi wires the payment-service HTTP routes.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// NewHandler returns the service's HTTP handler. authenticate wraps every route that needs a
// bearer token.
func NewHandler(authenticate func(http.Handler) http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	// Planned endpoints: authenticated now, implemented by later changes (roadmap step 5).
	mux.Handle("POST /payments", authenticate(http.HandlerFunc(notImplemented)))
	mux.Handle("POST /sandbox/reset", authenticate(http.HandlerFunc(notImplemented)))
	return logRequests(mux)
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"error":   "not_implemented",
		"message": "This endpoint is planned and not implemented yet.",
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// logRequests logs method, route pattern, status and duration only: no headers, tokens, query
// strings or user ids.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		slog.Info("request",
			"method", r.Method,
			"route", route,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}
````

### A6. `services/payment-service/internal/httpapi/server_test.go` (full file)

````go
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gradiputera/gradi-playground/services/payment-service/internal/httpapi"
)

// allow and deny stand in for the JWT middleware, which has its own tests.
func allow(next http.Handler) http.Handler { return next }

func deny(http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
}

func do(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestHealthNeedsNoToken(t *testing.T) {
	rec := do(t, httpapi.NewHandler(deny), http.MethodGet, "/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content type %q", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body["status"] != "ok" || len(body) != 1 {
		t.Fatalf("body %v, err %v", body, err)
	}
}

func TestPlannedEndpointsRequireToken(t *testing.T) {
	for _, path := range []string{"/payments", "/sandbox/reset"} {
		if rec := do(t, httpapi.NewHandler(deny), http.MethodPost, path); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without token: status %d, want 401", path, rec.Code)
		}
		rec := do(t, httpapi.NewHandler(allow), http.MethodPost, path)
		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("%s with token: status %d, want 501", path, rec.Code)
		}
		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body["error"] != "not_implemented" {
			t.Fatalf("%s body %v, err %v", path, body, err)
		}
	}
}

func TestUnknownRoutesAndMethods(t *testing.T) {
	h := httpapi.NewHandler(allow)
	if rec := do(t, h, http.MethodGet, "/nope"); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown path: status %d, want 404", rec.Code)
	}
	if rec := do(t, h, http.MethodGet, "/payments"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /payments: status %d, want 405", rec.Code)
	}
}
````

### A7. `services/payment-service/internal/migrations/migrations.go` (full file)

````go
// Package migrations applies payment-service's own schema migrations (golang-migrate). The history
// table lives in the payment schema, which is the payment_service role's search_path.
package migrations

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
)

//go:embed sql/*.sql
var files embed.FS

// Up applies all pending migrations. It is safe to run on every start: golang-migrate takes a
// Postgres advisory lock, and an up-to-date schema is a no-op.
func Up(ctx context.Context, databaseURL string) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}

	driver, err := pgxmigrate.WithInstance(db, &pgxmigrate.Config{SchemaName: "payment"})
	if err != nil {
		return fmt.Errorf("migration driver: %w", err)
	}
	source, err := iofs.New(files, "sql")
	if err != nil {
		return fmt.Errorf("migration source: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", source, "payment", driver)
	if err != nil {
		return fmt.Errorf("migrator: %w", err)
	}
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
````

### A8. `services/payment-service/internal/migrations/sql/000001_create_payments.up.sql` (full file)

````sql
-- Payments simulated by payment-service. Amounts are integer minor units with an ISO 4217 code.
-- Every write carries an idempotency key, unique per user.
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  scenario text not null check (scenario in ('success', 'declined', 'timeout', 'insufficient_funds')),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index payments_user_id_created_at_idx on payments (user_id, created_at desc);
````

### A9. `services/payment-service/internal/migrations/sql/000001_create_payments.down.sql` (full file)

````sql
drop table if exists payments;
````

### A10. `services/payment-service/internal/integration/integration_test.go` (full file)

````go
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
````

### A11. `services/payment-service/Dockerfile` (full file)

````dockerfile
# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).

FROM golang:1.27.4-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/payment-service .

# Static, shell-less runtime image with CA certificates, running as a non-root user.
FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/payment-service /payment-service
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/payment-service"]
````

### A12. `services/payment-service/.dockerignore` (full file)

````text
.env
.env.*
**/*_test.go
openspec/
README.md
Dockerfile
.dockerignore
vercel.json
````

### A13. `services/payment-service/vercel.json` (full file)

````json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "container"
}
````

### A14. `services/payment-service/.env.example` (full file)

````text
# Local development only. Copy to .env (gitignored). Hosted values live only in Vercel.
PORT=8083
# Local-only role password from supabase/seed.sql; never a real credential.
DATABASE_URL=postgres://payment_service:local-dev-only-payment@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
````

### A15. `services/payment-service/README.md` (full file)

````md
# payment-service

Simulated payments, orchestration of ledger posting and payment event emission. Built with Go and packaged as a container.

## Status

In progress: the service skeleton is in place. This covers health, JWT validation, own-schema migrations, the container image and CI. The payment endpoints answer `501` until roadmap step 5.

## Responsibilities

- Owns the `payment` schema. Migrations use golang-migrate, with the history table (`schema_migrations`) inside the `payment` schema, applied on every start.
- Simulates payment scenarios: success, declined, timeout, insufficient funds.
- Orchestrates posting to the ledger and writes payment events to the outbox.
- Idempotency key on every write; context timeouts on all outbound calls; never retries non-idempotent calls.

## API

The contract is [contracts/openapi/payment.yaml](../../contracts/openapi/payment.yaml).

| Endpoint | Token | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /payments` | required | `501` (planned: simulates a payment; requires an idempotency key) |
| `POST /sandbox/reset` | required | `501` (planned: deletes the caller's rows in `payment` and re-applies the seed) |

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`.

Tokens are Supabase Auth access tokens, validated by the service itself (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

## Events

- Publishes: `payment.succeeded.v1`, `payment.failed.v1` (through the outbox, in the same transaction as the payment change). Planned.
- Consumes: none.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | Postgres URL for the `payment_service` role. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds per request; hourly refresh, plus at most one extra fetch every 5 minutes for an unknown key id.
- **Database connection and migrations at startup:** 30 seconds.

## Local development

You need Go 1.27, plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `payment_service` password.
2. Run the service from this folder:
   ```bash
   set -a; . ./.env; set +a
   go run .
   ```
3. Check it: `curl http://127.0.0.1:8083/health`.

Tests:
- `go test ./...` runs the unit tests and skips the integration tests.
- To run the integration tests too, with the local stack running:
  ```bash
  eval "$(npx -y supabase@3.2.0 status -o env)"
  PAYMENT_TEST_DATABASE_URL="postgres://payment_service:local-dev-only-payment@127.0.0.1:54322/postgres" \
  PAYMENT_TEST_SUPABASE_URL="$API_URL" PAYMENT_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
    go test -count=1 ./...
  ```

Container: `docker build -t payment-service .`, then run it with the three variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role payment_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/payment-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://payment_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`. Copy `<pooler-host>` from the Supabase dashboard, under Connect > Session pooler.

   Use session mode, not transaction mode (port 6543): migrations need a session-level advisory lock.
3. **Check.** After the deploy:
   - `https://<payment-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /payments` without a token returns `401`.

## Related

- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0012: Simulated DC/DRC failover](../../architecture/adr/0012-simulated-dc-drc-failover.md)
````

### A16. `.github/workflows/payment-service.yml` (full file)

````yaml
name: payment-service

on:
  push:
    branches: [main]
    paths:
      - "services/payment-service/**"
      - "contracts/openapi/payment.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/payment-service.yml"
  pull_request:
    paths:
      - "services/payment-service/**"
      - "contracts/openapi/payment.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/payment-service.yml"

permissions:
  contents: read

jobs:
  payment-service:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: services/payment-service
    env:
      # Dummy values so env() references in supabase/config.toml resolve. Not real credentials.
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: ci-dummy-client-id
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: ci-dummy-secret
      SUPABASE_AUTH_CAPTCHA_SECRET: ci-dummy-captcha
      # Local-only role password from supabase/seed.sql. Not a real credential.
      LOCAL_DATABASE_URL: postgres://payment_service:local-dev-only-payment@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: actions/setup-go@v7
        with:
          go-version-file: services/payment-service/go.mod
          cache-dependency-path: services/payment-service/go.sum

      - name: Check formatting
        run: test -z "$(gofmt -l .)" || { gofmt -l .; exit 1; }

      - run: go vet ./...

      - name: Unit tests
        run: go test ./...

      - name: Validate service specs
        run: npx -y @fission-ai/openspec@latest validate --all --strict

      - name: Check the API contract for breaking changes
        if: github.event_name == 'pull_request'
        working-directory: .
        run: |
          git show "origin/${{ github.base_ref }}:contracts/openapi/payment.yaml" > "$RUNNER_TEMP/payment-base.yaml"
          go run github.com/oasdiff/oasdiff@v1.39.0 breaking --fail-on ERR "$RUNNER_TEMP/payment-base.yaml" contracts/openapi/payment.yaml

      - uses: supabase/setup-cli@v3
        with:
          version: 3.2.0

      - name: Generate an ephemeral JWT signing key
        working-directory: .
        run: |
          echo '[]' > supabase/signing_keys.json
          supabase gen signing-key --algorithm ES256 --append

      # Database, auth and gateway only.
      - name: Start the local Supabase stack
        working-directory: .
        run: supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor

      - name: Integration tests against the local stack
        run: |
          eval "$(supabase status -o env)"
          PAYMENT_TEST_DATABASE_URL="$LOCAL_DATABASE_URL" \
          PAYMENT_TEST_SUPABASE_URL="$API_URL" \
          PAYMENT_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
            go test -count=1 -v ./internal/integration/

      - name: Build the container image
        run: docker build -t payment-service:ci .

      - name: Smoke test the container
        run: |
          eval "$(supabase status -o env)"
          docker run -d --name payment-service --network host \
            -e PORT=8083 -e DATABASE_URL="$LOCAL_DATABASE_URL" -e SUPABASE_URL="$API_URL" \
            payment-service:ci
          for i in $(seq 1 30); do
            curl -fsS http://127.0.0.1:8083/health && break
            sleep 1
          done
          test "$(curl -s http://127.0.0.1:8083/health)" = '{"status":"ok"}'
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8083/payments)" = 401
          docker logs payment-service

      - name: Stop the local Supabase stack
        if: always()
        working-directory: .
        run: supabase stop --no-backup
````

### A17. `contracts/openapi/payment.yaml` (full file; adds the two `501` responses)

````yaml
openapi: 3.1.0
x-status: planned
info:
  title: payment-service API
  version: 0.1.0
servers: []
security:
  - bearerAuth: []
paths:
  /health:
    get:
      summary: Health check
      security: []
      responses:
        "200":
          description: Service is healthy.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    const: ok
  /payments:
    post:
      summary: Simulate a payment (requires an idempotency key)
      responses:
        "201":
          description: Payment simulated; outcome returned.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
  /sandbox/reset:
    post:
      summary: Reset the caller's payments to seed
      responses:
        "200":
          description: Caller's rows were deleted and the seed was re-applied.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
````

### A18. `.github/dependabot.yml` (append)

Append these lines at the end of the file, after the last line of the existing `npm` entry (its `ignore` list). Keep the two-space indentation: each `- package-ecosystem` line starts with two spaces, at the same level as the existing entries. Change nothing else.

````yaml
  - package-ecosystem: gomod
    directory: /services/payment-service
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /services/payment-service
    schedule:
      interval: weekly
````
