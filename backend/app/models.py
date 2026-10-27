from sqlalchemy import Integer, String, ForeignKey, DateTime, Numeric, func, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

class Wallet(Base):
    __tablename__ = 'wallets'
    __table_args__ = (
        CheckConstraint('balance >= 0', name='check_wallet_positive_balance'),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    balance: Mapped[float] = mapped_column(Numeric(18, 2), default=0)

class Transaction(Base):
    __tablename__ = 'transactions'
    __table_args__ = (
        Index('ix_transactions_user_id_id_desc', 'user_id', 'id'),
        Index('ix_transactions_user_id_created_at_desc', 'user_id', 'created_at'),
        Index('ix_transactions_reference', 'reference'),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    kind: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default='pending')
    reference: Mapped[str] = mapped_column(String(150), nullable=True)
    failure_reason: Mapped[str] = mapped_column(String(200), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
