"""Smoke tests for the TaskFlow REST API."""
from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date

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
        "due_time": "15:30",
        "proj": "Website Redesign",
    }
    created = client.post("/api/tasks", json=payload).json()
    assert created["title"] == "Test task"
    assert created["due_time"] == "15:30"
    task_id = created["id"]

    updated = client.patch(
        f"/api/tasks/{task_id}", json={"status": "done", "due_time": "09:00"}
    ).json()
    assert updated["status"] == "done"
    assert updated["due_time"] == "09:00"

    bad = client.post(
        "/api/tasks", json={**payload, "due_time": "25:99"}
    )
    assert bad.status_code == 422

    response = client.delete(f"/api/tasks/{task_id}")
    assert response.status_code == 204

    response = client.get(f"/api/tasks/{task_id}")
    assert response.status_code == 404


def test_assistant_endpoint_returns_structured_task(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The /api/assistant endpoint should return what the LLM returned, validated."""
    import app.main as main_module
    from app.assistant import AssistantResponse, AssistantTask

    async def fake_interpret(request, *, today, **kwargs):  # noqa: ANN001
        assert request.text.strip() != ""
        assert isinstance(today, date)
        return AssistantResponse(
            recommendation="Looks like a backend bug \u2014 assigning to BL with high priority.",
            task=AssistantTask(
                title="Fix payment timeout bug",
                desc="Investigate 504s on checkout",
                status="todo",
                priority="high",
                tag="dev",
                assignee="BL",
                due=None,
                due_time="15:00",
                proj="Backend API",
            ),
        )

    monkeypatch.setattr(main_module, "interpret_command", fake_interpret)

    response = client.post(
        "/api/assistant",
        json={"text": "\u041f\u043e\u0447\u0438\u043d\u0438 \u043b\u0430\u0433 \u043d\u0430 \u0447\u0435\u043a\u0430\u0443\u0442\u0435, \u0441\u0440\u043e\u0447\u043d\u043e", "language": "ru-RU"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["task"]["assignee"] == "BL"
    assert body["task"]["priority"] == "high"
    assert body["task"]["proj"] == "Backend API"
    assert body["task"]["due_time"] == "15:00"
    assert "recommendation" in body and len(body["recommendation"]) > 0


def test_assistant_endpoint_propagates_errors(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.main as main_module
    from app.assistant import AssistantError

    async def boom(request, *, today, **kwargs):  # noqa: ANN001
        raise AssistantError("GEMINI_API_KEY is not configured on the server.")

    monkeypatch.setattr(main_module, "interpret_command", boom)

    response = client.post("/api/assistant", json={"text": "hello", "language": "en-US"})
    assert response.status_code == 502
    assert "GEMINI_API_KEY" in response.json()["detail"]


def test_assistant_detects_conflict_and_proposes_alternatives(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When Gemini's suggested slot is occupied, the response includes a conflict block."""
    import app.main as main_module
    from app.assistant import AssistantResponse, AssistantTask

    occupying = client.post(
        "/api/tasks",
        json={
            "title": "Sprint planning",
            "due": "2026-06-01",
            "due_time": "15:00",
            "proj": "Operations",
        },
    ).json()
    assert occupying["due_time"] == "15:00"

    async def fake_interpret(request, *, today, **kwargs):  # noqa: ANN001
        return AssistantResponse(
            recommendation="Suggest scheduling at the requested time.",
            task=AssistantTask(
                title="1:1 with Beth",
                priority="medium",
                tag="pm",
                assignee="BL",
                due=date(2026, 6, 1),
                due_time="15:00",
                proj="Backend API",
            ),
        )

    monkeypatch.setattr(main_module, "interpret_command", fake_interpret)
    body = client.post(
        "/api/assistant",
        json={"text": "Set up 1:1 with Beth on June 1 at 3pm", "language": "en-US"},
    ).json()

    conflict = body["conflict"]
    assert conflict is not None
    assert len(conflict["conflicts"]) == 1
    assert conflict["conflicts"][0]["title"] == "Sprint planning"
    assert conflict["conflicts"][0]["due_time"] == "15:00"
    assert len(conflict["alternatives"]) == 3
    # Same-day shifts come first when free
    alt_keys = [(a["due"], a["due_time"]) for a in conflict["alternatives"]]
    assert ("2026-06-01", "16:00") in alt_keys
    assert ("2026-06-01", "14:00") in alt_keys


def test_assistant_no_conflict_when_slot_is_free(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An empty slot should produce conflict=None."""
    import app.main as main_module
    from app.assistant import AssistantResponse, AssistantTask

    async def fake_interpret(request, *, today, **kwargs):  # noqa: ANN001
        return AssistantResponse(
            recommendation="No conflicts expected.",
            task=AssistantTask(
                title="Solo task",
                priority="low",
                tag="dev",
                assignee="YO",
                due=date(2030, 1, 1),
                due_time="10:00",
                proj="Backend API",
            ),
        )

    monkeypatch.setattr(main_module, "interpret_command", fake_interpret)
    body = client.post(
        "/api/assistant",
        json={"text": "schedule something in the far future", "language": "en-US"},
    ).json()
    assert body["conflict"] is None


def teardown_module(_module) -> None:
    """Reset env var after tests."""
    os.environ.pop("TASKFLOW_DB_PATH", None)
