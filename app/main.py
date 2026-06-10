import json
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pywebpush import WebPushException, webpush
from sqlalchemy import and_, inspect
from sqlalchemy.orm import Session, selectinload

from app.database import Base, SessionLocal, engine, get_db
from app.models import Category, PushSubscription, Reminder, Task, TaskStatus, User
from app.schemas import (
    AuthResponse,
    CategoryCreate,
    CategoryResponse,
    DashboardSummary,
    PushPublicKeyResponse,
    PushSubscriptionCreate,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
    UserCreate,
    UserLogin,
    UserResponse,
    UserSettingsResponse,
    UserSettingsUpdate,
)
from app.security import create_access_token, decode_access_token, hash_password, verify_password


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
VAPID_PUBLIC_KEY = os.getenv(
    "PUSH_VAPID_PUBLIC_KEY",
    "BPeR7fUB-riJWs3mKalALHV39EZo8dSvv4zsI2uO0XYfSxAao0hPadSfcclK9dfQMY2Z2K4QKI-Bq_ltQ7aMWlU",
)
VAPID_PRIVATE_KEY = os.getenv(
    "PUSH_VAPID_PRIVATE_KEY",
    "eQr_PNlEHyuR8NfPCsNnqXFXnZlZKvRPq_Kf9kyXr4E",
)
VAPID_SUBJECT = os.getenv("PUSH_VAPID_SUBJECT", "mailto:studenttasks@example.com")
PUSH_WORKER_DISABLED = os.getenv("STUDENT_TASK_DISABLE_PUSH_WORKER", "").lower() in {"1", "true", "yes"}

push_worker_stop = threading.Event()
push_worker_thread: threading.Thread | None = None


def ensure_database_schema() -> None:
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "users" in tables:
            user_columns = {column["name"] for column in inspector.get_columns("users")}
            if "notification_enabled" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN notification_enabled BOOLEAN NOT NULL DEFAULT 0",
                )

        if "reminders" in tables:
            reminder_columns = {column["name"] for column in inspector.get_columns("reminders")}
            if "notified_at" not in reminder_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE reminders ADD COLUMN notified_at DATETIME",
                )

    Base.metadata.create_all(bind=engine)


