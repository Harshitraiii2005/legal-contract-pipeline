# Legal Contract Pipeline

AI-powered contract review system. A LangGraph multi-agent pipeline extracts
clauses, RAG-scores them for risk against historical data, checks regulatory
compliance, drafts redlines, and writes an executive summary — then pauses for
a lawyer's human-in-the-loop approval before anything is finalized. Every
agent decision is written to an append-only audit log.

## Architecture

```
Upload (PDF/DOCX)
     |
     v
Clause Extractor        (serial — segments contract into typed clauses)
     |
     v
Parallel (asyncio.gather)
     +-- Risk Scorer        (RAG + LLM)
     +-- Compliance Checker (policy matching)
              |
              v
          Redliner
     |
     v
Report Writer
     |
     v
Human Approval Gate     (LangGraph interrupt, checkpointed to Postgres,
     |                   resumed via API when the lawyer decides)
     v
Approved / Rejected     (immutable audit trail)
```

See `backend/app/graph/pipeline.py` for the LangGraph wiring and
`backend/app/graph/state.py` for the typed `ContractReviewState` schema shared
across every agent.

## Stack

| Layer | Tech |
|---|---|
| Agents / orchestration | LangGraph, Anthropic Claude |
| RAG | Pinecone, sentence-transformers |
| API | FastAPI, Pydantic v2 |
| DB | PostgreSQL, SQLAlchemy, Alembic |
| Async jobs | Celery + Redis |
| Frontend | React, Vite, TypeScript, Zustand |
| CI/CD | Jenkins (multibranch pipeline) |
| Infra | Kubernetes (Kustomize: base + local/staging/production overlays) |
| Eval tracking | MLflow |

## Repository layout

```
legal-contract-pipeline/
  backend/            FastAPI app, LangGraph agents, Celery workers, Alembic migrations
  frontend/           React + Vite SPA
  infra/nginx/        Reference nginx config
  jenkins/            Jenkinsfile support files (ephemeral CI services, seed job)
  k8s/                Kubernetes manifests — base + overlays (local, staging, production)
  mlflow/             MLflow tracking server image + k8s deployment + local compose
  evals/              Labelled clause dataset + MLflow-tracked eval harness
  Jenkinsfile         CI/CD pipeline definition
  Makefile            Common dev/test/deploy commands
  .env.example        All required environment variables
```

## Quickstart (local, Kubernetes)

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY, PINECONE_API_KEY at minimum

# 1. Build images
make build

# 2. Spin up a local cluster and load images
kind create cluster --name legal-pipeline
kind load docker-image legal-backend:latest --name legal-pipeline
kind load docker-image legal-frontend:latest --name legal-pipeline

# 3. Deploy
make k8s-local

# Frontend: http://localhost:30080
# API:      http://localhost:30800/docs
```

See `k8s/README.md` for staging/production deployment via Jenkins, secrets
provisioning, and autoscaling notes.

## Quickstart (local, no Kubernetes)

Useful for fast iteration on agent logic without a cluster:

```bash
cp .env.example .env
# point DATABASE_URL / REDIS_URL at local services you run yourself, e.g.:
docker run -d -p 5432:5432 -e POSTGRES_USER=legal -e POSTGRES_PASSWORD=legal -e POSTGRES_DB=legaldb postgres:16-alpine
docker run -d -p 6379:6379 redis:7-alpine

cd backend && pip install -r requirements.txt
make migrate

# 3 terminals:
make dev-backend
make dev-worker
make dev-frontend
```

## Running evals

```bash
make mlflow-up       # local MLflow tracking server on :5000
make evals           # scores the labelled clause dataset, logs to MLflow
open http://localhost:5000
```

The eval stage also runs in Jenkins on every build (skippable with the
`SKIP_EVALS` build parameter) and fails the pipeline if score/severity
accuracy drops below the thresholds in `evals/run_evals.py`.

## CI/CD

See `Jenkinsfile` and `jenkins/README.md`. Stages: lint -> test -> build -> MLflow
evals -> (on `main`) build images -> push to ECR -> deploy via Kustomize to the
environment selected by the `DEPLOY_ENV` build parameter.

## Key design decisions

- **Typed state, not raw strings.** Every agent reads/writes a Pydantic
  `ContractReviewState`, making the pipeline inspectable, testable, and
  resumable after failures.
- **RAG-first, LLM-second.** The Risk Scorer retrieves the 3 most similar
  historical clauses from Pinecone before asking Claude to reason — cheaper
  and more accurate than scoring from scratch.
- **Parallel agent execution.** Risk Scorer, Compliance Checker, and Redliner
  run concurrently via `asyncio.gather` after clause extraction, cutting
  total latency by roughly 60%.
- **Human-in-the-loop as a first-class graph node.** Modeled as a LangGraph
  interrupt — state is checkpointed to Postgres and the graph pauses until a
  lawyer submits a decision via the API.
- **Immutable audit log.** Every agent decision is written to an append-only
  `audit.audit_logs` table with `UPDATE`/`DELETE` revoked at the database
  level, not just the app layer.
