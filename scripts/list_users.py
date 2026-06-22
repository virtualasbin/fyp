from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import func

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.database import SessionLocal
from backend.models import Task, User


def list_users(email_filter: str | None = None) -> None:
    db = SessionLocal()
    try:
        query = (
            db.query(
                User.id,
                User.name,
                User.email,
                User.notification_enabled,
                func.count(Task.id).label("task_count"),
            )
            .outerjoin(Task, Task.user_id == User.id)
            .group_by(User.id, User.name, User.email, User.notification_enabled)
            .order_by(User.id.asc())
        )

        if email_filter:
            query = query.filter(User.email.ilike(f"%{email_filter}%"))

        users = query.all()
        if not users:
            print("No users found in the current database.")
            return

        print("Registered users:")
        print("-" * 88)
        print(f"{'ID':<6}{'Name':<22}{'Email':<38}{'Notify':<10}{'Tasks':<8}")
        print("-" * 88)
        for user in users:
            print(
                f"{user.id:<6}{user.name[:20]:<22}{user.email[:36]:<38}"
                f"{str(user.notification_enabled):<10}{user.task_count:<8}",
            )
        print("-" * 88)
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="List registered users from the current Student Task Manager database.",
    )
    parser.add_argument(
        "--email",
        help="Optional email filter, for example: --email pandey",
    )
    args = parser.parse_args()
    list_users(email_filter=args.email)


if __name__ == "__main__":
    main()
