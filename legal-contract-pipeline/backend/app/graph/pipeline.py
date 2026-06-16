"""LangGraph pipeline — graph definition, nodes, and edges."""

from __future__ import annotations

import asyncio
from typing import Any

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.postgres import PostgresSaver

from app.agents.clause_extractor import ClauseExtractor
from app.agents.risk_scorer import RiskScorer
from app.agents.compliance_checker import ComplianceChecker
from app.agents.redliner import Redliner
from app.agents.report_writer import ReportWriter
from app.graph.state import ContractReviewState
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Node names ───────────────────────────────────────────────────────────────
EXTRACT = "clause_extractor"
PARALLEL_ANALYSIS = "parallel_analysis"
AGGREGATE = "aggregate"
REPORT = "report_writer"
HUMAN_APPROVAL = "human_approval"
DONE = END


def _build_agents() -> dict:
    return {
        "extractor": ClauseExtractor(),
        "scorer": RiskScorer(),
        "compliance": ComplianceChecker(),
        "redliner": Redliner(),
        "reporter": ReportWriter(),
    }


# ── Node functions ───────────────────────────────────────────────────────────

def node_extract(state: dict[str, Any], agents: dict) -> dict[str, Any]:
    """Serial: extract clauses first."""
    return agents["extractor"].run(state)


def node_parallel_analysis(state: dict[str, Any], agents: dict) -> dict[str, Any]:
    """Run scorer, compliance, and redliner in parallel via asyncio."""
    async def _run():
        loop = asyncio.get_event_loop()
        scorer_task = loop.run_in_executor(None, agents["scorer"].run, state)
        compliance_task = loop.run_in_executor(None, agents["compliance"].run, state)
        scored, compliant = await asyncio.gather(scorer_task, compliance_task)

        # Redliner needs scores + compliance results
        merged = {**state, **scored, **compliant}
        redline_task = loop.run_in_executor(None, agents["redliner"].run, merged)
        redlined = await asyncio.gather(redline_task)
        return {**scored, **compliant, **redlined[0]}

    return asyncio.run(_run())


def node_report(state: dict[str, Any], agents: dict) -> dict[str, Any]:
    return agents["reporter"].run(state)


def node_human_approval(state: dict[str, Any]) -> dict[str, Any]:
    """Interrupt node — graph pauses here until lawyer approves/rejects."""
    logger.info("pipeline_awaiting_approval", contract_id=state.get("contract_id"))
    return {"awaiting_approval": True}


def node_post_approval(state: dict[str, Any]) -> dict[str, Any]:
    """Resume after human decision — just route."""
    return {"awaiting_approval": False}


# ── Routing ──────────────────────────────────────────────────────────────────

def route_after_approval(state: dict[str, Any]) -> str:
    if state.get("approval") and state["approval"]["approved"]:
        return "finalize"
    return "rejected"


# ── Graph factory ────────────────────────────────────────────────────────────

def build_graph(checkpointer=None):
    agents = _build_agents()

    graph = StateGraph(ContractReviewState)

    graph.add_node(EXTRACT, lambda s: node_extract(s, agents))
    graph.add_node(PARALLEL_ANALYSIS, lambda s: node_parallel_analysis(s, agents))
    graph.add_node(REPORT, lambda s: node_report(s, agents))
    graph.add_node(HUMAN_APPROVAL, node_human_approval)
    graph.add_node("post_approval", node_post_approval)
    graph.add_node("finalize", lambda s: {"pipeline_complete": True})
    graph.add_node("rejected", lambda s: {"pipeline_complete": True, "error": "Review rejected by lawyer"})

    # Edges
    graph.set_entry_point(EXTRACT)
    graph.add_edge(EXTRACT, PARALLEL_ANALYSIS)
    graph.add_edge(PARALLEL_ANALYSIS, REPORT)
    graph.add_edge(REPORT, HUMAN_APPROVAL)

    # Interrupt here — graph pauses until resume() is called
    graph.add_edge(HUMAN_APPROVAL, "post_approval")

    graph.add_conditional_edges(
        "post_approval",
        route_after_approval,
        {"finalize": "finalize", "rejected": "rejected"},
    )
    graph.add_edge("finalize", END)
    graph.add_edge("rejected", END)

    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["post_approval"],  # pause before consuming approval
    )