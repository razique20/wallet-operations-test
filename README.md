# IT Development Lead - Practical Assessment

**Timebox: 4 hours, including setup, investigation, implementation, tests and your review.** Prioritize the highest risks; a well-tested partial submission is acceptable. Explain unfinished work and why you deferred it. Do not rebuild the app from scratch.

AI assistance is allowed. Disclose significant assistance, including tools and the parts of your submission they helped produce. You remain responsible for explaining and validating your work. A supervised technical review will follow, including discussion of your decisions and a small live change.

## Start

```bash
docker compose up --build
```

- API docs: http://localhost:8000/docs
- Frontend: http://localhost:5173
- Demo user IDs: 1 and 2; demo balances: 100 and 250.
- Test from the backend container: `docker compose exec backend python -m pytest -q`
- API is deliberately insecure and intended for local assessment only. Never expose it to the internet.

## Your tasks

Suggested allocation: 20 minutes for setup and investigation, 75 backend, 35 frontend, 35 AI, 35 crypto, 25 leadership, and 15 final verification. Adjust this allocation to your priorities.

1. **Backend:** Ensure withdrawals preserve financial integrity under concurrency and retries, and transaction history remains usable as data grows. Identify two security or data integrity problems. Add meaningful tests.
2. **Frontend:** Improve transaction status freshness, detail view, loading and failure handling. Avoid wasteful requests.
3. **AI:** Protect account data, ground financial responses in authorized records, handle provider failure and reduce unnecessary provider calls. Mock AI is provided.
4. **Crypto:** Validate deposit evidence and prevent repeated crediting. Consider RPC outages and explain your approach to reorganizations. Mock blockchain provider is provided.
5. **Leadership:** Write `TECHNICAL_REVIEW.md` with top three risks, one architectural improvement, junior code-review feedback, production checks, and a rejected alternative.

## Observable requirements

### Account data and AI

- The current local user may access only their own account and transaction information, including transaction detail and AI requests. A user identifier supplied in an AI question or request body must not grant access to another account.
- The demo header is not production authentication. You may retain it as the local identity fixture if you clearly document its trust assumptions and a production authentication boundary. Enforce ownership relative to that identity throughout the backend. A full identity provider is outside the timebox.
- Financial answers must accurately reflect the caller's authorized stored records. Unsupported amounts, balances or statuses must not be presented as verified facts. Clearly distinguish generated explanation from verified financial information.
- Do not pass unrelated users' records or unnecessary private transaction references to the model. A question asking for transaction amounts and statuses should not require private reference identifiers in model context or output.
- Missing or unknown requested accounts must not silently expose another account. Provider failure must give a controlled, non-sensitive error or explicitly unavailable response. Repeated identical questions for unchanged records should avoid redundant provider work; explain how updates invalidate any reused answer.

### Simulated deposit policy

- Accept only successful Ethereum USDT transfers to `0xmerchant`, with at least **12 confirmations**. In this mock, the provider's token label represents token identity; explain how real token contracts and transfer events would be verified in production.
- The requested network must match the provider evidence and the accepted network. The requested positive amount must exactly match the provider transfer amount, with at most two decimal places.
- A blockchain transaction may credit at most one wallet once, including retries, different request references and simultaneous requests. Preserve agreement between wallet balances and completed transaction records.
- Reject unknown, failed, unsupported, underconfirmed or mismatched evidence without changing balances or recording completed deposits. RPC outages must not credit funds or expose provider details.
- Use the provided mock provider only. Reorganization handling is a design discussion and documented limitation; live-chain integration or a full reorganization processor is not required.

### Scope and verification

Keep the documented startup and build commands working. Support bounded, stable history navigation and describe your pagination contract. Use isolated synthetic data for tests. Explain your frontend refresh interaction (for example, a refresh control or automatic updates), and show distinct loading, empty and failure states. Equivalent designs are acceptable; no specific locking, authentication, caching or UI architecture is required.

## Deliverables

- Your complete changed source code and automated tests, with commits and a README describing execution/tests. If the supplied folder has no Git metadata, initialize a local repository before committing.
- `TECHNICAL_REVIEW.md` (concise).
- List unfinished work honestly.
- Be ready to explain a fix and make a small change live.

## Notes

- `X-User-Id` is a *deliberately untrusted demo header*, not real authentication. Identify the risk; implement a sensible local authentication boundary or clearly document how to enforce it in production.
- Local database credentials are test-only.
- Avoid real money, real keys, real blockchain connections, or paid LLM calls.
- Candidate implementations are assessed for correctness, reasoning, and tests, not feature count.
