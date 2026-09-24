package handlers

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	"github.com/google/uuid"
	"github.com/lexai/backend-go/config"
	"github.com/lexai/backend-go/db"
	"github.com/lexai/backend-go/models"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	cfg *config.Config
}

func NewAuthHandler(cfg *config.Config) *AuthHandler {
	return &AuthHandler{cfg: cfg}
}

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

const minPasswordLength = 8

// normalizeEmail lowercases and trims an email so "Foo@Bar.com" and
// "foo@bar.com " are treated as the same account both at registration and
// at login — without this, a user could accidentally register a
// case-variant duplicate, or fail to log in because of how their browser
// or a password manager capitalized the address.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// Register creates a new user.
func (h *AuthHandler) Register(c *fiber.Ctx) error {
	var req models.RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Invalid request body"})
	}

	req.Email = normalizeEmail(req.Email)
	req.FullName = strings.TrimSpace(req.FullName)

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Email and password are required"})
	}
	if !emailPattern.MatchString(req.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Enter a valid email address"})
	}
	if len(req.Password) < minPasswordLength {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Password must be at least 8 characters"})
	}

	// The role a self-registering user ends up with is never taken from the
	// request body — a client could otherwise POST {"role": "admin"} and
	// grant itself elevated privileges. Every self-registration is a
	// "reviewer"; role changes are an administrative action, not something
	// exposed on this endpoint.
	const role = "reviewer"

	// Check if email already exists
	var exists bool
	err := db.Pool.QueryRow(context.Background(),
		"SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)", req.Email).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Database error"})
	}
	if exists {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Email already registered"})
	}

	// Hash password
	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Failed to hash password"})
	}

	userID := uuid.New().String()
	now := time.Now().UTC()

	_, err = db.Pool.Exec(context.Background(),
		`INSERT INTO users (id, email, hashed_password, full_name, role, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
		userID, req.Email, string(hashed), req.FullName, role, now, now)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Failed to create user"})
	}

	return c.Status(fiber.StatusCreated).JSON(models.UserResponse{
		ID:        userID,
		Email:     req.Email,
		FullName:  req.FullName,
		Role:      role,
		CreatedAt: now,
	})
}

// Login authenticates a user and returns JWT tokens.
func (h *AuthHandler) Login(c *fiber.Ctx) error {
	var req models.LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Invalid request body"})
	}
	req.Email = normalizeEmail(req.Email)

	var user models.User
	err := db.Pool.QueryRow(context.Background(),
		`SELECT id, email, hashed_password, full_name, role, is_active FROM users WHERE email = $1`,
		req.Email).Scan(&user.ID, &user.Email, &user.HashedPassword, &user.FullName, &user.Role, &user.IsActive)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "Invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.HashedPassword), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "Invalid credentials"})
	}

	if !user.IsActive {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"detail": "Account disabled"})
	}

	accessToken := h.createAccessToken(user.ID, user.Role)
	refreshToken := h.createRefreshToken(user.ID)

	return c.JSON(models.TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "bearer",
	})
}

// Refresh generates new tokens from a valid refresh token.
func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	var req models.RefreshRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Invalid request body"})
	}
	if req.RefreshToken == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "Refresh token missing"})
	}

	token, err := jwt.Parse(req.RefreshToken, func(t *jwt.Token) (interface{}, error) {
		return []byte(h.cfg.SecretKey), nil
	})
	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "Invalid refresh token"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || claims["type"] != "refresh" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "Not a refresh token"})
	}

	userID, _ := claims["sub"].(string)
	var user models.User
	err = db.Pool.QueryRow(context.Background(),
		`SELECT id, role, is_active FROM users WHERE id = $1`, userID).
		Scan(&user.ID, &user.Role, &user.IsActive)
	if err != nil || !user.IsActive {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "User not found"})
	}

	return c.JSON(models.TokenResponse{
		AccessToken:  h.createAccessToken(user.ID, user.Role),
		RefreshToken: h.createRefreshToken(user.ID),
		TokenType:    "bearer",
	})
}

// Me returns the current authenticated user's profile.
func (h *AuthHandler) Me(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)

	var user models.UserResponse
	err := db.Pool.QueryRow(context.Background(),
		`SELECT id, email, full_name, role, created_at FROM users WHERE id = $1`, userID).
		Scan(&user.ID, &user.Email, &user.FullName, &user.Role, &user.CreatedAt)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"detail": "User not found"})
	}
	return c.JSON(user)
}

func (h *AuthHandler) createAccessToken(userID, role string) string {
	claims := jwt.MapClaims{
		"sub":  userID,
		"role": role,
		"exp":  time.Now().UTC().Add(time.Duration(h.cfg.AccessTokenExpireMinutes) * time.Minute).Unix(),
		"iat":  time.Now().UTC().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(h.cfg.SecretKey))
	return tokenStr
}

func (h *AuthHandler) createRefreshToken(userID string) string {
	claims := jwt.MapClaims{
		"sub":  userID,
		"type": "refresh",
		"exp":  time.Now().UTC().Add(time.Duration(h.cfg.RefreshTokenExpireDays) * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(h.cfg.SecretKey))
	return tokenStr
}
