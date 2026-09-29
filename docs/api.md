# HTTP API

Base URL in local development: `http://127.0.0.1:4310/api`.

This local demo has no authentication. Do not expose it to the public internet. JSON request bodies are limited to 16 KB.

| Method | Route                | Purpose                                                      |
| ------ | -------------------- | ------------------------------------------------------------ |
| GET    | `/health`            | Runtime mode and configured planner name                     |
| GET    | `/state`             | Runs, last 200 events, ledger effects, policy, knowledge     |
| GET    | `/runs/:id`          | A mission and its complete ordered trace                     |
| POST   | `/runs`              | Create a validated mission; returns 201                      |
| POST   | `/runs/:id/decision` | Approve or reject a waiting action                           |
| POST   | `/runs/:id/cancel`   | Cancel before an effect is committed                         |
| PUT    | `/policy`            | Replace the complete workspace policy                        |
| GET    | `/live/config`       | Whether an optional server model is configured; no secrets   |
| POST   | `/live/complete`     | Proxy bounded structured generation for the local playground |

The public GitHub Pages playground does not call this API. It runs inference in a WebGPU worker. The optional `/live/complete` body contains `messages` (up to 25 role/content objects) and `allowedTools` (a nonempty subset of the six playground tools). It returns generated `content` and measured token usage, or 503 when not configured / 502 on provider failure. It never substitutes a deterministic response. The server injects the current structured-output schema, forwards to the environment-configured provider, and keeps its key off the client.

## Launch a mission

```bash
curl -X POST http://127.0.0.1:4310/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"customer":"Alex Morgan","issue":"Please refund the duplicate charge.","scenario":"refund","amountCents":24900,"faultOnce":false}'
```

`scenario` is `refund`, `replacement`, or `account`. Amounts are nonnegative integer cents. Amounts up to 10,000,000 cents can be submitted so the policy boundary can be demonstrated; refund execution has an independently enforced ceiling of 50,000 cents.

## Decide an approval

```bash
curl -X POST http://127.0.0.1:4310/api/runs/RUN_ID/decision \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approved"}'
```

Decisions are `approved` or `rejected`. Repeating a decision or deciding a mission that is not waiting returns 409. Approval resumes the existing run at its execution checkpoint.

## Change policy

```bash
curl -X PUT http://127.0.0.1:4310/api/policy \
  -H 'Content-Type: application/json' \
  -d '{"autoRefundLimitCents":10000,"hardRefundLimitCents":50000,"maxActions":12,"paused":false}'
```

Limits are inclusive: a $100 refund is automatic with the default settings, while $100.01 needs approval. Hard limit values cannot exceed $500. `maxActions` must be between 6 and 30. Replacements always need approval; account cases create a specialist handoff.

## Errors

The API returns `{ "error": "..." }`, with validation details where applicable. 400 indicates invalid input, 403 a disallowed browser origin, 404 a missing resource, 409 a state conflict, 413 an oversized body, and 429 a full active queue. Internal failures return a generic 500 response.
