import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

// No auth: no token to attach, no 401-refresh flow. Every request here is
// anonymous, and the backend treats contracts/reviews as shared rather than
// scoped to a caller.
export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 60_000,
  headers: { "Content-Type": "application/json" },
});

// ── Typed API helpers ─────────────────────────────────────────────────────────

export interface Contract {
  id: string;
  name: string;
  status: string;
  overall_risk_score: number;
  clause_count: number;
  thread_id: string;
}

export interface Review {
  id: string;
  contract_id: string;
  overall_score: number;
  executive_summary: string;
  risk_scores: RiskScore[];
  compliance_results: ComplianceResult[];
  redline_edits: RedlineEdit[];
  approved: boolean | null;
  reviewer_notes: string;
  decided_at: string | null;
  represented_party?: string;
}

export interface RiskScore {
  clause_id: number;
  score: number;
  severity: "low" | "medium" | "high" | "critical";
  reasoning: string;
  flags: string[];
}

export interface ComplianceResult {
  clause_id: number;
  compliant: boolean;
  violations: { framework: string; article: string; description: string }[];
  recommendations: string[];
}

export interface RedlineEdit {
  clause_id: number;
  original_text: string;
  revised_text: string;
  changes: { original: string; replacement: string; rationale: string }[];
  attorney_note: string;
}

export interface AuditEvent {
  id: string;
  event_type: string;
  agent_name: string | null;
  user_id: string | null;
  occurred_at: string;
  payload_summary: Record<string, unknown>;
}

export const contractsApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post<Contract>("/contracts/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  list: (skip = 0, limit = 20) =>
    apiClient.get<Contract[]>("/contracts/", { params: { skip, limit } }),
  get: (id: string) => apiClient.get<Contract>(`/contracts/${id}`),
  downloadRedline: (id: string) =>
    apiClient.get(`/contracts/${id}/download/redline`, { responseType: "blob" }),
  downloadReport: (id: string) =>
    apiClient.get(`/contracts/${id}/download/report`, { responseType: "blob" }),
};

export const reviewsApi = {
  get: (contractId: string) => apiClient.get<Review>(`/reviews/${contractId}`),
  approve: (contractId: string, approved: boolean, notes = "") =>
    apiClient.post(`/reviews/${contractId}/approve`, { approved, notes }),
  audit: (contractId: string) =>
    apiClient.get<AuditEvent[]>(`/reviews/${contractId}/audit`),
};