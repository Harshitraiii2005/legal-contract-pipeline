# Jenkins CI/CD

This replaces the GitHub Actions setup with a Jenkins multibranch pipeline.

## Setup (one-time)

1. **Create the Docker network** used by the ephemeral test services:
   ```bash
   docker network create jenkins-net
   ```

2. **Install required Jenkins plugins**:
   - Docker Pipeline
   - Kubernetes CLI Plugin
   - AnsiColor
   - JUnit
   - Cobertura (or Coverage) Plugin
   - Job DSL (for the seed job)
   - GitHub Branch Source

3. **Add credentials** (Manage Jenkins → Credentials):

   | ID | Type | Used for |
   |---|---|---|
   | `aws-creds` | AWS Credentials | ECR push |
   | `ecr-registry-url` | Secret text | e.g. `123456789.dkr.ecr.us-east-1.amazonaws.com` |
   | `kubeconfig-staging` | Secret file | kubeconfig for staging cluster |
   | `kubeconfig-production` | Secret file | kubeconfig for production cluster |
   | `anthropic-api-key` | Secret text | used for test/eval stages |
   | `github-app-creds` | GitHub App / token | repo scanning for multibranch source |

4. **Run the seed job** once, pointing it at `jenkins/seed-job.groovy`, to provision
   the multibranch pipeline job (`legal-contract-pipeline`).

## Pipeline stages (see root `Jenkinsfile`)

```
Checkout
  → Backend: Install + Lint (ruff)
  → Backend: Unit + Integration Tests (pytest, against ephemeral postgres-ci/redis-ci)
  → Frontend: Lint + Build (eslint, vite build)
  → MLflow Evals (skippable via SKIP_EVALS param)
  → Build Images        [main branch only]
  → Push to ECR         [main branch only]
  → Deploy              [main branch only, gated by DEPLOY_ENV param: staging|production]
```

Deploys apply the relevant Kustomize overlay in `k8s/overlays/<env>/` and wait
for rollout of `legal-backend`, `legal-worker`, and `legal-frontend` deployments.

## Ephemeral CI services

`jenkins/ci-services.yml` spins up throwaway Postgres + Redis containers on
`jenkins-net` for the test stage only. They use `tmpfs` storage and are torn
down (`docker compose ... down -v`) at the end of the stage — no state persists
between builds.

## Manual deploy trigger

Build with parameters → set `DEPLOY_ENV` to `staging` or `production` to deploy
after a successful `main` build. Defaults to `none` (build/test only, no deploy).
