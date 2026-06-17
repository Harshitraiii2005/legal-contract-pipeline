#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# scaffold.sh
# Generates the full project structure for the Legal Contract Review Pipeline
# (multi-agent system + MLflow tracking + Jenkins CI/CD + kubeadm deployment)
#
# Usage:
#   chmod +x scaffold.sh
#   ./scaffold.sh [project-name]
#
# Default project name: legal-contract-pipeline
# ---------------------------------------------------------------------------

PROJECT_NAME="${1:-legal-contract-pipeline}"

echo "Scaffolding project: ${PROJECT_NAME}"

mk_file() {
  # mk_file <path> <starter-comment>
  local path="$1"
  local comment="${2:-}"
  mkdir -p "$(dirname "$path")"
  if [ ! -f "$path" ]; then
    if [ -n "$comment" ]; then
      echo "$comment" > "$path"
    else
      touch "$path"
    fi
  fi
}

ROOT="${PROJECT_NAME}"
mkdir -p "${ROOT}"
cd "${ROOT}"

# ---------------------------------------------------------------------------
# backend/
# ---------------------------------------------------------------------------

# agents/
mk_file "backend/app/agents/__init__.py"
mk_file "backend/app/agents/base_agent.py" "# Shared base class: prompt formatting, retries, structured output parsing"
mk_file "backend/app/agents/clause_extractor.py" "# Agent 1: segments contract text into typed clauses"
mk_file "backend/app/agents/risk_scorer.py" "# Agent 2: RAG-backed risk scoring per clause"
mk_file "backend/app/agents/compliance_checker.py" "# Agent 3: maps clauses against GDPR / CCPA / policy rules"
mk_file "backend/app/agents/redliner.py" "# Agent 4: generates tracked-change suggestions"
mk_file "backend/app/agents/report_writer.py" "# Agent 5: produces executive summary + risk heatmap"

# graph/ (LangGraph orchestration)
mk_file "backend/app/graph/__init__.py"
mk_file "backend/app/graph/state.py" "# ContractReviewState Pydantic model — single source of truth"
mk_file "backend/app/graph/pipeline.py" "# LangGraph graph definition: nodes, edges, parallel branches"
mk_file "backend/app/graph/orchestrator.py" "# run() / interrupt() / resume() for the human approval gate"

# monitoring/ (feeds MLflow)
mk_file "backend/app/monitoring/__init__.py"
mk_file "backend/app/monitoring/mlflow_logger.py" "# Logs per-agent metrics (latency, tokens, scores) to MLflow"
mk_file "backend/app/monitoring/drift_tracker.py" "# Tracks lawyer override rate vs agent risk score (drift signal)"
mk_file "backend/app/monitoring/cost_tracker.py" "# Tracks token usage / cost per contract run"

# api/
mk_file "backend/app/api/__init__.py"
mk_file "backend/app/api/deps.py" "# DB session, current_user dependency injection"
mk_file "backend/app/api/routes/__init__.py"
mk_file "backend/app/api/routes/contracts.py" "# Upload, status polling, download endpoints"
mk_file "backend/app/api/routes/reviews.py" "# Approve / reject / request-revision endpoints"
mk_file "backend/app/api/routes/auth.py" "# JWT login / register endpoints"
mk_file "backend/app/api/routes/metrics.py" "# Prometheus-style metrics scrape endpoint"

# services/
mk_file "backend/app/services/__init__.py"
mk_file "backend/app/services/document_parser.py" "# PDF/DOCX -> clean text via pdfplumber / python-docx"
mk_file "backend/app/services/vector_store.py" "# Pinecone client wrapper for the clause library"
mk_file "backend/app/services/docx_builder.py" "# Builds red-lined .docx output with tracked changes"
mk_file "backend/app/services/pdf_exporter.py" "# Renders risk summary PDF via WeasyPrint"
mk_file "backend/app/services/email_service.py" "# SendGrid wrapper for approval notifications"

# models/
mk_file "backend/app/models/__init__.py"
mk_file "backend/app/models/contract.py" "# SQLAlchemy ORM: Contract"
mk_file "backend/app/models/review.py" "# SQLAlchemy ORM: Review / HumanDecision"
mk_file "backend/app/models/audit_log.py" "# Append-only audit log model (no UPDATE/DELETE grants)"
mk_file "backend/app/models/user.py" "# SQLAlchemy ORM: User + roles"

