package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"

	"github.com/lexai/backend-go/config"
	"github.com/lexai/backend-go/db"
	"github.com/lexai/backend-go/handlers"
	"github.com/lexai/backend-go/middleware"
	"github.com/lexai/backend-go/services"
)

func main() {
	// Load .env file from project root
	godotenv.Load("../.env")
	godotenv.Load(".env")

	cfg := config.Load()
	log.Printf("[main] Starting LexAI API Gateway (env=%s, debug=%v)", cfg.Env, cfg.Debug)

	// ── Database ──────────────────────────────────────────────────────
	if err := db.Connect(cfg); err != nil {
		log.Fatalf("[main] Database connection failed: %v", err)
	}
	defer db.Close()

	// ── Redis Queue ───────────────────────────────────────────────────
	queue, err := services.NewQueue(cfg)
	if err != nil {
		log.Printf("[main] WARNING: Redis connection failed: %v (pipeline jobs won't enqueue)", err)
		queue = nil
	}
	if queue != nil {
		defer queue.Close()
	}

	// ── Storage ───────────────────────────────────────────────────────
	storage := services.NewStorage(cfg)

	// ── Fiber App ─────────────────────────────────────────────────────
	app := fiber.New(fiber.Config{
		BodyLimit:    cfg.MaxUploadMB * 1024 * 1024,
		ErrorHandler: customErrorHandler,
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{Format: "${time} ${status} ${method} ${path} ${latency}\n"}))
	app.Use(compress.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     joinOrigins(cfg.CORSOrigins),
		AllowCredentials: true,
		AllowMethods:     "GET,POST,PUT,DELETE,PATCH,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization," + middleware.SessionHeader,
	}))

	// ── Health ────────────────────────────────────────────────────────
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "env": cfg.Env})
	})

	// ── Handlers ──────────────────────────────────────────────────────
	contractHandler := handlers.NewContractHandler(cfg, storage, queue)
	reviewHandler := handlers.NewReviewHandler(cfg)

	// ── Routes ────────────────────────────────────────────────────────
	// No login — but not fully open either. Every request carries an
	// anonymous per-visitor session id (generated client-side, sent as
	// X-Session-Id), and contracts/reviews are scoped to whichever session
	// created them. There's no form, no password, nothing to remember; a
	// visitor just can't see another visitor's contracts.
	api := app.Group("/api/v1", middleware.SessionMiddleware())

	// Contracts
	contracts := api.Group("/contracts")
	contracts.Post("/upload", contractHandler.Upload)
	contracts.Get("/", contractHandler.List)
	contracts.Get("/:id", contractHandler.Get)
	contracts.Get("/:id/download/redline", contractHandler.DownloadRedline)
	contracts.Get("/:id/download/report", contractHandler.DownloadReport)

	// Reviews
	reviews := api.Group("/reviews")
	reviews.Get("/:contract_id", reviewHandler.GetReview)
	reviews.Post("/:contract_id/approve", reviewHandler.SubmitApproval)
	reviews.Get("/:contract_id/audit", reviewHandler.GetAuditTrail)

	// ── Graceful Shutdown ─────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("[main] Shutting down...")
		app.Shutdown()
	}()

	log.Printf("[main] Listening on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("[main] Server error: %v", err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.Status(code).JSON(fiber.Map{"detail": err.Error()})
}

func joinOrigins(origins []string) string {
	result := ""
	for i, o := range origins {
		if i > 0 {
			result += ","
		}
		result += o
	}
	return result
}
