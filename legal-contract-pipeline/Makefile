dev:
	docker compose -f infra/docker-compose.yml up --build

test:
	cd backend && pytest

lint:
	cd backend && ruff check app

evals:
	python evals/run_evals.py --gate evals/eval_config.yaml

migrate:
	cd backend && alembic upgrade head
