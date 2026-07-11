import { useState } from "react";

interface Props {
  contractId: string;
  contractName: string;
  overallScore: number;
  onApprove: (notes: string) => Promise<void>;
  onReject: (notes: string) => Promise<void>;
  loading?: boolean;
}

export function ApprovalGate({
  contractName,
  overallScore,
  onApprove,
  onReject,
  loading,
}: Props) {
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  
  // Interactive legal checklists
  const [checkedReview, setCheckedReview] = useState(false);
  const [checkedRedlines, setCheckedRedlines] = useState(false);
  const [checkedAudit, setCheckedAudit] = useState(false);

  const canApprove = checkedReview && checkedRedlines && checkedAudit;

  const handleDecision = async () => {
    if (!confirming) return;
    if (confirming === "approve") {
      if (!canApprove) return;
      await onApprove(notes);
    } else {
      await onReject(notes);
    }
    setConfirming(null);
  };

  const riskColor =
    overallScore >= 70
      ? "var(--color-critical)"
      : overallScore >= 40
      ? "var(--color-high)"
      : overallScore >= 20
      ? "var(--color-medium)"
      : "var(--color-low)";

  return (
    <div className="approval-gate">
      <div className="approval-gate__header">
        <h2 className="approval-gate__title">Legal Execution Gate</h2>
        <p className="approval-gate__subtitle">Sign-off required for: <strong>{contractName}</strong></p>
      </div>

      <div className="approval-gate__score" style={{ borderColor: "var(--color-border)" }}>
        <span className="approval-gate__score-number" style={{ color: riskColor }}>
          {overallScore}%
        </span>
        <span className="approval-gate__score-label">Overall Risk Index</span>
      </div>

      {/* Review Checklist */}
      <div className="checklist-box">
        <h4 className="checklist-box__title">Required Verification Checklist</h4>
        
        <label className="checklist-item">
          <input
            type="checkbox"
            checked={checkedReview}
            onChange={(e) => setCheckedReview(e.target.checked)}
          />
          <span>I have reviewed all critical and high-risk clauses extracted by the AI agents.</span>
        </label>
        
        <label className="checklist-item">
          <input
            type="checkbox"
            checked={checkedRedlines}
            onChange={(e) => setCheckedRedlines(e.target.checked)}
          />
          <span>I confirm that all suggested redline edits align with legal parameters.</span>
        </label>
        
        <label className="checklist-item">
          <input
            type="checkbox"
            checked={checkedAudit}
            onChange={(e) => setCheckedAudit(e.target.checked)}
          />
          <span>I agree to commit this decision to the system's audit trail.</span>
        </label>
      </div>

      <div className="approval-gate__notes">
        <label htmlFor="approval-notes" className="form-label">
          Professional Review Notes
        </label>
        <textarea
          id="approval-notes"
          className="form-textarea"
          rows={4}
          placeholder="Add observations, counterparty communication details, or policy deviations..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {confirming ? (
        <div className="approval-gate__confirm">
          <p className="approval-gate__confirm-text">
            {confirming === "approve"
              ? "Approve this contract and commit redlined changes?"
              : "Reject this contract? Rejection terminates pipeline review."}
          </p>
          <div className="approval-gate__actions" style={{ justifyContent: "center" }}>
            <button
              className={`btn ${confirming === "approve" ? "btn--primary" : "btn--reject"}`}
              onClick={handleDecision}
              disabled={loading || (confirming === "approve" && !canApprove)}
            >
              {loading ? (
                <>
                  <span className="spinner spinner--sm" style={{ borderTopColor: "#fff" }} />
                  <span>Saving...</span>
                </>
              ) : (
                `Confirm ${confirming === "approve" ? "Approval" : "Rejection"}`
              )}
            </button>
            <button className="btn btn--ghost" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="approval-gate__actions">
          <button
            className="btn btn--approve"
            style={{ flex: 1 }}
            onClick={() => setConfirming("approve")}
            disabled={loading || !canApprove}
            title={!canApprove ? "Complete the verification checklist to approve" : ""}
          >
            ✓ Sign-off & Approve
          </button>
          <button
            className="btn btn--reject"
            style={{ flex: 1 }}
            onClick={() => setConfirming("reject")}
            disabled={loading}
          >
            ✕ Terminate & Reject
          </button>
        </div>
      )}
    </div>
  );
}
