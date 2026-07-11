import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useReview } from "../hooks/useReview";
import { useWebSocket } from "../hooks/useWebSocket";
import { ClauseTable } from "../components/ClauseTable";
import { DiffViewer } from "../components/DiffViewer";
import { ComplianceViewer } from "../components/ComplianceViewer";
import { ApprovalGate } from "../components/ApprovalGate";
import { AuditTimeline } from "../components/AuditTimeline";
import { contractsApi } from "../api/client";

type Tab = "clauses" | "redlines" | "compliance" | "approval" | "audit";

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

  const getRiskClass = (score: number) => {
    if (score >= 70) return "risk-critical";
    if (score >= 40) return "risk-high";
    if (score >= 20) return "risk-medium";
    return "risk-low";
  };

  const getRiskColor = (score: number) => {
    if (score >= 70) return "var(--color-critical)";
    if (score >= 40) return "var(--color-high)";
    if (score >= 20) return "var(--color-medium)";
    return "var(--color-low)";
  };

  const countViolations = () => {
    if (!review?.compliance_results) return 0;
    return review.compliance_results.reduce((acc, r) => acc + (r.violations?.length || 0), 0);
  };

  return (
    <div className="page review-page">
      <header className="review-header">
        <Link to="/" className="review-header__back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "6px" }}>
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Workspace
        </Link>
        <div className="review-header__info">
          <h1 className="review-header__title" title={contract.name}>{contract.name}</h1>
          <span className={`badge ${contract.status === "approved" ? "badge--low" : contract.status === "rejected" ? "badge--critical" : "badge--info"}`}>
            {contract.status.replace(/_/g, " ")}
          </span>
        </div>
        <div className="review-header__actions">
          {review && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => handleDownload("redline")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Redlined DOCX
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => handleDownload("report")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Risk PDF
              </button>
            </>
          )}
        </div>
      </header>

      {/* Pipeline progress */}
      {isProcessing && (
        <div className="pipeline-progress">
          <div className="spinner spinner--sm" />
          <span>AI Agents analyzing clauses, risk, compliance and redlines...</span>
          {wsEvents.length > 0 ? (
            wsEvents.slice(-1).map((e, i) => (
              <span key={i} className="pipeline-progress__event">{e.message}</span>
            ))
          ) : auditEvents.length > 0 ? (
            <span className="pipeline-progress__event">
              Current stage: {auditEvents[auditEvents.length - 1].event_type.replace(/_/g, " ")}
            </span>
          ) : (
            <span className="pipeline-progress__event">Starting pipeline...</span>
          )}
        </div>
      )}

      {/* Score summary */}
      {review && (
        <div className={`score-summary ${getRiskClass(review.overall_score)}`}>
          <div className="score-summary__score" style={{ borderColor: getRiskColor(review.overall_score), display: "flex", flexDirection: "column", height: "auto", minHeight: "130px", padding: "16px 12px" }}>
            <span className="score-summary__number" style={{ color: getRiskColor(review.overall_score), lineHeight: "1" }}>
              {review.overall_score}
            </span>
            <span className="score-summary__label" style={{ marginBottom: "8px" }}>Risk Rating</span>
            <div className="score-legend" style={{ fontSize: "10px", textAlign: "left", lineHeight: "1.4", borderTop: "1px solid var(--color-border)", paddingTop: "8px", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-text-secondary)" }}>
                <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-critical)" }}></span>
                70-100 Critical
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-text-secondary)" }}>
                <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-high)" }}></span>
                40-69 High
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-text-secondary)" }}>
                <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-medium)" }}></span>
                20-39 Medium
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-text-secondary)" }}>
                <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-low)" }}></span>
                0-19 Low
              </div>
            </div>
          </div>
          <div className="score-summary__details">
            <h4 className="score-summary__heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Executive Risk Briefing</span>
              {review.represented_party && (
                <span className="badge badge--info" style={{ fontSize: "11px", textTransform: "none", padding: "2px 8px" }}>
                  Perspective: {review.represented_party}
                </span>
              )}
            </h4>
            <p className="score-summary__summary" style={{ whiteSpace: "pre-wrap" }}>{review.executive_summary}</p>
          </div>
        </div>
      )}

      {review && (
        <>
          {/* Tabs */}
          <nav className="tab-nav">
            {(["clauses", "redlines", "compliance", "approval", "audit"] as Tab[]).map((t) => {
              const showBadge = 
                (t === "approval" && contract.status === "awaiting_approval") || 
                (t === "compliance" && countViolations() > 0);
              
              return (
                <button
                  key={t}
                  className={`tab-nav__item ${tab === t ? "tab-nav__item--active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t === "redlines" ? "Suggested Redlines" : t.charAt(0).toUpperCase() + t.slice(1)}
                  {showBadge && (
                    <span className="tab-nav__badge" style={{ backgroundColor: t === "compliance" ? "var(--color-critical)" : "var(--color-accent)" }} />
                  )}
                </button>
              );
            })}
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
            {tab === "compliance" && (
              <ComplianceViewer
                results={review.compliance_results as any}
                edits={review.redline_edits as any}
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