# workers/
mk_file "backend/app/workers/__init__.py"
mk_file "backend/app/workers/celery_app.py" "# Celery app config (Redis broker + result backend)"
mk_file "backend/app/workers/tasks.py" "# run_review_pipeline Celery task"

# core/
mk_file "backend/app/core/__init__.py"
mk_file "backend/app/core/config.py" "# Pydantic Settings — loads all env vars"
mk_file "backend/app/core/database.py" "# SQLAlchemy async engine + session factory"
mk_file "backend/app/core/logging.py" "# Structured JSON logging setup"
mk_file "backend/app/core/security.py" "# JWT encode/decode, password hashing, RBAC"

mk_file "backend/app/main.py" "# FastAPI app entry point"
mk_file "backend/app/__init__.py"

# tests/
mk_file "backend/tests/__init__.py"
mk_file "backend/tests/test_agents/__init__.py"
mk_file "backend/tests/test_agents/test_clause_extractor.py"
mk_file "backend/tests/test_agents/test_risk_scorer.py"
mk_file "backend/tests/test_api/__init__.py"
mk_file "backend/tests/test_api/test_contracts.py"
mk_file "backend/tests/fixtures/.gitkeep"

# alembic/
mk_file "backend/alembic/env.py"
mk_file "backend/alembic/versions/.gitkeep"
mk_file "backend/alembic.ini"

mk_file "backend/Dockerfile" "# Multi-stage build: python:3.12-slim base"
mk_file "backend/pyproject.toml" "# Backend dependencies (managed via uv or pip)"
mk_file "backend/requirements.txt"

# ---------------------------------------------------------------------------
# frontend/
# ---------------------------------------------------------------------------

mk_file "frontend/src/components/ContractUpload.tsx"
mk_file "frontend/src/components/ClauseTable.tsx"
mk_file "frontend/src/components/DiffViewer.tsx"
mk_file "frontend/src/components/ApprovalGate.tsx"
mk_file "frontend/src/components/AuditTimeline.tsx"
mk_file "frontend/src/pages/Dashboard.tsx"
mk_file "frontend/src/pages/ReviewPage.tsx"
mk_file "frontend/src/pages/Login.tsx"
mk_file "frontend/src/hooks/useReview.ts"
mk_file "frontend/src/hooks/useWebSocket.ts"
mk_file "frontend/src/store/reviewStore.ts"
mk_file "frontend/src/api/client.ts"
mk_file "frontend/src/main.tsx"
mk_file "frontend/Dockerfile" "# Multi-stage build: node base -> nginx serve"
mk_file "frontend/package.json"
mk_file "frontend/vite.config.ts"
mk_file "frontend/tsconfig.json"

# ---------------------------------------------------------------------------
# mlflow/  (tracking server)
# ---------------------------------------------------------------------------

mk_file "mlflow/mlflow_server.Dockerfile" "# MLflow tracking server image"
mk_file "mlflow/requirements.txt" "mlflow
boto3
psycopg2-binary"
mk_file "mlflow/configs/backend_store.yaml" "# Postgres backend store URI config"
mk_file "mlflow/configs/artifact_store.yaml" "# S3 / MinIO artifact store config"

# ---------------------------------------------------------------------------
# evals/  (quality gate — fixed labelled dataset)
# ---------------------------------------------------------------------------

mk_file "evals/datasets/labelled_clauses_v1.jsonl" "# Hand-labelled clauses: text, true_type, true_risk_score"
mk_file "evals/datasets/labelled_contracts_v1/.gitkeep"
mk_file "evals/run_evals.py" "# Runs full pipeline against labelled dataset, logs results to MLflow"
mk_file "evals/metrics.py" "# precision/recall, score MAE, latency calculations"
mk_file "evals/compare_runs.py" "# Diffs two MLflow run IDs side by side"
mk_file "evals/eval_config.yaml" "# Threshold gates — CI fails build if these regress"

# ---------------------------------------------------------------------------
# experiments/  (prompt/config sandbox — not CI-enforced)
# ---------------------------------------------------------------------------

mk_file "experiments/prompts/clause_extractor_v1.txt"
mk_file "experiments/prompts/clause_extractor_v2.txt"
mk_file "experiments/prompts/risk_scorer_v1.txt"
mk_file "experiments/run_experiment.py" "# Sweeps prompt/config variants, logs each as an MLflow run"

# ---------------------------------------------------------------------------
# jenkins/  (CI/CD)
# ---------------------------------------------------------------------------

