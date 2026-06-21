# Kubernetes manifests

Replaces the old `docker-compose.yml` / `docker-compose.prod.yml` setup.
Structured with [Kustomize](https://kustomize.io) — one `base/` plus three
overlays (`local`, `staging`, `production`).

```
k8s/
  base/
    namespace.yaml
    configmap.yaml
    secret.example.yaml        # documents required keys, not applied directly
    postgres.yaml               # StatefulSet + headless Service
    redis.yaml                  # Deployment + Service
    backend-deployment.yaml     # Deployment + Service + HPA, runs alembic via initContainer
    worker-deployment.yaml      # Celery worker Deployment + HPA
    worker-scaledobject.yaml    # optional KEDA queue-depth autoscaler (alt to HPA)
    frontend-deployment.yaml    # Deployment + Service
    ingress.yaml                # nginx-ingress + cert-manager TLS
    network-policy.yaml         # restrict DB/Redis ingress to backend+worker only
    migration-job.yaml          # standalone alembic upgrade Job
    kustomization.yaml
  overlays/
    local/        # kind/minikube — NodePort, dummy secrets, no ingress/netpol
    staging/      # 1 replica each, staging hostnames, DEBUG=true
    production/   # 3 backend/worker replicas, PDBs, higher resource limits
```

## Local development (kind / minikube)

```bash
kind create cluster --name legal-pipeline
docker build -t legal-backend:dev ./backend
docker build -t legal-frontend:dev ./frontend
kind load docker-image legal-backend:dev --name legal-pipeline
kind load docker-image legal-frontend:dev --name legal-pipeline

kubectl apply -k k8s/overlays/local

# Frontend: http://localhost:30080
# API:      http://localhost:30800
kubectl -n legal-local get pods -w
```

## Staging / Production

These are normally applied by Jenkins (see `Jenkinsfile`), which sets the
image tag to the built commit SHA before applying:

```bash
cd k8s/overlays/staging   # or production
kustomize edit set image \
  legal-backend=<registry>/legal-backend:<sha> \
  legal-frontend=<registry>/legal-frontend:<sha>
kubectl apply -k .
kubectl rollout status deployment/legal-backend -n legal-staging
```

## Secrets

Real secrets are **never committed**. `base/secret.example.yaml` documents
the expected keys with placeholder values and is provided as a reference /
local-testing fallback only. In staging and production, secrets should be
provisioned via:

- **External Secrets Operator** pulling from AWS Secrets Manager / SSM, or
- **Sealed Secrets**, encrypting secrets at rest in git.

Either approach should produce a `Secret` named `legal-backend-secrets` in
the target namespace with the keys listed in `secret.example.yaml`.

## Autoscaling

- `legal-backend` and `legal-worker` ship with CPU-based HPAs by default.
- If [KEDA](https://keda.sh) is installed, swap the worker HPA for
  `worker-scaledobject.yaml`, which scales on Celery queue depth in Redis —
  a much better signal for the bursty, upload-triggered workload this
  pipeline has.

## Migrations

Migrations run two ways, both safe to use together:
1. Automatically, via an `initContainer` on every `legal-backend` rollout.
2. On demand, via `kubectl apply -f k8s/base/migration-job.yaml` (or through
   the Jenkins "Run DB migrations" step) for out-of-band migration runs.