ensure_database_schema()


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    token = authorization.replace("Bearer ", "", 1).strip()
    email = decode_access_token(token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    return user


def validate_category_ownership(db: Session, user_id: int, category_id: int | None) -> Category | None:
    if category_id is None:
        return None

    category = db.query(Category).filter(Category.id == category_id, Category.user_id == user_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found.")
    return category


def build_settings_response(db: Session, current_user: User) -> UserSettingsResponse:
    push_subscribed = (
        db.query(PushSubscription).filter(PushSubscription.user_id == current_user.id).count() > 0
    )
    return UserSettingsResponse(
        notification_enabled=current_user.notification_enabled,
        push_supported=True,
        push_subscribed=push_subscribed,
    )


def serialize_task_query(db: Session, user_id: int):
    return (
        db.query(Task)
        .options(selectinload(Task.reminders))
        .filter(Task.user_id == user_id)
        .order_by(Task.due_date.asc())
    )


def replace_task_reminders(task: Task, reminder_payloads: list, db: Session) -> None:
    task.reminders.clear()
    for reminder_payload in reminder_payloads:
        task.reminders.append(Reminder(reminder_time=reminder_payload.reminder_time))
    db.flush()


def send_web_push(subscription: PushSubscription, payload: dict, db: Session) -> bool:
    subscription_info = {
        "endpoint": subscription.endpoint,
        "keys": {
            "p256dh": subscription.p256dh,
            "auth": subscription.auth,
        },
    }

    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        subscription.last_seen_at = datetime.utcnow()
        return True
    except WebPushException as exc:
        response = getattr(exc, "response", None)
        status_code = getattr(response, "status_code", None)
        if status_code in {404, 410}:
            db.delete(subscription)
        return False


def dispatch_due_push_notifications() -> None:
    db = SessionLocal()
    try:
        now = datetime.now()
        reminders = (
            db.query(Reminder)
            .options(selectinload(Reminder.task).selectinload(Task.user))
            .join(Task, Reminder.task_id == Task.id)
            .join(User, Task.user_id == User.id)
            .filter(
                Reminder.reminder_time <= now,
                Reminder.notified_at.is_(None),
                Task.status != TaskStatus.completed,
                User.notification_enabled.is_(True),
            )
            .all()
        )

        if not reminders:
            return

        for reminder in reminders:
            task = reminder.task
            user = task.user
            subscriptions = (
                db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
            )
            if not subscriptions:
                continue

            payload = {
                "title": "Task Reminder",
                "body": f"{task.title} is due soon.",
                "url": "/",
                "tag": f"reminder-{reminder.id}",
            }
            delivered = False
            for subscription in subscriptions:
                delivered = send_web_push(subscription, payload, db) or delivered

            if delivered:
                reminder.notified_at = now

        db.commit()
    finally:
        db.close()


def push_worker_loop() -> None:
    while not push_worker_stop.is_set():
        try:
            dispatch_due_push_notifications()
        except Exception:
            pass
        push_worker_stop.wait(60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global push_worker_thread

    ensure_database_schema()
    if not PUSH_WORKER_DISABLED and not (push_worker_thread and push_worker_thread.is_alive()):
        push_worker_stop.clear()
        push_worker_thread = threading.Thread(
            target=push_worker_loop,
            name="push-reminder-worker",
            daemon=True,
        )
        push_worker_thread.start()

    try:
        yield
    finally:
        push_worker_stop.set()
        if push_worker_thread and push_worker_thread.is_alive():
            push_worker_thread.join(timeout=1.0)


app = FastAPI(
    title="Student Task Management PWA",
    description="A FastAPI backend for student coursework and deadline management.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/auth/register", response_model=AuthResponse, status_code=201)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email is already registered.")

    user = User(
        name=payload.name.strip(),
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.email)
    return AuthResponse(access_token=token, user=user)


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(user.email)
    return AuthResponse(access_token=token, user=user)


@app.get("/api/auth/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/api/settings", response_model=UserSettingsResponse)
def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return build_settings_response(db, current_user)


@app.put("/api/settings", response_model=UserSettingsResponse)
def update_settings(
    payload: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.notification_enabled = payload.notification_enabled
    db.commit()
    db.refresh(current_user)
    return build_settings_response(db, current_user)


@app.get("/api/push/public-key", response_model=PushPublicKeyResponse)
def get_push_public_key():
    return PushPublicKeyResponse(public_key=VAPID_PUBLIC_KEY)


@app.post("/api/push/subscribe", response_model=UserSettingsResponse, status_code=201)
def subscribe_push(
    payload: PushSubscriptionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscription = (
        db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    )
    if not subscription:
        subscription = PushSubscription(
            user_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
        db.add(subscription)
    else:
        subscription.user_id = current_user.id
        subscription.p256dh = payload.keys.p256dh
        subscription.auth = payload.keys.auth
        subscription.last_seen_at = datetime.utcnow()

    current_user.notification_enabled = True
    db.commit()
    db.refresh(current_user)
    return build_settings_response(db, current_user)


@app.delete("/api/push/subscribe", status_code=204)
def unsubscribe_push(
    endpoint: str = Query(..., min_length=10),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscription = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.endpoint == endpoint,
            PushSubscription.user_id == current_user.id,
        )
        .first()
    )
    if subscription:
        db.delete(subscription)
        db.commit()
    return None


@app.post("/api/push/test")
def send_test_push(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    subscriptions = db.query(PushSubscription).filter(PushSubscription.user_id == current_user.id).all()
    if not subscriptions:
        raise HTTPException(status_code=400, detail="Push notifications are not enabled on this device.")

    payload = {
        "title": "Test Notification",
        "body": "Push notifications are working for your Student Task Manager.",
        "url": "/",
        "tag": f"test-{current_user.id}",
    }
    delivered = False
    for subscription in subscriptions:
        delivered = send_web_push(subscription, payload, db) or delivered

    db.commit()
    if not delivered:
        raise HTTPException(status_code=400, detail="Unable to deliver a push notification to this device.")
    return {"message": "Test push notification sent."}


@app.get("/api/categories", response_model=list[CategoryResponse])
def list_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Category)
        .filter(Category.user_id == current_user.id)
        .order_by(Category.category_name.asc())
        .all()
    )


@app.post("/api/categories", response_model=CategoryResponse, status_code=201)
def create_category(
    payload: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(Category)
        .filter(
            Category.user_id == current_user.id,
            Category.category_name == payload.category_name.strip(),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists.")

    category = Category(user_id=current_user.id, category_name=payload.category_name.strip())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@app.put("/api/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    payload: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    category = validate_category_ownership(db, current_user.id, category_id)
    assert category is not None
    category.category_name = payload.category_name.strip()
    db.commit()
    db.refresh(category)
    return category


@app.delete("/api/categories/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    category = validate_category_ownership(db, current_user.id, category_id)
    assert category is not None

    for task in db.query(Task).filter(Task.category_id == category.id).all():
        task.category_id = None

    db.delete(category)
    db.commit()
    return None


@app.get("/api/tasks", response_model=list[TaskResponse])
def list_tasks(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serialize_task_query(db, current_user.id).all()


@app.post("/api/tasks", response_model=TaskResponse, status_code=201)
def create_task(
    payload: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    validate_category_ownership(db, current_user.id, payload.category_id)

    task = Task(
        user_id=current_user.id,
        category_id=payload.category_id,
        title=payload.title,
        description=payload.description,
        due_date=payload.due_date,
        priority=payload.priority,
        status=payload.status,
    )

    db.add(task)
    db.flush()
    for reminder in payload.reminders:
        db.add(Reminder(task_id=task.id, reminder_time=reminder.reminder_time))

    db.commit()
    return serialize_task_query(db, current_user.id).filter(Task.id == task.id).first()


@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = serialize_task_query(db, current_user.id).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task


@app.put("/api/tasks/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = serialize_task_query(db, current_user.id).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    if payload.category_id is not None:
        validate_category_ownership(db, current_user.id, payload.category_id)

    update_data = payload.model_dump(exclude_unset=True)
    reminder_payloads = update_data.pop("reminders", None)
    for field, value in update_data.items():
        setattr(task, field, value)

    if reminder_payloads is not None:
        replace_task_reminders(task, reminder_payloads, db)

    if task.due_date.year < 2000:
        raise HTTPException(status_code=400, detail="Due date is invalid.")
    for reminder in task.reminders:
        if reminder.reminder_time > task.due_date:
            raise HTTPException(
                status_code=400,
                detail="Reminder time must be before the task due date.",
            )

    db.commit()
    return serialize_task_query(db, current_user.id).filter(Task.id == task_id).first()


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    db.delete(task)
    db.commit()
    return None


@app.get("/api/dashboard", response_model=DashboardSummary)
def dashboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.now()
    start_of_today = datetime(now.year, now.month, now.day)
    end_of_today = start_of_today + timedelta(days=1)
    upcoming_limit = now + timedelta(days=7)

    base_query = db.query(Task).filter(Task.user_id == current_user.id)
    total_tasks = base_query.count()
    completed_tasks = base_query.filter(Task.status == TaskStatus.completed).count()
    overdue_count = (
        base_query.filter(and_(Task.due_date < now, Task.status != TaskStatus.completed)).count()
    )
    todays_tasks = (
        base_query.filter(and_(Task.due_date >= start_of_today, Task.due_date < end_of_today)).count()
    )
    upcoming_deadlines = (
        base_query.filter(
            and_(
                Task.due_date >= now,
                Task.due_date <= upcoming_limit,
                Task.status != TaskStatus.completed,
            )
        ).count()
    )

    completion_rate = round((completed_tasks / total_tasks) * 100, 2) if total_tasks else 0.0

    return DashboardSummary(
        todays_tasks=todays_tasks,
        upcoming_deadlines=upcoming_deadlines,
        overdue_count=overdue_count,
        completion_rate=completion_rate,
        total_tasks=total_tasks,
    )


@app.get("/api/reminders/due")
def due_reminders(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.now()
    reminders = (
        db.query(Reminder)
        .join(Task, Reminder.task_id == Task.id)
        .filter(
            Task.user_id == current_user.id,
            Reminder.reminder_time <= now,
            Reminder.notified_at.is_(None),
            Task.status != TaskStatus.completed,
        )
        .all()
    )
    reminder_payloads = [
        {
            "id": reminder.id,
            "task_id": reminder.task_id,
            "reminder_time": reminder.reminder_time,
            "task_title": reminder.task.title,
        }
        for reminder in reminders
    ]
    for reminder in reminders:
        reminder.notified_at = now
    if reminders:
        db.commit()
    return reminder_payloads


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="frontend-assets")


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/{full_path:path}")
def serve_spa_fallback(full_path: str):
    file_path = FRONTEND_DIR / full_path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(FRONTEND_DIR / "index.html")
