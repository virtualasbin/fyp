from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from sqlalchemy import inspect

from backend.database import Base, SessionLocal, engine
from backend.models import Category, PushSubscription, Reminder, Task, TaskPriority, TaskStatus, User
from backend.security import hash_password


DEMO_EMAIL = "demo@studenttasks.example.com"
LEGACY_DEMO_EMAILS = ["demo@studenttasks.local"]
DEMO_PASSWORD = "Password123"
DEMO_NAME = "Demo Student"


def ensure_seed_schema() -> None:
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


def ensure_demo_user(reset_demo: bool) -> None:
    ensure_seed_schema()
    db = SessionLocal()
    try:
        user = db.query(User).filter(
            User.email.in_([DEMO_EMAIL, *LEGACY_DEMO_EMAILS]),
        ).first()
        if not user:
            user = User(
                name=DEMO_NAME,
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.name = DEMO_NAME
            user.email = DEMO_EMAIL
            user.password_hash = hash_password(DEMO_PASSWORD)
            user.notification_enabled = False
            db.commit()
            db.refresh(user)

        if reset_demo:
            task_ids = [task_id for (task_id,) in db.query(Task.id).filter(Task.user_id == user.id).all()]
            if task_ids:
                db.query(Reminder).filter(Reminder.task_id.in_(task_ids)).delete(
                    synchronize_session=False,
                )
            db.query(Task).filter(Task.user_id == user.id).delete(synchronize_session=False)
            db.query(Category).filter(Category.user_id == user.id).delete(synchronize_session=False)
            db.query(PushSubscription).filter(PushSubscription.user_id == user.id).delete(
                synchronize_session=False,
            )
            db.commit()

        existing_tasks = db.query(Task).filter(Task.user_id == user.id).count()
        if existing_tasks:
            print("Demo user already has tasks. Use --reset-demo for a fresh sample dataset.")
            print_credentials()
            return

        category_names = [
            "Web Development",
            "Database Systems",
            "Research Methods",
            "Final Year Project",
        ]
        categories: dict[str, Category] = {}
        for name in category_names:
            category = Category(user_id=user.id, category_name=name)
            db.add(category)
            db.flush()
            categories[name] = category

        now = datetime.now().replace(second=0, microsecond=0)
        sample_tasks = [
            {
                "title": "Finish AT3 implementation section",
                "description": "Write the implementation overview and include screenshots of the dashboard.",
                "due_date": now + timedelta(hours=6),
                "priority": TaskPriority.high,
                "status": TaskStatus.in_progress,
                "category": "Final Year Project",
                "reminders": [now + timedelta(hours=2)],
            },
            {
                "title": "Prepare database schema revision",
                "description": "Review entity relationships and verify Appendix F matches the implementation.",
                "due_date": now + timedelta(days=2),
                "priority": TaskPriority.high,
                "status": TaskStatus.pending,
                "category": "Database Systems",
                "reminders": [now + timedelta(days=1, hours=2)],
            },
            {
                "title": "Read usability testing articles",
                "description": "Collect references for the testing and evaluation section.",
                "due_date": now + timedelta(days=4),
                "priority": TaskPriority.medium,
                "status": TaskStatus.pending,
                "category": "Research Methods",
                "reminders": [],
            },
            {
                "title": "Deploy latest build to local review environment",
                "description": "Check responsive layout and offline caching before taking screenshots.",
                "due_date": now - timedelta(days=1),
                "priority": TaskPriority.high,
                "status": TaskStatus.pending,
                "category": "Web Development",
                "reminders": [now - timedelta(days=1, hours=2)],
            },
            {
                "title": "Complete literature review summary",
                "description": "Summarise the key sources for contextual research.",
                "due_date": now - timedelta(days=3),
                "priority": TaskPriority.low,
                "status": TaskStatus.completed,
                "category": "Research Methods",
                "reminders": [],
            },
            {
                "title": "Create final dashboard screenshots",
                "description": "Capture desktop and mobile dashboard views for evidence.",
                "due_date": now + timedelta(days=1),
                "priority": TaskPriority.medium,
                "status": TaskStatus.pending,
                "category": "Final Year Project",
                "reminders": [now + timedelta(hours=8)],
            },
        ]

        for sample in sample_tasks:
            task = Task(
                user_id=user.id,
                category_id=categories[sample["category"]].id,
                title=sample["title"],
                description=sample["description"],
                due_date=sample["due_date"],
                priority=sample["priority"],
                status=sample["status"],
            )
            db.add(task)
            db.flush()

            for reminder_time in sample["reminders"]:
                db.add(Reminder(task_id=task.id, reminder_time=reminder_time))

        db.commit()
        print("Demo data seeded successfully.")
        print_credentials()
    finally:
        db.close()


def print_credentials() -> None:
    print(f"Email: {DEMO_EMAIL}")
    print(f"Password: {DEMO_PASSWORD}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed safe demo data for the Student Task Manager.")
    parser.add_argument(
        "--reset-demo",
        action="store_true",
        help="Reset the demo user's categories and tasks before seeding fresh sample data.",
    )
    args = parser.parse_args()
    ensure_demo_user(reset_demo=args.reset_demo)


if __name__ == "__main__":
    main()
