package handlers

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/lexai/backend-go/config"
	"github.com/lexai/backend-go/db"
	"github.com/lexai/backend-go/models"
)

type ReviewHandler struct {
	cfg *config.Config
}

func NewReviewHandler(cfg *config.Config) *ReviewHandler {
	return &ReviewHandler{cfg: cfg}
}

// GetReview returns the review details for a contract, scoped to the
// calling session (via a join back to contracts.owner_id — reviews itself
// has no owner_id of its own).
func (h *ReviewHandler) GetReview(c *fiber.Ctx) error {
	sessionID := c.Locals("session_id").(string)
	contractID := c.Params("contract_id")

	var review models.Review
	err := db.Pool.QueryRow(context.Background(),
		`SELECT r.id, r.contract_id, r.overall_score, r.executive_summary,
		        r.clauses, r.risk_scores, r.compliance_results, r.redline_edits,
		        r.approved, r.reviewer_notes, r.decided_at, r.represented_party
		 FROM reviews r JOIN contracts c ON c.id = r.contract_id
		 WHERE r.contract_id = $1 AND c.owner_id = $2`,
		contractID, sessionID).Scan(
		&review.ID, &review.ContractID, &review.OverallScore, &review.ExecutiveSummary,
		&review.Clauses, &review.RiskScores, &review.ComplianceResults, &review.RedlineEdits,
		&review.Approved, &review.ReviewerNotes, &review.DecidedAt, &review.RepresentedParty,
	)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Review not found"})
	}

	// Parse JSONB fields
	var riskScores, compResults, redlineEdits, clauses interface{}
	json.Unmarshal(review.RiskScores, &riskScores)
	json.Unmarshal(review.ComplianceResults, &compResults)
	json.Unmarshal(review.RedlineEdits, &redlineEdits)
	json.Unmarshal(review.Clauses, &clauses)

	out := models.ReviewOut{
		ID:                review.ID,
		ContractID:        review.ContractID,
		OverallScore:      review.OverallScore,
		ExecutiveSummary:  review.ExecutiveSummary,
		RiskScores:        riskScores,
		ComplianceResults: compResults,
		RedlineEdits:      redlineEdits,
		Approved:          review.Approved,
		ReviewerNotes:     review.ReviewerNotes,
		DecidedAt:         review.DecidedAt,
		RepresentedParty:  review.RepresentedParty,
	}

	return c.JSON(out)
}

// SubmitApproval handles approve/reject decision.
func (h *ReviewHandler) SubmitApproval(c *fiber.Ctx) error {
	sessionID := c.Locals("session_id").(string)
	contractID := c.Params("contract_id")

	var req models.ApprovalRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "Invalid request body"})
	}

	// Verify contract exists, belongs to this session, and is awaiting approval
	var contractStatus, reviewID string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT c.status, r.id FROM contracts c
		 LEFT JOIN reviews r ON r.contract_id = c.id
		 WHERE c.id = $1 AND c.owner_id = $2`,
		contractID, sessionID).Scan(&contractStatus, &reviewID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Contract not found"})
	}
	if contractStatus != "awaiting_approval" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"detail": "Contract is '" + contractStatus + "', not awaiting approval",
		})
	}

	now := time.Now().UTC()
	newStatus := "approved"
	if !req.Approved {
		newStatus = "rejected"
	}

	// Update review (reviewer_id stays NULL — there's no caller identity without auth)
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE reviews SET approved = $1, reviewer_notes = $2, decided_at = $3, updated_at = $4
		 WHERE contract_id = $5`,
		req.Approved, req.Notes, now, now, contractID)
	if err != nil {
		log.Printf("[reviews] Update review error: %v", err)
	}

	// Update contract status
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE contracts SET status = $1, updated_at = $2 WHERE id = $3`,
		newStatus, now, contractID)
	if err != nil {
		log.Printf("[reviews] Update contract error: %v", err)
	}

	// Audit event
	writeAuditEvent(contractID, "approval_submitted", &sessionID, &reviewID, nil,
		map[string]interface{}{"approved": req.Approved, "notes": req.Notes})

	return c.JSON(fiber.Map{"contract_id": contractID, "status": newStatus})
}

// GetAuditTrail returns the audit log for a contract, scoped to the
// calling session.
func (h *ReviewHandler) GetAuditTrail(c *fiber.Ctx) error {
	sessionID := c.Locals("session_id").(string)
	contractID := c.Params("contract_id")

	var exists bool
	err := db.Pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM contracts WHERE id = $1 AND owner_id = $2)`,
		contractID, sessionID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Contract not found"})
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, event_type, agent_name, user_id, occurred_at, payload
		 FROM audit.audit_logs WHERE contract_id = $1 ORDER BY occurred_at ASC`,
		contractID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Database error"})
	}
	defer rows.Close()

	logs := make([]models.AuditLogOut, 0)
	for rows.Next() {
		var entry models.AuditLog
		var payloadBytes []byte
		if err := rows.Scan(&entry.ID, &entry.EventType, &entry.AgentName, &entry.UserID, &entry.OccurredAt, &payloadBytes); err != nil {
			continue
		}
		var payload map[string]interface{}
		json.Unmarshal(payloadBytes, &payload)

		// Filter out "text" key like Python does
		summary := make(map[string]interface{})
		for k, v := range payload {
			if k != "text" {
				summary[k] = v
			}
		}

		logs = append(logs, models.AuditLogOut{
			ID:             entry.ID,
			EventType:      entry.EventType,
			AgentName:      entry.AgentName,
			UserID:         entry.UserID,
			OccurredAt:     entry.OccurredAt.Format(time.RFC3339),
			PayloadSummary: summary,
		})
	}

	return c.JSON(logs)
}

// ── Audit Helper ─────────────────────────────────────────────────────────────

func writeAuditEvent(contractID, eventType string, userID, reviewID, agentName *string, payload map[string]interface{}) {
	payloadBytes, _ := json.Marshal(payload)
	id := uuid.New().String()

	_, err := db.Pool.Exec(context.Background(),
		`INSERT INTO audit.audit_logs (id, contract_id, review_id, user_id, event_type, agent_name, payload, occurred_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, contractID, reviewID, userID, eventType, agentName, payloadBytes, time.Now().UTC())
	if err != nil {
		log.Printf("[audit] Failed to write event %s: %v", eventType, err)
	}
}
