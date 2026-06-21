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

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function ClauseTable({ scores, onSelectClause }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "id">("score");

  const visible = scores
    .filter((s) => filter === "all" || s.severity === filter)
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
        <select
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "score" | "id")}
        >
          <option value="score">Sort by risk score</option>
          <option value="id">Sort by clause #</option>
        </select>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Score</th>
            <th>Severity</th>
            <th>Key Flags</th>
            <th>Reasoning</th>
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
              <td>—</td>
              <td>
                <ScoreBar value={score.score} />
              </td>
              <td>
                <span className={`badge ${SEVERITY_CLASS[score.severity]}`}>
                  {score.severity.toUpperCase()}
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

      {visible.length === 0 && (
        <p className="empty-state">No clauses match the selected filter.</p>
      )}
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  const color =
    value >= 80 ? "#C0392B" : value >= 60 ? "#E67E22" : value >= 30 ? "#F39C12" : "#27AE60";
  return (
    <div className="score-bar" title={`${value}/100`}>
      <div className="score-bar__fill" style={{ width: `${value}%`, background: color }} />
      <span className="score-bar__label">{value}</span>
    </div>
  );
}
