export interface ClauseExtract {
  id: number;
  type: string;
  heading: string;
  text: string;
  page_hint?: number;
}

export interface ClauseRiskScore {
  clause_id: number;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
  flags: string[];
  rag_hits?: string[];
}

export interface ComplianceViolation {
  framework: string;
  article?: string;
  description: string;
  confidence?: number;
}

export interface ComplianceResult {
  clause_id: number;
  compliant: boolean;
  violations: ComplianceViolation[];
  recommendations: string[];
}

export interface RedlineEdit {
  clause_id: number;
  original_text: string;
  revised_text: string;
  changes: Array<{
    type: string;
    original: string;
    replacement: string;
    rationale: string;
  }>;
  attorney_note?: string;
  approved?: boolean | null;
  original_score?: number;
  mitigated_score?: number;
  mitigation_score_mismatch?: boolean;
}

export interface FinalReport {
  contract_id: string;
  contract_name: string;
  overall_score: number;
  clause_count: number;
  high_risk_count: number;
  violation_count: number;
  compliance_violation_clauses: number;
  compliance_violation_issues: number;
  executive_summary: string;
  risk_scores: ClauseRiskScore[];
  compliance_results: ComplianceResult[];
  redline_edits: RedlineEdit[];
  represented_party: string;
  extraction_integrity_warning?: string | null;
  generated_at?: Date;
}

export interface ContractReviewState {
  contract_id: string;
  contract_name: string;
  contract_text: string;
  represented_party: string;

  clauses: ClauseExtract[];
  clause_count?: number;
  extraction_integrity_warning?: string | null;

  risk_scores: ClauseRiskScore[];

  compliance_results: ComplianceResult[];
  compliance_violation_count?: number;
  compliance_violation_clauses?: number;
  compliance_violation_issues?: number;

  redline_edits: RedlineEdit[];

  report?: FinalReport | null;
  pipeline_complete?: boolean;

  awaiting_approval?: boolean;
  user_id: string;
}
