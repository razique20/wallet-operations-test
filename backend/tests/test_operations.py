import os
import pytest
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.models import Wallet, Transaction

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    """Ensure clean test baseline for users 1 and 2."""
    with SessionLocal() as db:
        # Reset user 1 to 100, user 2 to 250
        w1 = db.query(Wallet).filter(Wallet.user_id == 1).first()
        if not w1:
            w1 = Wallet(user_id=1, balance=Decimal('100.00'))
            db.add(w1)
        else:
            w1.balance = Decimal('100.00')

        w2 = db.query(Wallet).filter(Wallet.user_id == 2).first()
        if not w2:
            w2 = Wallet(user_id=2, balance=Decimal('250.00'))
            db.add(w2)
        else:
            w2.balance = Decimal('250.00')

        # Clean existing test transactions
        db.query(Transaction).delete()
        db.commit()
    yield

# ==============================================================================
# 1. CONCURRENCY & FINANCIAL INTEGRITY TESTS
# ==============================================================================
def test_withdrawal_standard():
    """Standard single withdrawal succeeds and deducts funds."""
    res = client.post(
        "/withdraw",
        headers={"X-User-Id": "1"},
        json={"amount": 40.00, "reference": "ref-w-std"}
    )
    assert res.status_code == 200
    assert res.json()["balance"] == 60.0
    assert res.json()["status"] == "completed"

def test_withdrawal_insufficient_funds():
    """Withdrawal exceeding balance is rejected."""
    res = client.post(
        "/withdraw",
        headers={"X-User-Id": "1"},
        json={"amount": 150.00, "reference": "ref-w-over"}
    )
    assert res.status_code == 400
    assert "Insufficient funds" in res.json()["detail"]

def test_concurrent_withdrawals_prevent_double_spend():
    """
    Financial Concurrency Guarantee:
    Balance starts at $100. Two concurrent withdrawal requests of $80 are submitted simultaneously.
    Under row-level locking (SELECT ... FOR UPDATE), exactly ONE must succeed ($20 remaining),
    and the other MUST fail with 400 Insufficient funds.
    Balance must NEVER become negative (-$60).
    """
    def send_withdraw(ref_id: str):
        # Dedicated client call
        return client.post(
            "/withdraw",
            headers={"X-User-Id": "1"},
            json={"amount": 80.00, "reference": ref_id}
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(send_withdraw, "conc-ref-1")
        f2 = executor.submit(send_withdraw, "conc-ref-2")
        r1 = f1.result()
        r2 = f2.result()

    statuses = [r1.status_code, r2.status_code]
    assert 200 in statuses, "One withdrawal must succeed"
    assert 400 in statuses, "One withdrawal must fail due to insufficient funds"

    # Verify final balance is strictly $20.00
    w_res = client.get("/wallet", headers={"X-User-Id": "1"})
    assert w_res.json()["balance"] == 20.0

def test_withdrawal_idempotency_retry():
    """Submitting the exact same withdrawal reference again returns 200 without deducting twice."""
    r1 = client.post(
        "/withdraw",
        headers={"X-User-Id": "1"},
        json={"amount": 30.00, "reference": "idemp-ref-001"}
    )
    assert r1.status_code == 200
    assert r1.json()["balance"] == 70.0
    assert r1.json()["idempotent"] is False

    # Retry same request
    r2 = client.post(
        "/withdraw",
        headers={"X-User-Id": "1"},
        json={"amount": 30.00, "reference": "idemp-ref-001"}
    )
    assert r2.status_code == 200
    assert r2.json()["balance"] == 70.0  # Balance was NOT deducted again
    assert r2.json()["idempotent"] is True

# ==============================================================================
# 2. CRYPTO DEPOSIT POLICY TESTS
# ==============================================================================
def test_deposit_valid_0xgood():
    """Valid ethereum USDT transfer to 0xmerchant with 15 confirms credits wallet."""
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 50.00,
            "reference": "dep-ref-1",
            "tx_hash": "0xgood",
            "network": "ethereum"
        }
    )
    assert res.status_code == 200
    assert res.json()["status"] == "credited"
    assert res.json()["balance"] == 150.0

def test_deposit_replay_attack_rejected():
    """The same tx_hash cannot be credited to another wallet (anti-replay)."""
    # User 1 deposits 0xgood
    client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 50.00,
            "reference": "dep-user1",
            "tx_hash": "0xgood",
            "network": "ethereum"
        }
    )
    # User 2 tries to claim the same tx_hash
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "2"},
        json={
            "amount": 50.00,
            "reference": "dep-user2-steal",
            "tx_hash": "0xgood",
            "network": "ethereum"
        }
    )
    assert res.status_code == 409
    assert "already been claimed" in res.json()["detail"]

def test_deposit_wrong_token_rejected():
    """Deposit with token != USDT is rejected."""
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 50.00,
            "reference": "dep-fake-token",
            "tx_hash": "0xwrongtoken",
            "network": "ethereum"
        }
    )
    assert res.status_code == 400
    assert "Unsupported token" in res.json()["detail"]

