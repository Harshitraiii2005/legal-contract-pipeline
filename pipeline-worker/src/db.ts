import { Pool } from 'pg';
import { config } from './config';
import crypto from 'crypto';

// This app's tables live in the "lexai" schema, not "public" — see
// backend-go/schema.sql for why (DATABASE_URL may point at a Postgres
// instance shared with an unrelated app). "contracts"/"reviews" below
// resolve into "lexai" without being schema-qualified; audit.audit_logs
// stays explicitly schema-qualified (see writeAuditEvent below) and is
// unaffected by this.
//
// NOTE: production is currently failing every query with "Connection
// terminated unexpectedly", including with a plain `SET search_path`
// query on 'connect' below (not just the startup-option variant this
// replaced) — so search_path itself is NOT the cause; something about the
// connection itself is failing before any query can run. Ruled out so
// far: this exact config works fine against the database's External URL
// from outside Render. Still unverified: whether DATABASE_URL on the
// deployed service is actually correct, and whether `ssl:
// { rejectUnauthorized: false }` (present before any of today's changes)
// is compatible with Render's Internal Postgres URL specifically — only
// External has been tested. See index.ts's startup connection test log
// for whatever the real error turns out to be.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  // Without this handler, an error on an *idle* pooled client (e.g. the
  // server dropping a connection between queries) throws unhandled and
  // crashes the whole process, rather than just failing whatever query
  // was in flight at the time.
  console.error('[db] Unexpected error on idle client:', err.message);
});

pool.on('connect', (client) => {
  client.query('SET search_path TO lexai, public').catch((err) => {
    console.error('[db] Failed to set search_path:', err.message);
  });
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
