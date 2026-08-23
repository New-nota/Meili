"""Pydantic-схемы диалога Meili (ТЗ-Meili M1.2)."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class ConversationRead(BaseModel):
    id: UUID
    trip_id: Optional[UUID]
    title: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageRead(BaseModel):
    id: UUID
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserMessageIn(BaseModel):
    content: str
    # M2.2: таймзона клиента для current_time в контексте (опционально)
    client_tz: Optional[str] = None


class PlanRead(BaseModel):
    id: UUID
    conversation_id: UUID
    plan_json: dict
    status: str
    created_at: datetime
    applied_at: Optional[datetime]

    class Config:
        from_attributes = True
