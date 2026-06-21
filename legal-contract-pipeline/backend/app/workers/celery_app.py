"""Celery application — broker: Redis, backend: Redis."""

from __future__ import annotations

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "legal_pipeline",
    broker=str(settings.REDIS_URL),
    backend=str(settings.REDIS_URL),
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,           # re-queue on worker crash
    worker_prefetch_multiplier=1,  # one task at a time per worker
    task_routes={
        "app.workers.tasks.run_review_pipeline": {"queue": "pipeline"},
    },
    beat_schedule={},
)
