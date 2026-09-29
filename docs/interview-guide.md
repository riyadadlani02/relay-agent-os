# Showing Relay OS in an interview

## The opening

“I built a small operating layer for customer-operation agents. I focused on the boundary between an agent proposing something and the system actually doing it: persistence, permissions, human review, idempotency, and evidence of the result.”

Describe this accurately as a portfolio prototype. Sample customers are fictional, the default planner is deterministic, and the connectors write a local sandbox ledger. Do not present it as deployed customer work or imply Wonderful helped build it.

## A five-minute walkthrough

**0:00 — Establish the operating view.** Show mission control, the six runtime services, and the pending approval queue. Explain that dashboard values are derived from stored runs and effects.

**0:45 — Run an autonomous workflow.** Launch a $49 refund. Follow the citation, structured plan, policy decision, ledger action, and verification.

**1:30 — Exercise judgment.** Launch a $249 refund. Show that no effect exists before approval. Approve the action and show the same mission resume.

**2:30 — Demonstrate a boundary.** Submit a $750 refund. It is blocked even if the customer asks the agent to ignore its instructions. Explain that the deterministic demo does not establish real-model prompt-injection robustness; the policy code is what enforces the hard ceiling.

**3:15 — Explain a failure.** Enable the transient connector failure. Show the retry key and the single ledger entry. Open the atomic transaction in `server/runtime.ts`.

**4:15 — Discuss tradeoffs.** Explain why a single-process SQLite runtime is easy to inspect, where it stops being sufficient, and what an outbox plus provider idempotency would add for real integrations.

## Be ready to answer

| Question                                          | Evidence to open                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| What happens after a restart?                     | Database reopen test and stored step cursor                                                 |
| Can an approval be replayed?                      | Decision state check and HTTP 409 test                                                      |
| What if policy changes after approval?            | Execution-time policy recheck test                                                          |
| Can the model choose an arbitrary tool?           | Closed action schema and scenario/action binding                                            |
| What if cancellation races with a model response? | Post-await persisted-state check                                                            |
| Is an external refund exactly once?               | No. Explain the local transaction boundary and external connector roadmap                   |
| How did you evaluate quality?                     | Runtime scenario evaluations are separate from model-quality evaluation                     |
| What would you ship next?                         | Identity, real connector semantics, and an operational pilot with explicit success criteria |

## Suggested repository description

“A durable operating layer for AI agents: policy-controlled workflows, human approvals, resumable execution, idempotent sandbox tools, and inspectable traces.”

## A concise application paragraph to adapt

I built Relay OS to explore the engineering behind dependable enterprise agents. It combines a TypeScript runtime with a React control plane, persisted approval gates, execution-time policy checks, retry-safe sandbox tools, and behavioral tests. The demo makes both autonomy and its boundaries visible. I would be excited to bring this approach to real customer workflows and learn from the deployment constraints at Wonderful.

Use your own voice and be ready to explain and modify the implementation. Add your role-specific experience and the repository link before sending an application.
