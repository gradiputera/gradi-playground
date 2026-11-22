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
