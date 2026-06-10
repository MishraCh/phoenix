<p align="center">
  <img src="frontend/public/phoenix-wordmark.png" alt="Phoenix AI" width="320" />
</p>

<h3 align="center">The AI Chief of Staff workspace — powered by Gideon, its agentic brain</h3>

---

**Phoenix** is an operational AI platform for founders and operators. **Gideon**, the agentic brain inside Phoenix, researches, drafts, enriches CRM data, and orchestrates work across your connected systems — and every external write is gated behind a human approval, right in the chat.

## What it does

- **Agentic command center** — one conversational surface where Gideon plans and acts in multiple steps: web research with citations, deep-dive reports, CRM queries, enrichment, and proposed actions, all streamed live.
- **Human-in-the-loop approvals** — Gideon never writes externally on its own. Creating a HubSpot contact, updating a deal, sending a payment link: each lands as an approval card in chat with **Approve** and **Edit before approval**. Bulk CRM write-backs go through one batch approval.
- **CRM enrichment loop** — query your HubSpot data, enrich it from the live web (industry, headcount, funding…), build lead datasets, and write the results back through a single gated approval.
- **Workflows** — chat-created and visually edited automations with scheduled or manual triggers and step-level run tracing.
- **3-tier memory** — working conversation memory, an active-entity register for natural follow-ups ("update *its* record"), and long-term vector memory over workspace facts and past sessions.
- **Six agent personas** — Executive, Sales, Research, Operations, Customer, and Recruiting specialists with scoped tools and behavior rules.
- **Billing on Stripe** — Free / Plus / Pro workspace plans via Stripe Checkout (promo codes supported), Customer Portal, and webhook-driven fulfillment. Stripe also connects as an integration: revenue dashboard plus approval-gated payment links.

## Product surfaces

| Surface | Route | Purpose |
|---------|-------|---------|
| Command Center | `/command-center` | Conversational commands, streaming responses, inline approval cards |
| Agents | `/agents` | Specialist personas with scoped tools |
| Workflows | `/workflows` | Automations with triggers, runs, and a visual canvas |
| Approvals | `/approvals` | Review, edit, approve, or reject every external write |
| Library | `/library` | Saved artifacts: reports, briefs, drafts with sources |
| Memory & Knowledge | `/context` | What Gideon knows about your workspace |
| Integrations | `/integrations` | HubSpot and Stripe live today; Gmail coming soon |
| Settings | `/settings` | Profile, response style, billing, workspace management |

## Architecture

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Node.js, Express 5, TypeScript, Firebase Auth + Firestore
- **AI:** Vercel AI SDK v6 (`ToolLoopAgent`) through **Vercel AI Gateway** — Claude Sonnet 4.5 by default, automatic provider fallback, 1536-dim embeddings for Firestore vector search
- **Web intelligence:** **Exa** — grounded answers, search + contents, find-similar, fast/deep research tasks, and entity enrichment
- **Payments:** Stripe Checkout subscriptions, Customer Portal, raw-body webhooks, restricted-key integration connect
- **Safety:** policy engine classifies every tool call; high-risk actions become approvals via typed `prepare*Approval` tools; executors run only after human approval

```
backend/src/
  ai/agentic/      ToolLoopAgent service, tool adapter (policy guardrails), prompts
  ai/providers/    Gateway LLM + embedding providers (OpenAI fallback)
  tools/           Tool registry — web, CRM, Stripe, artifacts, approvals, workflows
  approvals/       Approval state machine (create / edit / approve / execute / fail)
  integrations/    HubSpot + Stripe workspace services, encrypted token store
  workflows/       Draft service, sanitizer, run engine
  payments/        Stripe billing (checkout, portal, webhook fulfillment)
  memory/          Session compression, memory promotion, vector retrieval
```

## Local development

**Requirements:** Node.js 18.18+, a Firebase project (Auth + Firestore), Vercel AI Gateway key, Exa API key, Stripe test keys.

```bash
# Frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev

# Backend API (separate terminal)
cd backend
cp .env.example .env   # fill in keys
npm install
npm run dev

# Background worker (separate terminal)
cd backend
npm run worker
```

Deploy the Firestore indexes once: `firebase deploy --only firestore:indexes`.

## Testing

```bash
cd backend && npx vitest run    # unit + behavior suites (no mocks for live-verified paths)
cd frontend && npx vitest run
```
