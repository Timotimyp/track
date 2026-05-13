"""SQLModel table and Pydantic schemas for TaskFlow."""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Field, SQLModel

Status = Literal["todo", "inprog", "done"]
Priority = Literal["high", "medium", "low"]
Tag = Literal["dev", "design", "qa", "pm"]


class Task(SQLModel, table=True):
    """Database table for tasks. Uses plain `str` columns so SQLModel can map them."""

    __tablename__ = "tasks"

    id: int | None = Field(default=None, primary_key=True)
    title: str
    desc: str = ""
    status: str = "todo"
    priority: str = "medium"
    tag: str = "dev"
    assignee: str = "YO"
    due: date | None = None
    proj: str = "Website Redesign"
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC).replace(tzinfo=None))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC).replace(tzinfo=None))


class TaskCreate(BaseModel):
    """Payload schema for creating a task with strict literal validation."""

    title: str
    desc: str = ""
    status: Status = "todo"
    priority: Priority = "medium"
    tag: Tag = "dev"
    assignee: str = "YO"
    due: date | None = None
    proj: str = "Website Redesign"


class TaskUpdate(BaseModel):
    title: str | None = None
    desc: str | None = None
    status: Status | None = None
    priority: Priority | None = None
    tag: Tag | None = None
    assignee: str | None = None
    due: date | None = None
    proj: str | None = None


class TaskRead(BaseModel):
    id: int
    title: str
    desc: str
    status: Status
    priority: Priority
    tag: Tag
    assignee: str
    due: date | None
    proj: str
    created_at: datetime
    updated_at: datetime


class Project(BaseModel):
    name: str
    slug: str
    color: str


class User(BaseModel):
    code: str
    name: str
    color: str
