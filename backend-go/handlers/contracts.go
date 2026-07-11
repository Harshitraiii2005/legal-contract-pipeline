package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"io"
	"io/ioutil"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/lexai/backend-go/config"
	"github.com/lexai/backend-go/db"
	"github.com/lexai/backend-go/models"
	"github.com/lexai/backend-go/services"
)

type ContractHandler struct {
	cfg     *config.Config
	storage *services.Storage
	queue   *services.Queue
}

func NewContractHandler(cfg *config.Config, storage *services.Storage, queue *services.Queue) *ContractHandler {
	return &ContractHandler{cfg: cfg, storage: storage, queue: queue}
}

// Upload handles contract file upload, text extraction, and pipeline enqueue.
func (h *ContractHandler) Upload(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"detail": "No file provided"})
	}

	maxBytes := int64(h.cfg.MaxUploadMB) * 1024 * 1024
	if file.Size > maxBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"detail": "File exceeds size limit"})
	}

	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Failed to read file"})
	}
	defer f.Close()

	content, err := ioutil.ReadAll(f)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Failed to read file"})
	}

	contractID := uuid.New().String()
	filename := file.Filename

	rawText, err := parseDocument(content, filename)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"detail": "Could not parse document: " + err.Error()})
	}

	storageKey := "contracts/" + userID + "/" + contractID + "/" + filename
	if err := h.storage.Put(content, storageKey); err != nil {
		log.Printf("[contracts] Storage error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Could not save uploaded file"})
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if len(ext) > 0 {
		ext = ext[1:]
	}

	now := time.Now().UTC()
	_, err = db.Pool.Exec(context.Background(),
		`INSERT INTO contracts (id, owner_id, name, original_filename, file_type, storage_key, raw_text, clause_count, overall_risk_score, status, thread_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 'pending', '', $8, $9)`,
		contractID, userID, filename, filename, ext, storageKey, rawText, now, now)
	if err != nil {
		log.Printf("[contracts] DB insert error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Failed to create contract"})
	}

	writeAuditEvent(contractID, "contract_uploaded", &userID, nil, nil,
		map[string]interface{}{"filename": filename, "size_bytes": len(content)})

	job := services.PipelineJob{
		ContractID:   contractID,
		ContractText: rawText,
		ContractName: filename,
		UserID:       userID,
	}
	if err := h.queue.Enqueue(context.Background(), job); err != nil {
		log.Printf("[contracts] Queue error: %v", err)
	}

	return c.Status(fiber.StatusCreated).JSON(models.ContractOut{
		ID: contractID, Name: filename, Status: "pending",
		OverallRiskScore: 0, ClauseCount: 0, ThreadID: "",
	})
}

// List returns all contracts for the authenticated user.
func (h *ContractHandler) List(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	skip := c.QueryInt("skip", 0)
	limit := c.QueryInt("limit", 20)
	if limit > 100 {
		limit = 100
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, name, status, overall_risk_score, clause_count, thread_id
		 FROM contracts WHERE owner_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3`,
		userID, skip, limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"detail": "Database error"})
	}
	defer rows.Close()

	contracts := make([]models.ContractOut, 0)
	for rows.Next() {
		var co models.ContractOut
		if err := rows.Scan(&co.ID, &co.Name, &co.Status, &co.OverallRiskScore, &co.ClauseCount, &co.ThreadID); err != nil {
			continue
		}
		contracts = append(contracts, co)
	}
	return c.JSON(contracts)
}

// Get returns a single contract.
func (h *ContractHandler) Get(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	contractID := c.Params("id")

	var co models.ContractOut
	err := db.Pool.QueryRow(context.Background(),
		`SELECT id, name, status, overall_risk_score, clause_count, thread_id
		 FROM contracts WHERE id = $1 AND owner_id = $2`,
		contractID, userID).Scan(&co.ID, &co.Name, &co.Status, &co.OverallRiskScore, &co.ClauseCount, &co.ThreadID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Contract not found"})
	}
	return c.JSON(co)
}

// DownloadRedline streams the redlined DOCX file.
func (h *ContractHandler) DownloadRedline(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	contractID := c.Params("id")

	var docxKey, contractName string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT r.redlined_docx_key, c.name FROM reviews r
		 JOIN contracts c ON c.id = r.contract_id
		 WHERE r.contract_id = $1 AND c.owner_id = $2`,
		contractID, userID).Scan(&docxKey, &contractName)
	if err != nil || docxKey == "" {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Redlined DOCX not yet generated"})
	}

	reader, err := h.storage.Get(docxKey)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Redlined DOCX file is missing from storage"})
	}
	defer reader.Close()
	data, _ := ioutil.ReadAll(reader)

	c.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	c.Set("Content-Disposition", `attachment; filename="redlined_`+contractName+`.docx"`)
	return c.Send(data)
}

// DownloadReport streams the risk report PDF.
func (h *ContractHandler) DownloadReport(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	contractID := c.Params("id")

	var pdfKey, contractName string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT r.risk_pdf_key, c.name FROM reviews r
		 JOIN contracts c ON c.id = r.contract_id
		 WHERE r.contract_id = $1 AND c.owner_id = $2`,
		contractID, userID).Scan(&pdfKey, &contractName)
	if err != nil || pdfKey == "" {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Risk report PDF not yet generated"})
	}

	reader, err := h.storage.Get(pdfKey)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"detail": "Risk report PDF file is missing from storage"})
	}
	defer reader.Close()
	data, _ := ioutil.ReadAll(reader)

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", `attachment; filename="risk_report_`+contractName+`.pdf"`)
	return c.Send(data)
}

// ── Document Parsing ─────────────────────────────────────────────────────────

func parseDocument(content []byte, filename string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt":
		return string(content), nil
	case ".docx":
		return extractDocxText(content)
	default:
		return string(content), nil
	}
}

func extractDocxText(data []byte) (string, error) {
	reader := bytes.NewReader(data)
	zipReader, err := zip.NewReader(reader, int64(len(data)))
	if err != nil {
		return "", err
	}

	var text strings.Builder
	for _, f := range zipReader.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		decoder := xml.NewDecoder(rc)
		var inText bool
		for {
			tok, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			switch t := tok.(type) {
			case xml.StartElement:
				if t.Name.Local == "t" {
					inText = true
				}
			case xml.EndElement:
				if t.Name.Local == "t" {
					inText = false
				}
				if t.Name.Local == "p" {
					text.WriteString("\n")
				}
			case xml.CharData:
				if inText {
					text.Write(t)
				}
			}
		}
		rc.Close()
		break
	}
	return strings.TrimSpace(text.String()), nil
}
