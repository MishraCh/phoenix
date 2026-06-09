# Gideon

**Agentic Operating Layer for Founders and Operators**

Gideon is a multimodal, agentic operating layer engineered for high-leverage workflows. It provides a unified command surface to autonomously research, draft, orchestrate, and execute operations across SaaS ecosystems like HubSpot and Google Workspace. Powered by a deterministic approval state machine, every external write is strictly gated before execution. The underlying cognitive architecture leverages LangGraph-based cyclic orchestration, dynamic capability manifests, and a continuously learning vector memory layer.

## Product Surfaces

| Surface | Route | Purpose |
|---------|-------|---------|
| **Command Center** | `/` | Primary interface: conversational commands with structured AI responses, inline approvals, and session continuity. |
| **Agents** | `/agents` | Six specialist assistants (Executive, Sales, Research, Operations, Customer, Recruiting), each with scoped tools, behavior rules, and output formats. |
| **Workflows** | `/workflows` | Prebuilt and custom automations: scheduled or manual triggers, step-level execution tracing, and visual canvas editor. |
| **Approvals** | `/approvals` | Every external write (email, CRM update, Slack message) lands here: review, edit, approve, or reject before Gideon acts. |
| **Library** | `/library` | Agent-generated artifacts: reports, briefs, and drafts with source attribution and freshness metadata. |
| **Memory & Knowledge** | `/context` | Workspace facts, user preferences, and patterns extracted from sessions, confirmed by the user. |
| **Integrations** | `/integrations` | Connect Gmail and HubSpot: each with a dedicated workspace UI for reading and acting on records. |
| **Settings** | `/settings` | Profile, workspace, members, billing, security, and appearance management. |

## Core Capabilities

### 1. Unified Agentic Command Center
A singular conversational interface designed for multi-step autonomous execution. Instead of navigating siloed SaaS dashboards, operators command Gideon to dynamically chain RAG retrieval, web scraping, and API mutations in a single natural language prompt.

### 2. Specialized Cognitive Agents
Gideon deploys six domain-specific, autonomous agents (Executive, Sales, Research, Operations, Customer, Recruiting). Each agent is isolated with specific behavior heuristics, scoped LangChain tool access, and deterministic output schemas for targeted workflow execution.

### 3. Bidirectional CRM Orchestration
Native read/write integration with HubSpot via encrypted OAuth flows. Gideon autonomously hydrates CRM contexts, generates semantic account summaries, drafts context-aware notes, and executes deterministic mutations to deal pipelines and contact properties.

### 4. Context-Aware Communication Intelligence
Deep integration with the Gmail API. Gideon executes semantic chunking on complex email threads to extract actionable insights, while utilizing few-shot prompting against your historical sent messages to draft stylistically authentic outbound replies.

### 5. Asynchronous Workflow Execution
A robust automation engine for scheduled and event-driven data pipelines. Workflows are processed via Upstash QStash webhooks, triggering concurrent web crawler execution and API interactions to synthesize and deliver high-fidelity artifacts asynchronously.

### 6. The Approval Gateway & Claim Safety
Zero-trust execution architecture. Every deterministic external action (API mutations, email dispatch) lands in a strict Approval Gateway. An asynchronous "Claim Safety" neural guardrail cross-verifies drafted content against origin source data to prevent hallucinated variables prior to manual user validation.

### 7. Persistent Vector Memory Layer
Continuous, passive cognitive learning. Gideon executes named-entity recognition and preference extraction from user interactions, persisting unstructured data into an OpenAI-embedded vector database. This powers dynamic prompt hydration for deeply personalized, context-aware responses across all future sessions.

### 8. Immutable Artifact Library
High-value outputs (Market Research, Playbooks, Funding Shortlists) are compiled into version-controlled, immutable Artifacts. Each generation strictly enforces RAG-backed source citations and freshness telemetry for complete auditability.

## Architecture

