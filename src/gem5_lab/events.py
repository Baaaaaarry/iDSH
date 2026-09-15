from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


EVENT_TYPES = {
    "EXPERIMENT_UPSERT",
    "STAGE_UPDATE",
    "TRIAL_STARTED",
    "TRIAL_PROGRESS",
    "TRIAL_FINISHED",
    "ITERATION_COMPLETED",
    "EXPERIMENT_FINISHED",
}


class EventValidationError(ValueError):
    pass


@dataclass(frozen=True)
class AgentEvent:
    event_id: str
    experiment_id: str
    event_type: str
    emitted_at: str
    payload: dict[str, Any]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentEvent":
        missing = [key for key in ("event_id", "experiment_id", "event_type", "emitted_at", "payload") if key not in data]
        if missing:
            raise EventValidationError(f"missing event fields: {missing}")
        if data.get("schema_version") != 1:
            raise EventValidationError("schema_version must be 1")
        if data["event_type"] not in EVENT_TYPES:
            raise EventValidationError(f"unsupported event_type: {data['event_type']}")
        if not isinstance(data["payload"], dict):
            raise EventValidationError("payload must be an object")
        try:
            datetime.fromisoformat(str(data["emitted_at"]).replace("Z", "+00:00"))
        except ValueError as exc:
            raise EventValidationError("emitted_at must be ISO-8601") from exc
        return cls(
            event_id=str(data["event_id"]),
            experiment_id=str(data["experiment_id"]),
            event_type=str(data["event_type"]),
            emitted_at=str(data["emitted_at"]),
            payload=data["payload"],
        )


class EventImporter:
    """Idempotently imports atomically-published Loop Agent JSON events."""

    def __init__(self, store: Any, directory: str | Path):
        self.store = store
        self.directory = Path(directory)

    def import_dict(self, data: dict[str, Any]) -> bool:
        return self.store.apply_agent_event(AgentEvent.from_dict(data))

    def import_file(self, path: str | Path) -> bool:
        source = Path(path)
        try:
            data = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise EventValidationError(f"invalid event file {source}: {exc}") from exc
        return self.import_dict(data)

    def scan(self) -> dict[str, Any]:
        imported = duplicates = 0
        errors: list[dict[str, str]] = []
        if not self.directory.exists():
            return {"imported": 0, "duplicates": 0, "errors": []}
        for path in sorted(self.directory.rglob("*.json")):
            try:
                if self.import_file(path):
                    imported += 1
                else:
                    duplicates += 1
            except EventValidationError as exc:
                errors.append({"file": str(path), "error": str(exc)})
        return {"imported": imported, "duplicates": duplicates, "errors": errors}


class AgentEventWriter:
    """Writes one event per file and publishes it atomically for the importer."""

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def write(self, event: dict[str, Any]) -> Path:
        validated = AgentEvent.from_dict(event)
        destination = self.directory / validated.experiment_id / f"{validated.emitted_at.replace(':', '')}-{validated.event_id}.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(event, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, destination)
        return destination


def make_event(event_id: str, experiment_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Convenience helper for runners and tests producing the public format."""
    return {
        "schema_version": 1,
        "event_id": event_id,
        "experiment_id": experiment_id,
        "event_type": event_type,
        "emitted_at": datetime.now(UTC).isoformat(),
        "payload": payload,
    }
