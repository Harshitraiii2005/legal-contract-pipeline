// Jenkinsfile — root pipeline for legal-contract-pipeline
// Stages: checkout -> lint -> test -> build images -> push to ECR -> deploy to k8s
//
// Required Jenkins credentials (configure in Jenkins > Credentials):
//   aws-creds            - AWS access key/secret (kind: AWS Credentials)
//   ecr-registry-url      - String param or env, e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com
//   kubeconfig-staging    - Kubeconfig file credential for staging cluster
//   kubeconfig-production - Kubeconfig file credential for production cluster
//   anthropic-api-key     - Secret text, used only for eval stage smoke tests
//
// Required Jenkins plugins: Docker Pipeline, Kubernetes CLI, AnsiColor, JUnit, Cobertura/Coverage

@Library('shared-pipeline-utils') _  // optional shared library; falls back gracefully if absent

pipeline {
    agent { label 'docker' }

    options {
        timestamps()
        ansiColor('xterm')
        buildDiscarder(logRotator(numToKeepStr: '30'))
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
    }

    environment {
        REGISTRY        = credentials('ecr-registry-url')
        BACKEND_IMAGE    = "${REGISTRY}/legal-backend"
        FRONTEND_IMAGE   = "${REGISTRY}/legal-frontend"
        IMAGE_TAG        = "${env.GIT_COMMIT.take(8)}"
        AWS_DEFAULT_REGION = 'us-east-1'
    }

    parameters {
        choice(name: 'DEPLOY_ENV', choices: ['none', 'staging', 'production'], description: 'Environment to deploy to after a successful build on main')
        booleanParam(name: 'SKIP_EVALS', defaultValue: false, description: 'Skip MLflow eval stage (useful for hotfixes)')
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.SHORT_SHA = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
                }
            }
        }

        stage('Backend: Install + Lint') {
            agent {
                docker { image 'python:3.11-slim'; args '-u root:root'; reuseNode true }
            }
            steps {
                dir('backend') {
                    sh '''
                        pip install --no-cache-dir -r requirements.txt
                        ruff check . --output-format=junit > ruff-report.xml || true
                    '''
                }
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: 'backend/ruff-report.xml'
                }
            }
        }

        stage('Backend: Unit + Integration Tests') {
            agent {
                docker {
                    image 'python:3.11-slim'
                    args '-u root:root --network jenkins-net'
                    reuseNode true
                }
            }
            environment {
                SECRET_KEY        = 'ci-secret-key-at-least-32-characters-long'
                DATABASE_URL      = 'postgresql://legal:legal@postgres-ci:5432/legaldb_test'
                ANTHROPIC_API_KEY = credentials('anthropic-api-key')
                PINECONE_API_KEY  = 'ci-test-key'
                REDIS_URL         = 'redis://redis-ci:6379/0'
            }
            steps {
                dir('backend') {
                    sh '''
                        pip install --no-cache-dir -r requirements.txt
                        pytest tests/ -v \
                            --junitxml=pytest-report.xml \
                            --cov=app --cov-report=xml --cov-report=term
                    '''
                }
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: 'backend/pytest-report.xml'
                    publishCoverage adapters: [coberturaAdapter('backend/coverage.xml')], failNoReports: false
                }
            }
        }

        stage('Frontend: Lint + Build') {
            agent {
                docker { image 'node:20-alpine'; reuseNode true }
            }
            steps {
                dir('frontend') {
                    sh '''
                        npm ci
                        npm run lint
                        VITE_API_URL=https://api.legalai.example.com/api/v1 npm run build
                    '''
                }
            }
        }

        stage('MLflow Evals') {
            when { expression { return !params.SKIP_EVALS } }
            agent {
                docker { image 'python:3.11-slim'; args '-u root:root'; reuseNode true }
            }
            environment {
                ANTHROPIC_API_KEY  = credentials('anthropic-api-key')
                PINECONE_API_KEY   = 'ci-test-key'
                MLFLOW_TRACKING_URI = 'http://mlflow.internal:5000'
            }
            steps {
                dir('backend') { sh 'pip install --no-cache-dir -r requirements.txt' }
                sh '''
                    pip install --no-cache-dir mlflow>=2.14.0
                    python evals/run_evals.py
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'evals/results/**', allowEmptyArchive: true
                }
            }
        }

        stage('Build Images') {
            when { branch 'main' }
            steps {
                script {
                    docker.build("${BACKEND_IMAGE}:${IMAGE_TAG}", "./backend")
                    docker.build("${FRONTEND_IMAGE}:${IMAGE_TAG}",
                        "--build-arg VITE_API_URL=https://api.legalai.example.com/api/v1 ./frontend")
                }
            }
        }

        stage('Push to ECR') {
            when { branch 'main' }
            steps {
                withCredentials([aws(credentialsId: 'aws-creds')]) {
                    sh '''
                        aws ecr get-login-password --region $AWS_DEFAULT_REGION | \
                            docker login --username AWS --password-stdin ${REGISTRY}
                    '''
                    script {
                        docker.image("${BACKEND_IMAGE}:${IMAGE_TAG}").push()
                        docker.image("${BACKEND_IMAGE}:${IMAGE_TAG}").push('latest')
                        docker.image("${FRONTEND_IMAGE}:${IMAGE_TAG}").push()
                        docker.image("${FRONTEND_IMAGE}:${IMAGE_TAG}").push('latest')
                    }
                }
            }
        }

        stage('Deploy') {
            when {
                allOf {
                    branch 'main'
                    expression { params.DEPLOY_ENV != 'none' }
                }
            }
            steps {
                script {
                    def kubeCred = (params.DEPLOY_ENV == 'production') ? 'kubeconfig-production' : 'kubeconfig-staging'
                    withCredentials([file(credentialsId: kubeCred, variable: 'KUBECONFIG')]) {
                        sh """
                            cd k8s/overlays/${params.DEPLOY_ENV}
                            kustomize edit set image \
                                legal-backend=${BACKEND_IMAGE}:${IMAGE_TAG} \
                                legal-frontend=${FRONTEND_IMAGE}:${IMAGE_TAG}
                            kubectl apply -k .
                            kubectl rollout status deployment/legal-backend -n legal-${params.DEPLOY_ENV} --timeout=180s
                            kubectl rollout status deployment/legal-worker  -n legal-${params.DEPLOY_ENV} --timeout=180s
                            kubectl rollout status deployment/legal-frontend -n legal-${params.DEPLOY_ENV} --timeout=180s
                        """
                    }
                }
            }
        }
    }

    post {
        success {
            echo "✅ Pipeline succeeded for ${env.SHORT_SHA}"
        }
        failure {
            echo "❌ Pipeline failed — see stage logs above"
            // slackSend / email notification hook goes here
        }
        always {
            cleanWs()
        }
    }
}