mk_file "jenkins/Jenkinsfile" "// Declarative pipeline: lint -> test -> eval gate -> build -> push -> deploy"
mk_file "jenkins/Jenkinsfile.vars.groovy" "// Shared pipeline variables (registry, namespace, image name)"
mk_file "jenkins/scripts/run_lint.sh" "#!/usr/bin/env bash
set -euo pipefail
echo 'TODO: ruff check backend/app'"
mk_file "jenkins/scripts/run_tests.sh" "#!/usr/bin/env bash
set -euo pipefail
echo 'TODO: pytest backend/tests'"
mk_file "jenkins/scripts/run_evals.sh" "#!/usr/bin/env bash
set -euo pipefail
echo 'TODO: python evals/run_evals.py --gate evals/eval_config.yaml'"
mk_file "jenkins/scripts/build_and_push.sh" "#!/usr/bin/env bash
set -euo pipefail
echo 'TODO: docker build + tag + push'"
mk_file "jenkins/scripts/deploy_k8s.sh" "#!/usr/bin/env bash
set -euo pipefail
echo 'TODO: kubectl apply -k k8s/overlays/prod'"
chmod +x jenkins/scripts/*.sh 2>/dev/null || true

# ---------------------------------------------------------------------------
# k8s/  (kubeadm manifests, kustomize layout)
# ---------------------------------------------------------------------------

mk_file "k8s/base/namespace.yaml" "# apiVersion: v1 / kind: Namespace"
mk_file "k8s/base/api-deployment.yaml" "# FastAPI Deployment + Service"
mk_file "k8s/base/api-hpa.yaml" "# HorizontalPodAutoscaler for the API deployment"
mk_file "k8s/base/worker-deployment.yaml" "# Celery worker Deployment"
mk_file "k8s/base/postgres-statefulset.yaml" "# StatefulSet + PersistentVolumeClaim"
mk_file "k8s/base/redis-deployment.yaml" "# Redis Deployment + Service"
mk_file "k8s/base/mlflow-deployment.yaml" "# MLflow tracking server Deployment + PVC"
mk_file "k8s/base/frontend-deployment.yaml" "# React frontend Deployment + Service"
mk_file "k8s/base/ingress.yaml" "# nginx-ingress routing rules"
mk_file "k8s/base/configmap.yaml" "# Non-secret config values"
mk_file "k8s/base/secrets.yaml.example" "# Template only — real secrets.yaml is gitignored"
mk_file "k8s/base/kustomization.yaml" "# Lists all base resources"
mk_file "k8s/overlays/dev/kustomization.yaml" "# Dev overlay — patches replicas, resource limits"
mk_file "k8s/overlays/prod/kustomization.yaml" "# Prod overlay — patches replicas, resource limits"
mk_file "k8s/README.md" "# kubeadm init / join steps + how to apply manifests"

# ---------------------------------------------------------------------------
# infra/ (local dev — docker-compose)
# ---------------------------------------------------------------------------

mk_file "infra/docker-compose.yml" "# Local dev: api, worker, postgres, redis, mlflow, frontend"
mk_file "infra/docker-compose.prod.yml"
mk_file "infra/nginx/nginx.conf" "# Reverse proxy config for local/staging"

# ---------------------------------------------------------------------------
# Root-level files
# ---------------------------------------------------------------------------

mk_file ".env.example" "ANTHROPIC_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
DATABASE_URL=
REDIS_URL=
SECRET_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
LANGSMITH_API_KEY=
SENDGRID_API_KEY=
ENVIRONMENT=development"

mk_file ".gitignore" "__pycache__/
*.pyc
.env
node_modules/
dist/
build/
k8s/base/secrets.yaml
.venv/
*.egg-info/
.pytest_cache/
.mlruns/"

mk_file "README.md" "# ${PROJECT_NAME}

Multi-agent legal contract review pipeline with MLflow tracking,
Jenkins CI/CD, and kubeadm deployment.

See k8s/README.md for cluster setup and jenkins/Jenkinsfile for the pipeline."

mk_file "Makefile" "dev:
	docker compose -f infra/docker-compose.yml up --build

test:
	cd backend && pytest

lint:
	cd backend && ruff check app

evals:
	python evals/run_evals.py --gate evals/eval_config.yaml

migrate:
	cd backend && alembic upgrade head"

echo ""
echo "Done. Project scaffolded at ./${ROOT}"
echo ""
echo "Structure summary:"
find . -type d | sort | sed 's|^\./||' | awk '{ n=split($0,a,"/"); print substr("                                                                ",1,(n-1)*2) a[n] "/" }'