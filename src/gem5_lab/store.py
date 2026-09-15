from __future__ import annotations

import json
import math
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import ExperimentSpec, TrialResult
from .events import AgentEvent, EventValidationError


def utcnow() -> str:
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._migrate()

    def _migrate(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS experiments (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL,
              stop_reason TEXT, spec_json TEXT NOT NULL, champion_trial_id TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              current_stage TEXT NOT NULL DEFAULT 'CREATE_EXPERIMENT'
            );
            CREATE TABLE IF NOT EXISTS iterations (
              experiment_id TEXT NOT NULL, number INTEGER NOT NULL,
              best_score REAL, relative_improvement REAL, created_at TEXT NOT NULL,
              PRIMARY KEY (experiment_id, number)
            );
            CREATE TABLE IF NOT EXISTS trials (
              id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, iteration INTEGER NOT NULL,
              config_hash TEXT NOT NULL, config_json TEXT NOT NULL, status TEXT NOT NULL,
              result_json TEXT, utility REAL, created_at TEXT NOT NULL, finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_trials_experiment ON trials(experiment_id, iteration);
            CREATE TABLE IF NOT EXISTS agent_events (
              event_id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL,
              event_type TEXT NOT NULL, emitted_at TEXT NOT NULL,
              payload_json TEXT NOT NULL, imported_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_events_experiment
              ON agent_events(experiment_id, emitted_at);
            """
        )
        experiment_columns = {row["name"] for row in self.db.execute("PRAGMA table_info(experiments)")}
        if "current_stage" not in experiment_columns:
            self.db.execute(
                "ALTER TABLE experiments ADD COLUMN current_stage TEXT NOT NULL DEFAULT 'CREATE_EXPERIMENT'"
            )
        if "metadata_json" not in experiment_columns:
            self.db.execute("ALTER TABLE experiments ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")
        trial_columns = {row["name"] for row in self.db.execute("PRAGMA table_info(trials)")}
        for name, sql_type, default in (
            ("stage", "TEXT", "NULL"),
            ("progress", "REAL", "0"),
            ("progress_json", "TEXT", "'{}'"),
            ("changed_params_json", "TEXT", "'[]'"),
            ("core_scope", "TEXT", "NULL"),
            ("benchmark_kind", "TEXT", "NULL"),
        ):
            if name not in trial_columns:
                self.db.execute(f"ALTER TABLE trials ADD COLUMN {name} {sql_type} DEFAULT {default}")
        iteration_columns = {row["name"] for row in self.db.execute("PRAGMA table_info(iterations)")}
        if "metrics_json" not in iteration_columns:
            self.db.execute("ALTER TABLE iterations ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}'")
        self.db.commit()

    def create_experiment(self, experiment_id: str, spec: ExperimentSpec) -> None:
        now = utcnow()
        self.db.execute(
            """INSERT INTO experiments
               (id, name, state, stop_reason, spec_json, champion_trial_id,
                created_at, updated_at, current_stage)
               VALUES (?, ?, 'CREATED', NULL, ?, NULL, ?, ?, 'CREATE_EXPERIMENT')""",
            (experiment_id, spec.name, json.dumps(spec.to_dict()), now, now),
        )
        self.db.commit()

    def update_stage(self, experiment_id: str, stage: str) -> None:
        self.db.execute(
            "UPDATE experiments SET current_stage=?, updated_at=? WHERE id=?",
            (stage, utcnow(), experiment_id),
        )
        self.db.commit()

    def update_experiment(
        self, experiment_id: str, state: str, stop_reason: str | None = None,
        champion_trial_id: str | None = None,
    ) -> None:
        self.db.execute(
            "UPDATE experiments SET state=?, stop_reason=?, champion_trial_id=COALESCE(?, champion_trial_id), updated_at=? WHERE id=?",
            (state, stop_reason, champion_trial_id, utcnow(), experiment_id),
        )
        self.db.commit()

    def add_trial(self, trial_id: str, experiment_id: str, iteration: int, key: str, config: dict[str, Any]) -> None:
        self.db.execute(
            """INSERT INTO trials
               (id, experiment_id, iteration, config_hash, config_json, status,
                result_json, utility, created_at, finished_at)
               VALUES (?, ?, ?, ?, ?, 'RUNNING', NULL, NULL, ?, NULL)""",
            (trial_id, experiment_id, iteration, key, json.dumps(config), utcnow()),
        )
        self.db.commit()

    def finish_trial(self, trial_id: str, result: TrialResult, utility: float) -> None:
        self.db.execute(
            "UPDATE trials SET status=?, result_json=?, utility=?, finished_at=? WHERE id=?",
            (result.status, json.dumps(result.to_dict()), utility, utcnow(), trial_id),
        )
        self.db.commit()

    def add_iteration(self, experiment_id: str, number: int, best_score: float, improvement: float) -> None:
        self.db.execute(
            """INSERT INTO iterations
               (experiment_id, number, best_score, relative_improvement, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (experiment_id, number, best_score, improvement, utcnow()),
        )
        self.db.commit()

    def experiment(self, experiment_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM experiments WHERE id=?", (experiment_id,)).fetchone()
        if not row:
            return None
        result = dict(row)
        result["spec"] = json.loads(result.pop("spec_json"))
        result["metadata"] = json.loads(result.pop("metadata_json", "{}") or "{}")
        return result

    def experiments(self) -> list[dict[str, Any]]:
        return [self.experiment(row["id"]) for row in self.db.execute("SELECT id FROM experiments ORDER BY created_at DESC")]

    def trials(self, experiment_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM trials WHERE experiment_id=? ORDER BY iteration, created_at", (experiment_id,)
        ).fetchall()
        output = []
        for row in rows:
            item = dict(row)
            if item["utility"] is not None and not math.isfinite(item["utility"]):
                item["utility"] = -1_000_000_000.0
            item["config"] = json.loads(item.pop("config_json"))
            item["result"] = json.loads(item.pop("result_json")) if item["result_json"] else None
            item["progress_detail"] = json.loads(item.pop("progress_json", "{}") or "{}")
            item["changed_parameters"] = json.loads(item.pop("changed_params_json", "[]") or "[]")
            output.append(item)
        return output

    def iterations(self, experiment_id: str) -> list[dict[str, Any]]:
        output = []
        for row in self.db.execute("SELECT * FROM iterations WHERE experiment_id=? ORDER BY number", (experiment_id,)):
            item = dict(row)
            item["metrics"] = json.loads(item.pop("metrics_json", "{}") or "{}")
            output.append(item)
        return output

    def events(self, experiment_id: str, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """SELECT event_id, event_type, emitted_at, payload_json
               FROM agent_events WHERE experiment_id=?
               ORDER BY emitted_at DESC LIMIT ?""",
            (experiment_id, limit),
        ).fetchall()
        return [
            {"event_id": row["event_id"], "event_type": row["event_type"],
             "emitted_at": row["emitted_at"], "payload": json.loads(row["payload_json"])}
            for row in rows
        ]

    def apply_agent_event(self, event: AgentEvent) -> bool:
        if self.db.execute("SELECT 1 FROM agent_events WHERE event_id=?", (event.event_id,)).fetchone():
            return False
        payload = event.payload
        now = utcnow()
        try:
            self.db.execute("BEGIN")
            if event.event_type == "EXPERIMENT_UPSERT":
                spec = payload.get("spec", {})
                name = payload.get("name") or event.experiment_id
                self.db.execute(
                    """INSERT INTO experiments
                       (id,name,state,stop_reason,spec_json,champion_trial_id,created_at,updated_at,current_stage,metadata_json)
                       VALUES (?,?,?,NULL,?,NULL,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET name=excluded.name,
                         spec_json=excluded.spec_json, metadata_json=excluded.metadata_json,
                         updated_at=excluded.updated_at""",
                    (event.experiment_id, name, payload.get("state", "CREATED"), json.dumps(spec),
                     event.emitted_at, now, payload.get("current_stage", "CREATE_EXPERIMENT"),
                     json.dumps(payload.get("metadata", {}))),
                )
            else:
                if not self.db.execute("SELECT 1 FROM experiments WHERE id=?", (event.experiment_id,)).fetchone():
                    raise EventValidationError("EXPERIMENT_UPSERT must be imported first")
                if event.event_type == "STAGE_UPDATE":
                    self.db.execute("UPDATE experiments SET current_stage=?,state=?,updated_at=? WHERE id=?",
                        (payload["stage"], payload.get("state", "RUNNING"), now, event.experiment_id))
                elif event.event_type == "TRIAL_STARTED":
                    self.db.execute(
                        """INSERT INTO trials
                           (id,experiment_id,iteration,config_hash,config_json,status,result_json,utility,
                            created_at,finished_at,stage,progress,progress_json,changed_params_json,core_scope,benchmark_kind)
                           VALUES (?,?,?,?,?,'RUNNING',NULL,NULL,?,NULL,?,0,?,?,?,?)
                           ON CONFLICT(id) DO UPDATE SET status='RUNNING',stage=excluded.stage,
                             progress=0,progress_json=excluded.progress_json,changed_params_json=excluded.changed_params_json""",
                        (payload["trial_id"], event.experiment_id, int(payload["iteration"]),
                         payload.get("config_hash", payload["trial_id"]), json.dumps(payload.get("config", {})),
                         event.emitted_at, payload.get("stage", "CONSTRAINT_CHECK"),
                         json.dumps(payload.get("progress_detail", {})), json.dumps(payload.get("changed_parameters", [])),
                         payload.get("core_scope"), payload.get("benchmark_kind")),
                    )
                elif event.event_type == "TRIAL_PROGRESS":
                    progress = float(payload.get("progress", 0))
                    if not 0 <= progress <= 1:
                        raise EventValidationError("trial progress must be between 0 and 1")
                    self.db.execute(
                        """UPDATE trials SET stage=?,progress=?,progress_json=?
                           WHERE id=? AND experiment_id=?""",
                        (payload.get("stage"), progress, json.dumps(payload.get("progress_detail", {})),
                         payload["trial_id"], event.experiment_id),
                    )
                    self.db.execute("UPDATE experiments SET current_stage=?,state='RUNNING',updated_at=? WHERE id=?",
                        (payload.get("stage", "GKB_QUICK_TEST"), now, event.experiment_id))
                elif event.event_type == "TRIAL_FINISHED":
                    result = payload["result"]
                    self.db.execute(
                        """UPDATE trials SET status=?,result_json=?,utility=?,finished_at=?,stage=?,progress=1,
                           progress_json=?,changed_params_json=? WHERE id=? AND experiment_id=?""",
                        (result["status"], json.dumps(result), payload.get("utility"), event.emitted_at,
                         payload.get("stage", "PARSE_METRICS"), json.dumps(payload.get("progress_detail", {})),
                         json.dumps(payload.get("changed_parameters", [])), payload["trial_id"], event.experiment_id),
                    )
                    if payload.get("best_candidate_updated"):
                        self.db.execute("UPDATE experiments SET champion_trial_id=?,updated_at=? WHERE id=?",
                            (payload["trial_id"], now, event.experiment_id))
                elif event.event_type == "ITERATION_COMPLETED":
                    self.db.execute(
                        """INSERT INTO iterations
                           (experiment_id,number,best_score,relative_improvement,created_at,metrics_json)
                           VALUES (?,?,?,?,?,?) ON CONFLICT(experiment_id,number) DO UPDATE SET
                           best_score=excluded.best_score,relative_improvement=excluded.relative_improvement,
                           metrics_json=excluded.metrics_json""",
                        (event.experiment_id, int(payload["iteration"]), float(payload["best_score"]),
                         float(payload.get("relative_improvement", 0)), event.emitted_at,
                         json.dumps(payload.get("metrics", {}))),
                    )
                elif event.event_type == "EXPERIMENT_FINISHED":
                    self.db.execute(
                        """UPDATE experiments SET state=?,stop_reason=?,champion_trial_id=COALESCE(?,champion_trial_id),
                           current_stage='DASHBOARD_FINAL_RESULT',updated_at=? WHERE id=?""",
                        (payload["state"], payload.get("stop_reason"), payload.get("champion_trial_id"), now,
                         event.experiment_id),
                    )
            self.db.execute(
                "INSERT INTO agent_events VALUES (?,?,?,?,?,?)",
                (event.event_id, event.experiment_id, event.event_type, event.emitted_at,
                 json.dumps(payload), now),
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return True

    def detail(self, experiment_id: str) -> dict[str, Any] | None:
        experiment = self.experiment(experiment_id)
        if not experiment:
            return None
        trials = self.trials(experiment_id)
        experiment["trials"] = trials
        experiment["iterations"] = self.iterations(experiment_id)
        experiment["counts"] = {
            "total": len(trials),
            "completed": sum(t["status"] == "COMPLETED" for t in trials),
            "failed": sum(t["status"] == "FAILED" for t in trials),
            "running": sum(t["status"] == "RUNNING" for t in trials),
        }
        champion_id = experiment.get("champion_trial_id")
        experiment["champion"] = next((t for t in trials if t["id"] == champion_id), None)
        experiment["current_trial"] = next((t for t in reversed(trials) if t["status"] == "RUNNING"), None)
        experiment["events"] = self.events(experiment_id)
        return experiment
