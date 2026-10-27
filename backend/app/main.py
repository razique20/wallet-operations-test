"""Wallet operations assessment application."""
import os
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Optional
from fastapi import FastAPI, Depends, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.orm import Session
from .db import Base, engine, SessionLocal
from .models import Wallet, Transaction
from .providers import MockLLM, MockChain

# Simple in-memory cache for AI answers: (user_id, question, last_tx_id) -> answer
_AI_CACHE: dict[tuple[int, str, Optional[int]], str] = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure tables and seed initial demo accounts
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.scalar(select(Wallet).where(Wallet.user_id == 1)):
            db.add(Wallet(user_id=1, balance=Decimal('100.00')))
        if not db.scalar(select(Wallet).where(Wallet.user_id == 2)):
            db.add(Wallet(user_id=2, balance=Decimal('250.00')))
        db.commit()
    yield

app = FastAPI(title='Wallet Operations - Assessment', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    with SessionLocal() as db:
        yield db

def current_user(x_user_id: int = Header(default=1)) -> int:
    """Authentication fixture for local assessment.
    
    Assumption: In production, this must be replaced by a cryptographically signed
    JWT / session token validated at the API Gateway or auth middleware.
    """
    if x_user_id <= 0:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user credentials")
    return x_user_id

class MoneyRequest(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    reference: str = Field(min_length=1, max_length=150)

class DepositRequest(MoneyRequest):
    tx_hash: str = Field(min_length=1, max_length=150)
    network: str = 'ethereum'

class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    user_id: Optional[int] = None

@app.get('/wallet')
def wallet(user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id))
    if not w:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Wallet not found')
    return {'user_id': user_id, 'balance': w.balance}

@app.post('/withdraw')
def withdraw(req: MoneyRequest, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    # 1. Pessimistic row locking on wallet to guarantee ACID financial integrity under concurrency
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
    if not w:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Wallet not found')

    # 2. Idempotency protection: check if request reference has already been executed for this user
    existing_tx = db.scalar(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.reference == req.reference,
            Transaction.kind == 'withdrawal'
        ).with_for_update()
    )
    if existing_tx:
        if existing_tx.status == 'completed':
            return {
                'status': 'completed',
                'balance': w.balance,
                'idempotent': True,
                'message': 'Withdrawal request already processed'
            }
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'Transaction with reference {req.reference} already in state: {existing_tx.status}')

    # 3. Balance verification
    if w.balance < req.amount:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Insufficient funds')

    # 4. Atomic balance deduction and transaction ledger creation
    w.balance = w.balance - req.amount
    tx = Transaction(
        user_id=user_id,
        amount=req.amount,
        kind='withdrawal',
        status='completed',
        reference=req.reference
    )
    db.add(tx)
    db.commit()
    db.refresh(w)
    return {'status': 'completed', 'balance': w.balance, 'idempotent': False}

@app.get('/transactions')
def transactions(
    user_id: int = Depends(current_user),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db)
):
    """Paginated transaction history query with bounded limits for high-volume scale."""
    query = (
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(desc(Transaction.id))
        .offset(offset)
        .limit(limit)
    )
    records = db.scalars(query).all()
    return [
        {
            'id': t.id,
            'amount': t.amount,
            'kind': t.kind,
            'status': t.status,
            'reference': t.reference,
            'failure_reason': t.failure_reason,
            'created_at': t.created_at.isoformat() if t.created_at else None
        }
        for t in records
    ]

@app.get('/transactions/{transaction_id}')
def transaction_detail(transaction_id: int, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    """Single transaction lookup strictly enforcing ownership to prevent IDOR leaks."""
    t = db.get(Transaction, transaction_id)
    if not t or t.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Transaction not found')
    return {
        'id': t.id,
        'user_id': t.user_id,
        'amount': t.amount,
        'kind': t.kind,
        'status': t.status,
        'reference': t.reference,
        'failure_reason': t.failure_reason,
        'created_at': t.created_at.isoformat() if t.created_at else None
    }

@app.post('/ai/ask')
def ask(req: AskRequest, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    """AI Assistant grounded strictly in authorized caller records with privacy protection."""
    # Enforce caller authorization: caller CANNOT inspect another user's account
    records = db.scalars(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(desc(Transaction.id))
        .limit(20)
    ).all()

    last_tx_id = records[0].id if records else None
    cache_key = (user_id, req.question.strip().lower(), last_tx_id)
    if cache_key in _AI_CACHE:
        return {'answer': _AI_CACHE[cache_key], 'cached': True}

    # Privacy Protection: do NOT pass internal/private transaction reference hashes to the LLM
    context = str([
        {'amount': str(t.amount), 'kind': t.kind, 'status': t.status}
        for t in records
    ])

    try:
        answer = MockLLM().answer(req.question, context)
        _AI_CACHE[cache_key] = answer
        return {'answer': answer, 'cached': False}
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail='AI provider timed out. Your request could not be processed at this time.'
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='AI assistant temporarily unavailable.'
        )

@app.post('/deposits/verify')
def verify_deposit(req: DepositRequest, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    """Verifies simulated on-chain deposit against strict policy rules and prevents replay."""
    # 1. Query blockchain provider with RPC outage resiliency
    try:
        tx = MockChain().lookup(req.tx_hash)
    except ConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Blockchain RPC provider unavailable. Please retry later.'
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Unexpected error communicating with blockchain node.'
        )

    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Transaction not found on-chain')

    # 2. Strict evidence validation against deposit policy
    # Network check
    if req.network.lower() != 'ethereum' or tx.get('network') != 'ethereum':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Unsupported network. Only ethereum is accepted.')

    # Token check
    if tx.get('token') != 'USDT':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported token {tx.get('token')}. Only USDT accepted.")

    # Recipient address check
    if tx.get('to') != '0xmerchant':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid deposit destination address {tx.get('to')}. Must be 0xmerchant.")

    # On-chain success status check
    if not tx.get('success', False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Blockchain transaction status indicates failure.')

    # Confirmations check (minimum 12 confirmations required)
    confirmations = tx.get('confirmations', 0)
    if confirmations < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Insufficient block confirmations ({confirmations}/12 required).'
        )

    # Exact amount match check
    chain_amount = Decimal(str(tx.get('amount', '0')))
    if req.amount != chain_amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Amount mismatch: expected {chain_amount}, request specified {req.amount}.'
        )

    # 3. Lock wallet row and check for global duplicate crediting (replay protection)
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
    if not w:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Wallet not found')

    # Check if this tx_hash has ever been credited to ANY wallet
    existing_deposit = db.scalar(
        select(Transaction)
        .where(
            Transaction.reference == req.tx_hash,
            Transaction.kind == 'deposit',
            Transaction.status == 'completed'
        )
        .with_for_update()
    )
    if existing_deposit:
        if existing_deposit.user_id == user_id:
            return {
                'status': 'credited',
                'balance': w.balance,
                'idempotent': True,
                'message': 'Deposit has already been credited to your wallet'
            }
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='Blockchain transaction hash has already been claimed by another wallet'
        )

    # 4. Atomic credit
    w.balance = w.balance + req.amount
    db.add(Transaction(
        user_id=user_id,
        amount=req.amount,
        kind='deposit',
        status='completed',
        reference=req.tx_hash
    ))
    db.commit()
    db.refresh(w)
    return {'status': 'credited', 'balance': w.balance, 'idempotent': False}
