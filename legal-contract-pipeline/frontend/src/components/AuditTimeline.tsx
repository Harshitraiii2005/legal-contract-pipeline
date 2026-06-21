import { AuditEvent } from "../api/client";

interface Props {
  events: AuditEvent[];
}

const EVENT_ICONS: Record<string, string> = {
  contract_uploaded: "📤",
  pipeline_complete: "🔬",
  approval_submitted: "✅",
  clause_extracted: "📋",
  risk_scored: "⚠️",
  compliance_checked: "🔍",
  redline_generated: "✏️",
  report_written: "📊",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function friendlyEvent(type: string) {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function AuditTimeline({ events }: Props) {
  if (events.length === 0) {
    return <p className="empty-state">No audit events yet.</p>;
  }

  return (
    <ol className="audit-timeline">
      {events.map((evt, i) => (
        <li key={evt.id} className="audit-timeline__item">
          <div className="audit-timeline__dot">
            {EVENT_ICONS[evt.event_type] ?? "•"}
          </div>
          <div className="audit-timeline__content">
            <div className="audit-timeline__header">
              <span className="audit-timeline__event">{friendlyEvent(evt.event_type)}</span>
              {evt.agent_name && (
                <span className="audit-timeline__agent">Agent: {evt.agent_name}</span>
              )}
              <time className="audit-timeline__time">{formatTime(evt.occurred_at)}</time>
            </div>
            {Object.keys(evt.payload_summary).length > 0 && (
              <details className="audit-timeline__payload">
                <summary>Details</summary>
                <pre>{JSON.stringify(evt.payload_summary, null, 2)}</pre>
              </details>
            )}
          </div>
          {i < events.length - 1 && <div className="audit-timeline__line" />}
        </li>
      ))}
    </ol>
  );
}
