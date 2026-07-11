# ⚖️ LexAI SaaS: Contract Analysis & Orchestration Pipeline

🚀 **Enterprise-Grade Polyglot Microservices Platform powered by Go (Fiber), Node.js (TypeScript), Vercel AI SDK, Redis (BullMQ), and React.**

---

<p align="center">
  <img src="https://img.shields.io/badge/API%20Gateway-Go%20%2F%20Fiber-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go API Gateway" />
  <img src="https://img.shields.io/badge/Pipeline%20Worker-Node%20%2F%20TypeScript-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Worker" />
  <img src="https://img.shields.io/badge/AI%20Orchestrator-Vercel%20AI%20SDK-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel AI SDK" />
  <img src="https://img.shields.io/badge/MCP%20Server-Compatible-blue?style=for-the-badge&logo=modelcontextprotocol&logoColor=white" alt="MCP Spec" />
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Database-PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Queue-Redis%20%2F%20BullMQ-cc2929?style=for-the-badge&logo=redis&logoColor=white" alt="BullMQ & Redis" />
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20Express-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React & Express" />
</p>

---

## 💡 Modernization & Microservice Architecture

LexAI has transitioned from a monolithic Python stack to a **high-performance polyglot microservice architecture**. This ensures optimal resource allocation, type safety, low latency, and modular scalability.

```mermaid
graph TD
    subgraph Frontend Layer [SPA Client Interface]
        FE[React SPA Client]
        EX[Express Production Server <br> port 8085]
        EX -->|Serves static assets| FE
    end

    subgraph Gateway Layer [Ingress & Security]
        GW[Go API Gateway <br> Fiber - port 8000]
        FE -->|REST API & Auth| GW
    end

    subgraph Storage & Queues [State & Communication]
        DB[(PostgreSQL Database)]
        RD[(Redis Queue / BullMQ)]
        GW -->|Reads/Writes Metadata| DB
        GW -->|Enqueues Review Jobs| RD
    end

    subgraph Orchestration Worker [AI Execution Hub]
        WK[Node.js Pipeline Worker <br> TypeScript]
        RD -->|Pulls Jobs| WK
        WK -->|Queries Vector Store| PC[(Pinecone Precedents)]
        WK -->|Logs Reviews & Audit| DB
    end

    subgraph LLM Provider [Cognitive Layer]
        VC[Vercel AI SDK]
        GQ[Groq Cloud / Llama 3]
        WK -->|Orchestrates Agents| VC
        VC -->|Executes Queries| GQ
    end

    subgraph External Interfaces [Model Context Protocol]
        MCP[MCP Server Wrapper <br> stdio / SSE port 8081]
        MCP -->|Direct Local Invocation| SDK[LexAIPipelineSDK]
        SDK --> WK
    end
```

### Why This Modernized Architecture is Better

> [!NOTE]
> **Performance**: By splitting concerns, the Go (Fiber) Gateway handles user sessions, JWT verification, and PostgreSQL transactions with near-zero latency. 
> 
> **AI Orchestration**: Node.js/TypeScript is the premier ecosystem for LLM agent integration. Replacing Python Celery with **BullMQ & Redis** yields lighter memory overhead and simpler serialization.
> 
> **Vercel AI SDK Integration**: Exclusively manages LLM execution, standardizing prompt caching, retry loops, and schema validations.
> 
> **Typesafe State Machine**: Every agent operates on strict, typed TypeScript interfaces (`ContractReviewState`), preventing runtime data drift.

---

## 🏆 What Makes This System Unique & Better

* **Vercel AI SDK Prompt Caching**: Employs SHA-256 prompt hashing and localized JSON response caching (`evals/.llm_cache_node.json`) to skip duplicate LLM queries during local dev or regression testing.
* **Calibrated Risk Scoring**: Scores clauses for risk severity (0-100) and applies strict regulatory filters (e.g. CCPA/GDPR/HIPAA). Applies automatic weighted severity floor calibration for critical terms.
* **Agentic Tracked-Change Redlining**: Rather than just explaining risk, the Redliner generates full tracked-change revisions side-by-side with original text, providing attorneys with an instant draft.
* **Unified Developer SDK**: Includes `LexAIPipelineSDK`, enabling developers to run the multi-agent legal review pipeline programmatically outside the Redis worker process.
* **Dual-Transport MCP Server**: The worker includes an integrated Model Context Protocol (MCP) server supporting **stdio** mode (for IDE extensions like Cursor) and **SSE HTTP** mode (for public endpoints).

