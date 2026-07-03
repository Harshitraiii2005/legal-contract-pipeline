import { useState } from "react";
import { RiskScore } from "../api/client";

interface Props {
  scores: RiskScore[];
  onSelectClause?: (clauseId: number) => void;
}

const SEVERITY_CLASS: Record<string, string> = {
  low: "badge--low",
  medium: "badge--medium",
  high: "badge--high",
  critical: "badge--critical",
};

export function ClauseTable({ scores, onSelectClause }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "id">("score");
  const [searchQuery, setSearchQuery] = useState("");

  const visible = scores
    .filter((s) => filter === "all" || s.severity === filter)
    .filter((s) => {
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      return (
        s.reasoning.toLowerCase().includes(term) ||
        s.flags.some((f) => f.toLowerCase().includes(term))
      );
    })
    .sort((a, b) =>
      sortBy === "score" ? b.score - a.score : a.clause_id - b.clause_id
    );

  return (
    <div className="clause-table">
      <div className="clause-table__controls">
        <div className="filter-pills">
          {["all", "critical", "high", "medium", "low"].map((f) => (
            <button
              key={f}
              className={`pill ${filter === f ? "pill--active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search clauses..."
            className="form-input"
            style={{ padding: "6px 14px", fontSize: "0.85rem", minWidth: "200px" }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "score" | "id")}
          >
            <option value="score">Sort by risk score</option>
            <option value="id">Sort by clause #</option>
          </select>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "60px" }}>#</th>
              <th>Score</th>
              <th style={{ width: "130px" }}>Severity</th>
              <th style={{ width: "220px" }}>Key Flags</th>
              <th>Analysis & Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((score) => (
              <tr
                key={score.clause_id}
                className={`table__row table__row--${score.severity}`}
                onClick={() => onSelectClause?.(score.clause_id)}
                style={{ cursor: onSelectClause ? "pointer" : "default" }}
              >
                <td className="table__cell--mono">{score.clause_id}</td>
                <td>
                  <ScoreBar value={score.score} />
                </td>
                <td>
                  <span className={`badge ${SEVERITY_CLASS[score.severity]}`}>
                    {score.severity}
                  </span>
                </td>
                <td>
                  <div className="flags">
                    {score.flags.slice(0, 3).map((f) => (
                      <span key={f} className="flag-chip">{f}</span>
                    ))}
                  </div>
                </td>
                <td className="table__cell--reasoning">{score.reasoning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 && (
        <p className="empty-state">No clauses match the selected query.</p>
      )}
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  const color =
    value >= 80
      ? "var(--color-critical)"
      : value >= 60
      ? "var(--color-high)"
      : value >= 30
      ? "var(--color-medium)"
      : "var(--color-low)";
      
  return (
    <div className="score-bar-wrapper" title={`${value}/100 Risk Score`}>
      <div className="score-bar">
        <div className="score-bar__fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span>{value}%</span>
    </div>
  );
}
