import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

type Tx = {
  id: number;
  user_id?: number;
  amount: number | string;
  kind: string;
  status: string;
  reference: string;
  failure_reason: string | null;
  created_at: string | null;
};

type WalletData = {
  user_id: number;
  balance: number;
};

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

function App() {
  const [userId, setUserId] = useState<number>(1);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [items, setItems] = useState<Tx[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [selectedTx, setSelectedTx] = useState<Tx | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  // Pagination state
  const [page, setPage] = useState<number>(0);
  const pageSize = 10;

  // Actions state
  const [activeTab, setActiveTab] = useState<'history' | 'withdraw' | 'deposit' | 'ai'>('history');
  const [actionSuccess, setActionSuccess] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [actionSubmitting, setActionSubmitting] = useState<boolean>(false);

  // Form inputs
  const [withdrawAmount, setWithdrawAmount] = useState<string>('20.00');
  const [withdrawRef, setWithdrawRef] = useState<string>('');
  const [depositHash, setDepositHash] = useState<string>('0xgood');
  const [depositAmount, setDepositAmount] = useState<string>('50.00');
  const [depositRef, setDepositRef] = useState<string>('');
  const [aiQuestion, setAiQuestion] = useState<string>('What is my total spending so far?');
  const [aiAnswer, setAiAnswer] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  const pollTimerRef = useRef<number | null>(null);

  // Fetch Wallet & Transactions
  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setRefreshing(true);
    setError('');

    try {
      const headers = { 'X-User-Id': String(userId) };

      // Parallel fetch for wallet balance and transactions
      const [walletRes, txsRes] = await Promise.all([
        fetch(`${API}/wallet`, { headers }),
        fetch(`${API}/transactions?limit=${pageSize}&offset=${page * pageSize}`, { headers })
      ]);

      if (!walletRes.ok) {
        throw new Error(`Failed to load wallet (${walletRes.status})`);
      }
      if (!txsRes.ok) {
        throw new Error(`Failed to load transactions (${txsRes.status})`);
      }

      const walletJson: WalletData = await walletRes.json();
      const txsJson: Tx[] = await txsRes.json();

      setWallet(walletJson);
      setItems(txsJson);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err?.message || 'Network error communicating with wallet service');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, page, pageSize]);

  // Initial & Dependency Fetch
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Live Auto-Refresh Polling
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      fetchData(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  // Load single transaction details
  const handleSelectTx = async (tx: Tx) => {
    setSelectedTx(tx);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/transactions/${tx.id}`, {
        headers: { 'X-User-Id': String(userId) }
      });
      if (res.ok) {
        const full = await res.json();
        setSelectedTx(full);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  // Perform Withdrawal
  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionSubmitting(true);
    setActionError('');
    setActionSuccess('');

    try {
      const ref = withdrawRef.trim() || `w-${Date.now()}`;
      const res = await fetch(`${API}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': String(userId)
        },
        body: JSON.stringify({
          amount: parseFloat(withdrawAmount),
          reference: ref
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Withdrawal failed');
      }
      setActionSuccess(`Withdrawal of $${withdrawAmount} successful! New balance: $${data.balance.toFixed(2)}`);
      setWithdrawRef('');
      fetchData(false);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionSubmitting(false);
    }
  };

  // Perform Deposit Verification
  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionSubmitting(true);
    setActionError('');
    setActionSuccess('');

    try {
      const ref = depositRef.trim() || `dep-${Date.now()}`;
      const res = await fetch(`${API}/deposits/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': String(userId)
        },
        body: JSON.stringify({
          amount: parseFloat(depositAmount),
          reference: ref,
          tx_hash: depositHash.trim(),
          network: 'ethereum'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Deposit verification failed');
      }
      setActionSuccess(`Deposit credited! New balance: $${data.balance.toFixed(2)} (${data.message || 'Confirmed'})`);
      setDepositRef('');
      fetchData(false);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionSubmitting(false);
    }
  };

  // Ask AI Assistant
  const handleAskAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiLoading(true);
    setAiAnswer('');
    setActionError('');

    try {
      const res = await fetch(`${API}/ai/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': String(userId)
        },
        body: JSON.stringify({ question: aiQuestion })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'AI Assistant unavailable');
      }
      setAiAnswer(data.answer);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div style={{
      maxWidth: 960,
      margin: '32px auto',
      padding: '0 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      color: '#1a1f36',
      backgroundColor: '#f8fafc',
      minHeight: '100vh'
    }}>
      {/* Top Header Card */}
      <header style={{
        background: '#ffffff',
        padding: '24px',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
              Wallet Operations
            </h1>
            <span style={{
              background: '#e0e7ff',
              color: '#3730a3',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600
            }}>
              Fintech Platform
            </span>
          </div>
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '14px' }}>
            Multi-currency ledger, blockchain deposit verification & AI insights
          </p>
        </div>

        {/* User Switcher & Live Balance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
              Active Demo User
            </label>
            <select
              value={userId}
              onChange={(e) => {
                setUserId(Number(e.target.value));
                setPage(0);
                setSelectedTx(null);
              }}
              style={{
                marginTop: '4px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                fontWeight: 600,
                backgroundColor: '#f1f5f9',
                cursor: 'pointer'
              }}
            >
              <option value={1}>User 1 (Primary Demo)</option>
              <option value={2}>User 2 (Secondary Demo)</option>
            </select>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: '10px',
            textAlign: 'right',
            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)'
          }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.9 }}>
              Available Balance
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800 }}>
              {wallet ? `$${wallet.balance.toFixed(2)}` : '...'}
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { id: 'history', label: 'Transaction History' },
          { id: 'withdraw', label: 'Withdraw Funds' },
          { id: 'deposit', label: 'Crypto USDT Deposit' },
          { id: 'ai', label: 'AI Financial Assistant' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as any);
              setActionSuccess('');
              setActionError('');
            }}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              backgroundColor: activeTab === tab.id ? '#0f172a' : '#ffffff',
              color: activeTab === tab.id ? '#ffffff' : '#475569',
              boxShadow: activeTab === tab.id ? '0 2px 8px rgba(15,23,42,0.2)' : '0 1px 3px rgba(0,0,0,0.05)',
              transition: 'all 0.15s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Action Alerts */}
      {actionSuccess && (
        <div style={{
          backgroundColor: '#ecfdf5',
          color: '#065f46',
          border: '1px solid #a7f3d0',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '14px',
          fontWeight: 500
        }}>
          ✓ {actionSuccess}
        </div>
      )}
      {actionError && (
        <div role="alert" style={{
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          border: '1px solid #fecaca',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '14px',
          fontWeight: 500
        }}>
          ⚠ {actionError}
        </div>
      )}

      {/* TAB 1: TRANSACTION HISTORY */}
      {activeTab === 'history' && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          padding: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Account Transactions</h2>
              {lastRefreshed && (
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Updated at {lastRefreshed}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: '13px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-poll (5s)
              </label>

              <button
                onClick={() => fetchData(false)}
                disabled={refreshing}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {refreshing ? '⟳ Refreshing...' : '↻ Refresh'}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" style={{ padding: '16px', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '8px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#64748b' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
              <div>Loading transactions...</div>
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#64748b', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
              <h3 style={{ margin: '0 0 6px', color: '#334155' }}>No transactions recorded yet</h3>
              <p style={{ margin: 0, fontSize: '14px' }}>
                Use the <strong>Withdraw Funds</strong> or <strong>Crypto Deposit</strong> tabs above to make your first transaction.
              </p>
            </div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <th style={{ padding: '12px 10px' }}>Reference / ID</th>
                    <th style={{ padding: '12px 10px' }}>Type</th>
                    <th style={{ padding: '12px 10px' }}>Amount</th>
                    <th style={{ padding: '12px 10px' }}>Status</th>
                    <th style={{ padding: '12px 10px' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => handleSelectTx(t)}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        backgroundColor: selectedTx?.id === t.id ? '#f0fdf4' : 'transparent',
                        transition: 'background-color 0.1s ease'
                      }}
                    >
                      <td style={{ padding: '12px 10px', fontFamily: 'monospace', color: '#334155' }}>
                        {t.reference || `#${t.id}`}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <span style={{
                          textTransform: 'capitalize',
                          fontWeight: 600,
                          color: t.kind === 'deposit' ? '#059669' : '#d97706'
                        }}>
                          {t.kind === 'deposit' ? '↓ Deposit' : '↑ Withdrawal'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px', fontWeight: 600, color: t.kind === 'deposit' ? '#059669' : '#0f172a' }}>
                        {t.kind === 'deposit' ? `+$${parseFloat(String(t.amount)).toFixed(2)}` : `-$${parseFloat(String(t.amount)).toFixed(2)}`}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: t.status === 'completed' ? '#dcfce7' : t.status === 'failed' ? '#fee2e2' : '#fef3c7',
                          color: t.status === 'completed' ? '#166534' : t.status === 'failed' ? '#991b1b' : '#92400e'
                        }}>
                          {t.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px', color: '#64748b', fontSize: '13px' }}>
                        {t.created_at ? new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Just now'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>
                  Page {page + 1} (showing max {pageSize} per page)
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      cursor: page === 0 ? 'not-allowed' : 'pointer',
                      opacity: page === 0 ? 0.5 : 1
                    }}
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={items.length < pageSize}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      cursor: items.length < pageSize ? 'not-allowed' : 'pointer',
                      opacity: items.length < pageSize ? 0.5 : 1
                    }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Selected Transaction Detail Drawer */}
          {selectedTx && (
            <div style={{
              marginTop: '24px',
              padding: '16px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  Transaction #{selectedTx.id} Detail
                </h3>
                <button
                  onClick={() => setSelectedTx(null)}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '16px' }}
                >
                  ✕
                </button>
              </div>
              {detailLoading ? (
                <p style={{ color: '#64748b' }}>Refreshing latest details...</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '13px' }}>
                  <div><strong>Reference:</strong> <span style={{ fontFamily: 'monospace' }}>{selectedTx.reference}</span></div>
                  <div><strong>Kind:</strong> {selectedTx.kind}</div>
                  <div><strong>Amount:</strong> ${parseFloat(String(selectedTx.amount)).toFixed(2)}</div>
                  <div><strong>Status:</strong> {selectedTx.status}</div>
                  <div><strong>Failure Reason:</strong> {selectedTx.failure_reason || 'None (Success)'}</div>
                  <div><strong>User Ownership:</strong> User {selectedTx.user_id || userId}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: WITHDRAW FUNDS */}
      {activeTab === 'withdraw' && (
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h2 style={{ marginTop: 0, fontSize: '18px', fontWeight: 700 }}>Execute Withdrawal</h2>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
            Protected by database row-level locking (concurrency safe) and idempotency keys.
          </p>
          <form onSubmit={handleWithdraw} style={{ maxWidth: '400px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Amount ($ USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '15px' }}
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Custom Reference / Idempotency Key (optional)
              </label>
              <input
                type="text"
                placeholder="Leave blank for auto-generated key"
                value={withdrawRef}
                onChange={(e) => setWithdrawRef(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>
            <button
              type="submit"
              disabled={actionSubmitting}
              style={{
                backgroundColor: '#0f172a',
                color: '#ffffff',
                padding: '10px 20px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {actionSubmitting ? 'Processing...' : 'Confirm Withdrawal'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: CRYPTO USDT DEPOSIT */}
      {activeTab === 'deposit' && (
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h2 style={{ marginTop: 0, fontSize: '18px', fontWeight: 700 }}>Verify Blockchain USDT Deposit</h2>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
            Validates network (ethereum), token (USDT), recipient (0xmerchant), and $\ge 12$ confirmations.
          </p>
          <form onSubmit={handleDeposit} style={{ maxWidth: '480px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Mock Transaction Hash
              </label>
              <select
                value={depositHash}
                onChange={(e) => setDepositHash(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', marginBottom: '6px' }}
              >
                <option value="0xgood">0xgood (Valid: USDT, 15 confirms, $50.00)</option>
                <option value="0xunconfirmed">0xunconfirmed (Invalid: 0 confirms)</option>
                <option value="0xwrongtoken">0xwrongtoken (Invalid: FAKE token)</option>
                <option value="0xwrongaddress">0xwrongaddress (Invalid: 0xattacker address)</option>
                <option value="0xfailed">0xfailed (Invalid: failed on-chain)</option>
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Amount ($ USDT)
              </label>
              <input
                type="number"
                step="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '15px' }}
              />
            </div>
            <button
              type="submit"
              disabled={actionSubmitting}
              style={{
                backgroundColor: '#059669',
                color: '#ffffff',
                padding: '10px 20px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {actionSubmitting ? 'Verifying on-chain...' : 'Verify & Credit Deposit'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 4: AI FINANCIAL ASSISTANT */}
      {activeTab === 'ai' && (
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h2 style={{ marginTop: 0, fontSize: '18px', fontWeight: 700 }}>AI Financial Assistant</h2>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
            Grounded strictly in the authenticated user's records. Private reference identifiers are redacted.
          </p>
          <form onSubmit={handleAskAi} style={{ maxWidth: '540px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Ask a question about your account:
              </label>
              <input
                type="text"
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>
            <button
              type="submit"
              disabled={aiLoading}
              style={{
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                padding: '10px 20px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {aiLoading ? 'Synthesizing...' : 'Ask AI'}
            </button>
          </form>

          {aiAnswer && (
            <div style={{
              marginTop: '20px',
              padding: '16px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              color: '#1e40af'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>
                🤖 AI Response
              </div>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>{aiAnswer}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
