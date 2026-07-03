import { AuditEvent } from "../api/client";

interface Props {
  events: AuditEvent[];
}

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
    return <p className="empty-state">No audit events logged for this document.</p>;
  }

  // Render SVG icons dynamically based on event types
  const renderIcon = (type: string) => {
    switch (type) {
      case "contract_uploaded":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
        );
      case "clause_extracted":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        );
      case "risk_scored":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case "compliance_checked":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        );
      case "redline_generated":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        );
      case "report_written":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        );
      case "pipeline_complete":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 11.08 22 12 22 12A10 10 0 1 1 18 4.7" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case "approval_submitted":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        );
      default:
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        );
    }
  };

  const getAgentColor = (agent: string | null) => {
    if (!agent) return {};
    const name = agent.toLowerCase();
    if (name.includes("risk")) return { color: "#fdba74", borderColor: "rgba(249, 115, 22, 0.2)", backgroundColor: "rgba(249, 115, 22, 0.05)" };
    if (name.includes("compliance")) return { color: "#60a5fa", borderColor: "rgba(59, 130, 246, 0.2)", backgroundColor: "rgba(59, 130, 246, 0.05)" };
    if (name.includes("redline")) return { color: "#c084fc", borderColor: "rgba(168, 85, 247, 0.2)", backgroundColor: "rgba(168, 85, 247, 0.05)" };
    return {};
  };

  return (
    <ol className="audit-timeline">
      {events.map((evt, i) => (
        <li key={evt.id} className="audit-timeline__item">
          <div className="audit-timeline__dot">
            {renderIcon(evt.event_type)}
          </div>
          <div className="audit-timeline__content">
            <div className="audit-timeline__header">
              <span className="audit-timeline__event">{friendlyEvent(evt.event_type)}</span>
              {evt.agent_name && (
                <span className="audit-timeline__agent" style={getAgentColor(evt.agent_name)}>
                  Agent: {evt.agent_name.replace("_", " ")}
                </span>
              )}
              <time className="audit-timeline__time">{formatTime(evt.occurred_at)}</time>
            </div>
            {Object.keys(evt.payload_summary).length > 0 && (
              <details className="audit-timeline__payload">
                <summary>Transaction Payload Summary</summary>
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
