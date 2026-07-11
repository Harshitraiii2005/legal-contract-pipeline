package models

import "time"

// User matches the existing `users` table.
type User struct {
	ID             string    `json:"id"`
	Email          string    `json:"email"`
	HashedPassword string    `json:"-"`
	FullName       string    `json:"full_name"`
	Role           string    `json:"role"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Contract matches the existing `contracts` table.
type Contract struct {
	ID               string    `json:"id"`
	OwnerID          string    `json:"owner_id"`
	Name             string    `json:"name"`
	OriginalFilename string    `json:"original_filename"`
	FileType         string    `json:"file_type"`
	StorageKey       string    `json:"storage_key"`
	RawText          string    `json:"raw_text,omitempty"`
	ClauseCount      int       `json:"clause_count"`
	OverallRiskScore int       `json:"overall_risk_score"`
	Status           string    `json:"status"`
	ThreadID         string    `json:"thread_id"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// ContractOut is the API response for a contract (matches Python ContractOut).
type ContractOut struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Status           string `json:"status"`
	OverallRiskScore int    `json:"overall_risk_score"`
	ClauseCount      int    `json:"clause_count"`
	ThreadID         string `json:"thread_id"`
}

// Review matches the existing `reviews` table.
type Review struct {
	ID                string     `json:"id"`
	ContractID        string     `json:"contract_id"`
	ReviewerID        *string    `json:"reviewer_id"`
	Clauses           []byte     `json:"clauses"`
	RiskScores        []byte     `json:"risk_scores"`
	ComplianceResults []byte     `json:"compliance_results"`
	RedlineEdits      []byte     `json:"redline_edits"`
	ExecutiveSummary  string     `json:"executive_summary"`
	OverallScore      int        `json:"overall_score"`
	RepresentedParty  string     `json:"represented_party"`
	Approved          *bool      `json:"approved"`
	ReviewerNotes     string     `json:"reviewer_notes"`
	DecidedAt         *time.Time `json:"decided_at"`
	RedlinedDocxKey   string     `json:"redlined_docx_key"`
	RiskPdfKey        string     `json:"risk_pdf_key"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// ReviewOut is the API response for a review (matches Python ReviewOut).
type ReviewOut struct {
	ID                string      `json:"id"`
	ContractID        string      `json:"contract_id"`
	OverallScore      int         `json:"overall_score"`
	ExecutiveSummary  string      `json:"executive_summary"`
	RiskScores        interface{} `json:"risk_scores"`
	ComplianceResults interface{} `json:"compliance_results"`
	RedlineEdits      interface{} `json:"redline_edits"`
	Approved          *bool       `json:"approved"`
	ReviewerNotes     string      `json:"reviewer_notes"`
	DecidedAt         *time.Time  `json:"decided_at"`
	RepresentedParty  string      `json:"represented_party"`
}

// AuditLog matches the existing `audit.audit_logs` table.
type AuditLog struct {
	ID           string                 `json:"id"`
	ContractID   string                 `json:"contract_id"`
	ReviewID     *string                `json:"review_id"`
	UserID       *string                `json:"user_id"`
	EventType    string                 `json:"event_type"`
	AgentName    *string                `json:"agent_name"`
	ModelVersion *string                `json:"model_version"`
	Payload      map[string]interface{} `json:"payload"`
	OccurredAt   time.Time              `json:"occurred_at"`
}

// AuditLogOut is the API response for audit trail items.
type AuditLogOut struct {
	ID             string                 `json:"id"`
	EventType      string                 `json:"event_type"`
	AgentName      *string                `json:"agent_name"`
	UserID         *string                `json:"user_id"`
	OccurredAt     string                 `json:"occurred_at"`
	PayloadSummary map[string]interface{} `json:"payload_summary"`
}

// ── Request/Response Schemas ────────────────────────────────────────────────

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

type UserResponse struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	FullName  string    `json:"full_name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type ApprovalRequest struct {
	Approved bool   `json:"approved"`
	Notes    string `json:"notes"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}
