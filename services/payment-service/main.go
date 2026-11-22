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
