import { useState } from "react";
import { RedlineEdit } from "../api/client";

interface Props {
  edits: RedlineEdit[];
  activeClauseId?: number;
}

export function DiffViewer({ edits, activeClauseId }: Props) {
  const [selected, setSelected] = useState<number>(activeClauseId ?? edits[0]?.clause_id);
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");

  const edit = edits.find((e) => e.clause_id === selected);

  return (
    <div className="diff-viewer">
      {/* Sidebar */}
      <aside className="diff-viewer__nav">
        <p className="diff-viewer__nav-title">Redlined Clauses ({edits.length})</p>
        <div className="diff-nav-list">
          {edits.map((e) => (
            <button
              key={e.clause_id}
              className={`diff-nav-item ${selected === e.clause_id ? "diff-nav-item--active" : ""}`}
              onClick={() => setSelected(e.clause_id)}
            >
              <span style={{ fontWeight: "700" }}>Clause #{e.clause_id}</span>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-dim)" }}>
                {e.changes.length} suggested changes
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Diff pane */}
      <main className="diff-viewer__pane">
        {edit ? (
          <>
            <div className="diff-toolbar">
              <h3 className="diff-toolbar__title">Clause #{edit.clause_id} In-depth Analysis</h3>
              <div className="diff-toggle-group">
                <button
                  className={`diff-toggle-btn ${viewMode === "split" ? "diff-toggle-btn--active" : ""}`}
                  onClick={() => setViewMode("split")}
                >
                  Split Screen
                </button>
                <button
                  className={`diff-toggle-btn ${viewMode === "unified" ? "diff-toggle-btn--active" : ""}`}
                  onClick={() => setViewMode("unified")}
                >
                  Unified Inline
                </button>
              </div>
            </div>

            {viewMode === "split" ? (
              <div className="diff-cols">
                <div className="diff-col diff-col--original">
                  <h4 className="diff-col__heading">Original Text</h4>
                  <div className="diff-text-wrapper">
                    <HighlightedText
                      text={edit.original_text}
                      changes={edit.changes}
                      side="original"
                    />
                  </div>
                </div>
                <div className="diff-col diff-col--revised">
                  <h4 className="diff-col__heading">Suggested Revised Text</h4>
                  <div className="diff-text-wrapper">
                    <HighlightedText
                      text={edit.revised_text}
                      changes={edit.changes}
                      side="revised"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="diff-unified">
                <h4 className="diff-col__heading" style={{ color: "var(--color-text-muted)" }}>Unified Diff View</h4>
                <div className="diff-text-wrapper" style={{ borderLeft: "4px solid var(--color-accent)" }}>
                  <div className="diff-unified__line diff-unified__line--del">
                    <strong>- </strong>
                    <HighlightedText text={edit.original_text} changes={edit.changes} side="original" />
                  </div>
                  <div className="diff-unified__line diff-unified__line--ins" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <strong>+ </strong>
                    <HighlightedText text={edit.revised_text} changes={edit.changes} side="revised" />
                  </div>
                </div>
              </div>
            )}

            {edit.attorney_note && (
              <div className="attorney-note">
                <span className="attorney-note__icon">⚖</span>
                <div>
                  <strong style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-medium)" }}>
                    Agent Legal Advisory
                  </strong>
                  <span>{edit.attorney_note}</span>
                </div>
              </div>
            )}

            {edit.changes.length > 0 && (
              <div className="change-log">
                <h5 className="change-log__title">Granular Redline History</h5>
                <div className="change-log__list">
                  {edit.changes.map((c, i) => (
                    <div key={i} className="change-log__item">
                      <span className="change-log__del">{c.original}</span>
                      {c.replacement && (
                        <>
                          <span className="change-log__arrow"> → </span>
                          <span className="change-log__ins">{c.replacement}</span>
                        </>
                      )}
                      <span className="change-log__rationale">{c.rationale}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="empty-state">Select a clause on the left to view suggested changes.</p>
        )}
      </main>
    </div>
  );
}

interface HighlightedProps {
  text: string;
  changes: { original: string; replacement: string }[];
  side: "original" | "revised";
}

function HighlightedText({ text, changes, side }: HighlightedProps) {
  let result = text;

  // Escape HTML first to prevent any script injections or layout breakage
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (side === "original") {
    changes.forEach((c) => {
      const escapedOriginal = c.original
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      result = result.replace(
        escapedOriginal,
        `<mark class="mark--del">${escapedOriginal}</mark>`
      );
    });
  } else {
    changes.forEach((c) => {
      if (c.replacement) {
        const escapedReplacement = c.replacement
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        result = result.replace(
          escapedReplacement,
          `<mark class="mark--ins">${escapedReplacement}</mark>`
        );
      }
    });
  }

  return (
    <pre
      className="diff-text"
      dangerouslySetInnerHTML={{ __html: result }}
    />
  );
}
