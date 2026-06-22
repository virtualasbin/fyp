import os
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


TEST_DB_PATH = Path(__file__).resolve().parent / "test_student_tasks.db"
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"
os.environ["STUDENT_TASK_DISABLE_PUSH_WORKER"] = "1"

from backend.database import engine
from backend.main import app


client = TestClient(app)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_auth_task_crud_dashboard_and_settings_flow():
    email = f"test-{uuid4().hex[:8]}@example.com"
    password = "Password123"

    register_response = client.post(
        "/api/auth/register",
        json={"name": "Test User", "email": email, "password": password},
    )
    assert register_response.status_code == 201
    register_data = register_response.json()
    token = register_data["access_token"]
    headers = auth_headers(token)

    me_response = client.get("/api/auth/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["email"] == email

    settings_response = client.get("/api/settings", headers=headers)
    assert settings_response.status_code == 200
    assert settings_response.json()["notification_enabled"] is False

    update_settings_response = client.put(
        "/api/settings",
        headers=headers,
        json={"notification_enabled": True},
    )
    assert update_settings_response.status_code == 200
    assert update_settings_response.json()["notification_enabled"] is True

    category_response = client.post(
        "/api/categories",
        headers=headers,
        json={"category_name": "Software Testing"},
    )
    assert category_response.status_code == 201
    category_id = category_response.json()["id"]

    task_response = client.post(
        "/api/tasks",
        headers=headers,
        json={
            "title": "Prepare AT3 evidence",
            "description": "Capture screenshots and validate reminder delivery.",
            "due_date": "2030-06-10T10:00:00",
            "priority": "high",
            "status": "pending",
            "category_id": category_id,
            "reminders": [{"reminder_time": "2030-06-09T09:00:00"}],
        },
    )
    assert task_response.status_code == 201
    task_data = task_response.json()
    task_id = task_data["id"]
    assert len(task_data["reminders"]) == 1

    dashboard_response = client.get("/api/dashboard", headers=headers)
    assert dashboard_response.status_code == 200
    assert dashboard_response.json()["total_tasks"] == 1

    update_task_response = client.put(
        f"/api/tasks/{task_id}",
        headers=headers,
        json={"status": "completed"},
    )
    assert update_task_response.status_code == 200
    assert update_task_response.json()["status"] == "completed"

    full_update_response = client.put(
        f"/api/tasks/{task_id}",
        headers=headers,
        json={
            "title": "Prepare final AT3 evidence",
            "description": "Capture final screenshots and verify deployed reminder behaviour.",
            "due_date": "2030-06-11T11:00:00",
            "priority": "medium",
            "status": "pending",
            "category_id": category_id,
            "reminders": [{"reminder_time": "2030-06-10T10:00:00"}],
        },
    )
    assert full_update_response.status_code == 200
    full_update_data = full_update_response.json()
    assert full_update_data["title"] == "Prepare final AT3 evidence"
    assert full_update_data["status"] == "pending"
    assert len(full_update_data["reminders"]) == 1

    list_tasks_response = client.get("/api/tasks", headers=headers)
    assert list_tasks_response.status_code == 200
    assert len(list_tasks_response.json()) == 1

    push_key_response = client.get("/api/push/public-key", headers=headers)
    assert push_key_response.status_code == 200
    assert push_key_response.json()["public_key"]

    delete_task_response = client.delete(f"/api/tasks/{task_id}", headers=headers)
    assert delete_task_response.status_code == 204

    final_dashboard_response = client.get("/api/dashboard", headers=headers)
    assert final_dashboard_response.status_code == 200
    assert final_dashboard_response.json()["total_tasks"] == 0


def teardown_module():
    client.close()
    engine.dispose()
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
