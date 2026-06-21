"""MLflow evaluation harness for the contract review pipeline.

Replaces the LangSmith-based harness. Tracks runs, params, metrics, and
per-example artifacts in MLflow instead of LangSmith's experiment UI.

Usage:
    MLFLOW_TRACKING_URI=http://mlflow.internal:5000 python evals/run_evals.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import mlflow

# Make `app` importable when run from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.agents.risk_scorer import RiskScorer  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.graph.state import ClauseExtract  # noqa: E402

DATASET_PATH = Path(__file__).parent / "datasets" / "labelled_clauses.jsonl"
EXPERIMENT_NAME = "contract-risk-scorer"
SCORE_TOLERANCE = 20  # within ±20 points counts as "correct" for accuracy metric


# ── Dataset ────────────────────────────────────────────────────────────────────

def load_dataset(path: Path = DATASET_PATH) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


# ── Target function ────────────────────────────────────────────────────────────

def score_clause(scorer: RiskScorer, row: dict[str, Any]) -> dict[str, Any]:
    clause = ClauseExtract(
        id=1,
        type=row["clause_type"],
        heading="",
        text=row["clause_text"],
    )
    result = scorer.run({"clauses": [clause]})
    predicted = result["risk_scores"][0]
    return {"score": predicted.score, "severity": predicted.severity, "flags": predicted.flags}


# ── Metrics ────────────────────────────────────────────────────────────────────

def score_within_tolerance(predicted: int, expected: int, tol: int = SCORE_TOLERANCE) -> bool:
    return abs(predicted - expected) <= tol


def run_eval() -> dict[str, float]:
    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    mlflow.set_experiment(EXPERIMENT_NAME)

    rows = load_dataset()
    scorer = RiskScorer()

    per_example_results: list[dict[str, Any]] = []

    with mlflow.start_run(run_name=f"eval-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"):
        mlflow.log_param("model", settings.ANTHROPIC_MODEL)
        mlflow.log_param("dataset", str(DATASET_PATH.name))
        mlflow.log_param("dataset_size", len(rows))
        mlflow.log_param("score_tolerance", SCORE_TOLERANCE)

        correct_score = 0
        correct_severity = 0
        abs_errors: list[int] = []

        for i, row in enumerate(rows):
            prediction = score_clause(scorer, row)

            is_score_correct = score_within_tolerance(prediction["score"], row["expected_score"])
            is_severity_correct = prediction["severity"] == row["expected_severity"]
            abs_error = abs(prediction["score"] - row["expected_score"])

            correct_score += int(is_score_correct)
            correct_severity += int(is_severity_correct)
            abs_errors.append(abs_error)

            per_example_results.append(
                {
                    "index": i,
                    "clause_type": row["clause_type"],
                    "expected_score": row["expected_score"],
                    "predicted_score": prediction["score"],
                    "abs_error": abs_error,
                    "expected_severity": row["expected_severity"],
                    "predicted_severity": prediction["severity"],
                    "score_correct": is_score_correct,
                    "severity_correct": is_severity_correct,
                    "predicted_flags": prediction["flags"],
                }
            )

            # Per-example metrics (step = example index) for drill-down in MLflow UI
            mlflow.log_metric("abs_error", abs_error, step=i)
            mlflow.log_metric("score_correct", int(is_score_correct), step=i)
            mlflow.log_metric("severity_correct", int(is_severity_correct), step=i)

        n = len(rows)
        score_accuracy = correct_score / n
        severity_accuracy = correct_severity / n
        mae = sum(abs_errors) / n

        mlflow.log_metric("score_accuracy", score_accuracy)
        mlflow.log_metric("severity_accuracy", severity_accuracy)
        mlflow.log_metric("mean_absolute_error", mae)

        # Save full per-example breakdown as an artifact
        with tempfile.TemporaryDirectory() as tmp:
            results_path = Path(tmp) / "eval_results.json"
            results_path.write_text(json.dumps(per_example_results, indent=2))
            mlflow.log_artifact(str(results_path))

        print("\n=== MLflow Eval Results ===")
        print(f"Score accuracy (±{SCORE_TOLERANCE}): {score_accuracy:.1%}")
        print(f"Severity match:            {severity_accuracy:.1%}")
        print(f"Mean absolute error:       {mae:.1f} points")
        print(f"Tracked at: {mlflow.get_tracking_uri()}  experiment='{EXPERIMENT_NAME}'")

        return {
            "score_accuracy": score_accuracy,
            "severity_accuracy": severity_accuracy,
            "mean_absolute_error": mae,
        }


if __name__ == "__main__":
    metrics = run_eval()

    # Fail the CI/Jenkins stage if quality regresses below thresholds
    MIN_SCORE_ACCURACY = 0.6
    MIN_SEVERITY_ACCURACY = 0.6

    if metrics["score_accuracy"] < MIN_SCORE_ACCURACY:
        print(f"❌ score_accuracy {metrics['score_accuracy']:.1%} below threshold {MIN_SCORE_ACCURACY:.0%}")
        sys.exit(1)
    if metrics["severity_accuracy"] < MIN_SEVERITY_ACCURACY:
        print(f"❌ severity_accuracy {metrics['severity_accuracy']:.1%} below threshold {MIN_SEVERITY_ACCURACY:.0%}")
        sys.exit(1)

    print("✅ Eval thresholds met.")
