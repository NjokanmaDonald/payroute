# PayRoute — Written Analysis

---

## Schema Design Document

### 1. Why this structure over alternatives considered

The central design decision was **separating account identity from account balances**. A single `accounts` table with currency columns (e.g., `ngn_balance`, `usd_balance`) is the first instinct but fails immediately when adding new currencies — it requires schema migrations in production. Instead, the `account_balances` table uses a `(account_id, currency)` composite unique key, making new currency support a data operation, not a schema change.

The second major decision was the `locked_balance` column alongside `balance`. Some designs use a single balance and rely on the sum of pending ledger entries to compute available funds. That approach requires a correlated subquery on every balance check, is slow at scale, and makes the "can this payment proceed?" check non-atomic. The explicit `locked_balance` field lets us do a single row read with `FOR UPDATE`, check `balance >= requested_amount`, and deduct atomically — no race condition possible. The `locked_balance` is then released on settlement or reversal.

The `idempotency_keys` table stores the full serialized response. An alternative — storing only the transaction ID and re-fetching — fails if the original request errored before creating a transaction, because we would have nothing to re-fetch. Storing the full response handles all cases uniformly.

For the status timeline, I chose a separate `transaction_status_history` table over a JSON array column on `transactions`. JSON arrays cannot be independently indexed, queried, or streamed. A separate table lets us query "all transitions to failed in the last hour" without scanning every transaction.

### 2. How we ensure no money is created or destroyed

Every balance change creates exactly two ledger entries that mirror each other:

- **Payment initiation**: DEBIT sender NGN (amount is negative), CREDIT system float NGN (positive). Net ledger impact: zero.
- **Settlement**: DEBIT system float NGN (negative, releasing the held amount), CREDIT recipient destination currency (positive). Net impact on total money in system: zero — we treat FX conversion as a restatement, not creation.
- **Reversal**: CREDIT sender NGN back (positive), DEBIT system float NGN (negative). Again, net zero.

The database enforces this with:
1. A `CHECK (balance >= 0)` constraint on `account_balances` — if a bug causes an overdraft, the database rejects it.
2. All ledger writes and balance updates happen inside a single `BEGIN/COMMIT` block, so partial application is impossible.
3. The `FOR UPDATE` row lock on the balance row before reading it guarantees that the balance check and the deduction are atomic under concurrent load.

An audit query to verify integrity: `SELECT SUM(amount) FROM ledger_entries` should always be zero if the system is correct.

### 3. How to handle adding a new currency pair in production

Adding e.g. KES (Kenyan Shilling) requires zero schema migrations:

1. Add the rate to the `RATES` map in `fxService.js` (or the live rate provider config).
2. Insert a `(system_account_id, 'KES', 0)` row into `account_balances` for the float account.
3. The `fx_quotes` table already stores `source_currency` and `destination_currency` as free-text CHAR(3) columns — no enum constraint to alter.
4. Deploy and test.

For production safety: wrap step 1 behind a feature flag, run in a staging environment first with live rate data, and add a monitoring alert for the new pair's settlement volumes. The `account_balances` CHECK constraint means the new currency can only go negative if there's a bug, which it will catch loudly.

### 4. One thing I would do differently with more time

I would replace the `balance` + `locked_balance` columns with a pure ledger-derived model and use a **materialized view** for the current balance. In the current design, the balance columns are a denormalized cache of the ledger. If a bug writes a ledger entry but fails to update the balance column (e.g., a crash mid-transaction), they diverge. With more time I would make `account_balances` a materialized view computed as `SUM(amount) GROUP BY account_id, currency` from `ledger_entries`, refreshed transactionally. Balance becomes a derived fact, not a stored one — impossible to corrupt. The tradeoff is that real-time balance reads require aggregating ledger entries, which is why I chose the simpler denormalized approach for this prototype.

---

## Part 4A: Code Review — Junior Developer's Webhook Handler

### Issue 1: Signature is checked for presence but never verified

**What**: The code checks `if (!signature)` but never computes or compares the expected HMAC value. Any string passes.

**Why it matters in payments**: This means anyone who knows the endpoint URL can forge a webhook — fake a "completed" status and credit an account without any real payment being processed. This is a direct money-loss vulnerability.

