import { useEffect, useRef, useState, useCallback } from "react";

export interface PipelineEvent {
  type: "progress" | "complete" | "error";
  agent?: string;
  message: string;
  data?: Record<string, unknown>;
}

export function useWebSocket(contractId?: string) {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!contractId) return;

    const wsUrl = `${import.meta.env.VITE_WS_URL ?? "ws://localhost:8000"}/ws/pipeline/${contractId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (evt) => {
      try {
        const event: PipelineEvent = JSON.parse(evt.data);
        setEvents((prev) => [...prev, event]);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  }, [contractId]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const clear = () => setEvents([]);

  return { events, connected, clear };
}
