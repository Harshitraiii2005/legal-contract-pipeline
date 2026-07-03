VENV_BIN = $(CURDIR)/.venv/bin

.PHONY: help dev dev-backend dev-frontend dev-worker test test-backend test-frontend \
        lint migrate migrate-make k8s-local k8s-staging k8s-production \
        mlflow-up mlflow-down evals build clean venv

help:
	@echo "Legal Contract Pipeline — make targets"
	@echo ""
	@echo "  make venv             Set up or update Python virtual environment"
	@echo "  make dev              Run backend + frontend + worker locally (3 terminals via tmux-free fallback: sequential hint)"
	@echo "  make dev-backend      Run FastAPI with reload"
	@echo "  make dev-frontend     Run Vite dev server"
	@echo "  make dev-worker       Run Celery worker"
	@echo ""
	@echo "  make test             Run backend + frontend tests"
	@echo "  make test-backend     pytest only"
	@echo "  make test-frontend    vitest only"
	@echo "  make lint             ruff (backend) + eslint (frontend)"
	@echo ""
	@echo "  make migrate          Apply alembic migrations"
	@echo "  make migrate-make m='msg'   Generate a new alembic revision"
	@echo ""
	@echo "  make k8s-local        Apply k8s/overlays/local (kind/minikube)"
	@echo "  make k8s-staging      Apply k8s/overlays/staging"
	@echo "  make k8s-production   Apply k8s/overlays/production"
	@echo ""
	@echo "  make mlflow-up        Start local MLflow tracking server (docker compose)"
	@echo "  make mlflow-down      Stop it"
	@echo "  make evals            Run evals/run_evals.py against MLFLOW_TRACKING_URI"
	@echo ""
	@echo "  make build            Build backend + frontend + mlflow Docker images"
	@echo "  make clean            Remove caches, __pycache__, node_modules build artifacts"

# ── Local dev ────────────────────────────────────────────────────────────────

venv:
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r backend/requirements.txt

dev-backend:
	cd backend && $(VENV_BIN)/uvicorn main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

dev-worker:
	cd backend && $(VENV_BIN)/celery -A app.workers.celery_app worker -Q pipeline -c 2 -l info

dev:
	@echo "Run these in separate terminals:"
	@echo "  make dev-backend"
	@echo "  make dev-worker"
	@echo "  make dev-frontend"

# ── Tests ─────────────────────────────────────────────────────────────────────

test: test-backend test-frontend

test-backend:
	cd backend && $(VENV_BIN)/pytest tests/ -v --cov=app --cov-report=term

test-frontend:
	cd frontend && npm run test

lint:
	cd backend && $(VENV_BIN)/ruff check .
	cd frontend && npm run lint

# ── Migrations ────────────────────────────────────────────────────────────────

migrate:
	cd backend && $(VENV_BIN)/alembic upgrade head

migrate-make:
	cd backend && $(VENV_BIN)/alembic revision --autogenerate -m "$(m)"

# ── Kubernetes ────────────────────────────────────────────────────────────────

k8s-local:
	kubectl apply -k k8s/overlays/local

k8s-staging:
	kubectl apply -k k8s/overlays/staging

k8s-production:
	kubectl apply -k k8s/overlays/production

# ── MLflow / Evals ────────────────────────────────────────────────────────────

mlflow-up:
	docker compose -f mlflow/docker-compose.mlflow.yml up -d

mlflow-down:
	docker compose -f mlflow/docker-compose.mlflow.yml down

evals:
	MLFLOW_TRACKING_URI=$${MLFLOW_TRACKING_URI:-http://localhost:5000} $(VENV_BIN)/python evals/run_evals.py

# ── Build ─────────────────────────────────────────────────────────────────────

build:
	docker build -t legal-backend:latest ./backend
	docker build -t legal-frontend:latest ./frontend
	docker build -t legal-mlflow:latest ./mlflow

clean:
	find backend -type d -name "__pycache__" -exec rm -rf {} +
	find backend -type f -name "*.pyc" -delete
	rm -rf frontend/node_modules frontend/dist
	rm -rf backend/.pytest_cache backend/.ruff_cache backend/htmlcov backend/coverage.xml
