package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/go-redis/redis/v8"
	"github.com/lexai/backend-go/config"
)

// Queue provides Redis-based job enqueueing for the Node.js pipeline worker.
type Queue struct {
	client    *redis.Client
	queueName string
}

// PipelineJob is the job payload sent to the Node.js worker via Redis.
type PipelineJob struct {
	ContractID   string `json:"contract_id"`
	ContractText string `json:"contract_text"`
	ContractName string `json:"contract_name"`
	UserID       string `json:"user_id"`
}

// NewQueue creates a new Redis queue client.
func NewQueue(cfg *config.Config) (*Queue, error) {
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Redis URL: %w", err)
	}
	client := redis.NewClient(opt)

	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	log.Println("[queue] Connected to Redis")
	return &Queue{client: client, queueName: "pipeline:jobs"}, nil
}

// Enqueue adds a pipeline job to the Redis queue.
// Uses BullMQ-compatible format so the Node.js worker can consume it.
func (q *Queue) Enqueue(ctx context.Context, job PipelineJob) error {
	data, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("failed to marshal job: %w", err)
	}

	// Use RPUSH to add to the BullMQ-compatible queue
	// BullMQ uses a specific key format; we use a simple list
	// The Node.js worker will BLPOP from this key
	if err := q.client.RPush(ctx, q.queueName, data).Err(); err != nil {
		return fmt.Errorf("failed to enqueue job: %w", err)
	}

	log.Printf("[queue] Enqueued pipeline job for contract %s", job.ContractID)
	return nil
}

// Close closes the Redis connection.
func (q *Queue) Close() error {
	return q.client.Close()
}
