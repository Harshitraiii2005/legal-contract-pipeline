# Minimal MLflow tracking server image.
# Backend store: Postgres (same cluster, separate DB/schema).
# Artifact store: S3.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    mlflow==2.14.1 \
    psycopg2-binary==2.9.9 \
    boto3==1.34.131

EXPOSE 5000

# BACKEND_STORE_URI and ARTIFACT_ROOT are supplied via env at runtime
# (see k8s/mlflow-deployment.yaml or mlflow/docker-compose.mlflow.yml)
CMD mlflow server \
    --host 0.0.0.0 \
    --port 5000 \
    --backend-store-uri "${BACKEND_STORE_URI}" \
    --default-artifact-root "${ARTIFACT_ROOT}" \
    --serve-artifacts
