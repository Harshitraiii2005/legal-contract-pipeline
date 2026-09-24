package db

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v4"
	"github.com/jackc/pgx/v4/pgxpool"
	"github.com/lexai/backend-go/config"
)

var Pool *pgxpool.Pool

// Connect initializes the PostgreSQL connection pool.
func Connect(cfg *config.Config) error {
	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("unable to parse database URL: %w", err)
	}
	poolConfig.MaxConns = int32(cfg.DBPoolSize)

	// This app's tables (users, contracts, reviews) live in the "lexai"
	// schema, not "public" — DATABASE_URL may point at a Postgres instance
	// shared with an unrelated app (e.g. a free-tier database also used by
	// another project), which can already have its own "public.users" etc.
	// Setting search_path here means every unqualified table reference in
	// this codebase (SELECT/INSERT/UPDATE against "users", "contracts",
	// "reviews") transparently resolves inside "lexai" without a single SQL
	// string elsewhere needing to be schema-qualified. audit.audit_logs
	// stays explicitly schema-qualified in code (see handlers/reviews.go)
	// and is unaffected by this.
	poolConfig.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET search_path TO lexai, public")
		return err
	}

	pool, err := pgxpool.ConnectConfig(context.Background(), poolConfig)
	if err != nil {
		return fmt.Errorf("unable to connect to database: %w", err)
	}

	// Verify connection
	if err := pool.Ping(context.Background()); err != nil {
		return fmt.Errorf("unable to ping database: %w", err)
	}

	Pool = pool
	log.Println("[db] Connected to PostgreSQL")
	return nil
}

// Close shuts down the connection pool.
func Close() {
	if Pool != nil {
		Pool.Close()
		log.Println("[db] PostgreSQL pool closed")
	}
}
