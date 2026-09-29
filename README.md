# Relay OS

### Intelligence, in your hands.

**[Open the interactive website](https://riyadadlani02.github.io/relay-agent-os/)** — a retro-futuristic agent OS playground that runs entirely in the browser.

![Relay OS retro website](docs/site-desktop.png)

Give an agent a customer request. Follow its plan, inspect its tool calls, approve a sensitive action, and verify the outcome—all in one workspace.

Relay OS is a runnable engineering portfolio project: a React control plane over a durable TypeScript agent runtime. **It starts without API keys.** Customer systems and business effects are sandboxed; orchestration, persistence, policy enforcement, approval decisions, and traces are implemented.

![Relay OS mission control](docs/overview.png)

## Start in two minutes

Requires **Node.js 24 or newer** and npm.

```bash
git clone https://github.com/riyadadlani02/relay-agent-os.git
cd relay-agent-os
npm ci
npm run dev
```

Open **http://127.0.0.1:5173** for the website, or **http://127.0.0.1:5173/?workspace=1** for the API-backed workspace. The API runs on port 4310. Ten explicitly labeled sample missions are generated on first startup, including two waiting for approval.

For the built application:

```bash
npm run build
npm start
# Open http://127.0.0.1:4310
```

Or use `docker compose up --build` and open port 4310. The Compose configuration binds the application to localhost and persists SQLite in a named volume. Docker packaging is provided; see the verification notes below for what has been exercised.

The public website uses the same runtime with a browser storage adapter and fixed demo scenarios. The backend workspace below uses SQLite. See [website design and deployment](docs/design.md) for both modes.

## The three-minute backend demo

1. Click **New mission → Quick refund → Launch mission**. A $49 refund passes through six services and lands in the sandbox ledger.
2. Launch **Approval gate**. The $249 refund pauses before execution. Inspect the trace, approve it, and watch it resume from the persisted checkpoint.
3. Launch **Policy boundary**. A $750 refund is blocked. There is no approval button that can bypass the hard limit.
4. Launch another quick refund with **Simulate one connector failure** enabled. The trace shows a retry using the same idempotency key; the ledger contains one effect.
5. Stop and restart the server while a run awaits approval. The pending decision and trace survive.

## What makes it an agent OS?

The OS metaphor refers to shared execution primitives for agent applications:

| Primitive        | Implementation                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Processes        | Typed missions with persisted lifecycle state and a step cursor                            |
| Scheduler        | Four concurrent in-process execution slots; workspace pause/resume                         |
| Capabilities     | A closed set of refund, replacement, and escalation actions; scenario-bound permissions    |
| Policy           | Server-enforced limits, action budgets, and a final authorization check before every write |
| Human interrupts | Persisted approval gates that resume the same mission                                      |
| Durable state    | SQLite WAL with atomic effect, event, and checkpoint writes                                |
| System calls     | Named sandbox tools with inspectable event payloads                                        |
| Observability    | An append-only application event log, per-mission traces, and state-derived metrics        |
| Evaluation       | Deterministic behavioral fixtures plus backend and browser regression tests                |

The six services are **Triage → Knowledge → Resolution → Policy → Action → Quality**. Resolution is the model boundary. The other services are deterministic application code.

## Architecture

```mermaid
flowchart LR
  UI[React control plane] --> API[Express API]
  API --> DB[(SQLite WAL)]
  Worker[Bounded scheduler] --> Runtime[Resumable runtime]
  Runtime --> Planner[Planner interface]
  Planner --> Demo[Deterministic planner]
  Planner --> Model[Optional model endpoint]
  Runtime --> Policy[Capability and policy checks]
  Policy --> Approval[Human approval checkpoint]
  Approval --> Policy
  Policy --> Ledger[Sandbox business ledger]
  Ledger --> Verify[Outcome verification]
  Runtime --> DB
```

The browser polls snapshots every 1.5 seconds and the selected trace every second. A worker advances runnable missions every 1.1 seconds. The deliberate pacing makes the workflow visible during a demo.

The key correctness boundary is in [`server/runtime.ts`](server/runtime.ts): effect creation, its audit event, and checkpoint advancement share one SQLite transaction. A unique constraint permits at most one sandbox effect per run. Pending approvals are ordinary durable states, not promises kept in memory.

See [architecture and tradeoffs](docs/architecture.md), [HTTP API](docs/api.md), and the [interview walkthrough](docs/interview-guide.md).

## Optional model planning

Copy `.env.example` to `.env` and configure an OpenAI-compatible **chat completions** endpoint:

```dotenv
MODEL_BASE_URL=https://your-provider.example/v1
MODEL_API_KEY=your-local-secret
MODEL_NAME=your-supported-model
```

Your provider must support JSON object responses. The server sends the typed mission and bundled reference policies, validates the returned plan, and independently checks its proposed action. Credentials stay on the server and `.env` is ignored by Git. Configuring a provider sends the entered customer request to that provider; use synthetic data for this demo.

Without those variables, planning is deterministic. There is no silent fallback if a configured model fails. The run fails closed with a safe error category. Real-provider behavior is **not included** in the default test or evaluation results.

## Verification

```bash
npm run check      # TypeScript, production build, backend/API tests, 10 scenario evals
npm run test:e2e   # Backend workspace browser flows
npm run build:pages
npm run test:pages # Static website, reload recovery, layout, accessibility
```

If Chrome is unavailable, install Playwright Chromium with `npx playwright install chromium`, then run `CI=1 npm run test:e2e`. Browser tests run their own isolated in-memory database on port 4311 and require a current production build.

Coverage includes approval bypass attempts, stricter policy after approval, duplicate/concurrent execution, transient retry, restart recovery, cancellation during an in-flight model request, malformed model output, and transaction rollback. Scenario evaluations verify runtime behavior; they do not measure model reasoning quality.

CI runs the same build, tests, evaluations, and browser suite on Node 24. Docker configuration and live model requests have not been exercised in this development environment.

## Project map

```text
src/                 React workspace, website, styles, shared contracts
src/site/            Retro website and browser sandbox adapter
server/runtime.ts    State machine, approval gates, policy enforcement
server/store.ts      SQLite persistence and atomic ledger operations
server/provider.ts   Deterministic and optional model planners
server/app.ts        Validated HTTP boundary
server/evaluate.ts   Isolated scenario evaluation suite
tests/               Runtime, HTTP, and browser tests
docs/                Architecture, API, demo, screenshots
```

## Scope and next steps

This is a **single-operator local prototype**, with synthetic customer context and a local business ledger. It does not include authentication, tenant isolation, production connectors, distributed workers, vector search, arbitrary agent code execution, a general workflow editor, or a voice stack. It is not suitable for exposure as an unauthenticated public service.

An external refund API cannot share a SQLite transaction. A production connector needs an outbox, provider-supported idempotency, reconciliation, and compensation. The local ledger demonstrates the invariant under a single transactional boundary; it does not claim exactly-once external delivery. New missions receive distinct identities and are not deduplicated against each other by invoice.

Next engineering priorities are documented in the [architecture roadmap](docs/architecture.md#what-i-would-build-next).

## Why this project

Wonderful describes an enterprise platform centered on orchestration, permissions, knowledge, guardrails, and evaluations, and describes forward-deployed engineering as shipping agents around real customer workflows. This independent project explores those engineering concerns in a small, inspectable implementation. Sources: [Wonderful platform](https://www.wonderful.ai/), [Wonderful careers](https://www.wonderful.ai/careers), reviewed September 29, 2026.

Built by Riya Dadlani. This is an independent portfolio project, with no affiliation or endorsement from Wonderful.

MIT licensed.
