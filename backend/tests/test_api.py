"""Smoke tests for the TaskFlow REST API."""
from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("TASKFLOW_DB_PATH", str(db_path))
    # Reload modules so they pick up the patched env var.
    import importlib

    import app.db as db_module
    import app.main as main_module

    importlib.reload(db_module)
    importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_projects_and_users(client: TestClient) -> None:
    projects = client.get("/api/projects").json()
    users = client.get("/api/users").json()
    assert len(projects) == 4
    assert {p["name"] for p in projects} == {
        "Website Redesign",
        "Backend API",
        "Mobile App",
        "Operations",
    }
    assert {u["code"] for u in users} >= {"AK", "BL", "CJ", "DM", "YO"}


def test_tasks_seeded(client: TestClient) -> None:
    tasks = client.get("/api/tasks").json()
    assert len(tasks) == 8


def test_create_update_delete_task(client: TestClient) -> None:
    payload = {
        "title": "Test task",
        "desc": "Some description",
        "status": "todo",
        "priority": "medium",
        "tag": "dev",
        "assignee": "YO",
        "due": "2026-06-01",
        "proj": "Website Redesign",
    }
    created = client.post("/api/tasks", json=payload).json()
    assert created["title"] == "Test task"
    task_id = created["id"]

    updated = client.patch(f"/api/tasks/{task_id}", json={"status": "done"}).json()
    assert updated["status"] == "done"

    response = client.delete(f"/api/tasks/{task_id}")
    assert response.status_code == 204

    response = client.get(f"/api/tasks/{task_id}")
    assert response.status_code == 404


def teardown_module(_module) -> None:
    """Reset env var after tests."""
    os.environ.pop("TASKFLOW_DB_PATH", None)