**Fix**:
```js
const expected = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(rawBody)  // must use raw buffer, not parsed body
  .digest('hex');

if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  return res.status(401).send('Invalid signature');
}
```
Note: `timingSafeEqual` is required to prevent timing attacks that could leak the secret by measuring response time.

### Issue 2: `req.body` is used for HMAC but has already been parsed by Express JSON middleware

**What**: If `express.json()` middleware runs before this handler, `req.body` is a JavaScript object, not the raw bytes. Re-stringifying it (`JSON.stringify(req.body)`) may produce different whitespace/key ordering than the original payload, making the HMAC comparison fail even for legitimate webhooks — and succeed for crafted payloads that match the re-serialized form.

**Why it matters**: The signature must be computed over the exact bytes received on the wire. Using a parsed+re-serialized body breaks the security contract.

**Fix**: Register the webhook route before `express.json()`, or use `express.raw({ type: '*/*' })` specifically for this endpoint, and pass the raw buffer to the HMAC function.

### Issue 3: Returns 404 for unknown transaction references

**What**: `if (!transaction.rows[0]) return res.status(404).send(...)`.

**Why it matters**: Payment providers treat 4xx responses (except 401/403) as "your fault — I'll retry". The provider will retry the webhook repeatedly for hours, hammering the endpoint. Additionally, unknown references are legitimate: they may come from a prior deployment, a test transaction, or a race condition. They should be silently acknowledged, not treated as errors.

**Fix**: Return `200 OK` for unknown references and log them. This is what every major payment provider's documentation explicitly requires.

### Issue 4: No transaction atomicity — two separate queries with no BEGIN/COMMIT

**What**: The status update and balance update are separate `await db.query()` calls. If the process crashes, throws, or the DB connection drops between them, the transaction status is updated but the balance is not (or vice versa).

**Why it matters**: This is the most dangerous bug in the handler. In the `completed` case, a crash after updating status but before crediting the recipient means money is lost — the payment shows complete but no credit occurred. In the `failed` case, the reverse: the status is failed but the sender's balance is not returned. Money disappears.

**Fix**: Wrap all related writes in a single `BEGIN / COMMIT` block:
```js
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE transactions ...');
  await client.query('UPDATE accounts ...');
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
}
```

### Issue 5: No idempotency check — processing the same webhook twice double-credits

**What**: There is no check whether this transaction has already been processed. If the provider retries the webhook (common — providers retry on any non-2xx, timeouts, and sometimes even after receiving 200), the balance is credited twice.

**Why it matters**: A completed payment retried 3 times = recipient credited 3x. This is direct financial loss.

**Fix**: Before processing, re-fetch the transaction with `FOR UPDATE` and check whether it's already in the target status. If `transaction.status === incomingStatus`, it's a duplicate — return 200 without applying changes.

### Issue 6: No validation of state transitions

**What**: The code applies `completed` or `failed` regardless of the current transaction status. A `completed` webhook for an already-`failed` transaction would re-credit the recipient.

**Why it matters**: Out-of-order webhook delivery is common in distributed systems. A provider may send `failed` then later (due to retry logic) send `completed`. Blindly applying both causes incorrect state.

**Fix**: Enforce a valid transition table:
```js
const VALID_TRANSITIONS = { processing: ['completed', 'failed'] };
if (!VALID_TRANSITIONS[tx.status]?.includes(payload.status)) {
  return res.status(200).send('OK'); // acknowledged, ignored
}
```

### Issue 7: Balance is credited from `payload.amount` (untrusted input), not from the transaction record

**What**: `UPDATE accounts SET balance = balance + $1 WHERE id = $2` uses `payload.amount` — a value from the incoming webhook body — not the `source_amount` or `destination_amount` stored in the transaction record when the payment was initiated.

**Why it matters**: An attacker who can forge a webhook (see Issue 1) can set `payload.amount` to any value. But even with a legitimate provider, using their amount rather than your own record means you are trusting an external party for the authoritative figure of how much to credit — a financial systems anti-pattern. The authoritative amount is what your system locked at initiation.

**Fix**: Credit `transaction.rows[0].destination_amount` (the amount stored when the payment was created), never `payload.amount`.

### Issue 8: No raw event logging

**What**: The webhook is processed without any audit trail of the raw incoming event.

**Why it matters**: If processing fails, is disputed, or needs to be replayed, there is no record. Regulatory requirements in financial services typically mandate logging all inbound events regardless of processing outcome.

