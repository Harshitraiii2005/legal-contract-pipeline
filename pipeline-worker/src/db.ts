import { Pool } from 'pg';
import { config } from './config';
import crypto from 'crypto';

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

export async function updateContractStatus(
  contractId: string,
  status: string,
  clauseCount: number,
  overallRiskScore: number,
  threadId: string
) {
  const query = `
    UPDATE contracts
    SET status = $1, clause_count = $2, overall_risk_score = $3, thread_id = $4, updated_at = NOW()
    WHERE id = $5
  `;
  await pool.query(query, [status, clauseCount, overallRiskScore, threadId, contractId]);
}

export async function insertReview(review: {
  contractId: string;
  clauses: any[];
  riskScores: any[];
  complianceResults: any[];
  redlineEdits: any[];
  executiveSummary: string;
  overallScore: number;
  representedParty: string;
  redlinedDocxKey: string;
  riskPdfKey: string;
}) {
  const id = crypto.randomUUID();
  const query = `
    INSERT INTO reviews (
      id, contract_id, clauses, risk_scores, compliance_results, redline_edits,
      executive_summary, overall_score, represented_party, redlined_docx_key, risk_pdf_key,
      created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    ON CONFLICT (contract_id) DO UPDATE
    SET clauses = $3, risk_scores = $4, compliance_results = $5, redline_edits = $6,
        executive_summary = $7, overall_score = $8, represented_party = $9,
        redlined_docx_key = $10, risk_pdf_key = $11, updated_at = NOW()
    RETURNING id
  `;
  const res = await pool.query(query, [
    id,
    review.contractId,
    JSON.stringify(review.clauses),
    JSON.stringify(review.riskScores),
    JSON.stringify(review.complianceResults),
    JSON.stringify(review.redlineEdits),
    review.executiveSummary,
    review.overallScore,
    review.representedParty,
    review.redlinedDocxKey,
    review.riskPdfKey,
  ]);
  return res.rows[0].id;
}

export async function writeAuditEvent(
  contractId: string,
  eventType: string,
  userId: string | null,
  reviewId: string | null,
  agentName: string | null,
  payload: any
) {
  const id = crypto.randomUUID();
  const query = `
    INSERT INTO audit.audit_logs (
      id, contract_id, event_type, user_id, review_id, agent_name, payload, occurred_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `;
  await pool.query(query, [
    id,
    contractId,
    eventType,
    userId,
    reviewId,
    agentName,
    JSON.stringify(payload),
  ]);
}
