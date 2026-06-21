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
  contractId,
  contractName,
  overallScore,
  onApprove,
  onReject,
  loading,
}: Props) {
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);

  const handleDecision = async () => {
    if (!confirming) return;
    if (confirming === "approve") await onApprove(notes);
    else await onReject(notes);
    setConfirming(null);
  };

  const riskColor =
    overallScore >= 80
      ? "#C0392B"
      : overallScore >= 60
      ? "#E67E22"
      : overallScore >= 30
      ? "#F39C12"
      : "#27AE60";

  return (
    <div className="approval-gate">
      <div className="approval-gate__header">
        <h2 className="approval-gate__title">Lawyer Review Required</h2>
        <p className="approval-gate__subtitle">{contractName}</p>
      </div>

      <div className="approval-gate__score" style={{ borderColor: riskColor }}>
        <span className="approval-gate__score-number" style={{ color: riskColor }}>
          {overallScore}
        </span>
        <span className="approval-gate__score-label">/ 100 Risk Score</span>
      </div>

      <div className="approval-gate__notes">
        <label htmlFor="approval-notes" className="form-label">
          Notes (optional)
        </label>
        <textarea
          id="approval-notes"
          className="form-textarea"
          rows={4}
          placeholder="Add review notes for the audit trail…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {confirming ? (
        <div className="approval-gate__confirm">
          <p className="approval-gate__confirm-text">
            {confirming === "approve"
              ? "Approve this contract and its redlines?"
              : "Reject this contract? This action is recorded in the audit log."}
          </p>
          <div className="approval-gate__actions">
            <button
              className={`btn ${confirming === "approve" ? "btn--approve" : "btn--reject"}`}
              onClick={handleDecision}
              disabled={loading}
            >
              {loading ? "Saving…" : `Confirm ${confirming === "approve" ? "Approval" : "Rejection"}`}
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
            onClick={() => setConfirming("approve")}
            disabled={loading}
          >
            ✓ Approve
          </button>
          <button
            className="btn btn--reject"
            onClick={() => setConfirming("reject")}
            disabled={loading}
          >
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  );
}
