# Relay OS: from a refund request to a controlled action

This is an independent engineering case study using a fictional audio retailer, **not a customer deployment**. The design brief is a support queue where customers ask for refunds, replacements and account help over text or speech.

## Discovery questions

Before integrating a real customer, I would sit with support and finance to answer: which record is authoritative for the amount and customer? What does “approved” mean, and who can approve? How often does a timeout leave an action’s outcome uncertain? Which requests require a human regardless of amount? How do staff discover a duplicate or wrong-customer action today?

For this prototype the answers are explicit: an order record supplies the refund amount; a typed order ID scopes a request; $100 is the autonomous limit; $500 is the ceiling; every replacement requires review. The separate Razorpay integration uses **INR**, a ₹49 test fixture and human approval for every external test refund. There is no implicit USD/INR conversion.

## What I built and why

The model chooses from a small tool contract. The runtime reads the order, retrieves policy, checks permission and verifies the result. A fluent answer is not a transaction receipt. Qwen is the no-key browser option; GPT-4.1 mini and GPT-5.4 were exercised through the same playground kernel.

The SQLite runtime commits each **local** effect with its audit event and checkpoint. Browser sessions use IndexedDB. An external processor cannot join either transaction, so the Razorpay connector first persists a refund intent, then sends its fixed amount with a stable provider idempotency key. A lost response becomes `unknown`, not “failed”; reconciliation uses that same intent.

The connector applies trusted entity binding, integer minor-unit checks, currency checks and terminal-action readback. Identifiers come from an order created by this server and subsequently verified from Razorpay, never from a payment ID buried in a model response or customer note.

Voice treats a pause as unreliable permission to end a caller’s thought, so browser capture waits for an explicit finish/review step. The local path uses Deepgram recognition. A synthetic Hindi request was transcribed and passed into Relay after reviewing its order ID. This is an audio-to-action path; it is not a deployed phone line or a calibrated turn detector.

## What I chose not to automate

- Identity and account-access decisions, exceptions, all replacements and refunds above the autonomous limit.
- Human approval itself, including a model claiming a manager has already approved.
- The normalization of an uncertain spoken order ID into authorization. The transcript is editable and reviewed before submission.
- A second refund after an uncertain processor result. Recover the original intent instead.
- Live money movement, production messaging or tenant access. These need authenticated operators and customer-owned credentials.

## Evidence changed the implementation

The first 240 hosted-model requests produced no unauthorized mutations but exposed 30 missing-order failures: the factuality checker treated the requested order number as unsupported when lookup returned no row. The fix returns the requested identifier as part of the lookup evidence. Both the first report and the rerun are published. Unnecessary handoffs remain visible rather than being relabeled as successes. See [the evaluation report](evaluation.md).

The [payment integration notes](payments.md) distinguish successful real test-order creation from the refund lifecycle covered by controlled transport tests. The [voice evidence](voice.md) includes the synthetic audio, raw recognition output, visible review edit and actual model/tool trace.

## Rollout with a customer

1. **Discover and instrument:** agree on policy owners and invariants; map customer, order and payment identifiers; measure the current queue’s handling time, rework and escalation reasons.
2. **Shadow:** replay a consented, de-identified sample. Propose actions without writes. Review every disagreement with support and finance. Measure task outcomes as well as policy violations, including per-language slices.
3. **Assisted pilot:** authenticated operators approve every action. Reconcile provider state daily. Investigate every unknown result, duplicate and wrong-entity proposal.
4. **Small autonomy:** allow only the agreed low-risk slice with a spend cap, queue limit, kill switch and immediate escalation. Keep voice readback for identifiers and amounts.
5. **Expand only on evidence:** define acceptance thresholds with the customer. Zero observed policy violations is a release requirement, not a claim that future violations are impossible. Track p50/p95 latency, correct resolution, approval workload, reconciliation age and caller correction rates.

Before any production rollout: tenant-bound authentication, role-based approvals, signed webhook handling, durable background reconciliation, alerting, data retention rules and operational ownership. The prototype is a single-operator localhost application; GitHub Pages hosts only the browser sandbox and published evidence.
