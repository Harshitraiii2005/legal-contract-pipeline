package db

import (
	"context"
	"fmt"
	"log"

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