---

## 🛠️ Tech Stack & Microservices

| Component | Technology | Description |
| :--- | :--- | :--- |
| **API Gateway** | Go, Fiber, pgx, JWT | Ingress controller, security boundary, user auth, metadata storage |
| **Pipeline Worker** | Node.js, TypeScript, BullMQ | Background async consumer for contract processing |
| **Orchestrator** | Vercel AI SDK, Groq, Pinecone | Multi-agent state machine (Extractor, Scorer, Compliance, Redliner) |
| **Frontend** | React SPA, Vite, Express | Beautiful dark-themed dashboard; served via node Express |
| **Databases** | PostgreSQL, Redis | User data, audit ledger, and worker message queue |
| **Integrations** | Model Context Protocol (MCP) | Exposes legal analysis tools to Cursor, Claude, and local scripts |

---

## 🚀 Getting Started

### 1. Environment Configuration
Create a `.env` file at the root:
```bash
cp .env.example .env
```
Fill in the credentials:
* `GROQ_API_KEY`: API Key for Llama-3 model generation.
* `POSTGRES_DB_URL`: Connection string for PostgreSQL database.
* `REDIS_URL`: Redis server URL for queue caching.
* `PINECONE_API_KEY`: Pinecone API credentials.

---

### 2. Running the Microservices Locally

Start PostgreSQL and Redis in Docker:
```bash
docker run -d -p 5432:5432 -e POSTGRES_USER=legal -e POSTGRES_PASSWORD=legal -e POSTGRES_DB=legaldb postgres:16-alpine
docker run -d -p 6379:6379 redis:7-alpine
```

#### A. Go API Gateway
```bash
cd backend-go
go run main.go
```
*Port: `http://localhost:8000`*

#### B. Pipeline Worker
Build and start the worker queue consumer:
```bash
cd pipeline-worker
npm install
npm run build
npm start
```

#### C. React & Express Frontend
```bash
cd frontend
npm install
npm run build
PORT=8085 npm start
```
*Port: `http://localhost:8085`*

---

## 🔌 Model Context Protocol (MCP) Configuration

LexAI provides an out-of-the-box MCP server to connect the contract review pipeline with AI assistants like **Cursor** or **Claude Desktop**.

### Running the Server

* **Stdio Mode** (Standard for local client plugins):
  ```bash
  cd pipeline-worker
  npm run mcp
  ```
* **SSE (HTTP) Server Mode** (Exposes public port `8081` for remote testing):
  ```bash
  cd pipeline-worker
  MCP_TRANSPORT=sse npm run mcp
  ```

### Adding to Clients

#### Claude Desktop
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "lexai-pipeline": {
      "command": "node",
      "args": ["/home/dell/legal-contract-pipeline/pipeline-worker/dist/mcp-server.js"],
      "env": {
        "GROQ_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Cursor Editor
1. Go to **Settings -> Beta -> Features -> MCP**.
2. Add a new server:
   * **Name**: `LexAI`
   * **Type**: `stdio`
   * **Command**: `node /home/dell/legal-contract-pipeline/pipeline-worker/dist/mcp-server.js`

---

## 🛡️ Directory Structure

```
legal-contract-pipeline/
├── backend-go/         # Go API Gateway (Fiber, DB pools, Middleware)
├── pipeline-worker/    # TypeScript Worker (BaseAgent, BullMQ, MCP Server)
│   ├── src/
│   │   ├── agents/     # Vercel AI SDK specialized agent nodes
│   │   ├── pipeline/   # Stateful multi-agent orchestrator logic
│   │   ├── services/   # DOCX parser, PDF exporters, and Pinecone vector store
│   │   ├── sdk.ts      # Standalone LexAIPipelineSDK
│   │   └── mcp-server.ts # MCP Server (stdio & SSE)
├── frontend/           # React SPA Client & Express wrapper
├── infra/              # Local Nginx proxy configurations
├── k8s/                # Kubernetes overlays & resource declarations
└── evals/              # Local evaluation datasets & LLM caching records
```
