"""FastAPI application exposing TaskFlow REST API."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from app.assistant import (
    AssistantError,
    AssistantRequest,
    AssistantResponse,
    interpret_command,
)
from app.conflicts import check_conflict
from app.db import engine, get_session, init_db
from app.models import (
    Project,
    Task,
    TaskCreate,
    TaskRead,
    TaskUpdate,
    User,
)
from app.seed import PROJECTS, USERS, build_seed_tasks


def seed_if_empty() -> None:
    with Session(engine) as session:
        existing = session.exec(select(Task)).first()
        if existing is not None:
            return
        for task in build_seed_tasks():
            session.add(task)
        session.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    seed_if_empty()
    yield


app = FastAPI(title="TaskFlow API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/projects", response_model=list[Project])
def list_projects() -> list[Project]:
    return PROJECTS


@app.get("/api/users", response_model=list[User])
def list_users() -> list[User]:
    return USERS


@app.get("/api/tasks", response_model=list[TaskRead])
def list_tasks(session: Session = Depends(get_session)) -> list[Task]:
    return list(session.exec(select(Task).order_by(Task.id)).all())


@app.post("/api/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, session: Session = Depends(get_session)) -> Task:
    task = Task(**payload.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@app.get("/api/tasks/{task_id}", response_model=TaskRead)
def get_task(task_id: int, session: Session = Depends(get_session)) -> Task:
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.patch("/api/tasks/{task_id}", response_model=TaskRead)
def update_task(
    task_id: int, payload: TaskUpdate, session: Session = Depends(get_session)
) -> Task:
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(task, key, value)
    task.updated_at = datetime.now(UTC).replace(tzinfo=None)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@app.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, session: Session = Depends(get_session)) -> None:
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
    session.commit()


@app.post("/api/assistant", response_model=AssistantResponse)
async def assistant(
    request: AssistantRequest,
    session: Session = Depends(get_session),
) -> AssistantResponse:
    """Parse a free-form voice/text command into a structured task suggestion.

    After Gemini returns a candidate task, we look in the local DB for tasks
    that occupy the same date + time slot and attach a conflict block to the
    response. The frontend uses this to warn the user and offer alternatives.
    """
    today = datetime.now(UTC).date()
    try:
        response = await interpret_command(request, today=today)
    except AssistantError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    response.conflict = check_conflict(
        session, response.task.due, response.task.due_time
    )
    return response
