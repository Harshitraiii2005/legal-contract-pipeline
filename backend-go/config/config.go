package config

import (
	"os"
	"strconv"
	"strings"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	// App
	Env       string
	Debug     bool
	SecretKey string

	// Database
	DatabaseURL   string
	DBPoolSize    int
	DBMaxOverflow int

	// Redis
	RedisURL string

	// OpenAI LLM
	OpenAIAPIKey string
	OpenAIModel  string

	// Pinecone
	PineconeAPIKey string
	PineconeEnv    string
	PineconeIndex  string

	// MLflow
	MLflowTrackingURI string

	// Auth
	JWTAlgorithm            string
	AccessTokenExpireMinutes int
	RefreshTokenExpireDays   int

	// Storage
	StorageRoot string

	// Email
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	FromEmail    string

	// Misc
	CORSOrigins []string
	MaxUploadMB int
	Port        string
}

// Load reads configuration from environment variables.
func Load() *Config {
	return &Config{
		Env:       getEnv("ENV", "development"),
		Debug:     getEnvBool("DEBUG", false),
		SecretKey: getEnv("SECRET_KEY", ""),

		DatabaseURL:   getEnv("DATABASE_URL", "postgresql://legal:legal@localhost:5432/legaldb"),
		DBPoolSize:    getEnvInt("DB_POOL_SIZE", 10),
		DBMaxOverflow: getEnvInt("DB_MAX_OVERFLOW", 20),

		RedisURL: getEnv("REDIS_URL", "redis://localhost:6379/0"),

		OpenAIAPIKey: getEnv("OPENAI_API_KEY", ""),
		OpenAIModel:  getEnv("OPENAI_MODEL", "gpt-4o"),

		PineconeAPIKey: getEnv("PINECONE_API_KEY", ""),
		PineconeEnv:    getEnv("PINECONE_ENV", "us-east-1-aws"),
		PineconeIndex:  getEnv("PINECONE_INDEX", "contract-clauses"),

		MLflowTrackingURI: getEnv("MLFLOW_TRACKING_URI", "http://localhost:5000"),

		JWTAlgorithm:            "HS256",
		AccessTokenExpireMinutes: getEnvInt("ACCESS_TOKEN_EXPIRE_MINUTES", 480),
		RefreshTokenExpireDays:   getEnvInt("REFRESH_TOKEN_EXPIRE_DAYS", 30),

		StorageRoot: getEnv("STORAGE_ROOT", "/data/legal-pipeline"),

		SMTPHost:     getEnv("SMTP_HOST", "smtp.sendgrid.net"),
		SMTPPort:     getEnvInt("SMTP_PORT", 587),
		SMTPUser:     getEnv("SMTP_USER", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		FromEmail:    getEnv("FROM_EMAIL", "noreply@legalai.example.com"),

		CORSOrigins: getEnvList("CORS_ORIGINS", []string{"http://localhost:5173", "http://localhost:3000"}),
		MaxUploadMB: getEnvInt("MAX_UPLOAD_MB", 50),
		Port:        getEnv("PORT", "8000"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		return strings.ToLower(v) == "true" || v == "1"
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvList(key string, fallback []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	// Handle JSON array format: ["a","b"]
	v = strings.Trim(v, "[]")
	v = strings.ReplaceAll(v, "\"", "")
	parts := strings.Split(v, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}
