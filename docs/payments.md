# Razorpay test connector

Run `npm run dev` and open **http://127.0.0.1:5173/?payments=1**. Configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`. The connector refuses a key that does not begin with `rzp_test_`. GitHub Pages never receives these keys or calls this local API.

The dedicated INR workflow creates a **₹49.00 / 4,900 paise** synthetic order, opens Razorpay test checkout, verifies the captured payment from the server, asks the configured planner to propose a refund, and presents an exact readback for operator approval. This does not reinterpret the browser demo’s USD orders as INR.

## Verification status

**Verified against Razorpay:** authenticated creation of a real test-mode order, with the provider’s order ID, INR currency and integer amount in [the published provider evidence](../public/evidence/payments.json).

**Not yet verified against Razorpay:** captured payment and refund completion. The provider checkout frame remained blank in Chrome and Codex’s in-app browser during verification. No payment was fabricated and no refund receipt is claimed. The local UI can continue the same order when checkout is available.

**Covered by controlled transport tests:** refusing live keys; binding the payment to its trusted order; detecting 100×/0.01× amount errors, wrong entities, uncaptured/already-refunded payments; requiring approval; rejecting mismatched provider receipts; stable idempotency after a lost response and service restart; rejection remaining terminal. These are connector tests, not live processor results.

## Boundary and recovery

The model provides intent, never a payment ID, amount, currency or approval bit. A fixture created by the server is matched against the processor’s order/payment records. These checks cover unit sanity, trusted entity binding and readback in a small TypeScript implementation; they are not a complete payment-safety test corpus.

Every external test refund requires a human readback approval. The service writes its intent and audit event in one SQLite transaction, then submits the stored amount with Razorpay’s `X-Refund-Idempotency` header. Provider effects and local state **cannot** share a transaction. Unknown results are persisted and reconciled with the same key and identical body. A matching provider response is required before displaying `processed`; a mismatched receipt remains `unknown`.

A local unique constraint permits one refund intent per payment. The connector supports full INR refunds only, capped at ₹500, and at most three synthetic fixtures in this prototype. Live keys, arbitrary payment IDs, partial refunds and model-supplied amounts have no UI/API path.

There is no production claim: no multi-tenant authentication, signed webhook endpoint, distributed leasing or automatic reconciliation worker. Reconciliation is an explicit local operator action. Do not expose this local server as a public unauthenticated payment service.

References: [Razorpay idempotent normal refunds](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent), [test checkout](https://razorpay.com/docs/server-integration/python/test-app/), [source](../server/connectors/payment-service.ts), [boundary tests](../tests/payments.test.ts).
