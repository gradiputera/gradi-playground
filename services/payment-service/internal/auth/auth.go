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
