"""Orchestrator — run, interrupt, and resume the review pipeline."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg2.pool import ThreadedConnectionPool

from app.graph.pipeline import build_graph
from app.graph.state import ApprovalDecision, ContractReviewState
from app.core.config import settings
from app.core.database import get_db_url
from app.core.logging import get_logger

logger = get_logger(__name__)


def _make_checkpointer() -> PostgresSaver:
    pool = ThreadedConnectionPool(1, 10, get_db_url())
    cp = PostgresSaver(pool)
    cp.setup()  # Creates checkpoint tables if they don't exist
    return cp


class PipelineOrchestrator:
    """Thread-safe orchestrator for contract review runs."""

    def __init__(self) -> None:
        self.checkpointer = _make_checkpointer()
        self.graph = build_graph(checkpointer=self.checkpointer)

    # ------------------------------------------------------------------ #
    # Start a new review                                                   #
    # ------------------------------------------------------------------ #

    def start_review(
        self,
        contract_id: str,
        contract_text: str,
        contract_name: str = "",
        user_id: str = "",
    ) -> dict[str, Any]:
        """
        Kick off the pipeline. Returns as soon as it hits the HITL interrupt.
        The thread_id stored in config is the resume handle.
        """
        thread_id = f"review-{contract_id}"
        config = {"configurable": {"thread_id": thread_id}}

        initial_state = ContractReviewState(
            contract_id=contract_id,
            contract_name=contract_name,
            contract_text=contract_text,
            user_id=user_id,
        )

        logger.info("pipeline_start", contract_id=contract_id, thread_id=thread_id)

        # Run until interrupt
        result = self.graph.invoke(initial_state.dict(), config=config)

        return {"thread_id": thread_id, "state": result}

    # ------------------------------------------------------------------ #
    # Resume after human decision                                          #
    # ------------------------------------------------------------------ #

    def submit_approval(
        self,
        thread_id: str,
        approved: bool,
        reviewer_id: str,
        notes: str = "",
    ) -> dict[str, Any]:
        """Resume the graph after lawyer approval/rejection."""
        config = {"configurable": {"thread_id": thread_id}}

        decision = ApprovalDecision(
            approved=approved,
            reviewer_id=reviewer_id,
            reviewer_notes=notes,
        )

        # Update state with the decision, then resume
        update = {"approval": decision.dict(), "awaiting_approval": False}
        result = self.graph.invoke(update, config=config)

        logger.info(
            "pipeline_resumed",
            thread_id=thread_id,
            approved=approved,
            reviewer_id=reviewer_id,
        )
        return {"thread_id": thread_id, "state": result}

    # ------------------------------------------------------------------ #
    # Introspect                                                           #
    # ------------------------------------------------------------------ #

    def get_state(self, thread_id: str) -> dict[str, Any]:
        config = {"configurable": {"thread_id": thread_id}}
        state_snapshot = self.graph.get_state(config)
        return state_snapshot.values if state_snapshot else {}

    def list_checkpoints(self, thread_id: str) -> list[dict]:
        config = {"configurable": {"thread_id": thread_id}}
        return [
            {"checkpoint_id": c.config["configurable"]["checkpoint_id"], "ts": c.metadata.get("created_at")}
            for c in self.graph.get_state_history(config)
        ]


# Singleton
_orchestrator: PipelineOrchestrator | None = None


def get_orchestrator() -> PipelineOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = PipelineOrchestrator()
    return _orchestrator