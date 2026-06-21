import { useState } from "react";
import { RedlineEdit } from "../api/client";

interface Props {
  edits: RedlineEdit[];
  activeClauseId?: number;
}

export function DiffViewer({ edits, activeClauseId }: Props) {
  const [selected, setSelected] = useState<number>(activeClauseId ?? edits[0]?.clause_id);

  const edit = edits.find((e) => e.clause_id === selected);

  return (
    <div className="diff-viewer">
      {/* Sidebar */}
      <aside className="diff-viewer__nav">
        <p className="diff-viewer__nav-title">Redlined Clauses ({edits.length})</p>
        {edits.map((e) => (
          <button
            key={e.clause_id}
            className={`diff-nav-item ${selected === e.clause_id ? "diff-nav-item--active" : ""}`}
            onClick={() => setSelected(e.clause_id)}
          >
            Clause #{e.clause_id}
          </button>
        ))}
      </aside>

      {/* Diff pane */}
      <main className="diff-viewer__pane">
        {edit ? (
          <>
            <div className="diff-cols">
              <div className="diff-col diff-col--original">
                <h4 className="diff-col__heading">Original</h4>
                <HighlightedText
                  text={edit.original_text}
                  changes={edit.changes}
                  side="original"
                />
              </div>
              <div className="diff-col diff-col--revised">
                <h4 className="diff-col__heading">Revised</h4>
                <HighlightedText
                  text={edit.revised_text}
                  changes={edit.changes}
                  side="revised"
                />
              </div>
            </div>

            {edit.attorney_note && (
              <div className="attorney-note">
                <span className="attorney-note__icon">⚖</span>
                <span>{edit.attorney_note}</span>
              </div>
            )}

            {edit.changes.length > 0 && (
              <div className="change-log">
                <h5 className="change-log__title">Changes</h5>
                {edit.changes.map((c, i) => (
                  <div key={i} className="change-log__item">
                    <span className="change-log__del">{c.original}</span>
                    {c.replacement && (
                      <>
                        <span className="change-log__arrow"> → </span>
                        <span className="change-log__ins">{c.replacement}</span>
                      </>
                    )}
                    <span className="change-log__rationale"> — {c.rationale}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="empty-state">Select a clause on the left to view changes.</p>
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

  if (side === "original") {
    changes.forEach((c) => {
      result = result.replace(
        c.original,
        `<mark class="mark--del">${c.original}</mark>`
      );
    });
  } else {
    changes.forEach((c) => {
      if (c.replacement) {
        result = result.replace(
          c.replacement,
          `<mark class="mark--ins">${c.replacement}</mark>`
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
