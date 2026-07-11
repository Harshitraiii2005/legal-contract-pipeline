import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 60_000,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach token ─────────────────────────────────────────
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem("access_token");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: handle 401 refresh ─────────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

// Endpoints that should NEVER trigger the refresh-and-retry flow below.
// A 401 from /auth/login means "wrong credentials" — there is no token to
// refresh, and trying to refresh (with a null refresh_token) was previously
// causing a hard redirect to /login that wiped the error message before
// React could render it. /auth/register and /auth/refresh have the same
// problem for the same reason.
const AUTH_ENDPOINTS = ["/auth/login", "/auth/register", "/auth/refresh"];

function isAuthEndpoint(url?: string): boolean {
  return Boolean(url && AUTH_ENDPOINTS.some((p) => url.includes(p)));
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Let auth endpoints fail normally — the caller's own try/catch (e.g.
    // Login.tsx) handles displaying "Invalid credentials" etc.
    if (isAuthEndpoint(original?.url)) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original._retry) {
      const hasRefreshToken = Boolean(localStorage.getItem("refresh_token"));

      // No refresh token means the user was never logged in — there is
      // nothing to refresh, so don't attempt it or redirect; just fail.
      if (!hasRefreshToken) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers!.Authorization = `Bearer ${token}`;
          return apiClient(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refresh = localStorage.getItem("refresh_token");
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refresh });
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("refresh_token", data.refresh_token);
        processQueue(null, data.access_token);
        original.headers!.Authorization = `Bearer ${data.access_token}`;
        return apiClient(original);
      } catch (err) {
        processQueue(err, null);
        localStorage.clear();
        window.location.href = "/login";
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

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

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<{ access_token: string; refresh_token: string }>("/auth/login", { email, password }),
  register: (email: string, password: string, full_name = "") =>
    apiClient.post("/auth/register", { email, password, full_name }),
  me: () => apiClient.get("/auth/me"),
};