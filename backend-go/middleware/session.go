package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// SessionHeader is the header the frontend sends a per-visitor session id
// on, generated client-side and persisted in localStorage. There is no
// login — this is the entire mechanism by which one visitor's contracts
// stay private from another's.
const SessionHeader = "X-Session-Id"

// SessionMiddleware reads the session id from SessionHeader and stores it
// in context locals under "session_id". A request without the header
// (e.g. a direct curl/API call, not the app itself, which always sends
// one) gets a fresh generated id instead of being rejected — it just
// means that single request can't see any contract created under a real
// session, since nothing was ever inserted under an id nobody sent before.
func SessionMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		sessionID := c.Get(SessionHeader)
		if sessionID == "" {
			sessionID = uuid.New().String()
		}
		c.Locals("session_id", sessionID)
		return c.Next()
	}
}
