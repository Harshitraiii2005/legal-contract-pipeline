import { useEffect } from "react";
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
  const navigate = useNavigate();

  useEffect(() => {
    fetchContracts();
    const interval = setInterval(fetchContracts, 15_000); // poll every 15s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page dashboard">
      <header className="page__header">
        <h1 className="page__title">Contract Reviews</h1>
        <button
          className="btn btn--ghost"
          onClick={() => { localStorage.clear(); navigate("/login"); }}
        >
          Sign out
        </button>
      </header>

      <section className="upload-section">
        <h2 className="section-title">Upload New Contract</h2>
        <ContractUpload />
      </section>

      <section className="contracts-section">
        <h2 className="section-title">Recent Contracts</h2>

        {loading && contracts.length === 0 ? (
          <div className="spinner" aria-label="Loading" />
        ) : contracts.length === 0 ? (
          <p className="empty-state">No contracts yet. Upload one above to get started.</p>
        ) : (
          <div className="contracts-grid">
            {contracts.map((c) => (
              <Link key={c.id} to={`/review/${c.id}`} className="contract-card">
                <div className="contract-card__header">
                  <span className="contract-card__icon">📄</span>
                  <span className={`badge ${STATUS_BADGE[c.status] ?? "badge--neutral"}`}>
                    {c.status.replace("_", " ")}
                  </span>
                </div>
                <h3 className="contract-card__name" title={c.name}>
                  {c.name.length > 60 ? c.name.slice(0, 57) + "…" : c.name}
                </h3>
                <div className="contract-card__meta">
                  {c.clause_count > 0 && (
                    <span>{c.clause_count} clauses</span>
                  )}
                  {c.overall_risk_score > 0 && (
                    <RiskChip score={c.overall_risk_score} />
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

function RiskChip({ score }: { score: number }) {
  const color =
    score >= 80 ? "#C0392B" : score >= 60 ? "#E67E22" : score >= 30 ? "#F39C12" : "#27AE60";
  return (
    <span className="risk-chip" style={{ color, borderColor: color }}>
      Risk {score}/100
    </span>
  );
}