def test_deposit_wrong_address_rejected():
    """Deposit sent to attacker address is rejected."""
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 50.00,
            "reference": "dep-wrong-addr",
            "tx_hash": "0xwrongaddress",
            "network": "ethereum"
        }
    )
    assert res.status_code == 400
    assert "Invalid deposit destination" in res.json()["detail"]

def test_deposit_unconfirmed_rejected():
    """Deposit with confirmations < 12 is rejected."""
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 50.00,
            "reference": "dep-unconfirmed",
            "tx_hash": "0xunconfirmed",
            "network": "ethereum"
        }
    )
    assert res.status_code == 400
    assert "Insufficient block confirmations" in res.json()["detail"]

def test_deposit_failed_onchain_rejected():
    """Failed on-chain transaction is rejected."""
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 50.00,
            "reference": "dep-failed-tx",
            "tx_hash": "0xfailed",
            "network": "ethereum"
        }
    )
    assert res.status_code == 400
    assert "failure" in res.json()["detail"]

def test_deposit_amount_mismatch_rejected():
    """Requested deposit amount must match on-chain transfer amount."""
    res = client.post(
        "/deposits/verify",
        headers={"X-User-Id": "1"},
        json={
            "amount": 999.00,
            "reference": "dep-mismatch",
            "tx_hash": "0xgood",
            "network": "ethereum"
        }
    )
    assert res.status_code == 400
    assert "Amount mismatch" in res.json()["detail"]

def test_deposit_rpc_outage_handled():
    """RPC failure gracefully returns 503 Service Unavailable."""
    os.environ['MOCK_CHAIN_FAIL'] = '1'
    try:
        res = client.post(
            "/deposits/verify",
            headers={"X-User-Id": "1"},
            json={
                "amount": 50.00,
                "reference": "dep-rpc-fail",
                "tx_hash": "0xgood",
                "network": "ethereum"
            }
        )
        assert res.status_code == 503
        assert "unavailable" in res.json()["detail"].lower()
    finally:
        os.environ.pop('MOCK_CHAIN_FAIL', None)

# ==============================================================================
# 3. AUTHORIZATION & IDOR TESTS
# ==============================================================================
def test_idor_transaction_detail_prevented():
    """User 1 cannot view User 2's transaction detail."""
    # User 2 makes a withdrawal
    r_w = client.post(
        "/withdraw",
        headers={"X-User-Id": "2"},
        json={"amount": 10.00, "reference": "user2-private-tx"}
    )
    assert r_w.status_code == 200

    # Get User 2's transaction ID
    r_txs = client.get("/transactions", headers={"X-User-Id": "2"})
    tx_id = r_txs.json()[0]["id"]

    # User 1 attempts to access User 2's transaction
    res_idor = client.get(f"/transactions/{tx_id}", headers={"X-User-Id": "1"})
    assert res_idor.status_code == 404

def test_ai_authorization_and_privacy():
    """AI endpoint respects caller identity and strips sensitive reference strings."""
    # Seed a transaction for user 1 with secret reference
    client.post(
        "/withdraw",
        headers={"X-User-Id": "1"},
        json={"amount": 15.00, "reference": "super-secret-vault-code-999"}
    )

    # User 1 asks AI
    res = client.post(
        "/ai/ask",
        headers={"X-User-Id": "1"},
        json={"question": "Show my transactions"}
    )
    assert res.status_code == 200
    answer = res.json()["answer"]
    assert "15.00" in answer
    # Verify sensitive reference hash is NOT passed to LLM
    assert "super-secret-vault-code-999" not in answer

def test_ai_provider_timeout_handled():
    """Mock LLM timeout returns 504 Gateway Timeout."""
    os.environ['MOCK_LLM_FAIL'] = '1'
    try:
        res = client.post(
            "/ai/ask",
            headers={"X-User-Id": "1"},
            json={"question": "What is my balance?"}
        )
        assert res.status_code == 504
        assert "timed out" in res.json()["detail"].lower()
    finally:
        os.environ.pop('MOCK_LLM_FAIL', None)

# ==============================================================================
# 4. PAGINATION & SCALE TESTS
# ==============================================================================
def test_transactions_pagination():
    """Transactions endpoint supports limit and offset parameters."""
    for i in range(5):
        client.post(
            "/withdraw",
            headers={"X-User-Id": "1"},
            json={"amount": 1.00, "reference": f"page-test-{i}"}
        )
    # Fetch page of 2 items
    p1 = client.get("/transactions?limit=2&offset=0", headers={"X-User-Id": "1"})
    assert p1.status_code == 200
    items = p1.json()
    assert len(items) == 2

    # Fetch next page of 2 items
    p2 = client.get("/transactions?limit=2&offset=2", headers={"X-User-Id": "1"})
    assert p2.status_code == 200
    items2 = p2.json()
    assert len(items2) == 2
    assert items[0]["id"] != items2[0]["id"]
