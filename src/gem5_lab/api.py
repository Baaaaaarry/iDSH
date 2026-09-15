from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .store import Store
from .events import EventImporter, EventValidationError


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("GEM5_LAB_DB", ROOT / "var" / "gem5-lab.db"))
store = Store(DB_PATH)
EVENTS_PATH = Path(os.environ.get("GEM5_LAB_EVENTS", ROOT / "var" / "agent-events"))
importer = EventImporter(store, EVENTS_PATH)
app = FastAPI(title="gem5-lab", version="0.1.0")


def sync_events() -> None:
    importer.scan()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/experiments")
def experiments():
    sync_events()
    return store.experiments()


@app.get("/api/experiments/{experiment_id}")
def experiment(experiment_id: str):
    sync_events()
    detail = store.detail(experiment_id)
    if not detail:
        raise HTTPException(404, "experiment not found")
    return detail


@app.post("/api/events")
def ingest_event(event: dict):
    try:
        imported = importer.import_dict(event)
    except (EventValidationError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"status": "imported" if imported else "duplicate", "event_id": event.get("event_id")}


@app.post("/api/events/scan")
def scan_events():
    return importer.scan()


@app.get("/")
def dashboard():
    return FileResponse(ROOT / "dashboard" / "index.html")