**Fix**: Write the raw headers and body to a `webhook_events` table as the very first operation, before any processing logic runs.

---

## Part 4B: Failure Scenarios

### 1. Double-spend: two concurrent POST /payments for the same account

**How this implementation handles it**: The payment service begins a database transaction and immediately issues `SELECT ... FOR UPDATE` on the sender's `account_balances` row. PostgreSQL serializes all concurrent `FOR UPDATE` locks on the same row — the second concurrent request will block at the lock acquisition until the first commits or rolls back. Once the first request commits (and the balance is reduced), the second request reads the updated balance, finds it insufficient, and returns a 422. This is enforced at the database level, not the application level, so it holds even under multi-instance deployments.

See [backend/src/services/paymentService.js](backend/src/services/paymentService.js) — the `FOR UPDATE` lock on `account_balances`.

### 2. Webhook arrives before the POST /payments response is written

**What happens**: The downstream provider is called inside the database transaction, before commit. If the provider's webhook arrives before `COMMIT` completes (theoretically possible with very fast providers), the webhook handler will query for `provider_reference` and find no matching transaction, because the transaction row hasn't been committed yet. The handler logs this as an unknown reference and returns 200.

**What prevents money loss**: The provider will retry the webhook. By the time the retry arrives (typically seconds to minutes later), the original `POST /payments` transaction has committed and the transaction row exists. The retry is processed normally.

**What I would add with more time**: A short retry/backoff loop in the webhook handler for the `provider_reference` lookup, to handle the narrow race window more gracefully rather than relying on provider retries.

### 3. FX rate stale: user waits 10 minutes then confirms

**How this implementation handles it**: FX quotes have a 30-second TTL stored in `fx_quotes.expires_at`. The `validateQuote()` function checks `expires_at < NOW()` and throws `"FX quote has expired"`. The UI displays a live countdown timer and automatically fetches a new quote if the user delays.

**What the system does**: Returns a 422 with a clear message. The user must re-confirm with the new rate. This protects both the client (from paying more than expected) and PayRoute (from absorbing a 3% FX loss on a locked rate).

**Design note**: The 30-second TTL is deliberately tight. In production this would be configurable and tied to the spread — a wider spread tolerates longer TTLs.

### 4. Partial settlement: payment completed but recipient's bank rejects the credit 2 days later

**How to model this**: This requires a new transaction status: `partially_reversed` or a separate reversal transaction linked to the original. The correct approach in double-entry terms is to create a new reversal transaction referencing the original `transaction_id`. This new transaction would:

1. Debit the recipient's destination-currency balance (taking back the credited amount)
2. Credit the system float for the destination currency
3. Decide whether to refund the sender in NGN (at current FX rate, not original) or hold in a suspense account pending investigation

The original transaction remains `completed` to preserve the audit trail — it was completed from PayRoute's perspective. The reversal is modelled as a separate financial event, not a mutation of history. The `transaction_status_history` table would record the reversal event with a link to the original.

**Current implementation gap**: This is not implemented in the prototype. It would require an operations endpoint to trigger manual reversals and a new `reversal_transactions` table or a `parent_transaction_id` foreign key.

### 5. Provider timeout: HTTP call times out after 30 seconds

**What the implementation currently does**: The `submitPayment()` call in `paymentService.js` is inside the database transaction with a savepoint (`SAVEPOINT before_provider`). If it throws (including a timeout error), the savepoint rolls back the provider call but the outer transaction is also rolled back entirely, restoring the sender's balance.

**The core problem**: A timeout means you don't know if the provider received the request. The payment may be in-flight at the provider. Rolling back silently means you could have a payment processing at the provider with no local record.

**What should happen**:
1. On timeout, write the transaction in a new `submitted_unknown` status (not `processing`, not `failed`).
2. Keep the funds locked.
3. Start a background reconciliation job that polls the provider's "check payment status" API using the idempotency key you sent them.
4. Once the provider confirms receipt or non-receipt, transition accordingly.
5. If the provider has no record after N retries, mark as failed and reverse.

The idempotency key sent to the provider is critical here — it allows the provider to deduplicate if the original request did arrive and you're re-querying.

---

## Part 4C: Production Readiness

### 1. Distributed locking and advisory locks for idempotency

