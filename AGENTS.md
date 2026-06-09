# AGENTS.md

## Purpose

This repo is the source of truth for Gideon implementation.

Gideon is a workspace-based **AI Chief of Staff and operating layer** for founders and operators. It provides one unified command layer, configurable agents, prebuilt and custom workflows, integrations, approvals, artifacts, activity logs, and context-aware assistance.

## Agent read order

Before non-trivial work, read:

1. `AGENTS.md`
2. `docs/product.md`
3. `docs/architecture.md`
4. `docs/ui-ux.md` — for frontend/UI work
5. `docs/data-models.md` — for schema/backend work
6. `docs/api-contracts.md` — for endpoint shapes
7. `docs/tasks.md` — for the active task
8. `docs/decisions.md` — if a tradeoff or provider choice is relevant

## Working rules

For non-trivial tasks, first produce a short plan:
- files likely to change
- implementation approach
- assumptions
- risks/gaps

Then implement only the requested task.

Do:
- make small, coherent, correct changes
- keep frontend and backend as separate runtime apps
- keep worker logic inside `backend/src/worker.ts` as a separate runtime entrypoint
- keep AI, secrets, integrations, and tool execution server-side
- use workspace-scoped data access
- use typed schemas and Zod validation
- prefer approval-first behavior for external/write actions
- create activity events for important actions
- use cached/synced data before live external API calls
- use Parallel Task for sourced web research and Parallel Extract for known URL/page extraction — not Playwright by default
- use Playwright only for JS-heavy pages, screenshots, or pages requiring interactions
- preserve source URLs/citations for web-derived outputs
- **use LangChain.js and LangGraph.js for every AI service, agent, and workflow — no custom orchestration loops, raw LLM SDK calls, or alternative frameworks**

Do not:
- build unrelated features
- expose internal agents as disconnected user-facing products
- add payment gateway in MVP
- build dark mode unless explicitly requested
- move AI orchestration into frontend
- execute external writes without policy/approval checks
- over-refactor outside the active task
- scrape private/paywalled/authenticated sites without explicit user authorization and a documented integration path
- call LLM provider SDKs directly — always go through LangChain/LangGraph abstractions
- write custom agent loops or orchestration logic outside of LangGraph graphs
- conflate invite codes (workspace access) with coupon codes (plan/credit upgrades)

## Product rules

The user sees **one Gideon experience**. Internally, Gideon may use agents, tools, workflows, and integrations.

Core product surfaces:
- Command Center
- Agents
- Workflows
- Approvals
- Library
- People
- Integrations
- Activity
- Context
- Settings

## Technical rules

- Frontend: `frontend/` — Next.js + TypeScript + shadcn/ui + Tailwind
- Backend: `backend/` — Node.js + TypeScript + Express
- Worker: `backend/src/worker.ts` — separate runtime process, shares backend services
- Auth: Firebase Auth
- DB: Firestore
- Storage: Firebase Storage
- AI orchestration: **LangChain.js + LangGraph.js — mandatory**
- LLM default: Vercel AI Gateway via `LLM_PROVIDER=auto` (Claude default; OpenAI fallback). See DEC-024.
- Embeddings default: OpenAI `text-embedding-3-small` (1536) via the AI Gateway (`EMBEDDING_PROVIDER=auto`). See DEC-024.
- Vector search: Firestore vector search (no external vector DB in MVP)
- Web research: Parallel Task via `WEB_RESEARCH_PROVIDER=parallel`
- URL extraction: Parallel Extract via `WEB_EXTRACT_PROVIDER=parallel`
- Validation: Zod
- Logging: Winston
- Billing: hardcoded coupon codes for plan upgrades; invite codes for workspace access

All provider details and decisions are in `docs/decisions.md`. All endpoint shapes are in `docs/api-contracts.md`.

### AI framework rule

Every component that calls an LLM, runs an agent, or executes a workflow **must** use LangChain.js and LangGraph.js. This is not optional.

| Component type | Required abstraction | MVP default |
|---|---|---|
| AI service (any) | LangChain `ChatModel` / `BaseLLM` | `ParallelLlmProvider` (DEC-014) |
| Agent (internal or visible) | LangGraph `StateGraph` node | — |
| Workflow execution | LangGraph `StateGraph` with typed state | — |
| Tool invocation | LangChain `Tool` / `StructuredTool` | — |
| Prompt management | LangChain `ChatPromptTemplate` | — |
| Embedding generation | LangChain `Embeddings` abstraction | `OpenAIEmbeddingProvider` (DEC-014b) |
| Retrieval | LangChain `VectorStoreRetriever` | `FirestoreVectorProvider` (DEC-018) |

Do not bypass these abstractions. Any task that needs LLM or agent behavior must route through `backend/src/ai/`. Provider selection is controlled by env vars — see `docs/decisions.md`.

## Implementation summary required

After changes, summarize:
- what changed
- files changed
- how to run/test
- assumptions made
- follow-ups/blockers

## Open decisions

Unresolved choices are tracked in `docs/decisions.md`. Check that file before making a provider, framework, or architecture choice.