* **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
* **Backend:** Node.js, Express 5, TypeScript, LangGraph.js, Firebase Admin
* **Worker:** Separate runtime process (`backend/src/worker.ts`)

### AI Intelligence Layer

All LLM calls are contained in `backend/src/ai/`. The core execution engine uses a LangGraph StateGraph that handles mode resolution, Retrieval-Augmented Generation (RAG), web research, and tool execution.

**Sub-modules:**

| Module | Purpose |
|--------|---------|
| `ai/providers/` | OpenAI LLM and embedding adapters |
| `ai/manifests/` | Dynamic capability manifest injected into every planner prompt |
| `ai/prompts/` | Composable prompt builder with persona and SOP injections |
| `ai/sops/` | Semantic retrieval of operating procedures matched to the user's intent |
| `ai/context/` | Assembles user profile, integration status, agent list, and workspace state |
| `ai/retrieval/` | Firestore vector search across artifacts, memory, and compressed session summaries |
| `ai/safety/` | Safety classification, claim verification, and approval routing |
| `ai/agents/` | Per-agent graph node configurations |

## Backend Services

| Service | Responsibility |
|---------|---------------|
| `CommandGraphService` | LangGraph command execution engine |
| `GideonManifestService` | Real-time capability manifest builder |
| `WorkspaceContextService` | Context assembly: user profile, integrations, agents |
| `CommandSessionService` | Session lifecycle, compression, memory promotion |
| `RetrievalService` | Vector search across workspace knowledge |
| `ApprovalService` | Create, edit, approve, reject with full state machine |
| `ArtifactService` | Artifact storage with source refs and freshness tracking |
| `WorkflowService` | Workflow CRUD, activation, step execution, run state |
| `JobLockService` | Firestore-backed job queue: transactional claiming, QStash webhook delivery |
| `MemoryService` | Workspace memory nodes: deduplication, user confirmation |
| `PolicyService` | Risk classification and approval routing |
| `IntegrationService` | OAuth flows, AES-256 encrypted token storage, delta sync |

## Worker and Real-Time Layer

The worker is a separate Node.js process (`backend/src/worker.ts`) that receives jobs via **Upstash QStash webhooks** (signed, verified) and processes workflows, agent runs, notifications, and integration syncs.

Server-sent events (`backend/src/sse/`) push events to the frontend:
* `command.progress`: Live status copy during command execution
* `approval.created`: New approval badge in the UI
* `workflow.status`: Step-level progress
* `notification.new`: In-app alerts

## Billing & Access

No payment gateway. Plans are workspace-based, upgraded via **coupon codes**.

**Coupon codes:** Upgrade plan and grant credits (`POST /billing/apply-coupon`).
**Invite codes:** Add a user to a workspace (`POST /workspaces/:id/join`).
These are distinct systems and must not be conflated.

## Local Development

### Requirements
* Node.js 18.18+ (tested on 22.11.0)
* Firebase project with Authentication and Firestore enabled
* OpenAI API Key

### 1. Frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

### 2. Backend API
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 3. Worker (separate terminal)
```bash
cd backend
npm run worker
```

## Scripts

**Frontend:**
```bash
npm run dev       # Next.js dev server
npm run build     # Production build
npm run start     # Serve production build
```

**Backend:**
```bash
npm run dev                       # API server (tsx watch)
npm run worker                    # Background worker (tsx watch)
npm run build                     # Compile to dist/
npm run start                     # Run compiled build
npm run eval:intelligence         # Run evaluation suite (requires Firestore emulator)
```

## Current Status and Roadmap

* **OpenAI Migration:** Complete. All legacy APIs have been replaced with dedicated OpenAI and LangGraph architectures.
* **Workflow Intelligence:** Hardened. Background steps process data efficiently without conversational hallucinations.
* **File Uploads:** In development. Users will soon be able to upload documents or PDFs as context sources.
* **Production Integrations:** Gmail OAuth and HubSpot are undergoing final verification and end-to-end testing before full public release.