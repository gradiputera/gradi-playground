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
