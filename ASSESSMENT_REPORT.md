# IT Development Lead Assessment — Implementation & Audit Report

**Candidate Submission & Technical Investigation Log**  
**Repository:** `candidate` (Wallet Operations Assessment)  
**Last Updated:** 2026-10-27  

---

## 1. Executive Summary & Activity Timeline

This document tracks all investigations, architectural findings, code modifications, security fixes, and test results chronologically throughout the assessment.

| Step | Component | Status | Description |
| :--- | :--- | :--- | :--- |
| **01** | **Repository & Git Setup** | Completed | Initialized local Git repository (`git init`) and committed pristine starter boilerplate. |
| **02** | **Environment Bring-up** | Completed | Resolved port 8000 conflict (orphaned process). Verified Docker Compose services (`db`, `backend`, `frontend`). |
| **03** | **Interactive Baseline Verification** | Completed | Verified baseline endpoints (`/wallet`, `/withdraw`, `/deposits/verify`). Tested frontend at `http://localhost:5173`. |
| **04** | **Vulnerability Discovery & Reproduction** | Completed | Confirmed live duplicate-crediting vulnerability (reproduced in frontend where `0xgood` was credited twice). |
| **05** | **Backend Concurrency & Idempotency Fixes** | In Progress | Implementing pessimistic row locking (`FOR UPDATE`) and idempotency constraints. |
| **06** | **Crypto Deposit Policy Enforcement** | Pending | Enforcing USDT, 12 confirmations, recipient, amount match, and replay prevention. |
| **07** | **Authorization & AI Privacy Fixes** | Pending | Resolving IDOR in transaction details and eliminating cross-tenant AI queries. |
| **08** | **Pagination & Database Optimization** | Pending | Implementing cursor/offset pagination and database indexing on transactions. |
| **09** | **Frontend UX & Live State Polish** | Pending | Adding auto-refresh, loading/empty states, currency formatting, and user switching. |
| **10** | **Automated Test Suite Expansion** | Pending | Pytest unit and integration tests covering all failure modes. |
| **11** | **Technical Review & Questionnaire (Parts A-G)** | Pending | Finalizing formal answers for submission. |

---

## 2. Identified Vulnerabilities & Technical Issues

### Issue 1: Financial Race Condition & Overdraft on Concurrent Withdrawals
- **File:** `backend/app/main.py` (`/withdraw`)
- **Vulnerability:** Balance check and deduction occur in memory without row-level locking.
- **Impact:** Two simultaneous $80 withdrawals on a $100 balance both succeed, resulting in a -$60 balance (Double-spending).
- **Reproduction:** Submit two concurrent HTTP POST requests to `/withdraw`.
- **Planned Fix:** Enforce `SELECT ... FOR UPDATE` via SQLAlchemy (`with_for_update()`) inside an ACID database transaction.

### Issue 2: Duplicate Request Processing (Missing Idempotency)
- **File:** `backend/app/main.py` (`/withdraw` & `/deposits/verify`)
- **Vulnerability:** No uniqueness constraint on request `reference` or transaction identifiers.
- **Impact:** Network timeouts or user double-clicks deduct or credit funds multiple times.
- **Reproduction:** Demonstrated live in frontend UI where submitting `0xgood` twice credited User 1 balance twice ($50 + $50).
- **Planned Fix:** Add unique constraint / idempotency registry checking prior to state mutation.

### Issue 3: Insecure Crypto Deposit Policy & Replay Attacks
- **File:** `backend/app/main.py` (`/deposits/verify`)
- **Vulnerability:** Missing verification of recipient address, token contract, confirmation threshold, execution status, and transfer amount match.
- **Impact:** Attackers can claim deposits made to other addresses, claim fake tokens, credit under-confirmed/reorg-prone blocks, or reuse one tx hash across multiple accounts.
- **Planned Fix:** Enforce strict policy: `token == 'USDT'`, `network == 'ethereum'`, `to == '0xmerchant'`, `confirmations >= 12`, `success is True`, `amount == tx.amount`, and global single-crediting check.

### Issue 4: Broken Object-Level Authorization (IDOR)
- **File:** `backend/app/main.py` (`/transactions/{transaction_id}`)
- **Vulnerability:** `GET /transactions/{id}` retrieves any transaction by ID without checking `t.user_id == current_user`.
- **Impact:** Any user can inspect any other customer's private financial records by enumerating transaction IDs.
- **Planned Fix:** Restrict queries to filter by `Transaction.user_id == user_id` and return 404 for unauthorized access.

### Issue 5: AI Data Leakage & Unchecked Provider Failure
- **File:** `backend/app/main.py` (`/ai/ask`)
- **Vulnerability:** 
  1. Accepts arbitrary `user_id` in request body (`target = req.user_id or user_id`), allowing callers to inspect other users' balances.
  2. Passes internal private references to the LLM context.
  3. No timeout/error handling when provider raises `TimeoutError` (`MOCK_LLM_FAIL=1`).
- **Impact:** Cross-account data leaks and unhandled 500 service crashes.
- **Planned Fix:** Disallow overriding `user_id`, sanitize LLM context (remove private references), add exception handling with fallback messaging and caching.

### Issue 6: Unbounded Queries & Database Scalability
- **File:** `backend/app/main.py` (`/transactions`)
- **Vulnerability:** Performs full table scan `order_by(Transaction.created_at.desc()).all()` with no limit or pagination.
- **Impact:** As the database reaches millions of records, this endpoint will cause DB CPU spikes, memory exhaustion, and connection timeouts.
- **Planned Fix:** Implement pagination (`limit`, `offset` / `cursor`) and composite index on `(user_id, id DESC)`.

---

## 3. Log of Modifications & Code Changes

*(This section will be appended with exact file diffs and rationales as each fix is implemented.)*

---
