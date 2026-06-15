# Student Task Management Web Application

This project is a Progressive Web Application (PWA) for university students to manage coursework, deadlines, reminders, and progress tracking in one place.

## Features

- Secure registration and login with hashed passwords and JWT authentication
- Task CRUD with due dates, priorities, statuses, categories, and reminders
- Dashboard analytics for today's tasks, upcoming deadlines, overdue counts, and completion rate
- Filtering and sorting for faster task navigation
- Responsive interface for desktop and mobile devices
- Offline support using a service worker
- Offline task queue with later sync
- Push notification support and browser reminder settings
- Public deployment support on Render

## Tech Stack

- Backend: FastAPI
- Database: SQLAlchemy with SQLite locally and PostgreSQL support for deployment
- Frontend: HTML, CSS, JavaScript
- Testing: Pytest

## Project Structure

```text
app/                    Backend code
frontend/               Frontend and PWA files
tests/                  Automated smoke test
docs/requirements/      AT1 and AT2 text resources
docs/submission/        AT3 demo script and testing evidence
run_demo.ps1            Local demo runner with automatic port fallback
seed_demo.py            Demo data seed script
render.yaml             Render deployment configuration
requirements.txt        Python dependencies
```

## Local Run

### Recommended

Run the app with automatic dependency install, demo seeding, and free-port selection:

```powershell
.\run_demo.ps1
```

If PowerShell blocks the script:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\run_demo.ps1
```

### Manual

```powershell
python -m pip install -r requirements.txt
python seed_demo.py --reset-demo
python -m uvicorn app.main:app --host 127.0.0.1 --port 8003
```

Demo account:

- Email: `demo@studenttasks.example.com`
- Password: `Password123`

## Deployment

The project is configured for free Render deployment using:

- `render.yaml`
- `.python-version`

## Testing

Run the automated smoke test:

```powershell
python -m pytest -q
```

## Key Files

- `app/main.py`: API routes and application startup
- `app/models.py`: SQLAlchemy models
- `app/schemas.py`: validation models
- `app/security.py`: password hashing and JWT logic
- `frontend/index.html`: main UI structure
- `frontend/app.js`: frontend application logic
- `frontend/service-worker.js`: offline caching and notification handling
- `tests/test_api_smoke.py`: automated smoke test

## Submission Support

- `docs/submission/AT3_video_script.txt`
- `docs/submission/AT3_testing_evidence.txt`

