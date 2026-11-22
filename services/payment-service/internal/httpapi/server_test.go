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
