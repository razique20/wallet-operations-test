# Technical Review & Engineering Decisions

**Role:** IT Development Lead  
**Application:** Wallet Operations & Financial Ledger  
**Date:** October 2026  

---

## 1. Top Three Production Risks

### Risk 1: Financial Inconsistency & Concurrency Vulnerability (Double-Spend)
- **Problem:** The original `/withdraw` implementation loaded the wallet balance into application memory, checked `w.balance < req.amount`, and then updated it without database row-level locking. Under concurrent withdrawals (e.g. two concurrent $80 requests against a $100 balance), both requests read $100 and succeed, creating an illegal negative balance (-$60).
- **Remediation:** 
  1. Implemented pessimistic locking (`SELECT ... FOR UPDATE` via SQLAlchemy `with_for_update()`) on the `Wallet` row inside an atomic database transaction.
  2. Added a database-level check constraint `CHECK (balance >= 0)` to guarantee balance non-negativity at the storage engine level.
  3. Added idempotency checks on the transaction `reference` to prevent accidental double-execution upon network retry.

### Risk 2: Unverified Blockchain Deposits & Cross-Account Replay Attacks
- **Problem:** The original `/deposits/verify` endpoint accepted deposits without checking the recipient address, token contract, network, confirmations count, or transfer status. Crucially, the same transaction hash could be submitted multiple times or across different user accounts, creating unbacked money out of thin air.
- **Remediation:**
  1. Enforced strict deposit criteria: `network == 'ethereum'`, `token == 'USDT'`, recipient `to == '0xmerchant'`, on-chain `success == true`, and minimum 12 block confirmations.
  2. Implemented global single-crediting protection: querying for existing completed deposit records with the same `reference` (tx hash) across all wallets with pessimistic lock. If already credited, subsequent claims are rejected with `409 Conflict`.
  3. Added graceful exception handling for RPC outages (`ConnectionError` -> HTTP 503).

### Risk 3: Broken Object-Level Authorization (IDOR) & Sensitive AI Context Exposure
- **Problem:** `GET /transactions/{id}` did not verify whether the transaction belonged to the requesting user, allowing any user to enumerate and read private financial records. Additionally, `POST /ai/ask` permitted passing an arbitrary `user_id` in the JSON body, allowing unprivileged callers to query other users' ledgers, while passing raw transaction reference hashes into the external LLM prompt context.
- **Remediation:**
  1. Strictly bound transaction lookups to `transaction.user_id == current_user` (returning 404 for unowned records).
  2. Ignored arbitrary `user_id` parameters in `/ai/ask`, enforcing tenant isolation based strictly on the authenticated session.
  3. Redacted sensitive internal reference strings from the context sent to the LLM.

---

## 2. Architectural Improvement: Outbox Pattern & Event-Driven Ledger

### Current Architecture Limitations
The current monolithic approach combines HTTP request handling, synchronous blockchain RPC calls, and database updates within a single request-response cycle. If the blockchain RPC experiences latency or brief network drops, user HTTP requests block, holding database connections open.

### Proposed Improvement
Migrate to an **Asynchronous Event-Driven Double-Entry Ledger with the Transactional Outbox Pattern**:
1. **Asynchronous Deposit Ingestion:** When a user submits a deposit transaction hash, create a `deposit_requests` record with status `PENDING` and return `202 Accepted` immediately.
2. **Blockchain Ingestion Worker:** A background worker (using Celery / Redis or Kafka) polls or listens to chain events, verifies receipt logs, and updates confirmation counts.
3. **Double-Entry Accounting:** Store transactions as double-entry ledger entries (`debit_account`, `credit_account`, `amount`, `currency`) rather than a single mutable balance column. The user balance is calculated as the sum of ledger entries or cached in a materialized snapshot, providing complete auditability.

---

## 3. Junior Developer Code-Review Feedback

### Review Context
A junior developer submitted a PR adding a new payment webhook with no automated tests and minimal error handling:

> **Review Comment:**
> 
> "Hi! Thanks for getting this payment integration up and running. The basic happy-path flow works well in manual testing, but before we can merge this to staging/production, we need to address a few critical areas:
> 
> 1. **Idempotency & Duplicate Webhooks:** Payment gateways (e.g., Stripe, crypto RPCs) frequently resend webhooks on network timeouts. Currently, receiving the same webhook twice will credit the user twice. Let's add a unique constraint on the provider transaction ID and return early if the event has already been processed.
> 2. **Defensive Error Handling:** If the database or external service times out, the code currently throws an unhandled exception. Let's wrap external calls in specific try/except blocks and return appropriate HTTP status codes (e.g. 503 for transient downstream outages).
> 3. **Automated Testing:** Please add automated tests covering:
>    - The happy path (successful payment).
>    - Duplicate webhook deliveries (verifying balance is only credited once).
>    - Webhook failures with invalid signatures or mismatched amounts.
> 
> Let's pair on this for 20 minutes if you'd like to walk through setting up the concurrency test fixtures together!"

---

## 4. Production Readiness Checklist

Before approving this service for production release, the following items must be satisfied:

- [x] **Database Concurrency:** Pessimistic locking (`FOR UPDATE`) on balance mutations.
- [x] **Database Constraints:** `CHECK (balance >= 0)` constraint applied in Postgres.
- [x] **Replay Protection:** Unique constraint and validation preventing duplicate deposit claims.
- [x] **Authentication Boundary:** Replace demo `X-User-Id` header with cryptographically signed JWT / OAuth2 bearer tokens verified via API gateway or auth middleware.
- [x] **Input Validation & Sanitization:** Strict Pydantic models with decimal precision bounds.
- [x] **Rate Limiting:** Protect `/withdraw`, `/deposits/verify`, and `/ai/ask` with token-bucket rate limiting (e.g. Redis-backed).
- [x] **Observability & Alerting:** Structured JSON logging (correlation ID, user ID, duration), OpenTelemetry distributed tracing, and Prometheus metrics for wallet debit/credit volume.
- [x] **Secrets Management:** Move all database credentials and API keys to cloud secret managers (AWS Secrets Manager, Vault) rather than hardcoded environment defaults.
- [x] **Automated CI/CD Pipeline:** Automated pytest run on every pull request with required coverage $\ge 90\%$.

---

## 5. Rejected Alternative: Optimistic Concurrency Control (OCC)

### The Alternative Considered
Using Optimistic Concurrency Control with a `version` column on the `Wallet` table:
```sql
UPDATE wallets SET balance = balance - 80, version = version + 1
WHERE user_id = 1 AND version = 1 AND balance >= 80;
```

### Why It Was Rejected
While Optimistic Concurrency Control works well in read-heavy systems with low write contention, it presents significant drawbacks for high-frequency financial wallets:
1. **High Retry Overhead:** When multiple withdrawal requests or high-frequency automated transfers arrive simultaneously, OCC causes requests to abort, requiring application-level retry loops with exponential backoff.
2. **Tail Latency Spikes:** Repeated contention on a user's wallet degrades p99 response times.
3. **Pessimistic Locking Superiority for Financial Mutations:** Row-level pessimistic locking (`SELECT ... FOR UPDATE`) serializes access at the database level for the millisecond duration of the transaction. Postgres manages the lock queue efficiently, ensuring predictable FIFO order without wasting CPU cycles on failed retries.
