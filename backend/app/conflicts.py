"""Schedule-conflict detection for AI-suggested tasks.

Given a candidate task with a date and a time-of-day, returns the list of
existing tasks that already occupy that exact slot (same `due` + same
`due_time`), plus a small set of deterministically-computed alternative slots
that are currently free.

The matching is deliberately strict (exact `due_time` HH:MM match) because the
Task model does not yet carry a duration. We treat any task with both a date
and a time as a scheduled item that should not double-book.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from pydantic import BaseModel
from sqlmodel import Session, select

from app.models import Task


class AssistantConflictTask(BaseModel):
    """A task that occupies the slot the user is trying to schedule."""

    id: int
    title: str
    due: date
    due_time: str


class AssistantAlternative(BaseModel):
    """A free slot proposed as an alternative."""

    due: date
    due_time: str


class AssistantConflict(BaseModel):
    """Conflict payload attached to an AssistantResponse when a clash is found."""

    conflicts: list[AssistantConflictTask]
    alternatives: list[AssistantAlternative]


def _find_at_slot(session: Session, due: date, due_time: str) -> list[Task]:
    stmt = select(Task).where(Task.due == due, Task.due_time == due_time)
    return list(session.exec(stmt).all())


def _shift_same_day(due: date, due_time: str, hours: int) -> tuple[date, str] | None:
    """Return `(date, HH:MM)` shifted by `hours`, only if it stays in the same day."""
    base = datetime.combine(due, datetime.strptime(due_time, "%H:%M").time())
    shifted = base + timedelta(hours=hours)
    if shifted.date() != due:
        return None
    return shifted.date(), shifted.strftime("%H:%M")


def _candidate_slots(due: date, due_time: str) -> list[tuple[date, str]]:
    """Order candidate replacement slots: +1h, -1h, +2h, -2h, next day same time, ..."""
    out: list[tuple[date, str]] = []
    for hours in (1, -1, 2, -2, 3, -3):
        shifted = _shift_same_day(due, due_time, hours)
        if shifted is not None:
            out.append(shifted)
    next_day = due + timedelta(days=1)
    out.append((next_day, due_time))
    nd_plus_one = _shift_same_day(next_day, due_time, 1)
    if nd_plus_one is not None:
        out.append(nd_plus_one)
    return out


def compute_alternatives(
    session: Session,
    due: date,
    due_time: str,
    *,
    max_alternatives: int = 3,
) -> list[AssistantAlternative]:
    """Return up to `max_alternatives` non-conflicting slots near the requested one."""
    seen: set[tuple[str, str]] = set()
    free: list[AssistantAlternative] = []
    for cand_date, cand_time in _candidate_slots(due, due_time):
        key = (cand_date.isoformat(), cand_time)
        if key in seen:
            continue
        seen.add(key)
        if _find_at_slot(session, cand_date, cand_time):
            continue
        free.append(AssistantAlternative(due=cand_date, due_time=cand_time))
        if len(free) >= max_alternatives:
            break
    return free


def check_conflict(
    session: Session,
    due: date | None,
    due_time: str | None,
) -> AssistantConflict | None:
    """Return a conflict block if the slot is occupied, otherwise None."""
    if due is None or not due_time:
        return None
    conflicting = _find_at_slot(session, due, due_time)
    if not conflicting:
        return None
    conflict_tasks = [
        AssistantConflictTask(
            id=t.id or 0,
            title=t.title,
            due=t.due,  # type: ignore[arg-type]
            due_time=t.due_time or "",
        )
        for t in conflicting
        if t.due is not None and t.due_time
    ]
    return AssistantConflict(
        conflicts=conflict_tasks,
        alternatives=compute_alternatives(session, due, due_time),
    )