**Why it matters**: The current idempotency check (SELECT → check → INSERT) has a TOCTOU race condition under concurrent requests with the same key. Two requests can both pass the SELECT check before either inserts. The `ON CONFLICT DO NOTHING` prevents duplicate DB rows, but both requests may have already proceeded to execute the payment logic.

**Implementation**: Use PostgreSQL advisory locks keyed on the idempotency key's hash: `pg_try_advisory_xact_lock(hashtext(idempotency_key))`. This acquires a session-level lock within the transaction. The second concurrent request with the same key will fail to acquire the lock and can retry after a short delay, by which point the first request has committed and the idempotency key is in the table.

**Failure mode prevented**: Duplicate payments from concurrent client retries (e.g., a client that double-clicks submit, or a network retry that overlaps with the original).

### 2. Dead-letter queue and webhook replay infrastructure

**Why it matters**: Webhooks can fail to process due to bugs, DB overload, or deployment issues. The current implementation logs failures in `webhook_events` but has no automated retry mechanism. Failed webhooks mean payments stuck in `processing` indefinitely and funds locked forever.

**Implementation**: Add a background worker (e.g., Bull queue backed by Redis, or a simple polling job) that queries `webhook_events WHERE processing_status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'` and replays them with exponential backoff. After N retries, escalate to an ops alert. The raw body in `webhook_events` is exactly what's needed for replay.

**Failure mode prevented**: Permanent fund lock due to transient processing failures. Regulatory non-compliance from missing settlement records.

### 3. Structured logging, distributed tracing, and payment-specific alerting

**Why it matters**: "Add monitoring" is not enough. In payments you need to know: what is the p99 latency of `POST /payments`? What percentage of webhooks are failing to process? What is the current volume of funds in `locked_balance` that have been there for more than 1 hour (potential stuck payments)?

**Implementation**:
- Replace `console.log` with a structured logger (Pino/Winston) emitting JSON with `transaction_id`, `provider_reference`, `amount`, and `currency` on every log line — so you can filter in Datadog/Grafana by transaction.
- Add distributed trace IDs (`x-trace-id` header) propagated from the client through to DB queries.
- Specific alerts: (a) `locked_balance` sum unchanged for >2 hours → stuck payment, (b) webhook `processing_status = 'failed'` rate >1% → provider issue, (c) `POST /payments` error rate >0.1% → service degradation.

**Failure mode prevented**: Silent money stuck in processing. Inability to diagnose provider issues. SLA breaches going undetected.

### 4. Row-level encryption for sensitive fields and secrets rotation

**Why it matters**: `recipient_name`, `recipient_account_number`, and transaction amounts are PII/PCI-scoped data. A DB compromise (SQL injection, misconfigured RDS snapshot) exposes all of it. The `WEBHOOK_SECRET` is currently a static environment variable — if it leaks, all webhook signatures are forgeable forever.

**Implementation**:
- Encrypt PII columns at the application layer using AES-256-GCM before writing to DB. Store the encryption key in a secrets manager (AWS KMS, HashiCorp Vault), not in environment variables. This way a DB dump without the key is useless.
- For `WEBHOOK_SECRET`: store in Vault with automatic 90-day rotation. The backend fetches it on startup and caches with TTL. Implement a grace period where both old and new secrets are accepted during rotation.

**Failure mode prevented**: PCI DSS non-compliance, regulatory fines, reputational damage from data breach. Forged webhooks after secret compromise.

### 5. Reconciliation job: compare internal ledger against provider settlement reports

**Why it matters**: The provider is the source of truth for whether funds moved. Our DB is our source of truth for what we expect. These can diverge due to bugs, provider errors, or fraud. Without reconciliation, you won't know until a client complains — by which point the discrepancy may involve significant sums.

**Implementation**:
- Daily batch job that downloads the provider's settlement report (CSV/API).
- For each entry in the provider report, find the matching `provider_reference` in our DB.
- Flag discrepancies: (a) provider says completed, we say processing — stuck webhook, (b) provider says failed, we say completed — potential double-settlement, (c) provider says completed, we have no record — orphaned payment.
- Write discrepancies to a `reconciliation_exceptions` table and alert the ops team.
- For category (a), auto-trigger a compensating webhook replay. For (b) and (c), escalate to manual review only — never auto-correct balance discrepancies without human approval.

**Failure mode prevented**: Undetected fund loss, double payments, regulatory reporting errors, fraud going unnoticed for extended periods.
