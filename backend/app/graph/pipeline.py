"""LangGraph pipeline — graph definition, nodes, and edges."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

from langgraph.graph import StateGraph, END

from app.agents.clause_extractor import ClauseExtractor
from app.agents.risk_scorer import RiskScorer
from app.agents.compliance_checker import ComplianceChecker
from app.agents.redliner import Redliner
from app.agents.report_writer import ReportWriter
from app.graph.state import ContractReviewState
from app.core.logging import get_logger

logger = get_logger(__name__)

EXTRACT = "clause_extractor"
PARALLEL_ANALYSIS = "parallel_analysis"
REPORT = "report_writer"
HUMAN_APPROVAL = "human_approval"


def _build_agents() -> dict:
    return {
        "extractor": ClauseExtractor(),
        "scorer": RiskScorer(),
        "compliance": ComplianceChecker(),
        "redliner": Redliner(),
        "reporter": ReportWriter(),
    }


def node_extract(state: ContractReviewState, agents: dict) -> dict[str, Any]:
    return agents["extractor"].run(state)


def node_parallel_analysis(state: ContractReviewState, agents: dict) -> dict[str, Any]:
    with ThreadPoolExecutor(max_workers=2) as executor:
        scorer_future = executor.submit(agents["scorer"].run, state)
        compliance_future = executor.submit(agents["compliance"].run, state)
        scored = scorer_future.result()
        compliant = compliance_future.result()

    # Reconciliation step:
    # If a clause has compliance violations, force a floor of 40 on its risk score.
    from app.agents.risk_scorer import get_severity
    
    risk_scores = scored.get("risk_scores", [])
    compliance_results = compliant.get("compliance_results", [])
    comp_map = {r.clause_id: r for r in compliance_results}
    
    reconciled_scores = []
    for s in risk_scores:
        comp = comp_map.get(s.clause_id)
        if comp and len(comp.violations) > 0:
            if s.score is None or s.score < 40:
                s.score = 40
                s.severity = get_severity(40)
                if "compliance violation floor applied" not in s.flags:
                    s.flags.append("compliance violation floor applied")
        reconciled_scores.append(s)
    scored["risk_scores"] = reconciled_scores

    merged = {**state.dict(), **scored, **compliant}
    merged_state = ContractReviewState(**merged)
    redlined = agents["redliner"].run(merged_state)
    return {**scored, **compliant, **redlined}


def node_report(state: ContractReviewState, agents: dict) -> dict[str, Any]:
    return agents["reporter"].run(state)


def node_human_approval(state: ContractReviewState) -> dict[str, Any]:
    logger.info("pipeline_awaiting_approval", contract_id=state.get("contract_id"))
    return {"awaiting_approval": True}


def node_post_approval(state: ContractReviewState) -> dict[str, Any]:
    return {"awaiting_approval": False}


def route_after_approval(state: ContractReviewState) -> str:
    approval = state.get("approval")
    if approval and approval.get("approved"):
        return "finalize"
    return "rejected"


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

    graph.set_entry_point(EXTRACT)
    graph.add_edge(EXTRACT, PARALLEL_ANALYSIS)
    graph.add_edge(PARALLEL_ANALYSIS, REPORT)
    graph.add_edge(REPORT, HUMAN_APPROVAL)
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
        interrupt_before=["post_approval"],
    )
