import { ComplianceResult, RedlineEdit } from "../api/client";

interface Props {
  results: ComplianceResult[];
  edits: RedlineEdit[];
}

export function ComplianceViewer({ results, edits }: Props) {
  const violations = results.filter((r) => !r.compliant);
  const isCompliant = violations.length === 0;

  // Deduplicate all unique frameworks checked across results
  const checkedFrameworks = Array.from(
    new Set(
      results.flatMap((r) => r.violations.map((v) => v.framework))
    )
  );

  // If no frameworks found in violations, show standard checked list
  const frameworksToShow = checkedFrameworks.length
    ? checkedFrameworks
    : ["GDPR", "CCPA", "HIPAA", "SOX", "FCPA"];

  const getClauseSnippet = (clauseId: number) => {
    const edit = edits.find((e) => e.clause_id === clauseId);
    if (!edit) return null;
    const text = edit.original_text;
    return text.length > 200 ? text.slice(0, 197) + "..." : text;
  };

  return (
    <div className="compliance-viewer">
      {/* High-level status */}
      <div className="compliance-summary-card">
        <div
          className={`compliance-summary-status ${
            isCompliant
              ? "compliance-summary-status--compliant"
              : "compliance-summary-status--violations"
          }`}
        >
          {isCompliant ? "✓" : "⚠"}
        </div>
        <div>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "700" }}>
            {isCompliant ? "Compliance Validation Passed" : "Action Required: Violations Identified"}
          </h3>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem", marginTop: "4px" }}>
            {isCompliant
              ? "All assessed high risk clauses align with checked regulatory frameworks."
              : `Found ${violations.length} clause(s) with ${results.reduce((acc, r) => acc + (r.violations?.length || 0), 0)} compliance issue(s).`}
          </p>
        </div>
      </div>

      {/* Checked regulatory frameworks */}
      <div>
        <h4 className="compliance-recommendations__title" style={{ marginBottom: "12px" }}>
          Assessed Regulatory Frameworks
        </h4>
        <div className="frameworks-list">
          {frameworksToShow.map((f) => (
            <span key={f} className="framework-badge">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Results grid */}
      <div className="compliance-grid">
        {results.map((res) => {
          const snippet = getClauseSnippet(res.clause_id);
          const hasViolations = res.violations && res.violations.length > 0;
          
          // Skip showing if it has no violations and is a skipped clause (no violations, recommendations empty)
          // unless all clauses are compliant, in which case we show them to prove coverage.
          if (!hasViolations && (!res.recommendations || res.recommendations.length === 0) && !isCompliant) {
            return null;
          }

          return (
            <div
              key={res.clause_id}
              className={`compliance-card ${
                res.compliant ? "compliance-card--compliant" : "compliance-card--violation"
              }`}
            >
              <div className="compliance-card__header">
                <span className="compliance-card__title">
                  Clause #{res.clause_id} Verification
                </span>
                <span
                  className={`badge ${
                    res.compliant ? "badge--low" : "badge--critical"
                  }`}
                >
                  {res.compliant ? "Compliant" : "Non-Compliant"}
                </span>
              </div>

              {snippet && (
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.15)",
                    padding: "12px 16px",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "var(--font-sans)",
                    fontSize: "0.825rem",
                    color: "var(--color-text-muted)",
                    lineHeight: "1.5",
                    borderLeft: "2px solid var(--color-border)"
                  }}
                >
                  <strong>Text: </strong>
                  <em>"{snippet}"</em>
                </div>
              )}

              {/* Violations */}
              {!res.compliant && res.violations && res.violations.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {res.violations.map((violation, idx) => (
                    <div key={idx} className="violation-item">
                      <span className="violation-item__framework">
                        {violation.framework} {violation.article ? `• ${violation.article}` : ""}
                      </span>
                      <span className="violation-item__desc">{violation.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {res.recommendations && res.recommendations.length > 0 && (
                <div className="compliance-recommendations">
                  <span className="compliance-recommendations__title">Recommended Action</span>
                  <ul className="compliance-recommendations__list">
                    {res.recommendations.map((rec, idx) => (
                      <li key={idx} style={{ marginBottom: "4px" }}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {res.compliant && (
                <p style={{ color: "var(--color-text-dim)", fontSize: "0.825rem" }}>
                  Assessed clean. No issues flagged under checked frameworks.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
