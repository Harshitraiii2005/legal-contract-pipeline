import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useReviewStore } from "../store/reviewStore";
import { ContractUpload } from "../components/ContractUpload";

const STATUS_BADGE: Record<string, string> = {
  pending: "badge--neutral",
  processing: "badge--info",
  awaiting_approval: "badge--warning",
  approved: "badge--low",
  rejected: "badge--critical",
  error: "badge--critical",
};

export default function Dashboard() {
  const { contracts, fetchContracts, loading } = useReviewStore();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    fetchContracts();
    const interval = setInterval(fetchContracts, 15_000); // poll every 15s
    return () => clearInterval(interval);
  }, []);

  // Calculate statistics
  const totalContracts = contracts.length;
  const awaitingReview = contracts.filter((c) => c.status === "awaiting_approval").length;
  const approvedContracts = contracts.filter((c) => c.status === "approved").length;
  
  const scoreContracts = contracts.filter((c) => c.overall_risk_score > 0);
  const avgRiskScore = scoreContracts.length
    ? Math.round(scoreContracts.reduce((sum, c) => sum + c.overall_risk_score, 0) / scoreContracts.length)
    : 0;

  // Filtered contracts
  const filteredContracts = contracts.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="page dashboard">
      <header className="page__header">
        <div>
          <h1 className="page__title">LexAI Workspace</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem", marginTop: "4px" }}>
            Review, redline, and analyze corporate contracts for compliance and risk.
          </p>
        </div>
        <button
          className="btn btn--ghost"
          onClick={() => {
            localStorage.clear();
            navigate("/login");
          }}
        >
          Sign out
        </button>
      </header>

      {/* KPI Stats Section */}
      <section className="stats-grid">
        <div className="stat-card">
          <span className="stat-card__label">Total Ingested</span>
          <span className="stat-card__value">{totalContracts}</span>
          <span className="stat-card__desc">Contracts uploaded to pipeline</span>
        </div>
        <div className="stat-card" style={{ borderLeft: "3px solid var(--color-medium)" }}>
          <span className="stat-card__label">Awaiting Sign-off</span>
          <span className="stat-card__value" style={{ color: "var(--color-medium)" }}>{awaitingReview}</span>
          <span className="stat-card__desc">Requires lawyer review & sign-off</span>
        </div>
        <div className="stat-card" style={{ borderLeft: "3px solid var(--color-low)" }}>
          <span className="stat-card__label">Approved & Executed</span>
          <span className="stat-card__value" style={{ color: "var(--color-low)" }}>{approvedContracts}</span>
          <span className="stat-card__desc">Signed and archived</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Avg Risk Rating</span>
          <span className="stat-card__value" style={{ color: avgRiskScore >= 60 ? "var(--color-critical)" : avgRiskScore >= 30 ? "var(--color-medium)" : "var(--color-low)" }}>
            {avgRiskScore}%
          </span>
          <span className="stat-card__desc">Average overall risk rating</span>
        </div>
      </section>

      {/* Upload area */}
      <section className="upload-section">
        <h2 className="section-title">Ingest New Document</h2>
        <ContractUpload />
      </section>

      {/* Contracts workspace */}
      <section className="contracts-section">
        <div className="dashboard-controls">
          <h2 className="section-title" style={{ marginBottom: 0 }}>Document Inventory</h2>
          
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", width: "100%", justifyContent: "space-between" }}>
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search contracts by name..."
                className="form-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div style={{ display: "flex", gap: "8px" }}>
              {["all", "pending", "processing", "awaiting_approval", "approved", "rejected"].map((filter) => (
                <button
                  key={filter}
                  className={`pill ${statusFilter === filter ? "pill--active" : ""}`}
                  onClick={() => setStatusFilter(filter)}
                  style={{ textTransform: "capitalize" }}
                >
                  {filter.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && contracts.length === 0 ? (
          <div className="page-center">
            <div className="spinner" aria-label="Loading" />
          </div>
        ) : filteredContracts.length === 0 ? (
          <div className="empty-state">
            <p style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "6px" }}>No documents found</p>
            <p style={{ color: "var(--color-text-dim)", fontSize: "0.875rem" }}>
              Try adjusting your search terms or status filters, or ingest a new contract above.
            </p>
          </div>
        ) : (
          <div className="contracts-grid">
            {filteredContracts.map((c) => (
              <Link key={c.id} to={`/review/${c.id}`} className="contract-card">
                <div>
                  <div className="contract-card__header">
                    <span className="contract-card__icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </span>
                    <span className={`badge ${STATUS_BADGE[c.status] ?? "badge--neutral"}`}>
                      {c.status.replace("_", " ")}
                    </span>
                  </div>
                  <h3 className="contract-card__name" title={c.name}>
                    {c.name.length > 55 ? c.name.slice(0, 52) + "…" : c.name}
                  </h3>
                </div>
                
                <div className="contract-card__meta">
                  <div className="contract-card__clauses">
                    <span>{c.clause_count || 0} Clauses</span>
                  </div>
                  {c.overall_risk_score > 0 && (
                    <RiskGauge score={c.overall_risk_score} />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RiskGauge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "var(--color-critical)"
      : score >= 60
      ? "var(--color-high)"
      : score >= 30
      ? "var(--color-medium)"
      : "var(--color-low)";
      
  return (
    <div className="risk-gauge-mini" title={`Risk rating: ${score}/100`}>
      <span className="risk-gauge-circle" style={{ background: color }} />
      <span>Risk {score}%</span>
    </div>
  );
}
