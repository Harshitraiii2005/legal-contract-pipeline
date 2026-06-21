import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useReview } from "../hooks/useReview";
import { useWebSocket } from "../hooks/useWebSocket";
import { ClauseTable } from "../components/ClauseTable";
import { DiffViewer } from "../components/DiffViewer";
import { ApprovalGate } from "../components/ApprovalGate";
import { AuditTimeline } from "../components/AuditTimeline";
import { contractsApi } from "../api/client";

type Tab = "clauses" | "redlines" | "approval" | "audit";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { contract, review, auditEvents, loading, error, approve, reject } = useReview(id);
  const { events: wsEvents } = useWebSocket(
    contract?.status === "processing" ? id : undefined
  );
  const [tab, setTab] = useState<Tab>("clauses");
  const [activeClause, setActiveClause] = useState<number | undefined>();

  const handleDownload = async (type: "redline" | "report") => {
    if (!id) return;
    const { data } =
      type === "redline"
        ? await contractsApi.downloadRedline(id)
        : await contractsApi.downloadReport(id);
    downloadBlob(data, type === "redline" ? "redlined_contract.docx" : "risk_report.pdf");
  };

  if (loading && !contract) return <div className="page-center"><div className="spinner" /></div>;
  if (error) return <div className="page-center alert alert--error">{error}</div>;
  if (!contract) return <div className="page-center">Contract not found.</div>;

  const isProcessing = contract.status === "processing" || contract.status === "pending";

  return (
    <div className="page review-page">
      <header className="review-header">
        <Link to="/" className="back-link">← Dashboard</Link>
        <div className="review-header__info">
          <h1 className="review-header__title">{contract.name}</h1>
          <span className={`badge ${contract.status === "approved" ? "badge--low" : contract.status === "rejected" ? "badge--critical" : "badge--info"}`}>
            {contract.status.replace(/_/g, " ")}
          </span>
        </div>
        <div className="review-header__actions">
          {review && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => handleDownload("redline")}>
                ⬇ Redlined DOCX
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => handleDownload("report")}>
                ⬇ Risk PDF
              </button>
            </>
          )}
        </div>
      </header>

      {/* Pipeline progress */}
      {isProcessing && (
        <div className="pipeline-progress">
          <div className="spinner spinner--sm" />
          <span>AI review in progress…</span>
          {wsEvents.slice(-1).map((e, i) => (
            <span key={i} className="pipeline-progress__event">{e.message}</span>
          ))}
        </div>
      )}

      {/* Score summary */}
      {review && (
        <div className="score-summary">
          <div className="score-summary__score">
            <span className="score-summary__number">{review.overall_score}</span>
            <span className="score-summary__denom">/100</span>
            <span className="score-summary__label">Overall Risk</span>
          </div>
          <p className="score-summary__summary">{review.executive_summary}</p>
        </div>
      )}

      {review && (
        <>
          {/* Tabs */}
          <nav className="tab-nav">
            {(["clauses", "redlines", "approval", "audit"] as Tab[]).map((t) => (
              <button
                key={t}
                className={`tab-nav__item ${tab === t ? "tab-nav__item--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === "approval" && contract.status === "awaiting_approval" && (
                  <span className="tab-nav__badge" />
                )}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {tab === "clauses" && (
              <ClauseTable
                scores={review.risk_scores as any}
                onSelectClause={(id) => { setActiveClause(id); setTab("redlines"); }}
              />
            )}
            {tab === "redlines" && (
              <DiffViewer
                edits={review.redline_edits as any}
                activeClauseId={activeClause}
              />
            )}
            {tab === "approval" && (
              <ApprovalGate
                contractId={contract.id}
                contractName={contract.name}
                overallScore={review.overall_score}
                onApprove={approve}
                onReject={reject}
                loading={loading}
              />
            )}
            {tab === "audit" && <AuditTimeline events={auditEvents} />}
          </div>
        </>
      )}
    </div>
  );
}
