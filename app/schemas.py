from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models import TaskPriority, TaskStatus


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    notification_enabled: bool


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CategoryBase(BaseModel):
    category_name: str = Field(min_length=2, max_length=100)


class CategoryCreate(CategoryBase):
    pass


class CategoryResponse(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int


class ReminderBase(BaseModel):
    reminder_time: datetime


class ReminderCreate(ReminderBase):
    pass


class ReminderResponse(ReminderBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    due_date: datetime
    priority: TaskPriority = TaskPriority.medium
    status: TaskStatus = TaskStatus.pending
    category_id: int | None = None
    reminders: list[ReminderCreate] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("reminders")
    @classmethod
    def validate_reminders_count(cls, value: list[ReminderCreate]) -> list[ReminderCreate]:
        if len(value) > 5:
            raise ValueError("A task can have a maximum of 5 reminders.")
        return value

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskBase":
        if self.due_date.year < 2000:
            raise ValueError("Due date is invalid.")
        for reminder in self.reminders:
            if reminder.reminder_time > self.due_date:
                raise ValueError("Reminder time must be before the task due date.")
        return self


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    due_date: datetime | None = None
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    category_id: int | None = None
    reminders: list[ReminderCreate] | None = None

    @field_validator("title")
    @classmethod
    def validate_optional_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_optional_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    category_id: int | None
    title: str
    description: str | None
    due_date: datetime
    priority: TaskPriority
    status: TaskStatus
    reminders: list[ReminderResponse]


class DashboardSummary(BaseModel):
    todays_tasks: int
    upcoming_deadlines: int
    overdue_count: int
    completion_rate: float
    total_tasks: int


class UserSettingsUpdate(BaseModel):
    notification_enabled: bool


class UserSettingsResponse(BaseModel):
    notification_enabled: bool
    push_supported: bool
    push_subscribed: bool


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=255)
    auth: str = Field(min_length=8, max_length=255)


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(min_length=10, max_length=500)
    keys: PushSubscriptionKeys


class PushPublicKeyResponse(BaseModel):
    public_key: str
