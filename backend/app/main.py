"""Wallet operations assessment application."""
from decimal import Decimal
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import Base, engine, SessionLocal
from .models import Wallet, Transaction
from .providers import MockLLM, MockChain

app = FastAPI(title='Wallet Operations - Assessment')

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
    return x_user_id

class MoneyRequest(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    reference: str

class DepositRequest(MoneyRequest):
    tx_hash: str
    network: str = 'ethereum'

class AskRequest(BaseModel):
    question: str
    user_id: int | None = None

@app.on_event('startup')
def initialize():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.scalar(select(Wallet).where(Wallet.user_id == 1)):
            db.add(Wallet(user_id=1, balance=Decimal('100.00')))
        if not db.scalar(select(Wallet).where(Wallet.user_id == 2)):
            db.add(Wallet(user_id=2, balance=Decimal('250.00')))
        db.commit()

@app.get('/wallet')
def wallet(user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id))
    if not w:
        raise HTTPException(404, 'Wallet not found')
    return {'user_id': user_id, 'balance': w.balance}

@app.post('/withdraw')
def withdraw(req: MoneyRequest, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id))
    if not w or w.balance < req.amount:
        raise HTTPException(400, 'Insufficient funds')
    w.balance = w.balance - req.amount
    db.add(Transaction(user_id=user_id, amount=req.amount, kind='withdrawal', status='completed', reference=req.reference))
    db.commit()
    return {'status': 'completed', 'balance': w.balance}

@app.get('/transactions')
def transactions(user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    records = db.scalars(select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.created_at.desc())).all()
    return [{'id': t.id, 'amount': t.amount, 'kind': t.kind, 'status': t.status, 'reference': t.reference, 'failure_reason': t.failure_reason} for t in records]

@app.get('/transactions/{transaction_id}')
def transaction_detail(transaction_id: int, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Transaction, transaction_id)
    if not t:
        raise HTTPException(404, 'Not found')
    return {'id': t.id, 'user_id': t.user_id, 'amount': t.amount, 'kind': t.kind, 'status': t.status, 'reference': t.reference, 'failure_reason': t.failure_reason}

@app.post('/ai/ask')
def ask(req: AskRequest, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    target = req.user_id or user_id
    records = db.scalars(select(Transaction).where(Transaction.user_id == target)).all()
    context = str([{'amount': str(t.amount), 'reference': t.reference, 'status': t.status} for t in records])
    return {'answer': MockLLM().answer(req.question, context)}

@app.post('/deposits/verify')
def verify_deposit(req: DepositRequest, user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    tx = MockChain().lookup(req.tx_hash)
    if not tx:
        raise HTTPException(404, 'Transaction not found')
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id))
    if not w:
        raise HTTPException(404, 'Wallet not found')
    w.balance = w.balance + req.amount
    db.add(Transaction(user_id=user_id, amount=req.amount, kind='deposit', status='completed', reference=req.tx_hash))
    db.commit()
    return {'status': 'credited', 'balance': w.balance}
